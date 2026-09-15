'use strict';

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';

const COMMUNITY_PASSWORD =
process.env.BMP_COMMUNITY_PASSWORD || 'bM.pcom.unitybrsecrityu';

const ROOMS = {
public: {
id: 'public',
name: 'چت عمومی',
password: null
},

community: {
id: 'community',
name: 'B.M.P COMMUNITY',
password: COMMUNITY_PASSWORD
}
};

const rooms = new Map();

for (const definition of Object.values(ROOMS)) {
rooms.set(definition.id, {
id: definition.id,
name: definition.name,
password: definition.password,

connectionCode: '0',
responseCode: '0',

revision: 0,
updatedAt: Date.now(),

members: new Map(),
sockets: new Set(),

hostPeerId: null
});
}

function generateCode() {
let result = '';

for (let i = 0; i < 10; i++) {
result += crypto.randomInt(0, 10).toString();
}

return result;
}

function getRoom(roomId) {
return rooms.get(String(roomId)) || null;
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

function roomState(room) {
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

function memberState(room) {
return Array.from(room.members.values()).map(function (member) {
return {
peerId: member.peerId,
name: member.name
};
});
}

function sendJson(res, status, data) {
res.writeHead(status, {
'Content-Type': 'application/json; charset=utf-8',
'Cache-Control': 'no-store',

'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'Content-Type',
'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
});

res.end(JSON.stringify(data));
}

function readJson(req) {
return new Promise(function (resolve, reject) {
let body = '';

req.on('data', function (chunk) {
body += chunk;

if (body.length > 1048576) {
reject(new Error('Request too large'));
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
reject(new Error('Invalid JSON'));
}
});

req.on('error', reject);
});
}

function isPasswordValid(room, password) {
if (room.password === null) {
return true;
}

return String(password || '') === room.password;
}

function broadcast(room, message, excludedSocket) {
const payload = JSON.stringify(message);

room.sockets.forEach(function (socket) {
if (socket === excludedSocket) {
return;
}

if (socket.readyState === WebSocket.OPEN) {
socket.send(payload);
}
});
}

function broadcastRoom(room) {
broadcast(room, {
type: 'room-state',
room: roomState(room),
members: memberState(room)
});
}

function removeSocketFromRoom(room, socket) {
const peerId = socket.peerId;

if (peerId) {
const member = room.members.get(peerId);

if (member && member.socket === socket) {
room.members.delete(peerId);
}

if (room.hostPeerId === peerId) {
const nextMember = room.members.values().next().value;

room.hostPeerId = nextMember
? nextMember.peerId
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

async function handleHttp(req, res) {
if (req.method === 'OPTIONS') {
res.writeHead(204, {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'Content-Type',
'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
});

res.end();
return;
}

const requestUrl = new URL(
req.url,
'http://' + (req.headers.host || 'localhost')
);

const pathname = requestUrl.pathname;

/*
• HEALTH
*/

if (req.method === 'GET' && pathname === '/health') {
sendJson(res, 200, {
ok: true,
service: 'BEHRAD M PLAYER realtime backend',
time: new Date().toISOString()
});

return;
}

/*
• ALL ROOMS
*/

if (req.method === 'GET' && pathname === '/api/rooms') {
sendJson(res, 200, {
ok: true,
rooms: Array.from(rooms.values()).map(roomState)
});

return;
}

/*
• SINGLE ROOM
*/

const roomMatch = pathname.match(
const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
);

if (req.method === 'GET' && roomMatch) {
const room = getRoom(roomMatch[1]);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

sendJson(res, 200, {
ok: true,
room: roomState(room),
members: memberState(room)
});

return;
}

/*
• JOIN ROOM
*/

if (
req.method === 'POST' &&
pathname === '/api/room/join'
) {
try {
const body = await readJson(req);

const room = getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

if (!isPasswordValid(room, body.password)) {
sendJson(res, 403, {
ok: false,
error: 'INVALID_PASSWORD'
});

return;
}

ensureCodes(room);

sendJson(res, 200, {
ok: true,
room: roomState(room),
members: memberState(room)
});

} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

/*
• LEAVE ROOM
*/

if (
req.method === 'POST' &&
pathname === '/api/room/leave'
) {
try {
const body = await readJson(req);

const room = getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

const peerId = String(body.peerId || '');

const member = room.members.get(peerId);

if (member) {
room.members.delete(peerId);

if (member.socket) {
room.sockets.delete(member.socket);
}
}

if (room.members.size === 0) {
resetRoom(room);
} else {
room.revision += 1;
room.updatedAt = Date.now();
}

broadcastRoom(room);

sendJson(res, 200, {
ok: true,
room: roomState(room)
});

} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

/*
• ROOM STATE
*/

if (
req.method === 'POST' &&
pathname === '/api/room/state'
) {
try {
const body = await readJson(req);

const room = getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

if (body.connectionCode !== undefined) {
room.connectionCode = String(
body.connectionCode
);
}

if (body.responseCode !== undefined) {
room.responseCode = String(
body.responseCode
);
}

room.revision += 1;
room.updatedAt = Date.now();

broadcastRoom(room);

sendJson(res, 200, {
ok: true,
room: roomState(room)
});

} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

/*
• WEBRTC SIGNAL
*/

if (
req.method === 'POST' &&
pathname === '/api/signal'
) {
try {
const body = await readJson(req);

const room = getRoom(body.roomId);

if (!room) {
sendJson(res, 404, {
ok: false,
error: 'ROOM_NOT_FOUND'
});

return;
}

const target = room.members.get(
String(body.to || '')
);

if (!target || !target.socket) {
sendJson(res, 404, {
ok: false,
error: 'PEER_NOT_FOUND'
});

return;
}

if (
target.socket.readyState === WebSocket.OPEN
) {
target.socket.send(
JSON.stringify({
type: 'signal',
from: String(body.from || ''),
to: String(body.to || ''),
signal: body.signal
})
);
}

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

/*
• NOT FOUND
*/

sendJson(res, 404, {
ok: false,
error: 'NOT_FOUND'
});
}

/*
• HTTP SERVER
*/

const server = http.createServer(
function (req, res) {
handleHttp(req, res).catch(
function (error) {
console.error(error);

sendJson(res, 500, {
ok: false,
error: 'INTERNAL_SERVER_ERROR'
});
}
);
}
);

/*
• WEBSOCKET SERVER
*/

const wss = new WebSocket.Server({
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
message = JSON.parse(
raw.toString()
);
} catch (error) {

socket.send(
JSON.stringify({
type: 'error',
error: 'INVALID_MESSAGE'
})
);

return;
}

/*
* HELLO / JOIN
*/

if (message.type === 'hello') {

const room = getRoom(
message.roomId
);

if (!room) {

socket.send(
JSON.stringify({
type: 'error',
error: 'ROOM_NOT_FOUND'
})
);

return;
}

if (
!isPasswordValid(
room,
message.password
)
) {

socket.send(
JSON.stringify({
type: 'error',
error: 'INVALID_PASSWORD'
})
);

socket.close(
1008,
'Invalid password'
);

return;
}

if (socket.roomId) {

const oldRoom = getRoom(
socket.roomId
);

if (
oldRoom &&
oldRoom !== room
) {
removeSocketFromRoom(
oldRoom,
socket
);
}
}

const peerId = String(
message.peerId ||
crypto.randomUUID()
);

const name = String(
message.name ||
'کاربر'
);

ensureCodes(room);

socket.roomId = room.id;
socket.peerId = peerId;

room.sockets.add(socket);

room.members.set(
peerId,
{
peerId: peerId,
name: name,
socket: socket,
joinedAt: Date.now()
}
);

if (!room.hostPeerId) {
room.hostPeerId = peerId;
}

room.revision += 1;
room.updatedAt = Date.now();

socket.send(
JSON.stringify({
type: 'welcome',
peerId: peerId,
room: roomState(room),
members: memberState(room)
})
);

broadcast(
room,
{
type: 'peer-joined',

peer: {
peerId: peerId,
name: name
}
},

socket
);

broadcastRoom(room);

return;
}

/*
* USER MUST BE IN A ROOM
*/

if (
!socket.roomId ||
!socket.peerId
) {

socket.send(
JSON.stringify({
type: 'error',
error: 'NOT_JOINED'
})
);

return;
}

const room = getRoom(
socket.roomId
);

if (!room) {
return;
}

/*
* ROOM STATE UPDATE
*/

if (
message.type === 'room-state'
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
room.updatedAt = Date.now();

broadcastRoom(room);

return;
}

/*
* WEBRTC SIGNALING
*/

if (
message.type === 'signal'
) {

const target =
room.members.get(
String(message.to || '')
);

if (
target &&
target.socket &&
target.socket.readyState ===
WebSocket.OPEN
) {

target.socket.send(
JSON.stringify({
type: 'signal',

from: socket.peerId,

to: String(
message.to || ''
),

signal: message.signal
})
);
}

return;
}

/*
* CHAT
*/

if (
message.type === 'chat'
) {

const sender =
room.members.get(
socket.peerId
);

broadcast(
room,
{
type: 'chat',

message: {
id: crypto.randomUUID(),

peerId:
socket.peerId,

name:
sender
? sender.name
: 'کاربر',

text:
String(
message.text || ''
),

time: Date.now()
}
}
);

return;
}

/*
* PRESENCE
*/

if (
message.type === 'presence'
) {

broadcast(
room,
{
type: 'presence',

peerId:
socket.peerId,

status:
String(
message.status ||
'online'
)
}
);

return;
}
}
);

/*
* SOCKET CLOSED
*/

socket.on(
'close',
function () {

if (!socket.roomId) {
return;
}

const room = getRoom(
socket.roomId
);

if (room) {
removeSocketFromRoom(
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

/*
• HEARTBEAT
*/

const heartbeat = setInterval(
function () {

wss.clients.forEach(
function (socket) {

if (socket.isAlive === false) {
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
clearInterval(heartbeat);
}
);

/*
• START SERVER
*/

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
