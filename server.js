'use strict';

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';

const COMMUNITY_PASSWORD =
process.env.BMP_COMMUNITY_PASSWORD || 'bM.pcom.unitybrsecrityu';

const rooms = new Map();

function makeRoom(id, name, password) {
return {
id: id,
name: name,
password: password,
connectionCode: '0',
responseCode: '0',
revision: 0,
updatedAt: Date.now(),
members: new Map(),
sockets: new Set(),
hostPeerId: null
};
}

rooms.set(
'public',
makeRoom('public', 'چت عمومی', null)
);

rooms.set(
'community',
makeRoom(
'community',
'B.M.P COMMUNITY',
COMMUNITY_PASSWORD
)
);

function getRoom(id) {
return rooms.get(String(id)) || null;
}

function generateCode() {
let value = '';

for (let i = 0; i < 10; i += 1) {
value += String(crypto.randomInt(0, 10));
}

return value;
}

function ensureCodes(room) {
if (room.connectionCode === '0') {
room.connectionCode = generateCode();
}

if (room.responseCode === '0') {
room.responseCode = generateCode();
}

room.revision += 1;
room.updatedAt = Date.now();
}

function resetRoom(room) {
room.connectionCode = '0';
room.responseCode = '0';
room.hostPeerId = null;
room.revision += 1;
room.updatedAt = Date.now();
}

function getRoomState(room) {
return {
id: room.id,
name: room.name,
connectionCode: room.connectionCode,
responseCode: room.responseCode,
revision: room.revision,
updatedAt: room.updatedAt,
online: room.members.size,
hostPeerId: room.hostPeerId
};
}

function getMembers(room) {
return Array.from(room.members.values()).map(
function (member) {
return {
peerId: member.peerId,
name: member.name
};
}
);
}

function sendJson(res, status, data) {
res.writeHead(status, {
'Content-Type':
'application/json; charset=utf-8',

'Cache-Control':
'no-store',

'Access-Control-Allow-Origin':
'*',

'Access-Control-Allow-Headers':
'Content-Type',

'Access-Control-Allow-Methods':
'GET,POST,OPTIONS'
});

res.end(JSON.stringify(data));
}

function readJson(req) {
return new Promise(function (resolve, reject) {
let body = '';

req.on('data', function (chunk) {
body += chunk;

if (body.length > 1048576) {
reject(
new Error('Request too large')
);

req.destroy();
}
});

req.on('end', function () {
if (!body) {
resolve({});
return;
}

try {
resolve(JSON.parse(body));
} catch (error) {
reject(
new Error('Invalid JSON')
);
}
});

req.on('error', reject);
});
}

function validPassword(room, password) {
if (room.password === null) {
return true;
}

return String(password || '') ===
room.password;
}

function sendSocket(socket, data) {
if (
socket.readyState ===
WebSocket.OPEN
) {
socket.send(
JSON.stringify(data)
);
}
}

function broadcast(
room,
data,
exceptSocket
) {
room.sockets.forEach(
function (socket) {
if (socket === exceptSocket) {
return;
}

sendSocket(socket, data);
}
);
}

function broadcastRoom(room) {
broadcast(room, {
type: 'room-state',

room:
getRoomState(room),

members:
getMembers(room)
});
}

function removeSocket(room, socket) {
if (socket.peerId) {
const member =
room.members.get(
socket.peerId
);

if (
member &&
member.socket === socket
) {
room.members.delete(
socket.peerId
);
}

if (
room.hostPeerId ===
socket.peerId
) {
const next =
room.members.values()
.next().value;

room.hostPeerId =
next
? next.peerId
: null;
}
}

room.sockets.delete(socket);

if (room.members.size === 0) {
resetRoom(room);
} else {
room.revision += 1;
room.updatedAt = Date.now();
}

broadcastRoom(room);
}

function getPathRoomId(pathname) {
const prefix = '/api/rooms/';

if (
pathname.indexOf(prefix) !== 0
) {
return null;
}

const id =
pathname.slice(prefix.length);

if (
!id ||
id.indexOf('/') !== -1
) {
return null;
}

return id;
}

async function handleRequest(
req,
res
) {
if (req.method === 'OPTIONS') {
res.writeHead(204, {
'Access-Control-Allow-Origin':
'*',

'Access-Control-Allow-Headers':
'Content-Type',

'Access-Control-Allow-Methods':
'GET,POST,OPTIONS'
});

res.end();
return;
}

const parsed = new URL(
req.url,
'http://' +
(req.headers.host || 'localhost')
);

const pathname =
parsed.pathname;

if (
req.method === 'GET' &&
pathname === '/health'
) {
sendJson(res, 200, {
ok: true,

service:
'BEHRAD M PLAYER realtime backend',

time:
new Date().toISOString()
});

return;
}

if (
req.method === 'GET' &&
pathname === '/api/rooms'
) {
sendJson(res, 200, {
ok: true,

rooms:
Array.from(
rooms.values()
).map(getRoomState)
});

return;
}

if (req.method === 'GET') {
const roomId =
getPathRoomId(pathname);

if (roomId !== null) {
const room =
getRoom(roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

sendJson(res, 200, {
ok: true,

room:
getRoomState(room),

members:
getMembers(room)
});

return;
}
}

if (
req.method === 'POST' &&
pathname === '/api/room/join'
) {
try {
const body =
await readJson(req);

const room =
getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

if (
!validPassword(
room,
body.password
)
) {
sendJson(res, 403, {
ok: false,
error: 'INVALID_PASSWORD'
});

return;
}

ensureCodes(room);

sendJson(res, 200, {
ok: true,

room:
getRoomState(room),

members:
getMembers(room)
});
} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

if (
req.method === 'POST' &&
pathname === '/api/room/leave'
) {
try {
const body =
await readJson(req);

const room =
getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

const peerId =
String(body.peerId || '');

const member =
room.members.get(peerId);

if (member) {
room.members.delete(peerId);

if (member.socket) {
room.sockets.delete(
member.socket
);
}
}

if (room.members.size === 0) {
resetRoom(room);
} else {
room.revision += 1;
room.updatedAt =
Date.now();
}

broadcastRoom(room);

sendJson(res, 200, {
ok: true,

room:
getRoomState(room)
});
} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

if (
req.method === 'POST' &&
pathname === '/api/room/state'
) {
try {
const body =
await readJson(req);

const room =
getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

if (
body.connectionCode !==
undefined
) {
room.connectionCode =
String(
body.connectionCode
);
}

if (
body.responseCode !==
undefined
) {
room.responseCode =
String(
body.responseCode
);
}

room.revision += 1;
room.updatedAt =
Date.now();

broadcastRoom(room);

sendJson(res, 200, {
ok: true,

room:
getRoomState(room)
});
} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

if (
req.method === 'POST' &&
pathname === '/api/signal'
) {
try {
const body =
await readJson(req);

const room =
getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

const target =
room.members.get(
String(body.to || '')
);

if (
!target ||
!target.socket
) {
sendJson(res, 404, {
ok: false,
error: 'PEER_NOT_FOUND'
});

return;
}

sendSocket(
target.socket,
{
type: 'signal',

from:
String(
body.from || ''
),

to:
String(
body.to || ''
),

signal:
body.signal
}
);

sendJson(res, 200, {
ok: true
});
} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

sendJson(res, 404, {
ok: false,
error: 'NOT_FOUND'
});
}

const server =
http.createServer(
function (req, res) {
handleRequest(
req,
res
).catch(
function (error) {
console.error(error);

if (!res.headersSent) {
sendJson(res, 500, {
ok: false,
error:
'INTERNAL_SERVER_ERROR'
});
} else {
res.end();
}
}
);
}
);

const wss =
new WebSocket.Server({
server: server,
path: '/ws'
});

wss.on(
'connection',
function (socket) {
socket.isAlive = true;
socket.roomId = null;
socket.peerId = null;

socket.on(
'pong',
function () {
socket.isAlive = true;
}
);

socket.on(
'message',
function (raw) {
let message;

try {
message =
JSON.parse(
raw.toString()
);
} catch (error) {
sendSocket(socket, {
type: 'error',
error:
'INVALID_MESSAGE'
});

return;
}

if (
message.type ===
'hello'
) {
const room =
getRoom(
message.roomId
);

if (!room) {
sendSocket(socket, {
type: 'error',
error:
'ROOM_NOT_FOUND'
});

return;
}

if (
!validPassword(
room,
message.password
)
) {
sendSocket(socket, {
type: 'error',
error:
'INVALID_PASSWORD'
});

socket.close(
1008,
'Invalid password'
);

return;
}

if (socket.roomId) {
const oldRoom =
getRoom(
socket.roomId
);

if (
oldRoom &&
oldRoom !== room
) {
removeSocket(
oldRoom,
socket
);
}
}

const peerId =
String(
message.peerId ||
crypto.randomUUID()
);

const name =
String(
message.name ||
'کاربر'
).slice(0, 50);

ensureCodes(room);

socket.roomId =
room.id;

socket.peerId =
peerId;

room.sockets.add(
socket
);

room.members.set(
peerId,
{
peerId:
peerId,

name:
name,

socket:
socket,

joinedAt:
Date.now()
}
);

if (!room.hostPeerId) {
room.hostPeerId =
peerId;
}

room.revision += 1;
room.updatedAt =
Date.now();

sendSocket(socket, {
type: 'welcome',

peerId:
peerId,

room:
getRoomState(room),

members:
getMembers(room)
});

broadcast(
room,
{
type:
'peer-joined',

peer: {
peerId:
peerId,

name:
name
}
},
socket
);

broadcastRoom(room);

return;
}

if (
!socket.roomId ||
!socket.peerId
) {
sendSocket(socket, {
type: 'error',
error:
'NOT_JOINED'
});

return;
}

const room =
getRoom(
socket.roomId
);

if (!room) {
return;
}

if (
message.type ===
'room-state'
) {
if (
message.connectionCode !==
undefined
) {
room.connectionCode =
String(
message.connectionCode
);
}

if (
message.responseCode !==
undefined
) {
room.responseCode =
String(
message.responseCode
);
}

room.revision += 1;
room.updatedAt =
Date.now();

broadcastRoom(room);

return;
}

if (
message.type ===
'signal'
) {
const target =
room.members.get(
String(
message.to || ''
)
);

if (
target &&
target.socket
) {
sendSocket(
target.socket,
{
type:
'signal',

from:
socket.peerId,

to:
String(
message.to || ''
),

signal:
message.signal
}
);
}

return;
}

if (
message.type ===
'chat'
) {
const sender =
room.members.get(
socket.peerId
);

const text =
String(
message.text || ''
).slice(0, 4000);

if (!text) {
return;
}

broadcast(
room,
{
type:
'chat',

message: {
id:
crypto.randomUUID(),

peerId:
socket.peerId,

name:
sender
? sender.name
: 'کاربر',

text:
text,

time:
Date.now()
}
}
);

return;
}

if (
message.type ===
'presence'
) {
broadcast(
room,
{
type:
'presence',

peerId:
socket.peerId,

status:
String(
message.status ||
'online'
)
}
);
}
}
);

socket.on(
'close',
function () {
if (!socket.roomId) {
return;
}

const room =
getRoom(
socket.roomId
);

if (room) {
removeSocket(
room,
socket
);
}
}
);

socket.on(
'error',
function (error) {
console.error(
'WebSocket error:',
error.message
);
}
);
}
);

const heartbeat =
setInterval(
function () {
wss.clients.forEach(
function (socket) {
if (
socket.isAlive ===
false
) {
socket.terminate();
return;
}

socket.isAlive = false;
socket.ping();
}
);
},
30000
);

wss.on(
'close',
function () {
clearInterval(
heartbeat
);
}
);

server.listen(
PORT,
HOST,
function () {
console.log(
'BEHRAD M PLAYER realtime server listening on ' +
HOST +
':' +
PORT
);
}
);
