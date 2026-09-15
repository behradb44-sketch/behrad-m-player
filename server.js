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

for (const room of Object.values(ROOMS)) {
rooms.set(room.id, {
id: room.id,
name: room.name,
password: room.password,
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
let code = '';

while (code.length < 10) {
code += crypto.randomInt(0, 10).toString();
}

return code;
}

function getRoom(roomId) {
return rooms.get(roomId) || null;
}

function ensureRoomCodes(room) {
if (room.connectionCode === '0') {
room.connectionCode = generateCode();
}

if (room.responseCode === '0') {
room.responseCode = generateCode();
}

room.revision += 1;
room.updatedAt = Date.now();

if (!room.hostPeerId) {
const firstMember = room.members.values().next().value;

if (firstMember) {
room.hostPeerId = firstMember.peerId;
}
}
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

function membersState(room) {
return Array.from(room.members.values()).map(member => ({
peerId: member.peerId,
name: member.name
}));
}

function sendJson(res, statusCode, data) {
const body = JSON.stringify(data);

res.writeHead(statusCode, {
'Content-Type': 'application/json; charset=utf-8',
'Cache-Control': 'no-store',
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'Content-Type',
'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
});

res.end(body);
}

function readJson(req) {
return new Promise((resolve, reject) => {
let body = '';

req.on('data', chunk => {
body += chunk;

if (body.length > 1024 * 1024) {
reject(new Error('Request too large'));
req.destroy();
}
});

req.on('end', () => {
if (!body) {
resolve({});
return;
}

try {
resolve(JSON.parse(body));
} catch {
reject(new Error('Invalid JSON'));
}
});

req.on('error', reject);
});
}

function broadcast(room, message, exceptSocket = null) {
const payload = JSON.stringify(message);

for (const socket of room.sockets) {
if (socket === exceptSocket) {
continue;
}

if (socket.readyState === WebSocket.OPEN) {
socket.send(payload);
}
}
}

function broadcastRoomState(room) {
broadcast(room, {
type: 'room-state',
room: roomState(room),
members: membersState(room)
});
}

function removeMember(room, socket) {
const peerId = socket.peerId;

if (!peerId) {
room.sockets.delete(socket);
return;
}

const member = room.members.get(peerId);

if (member && member.socket === socket) {
room.members.delete(peerId);
}

room.sockets.delete(socket);

if (room.hostPeerId === peerId) {
const nextMember = room.members.values().next().value;
room.hostPeerId = nextMember ? nextMember.peerId : null;
}

if (room.members.size === 0) {
resetRoom(room);
} else {
room.revision += 1;
room.updatedAt = Date.now();
}

broadcastRoomState(room);
}

function validateRoomPassword(room, password) {
if (!room.password) {
return true;
}

return String(password || '') === room.password;
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

const url = new URL(
req.url,
http://${req.headers.host || 'localhost'}`
);

if (req.method === 'GET' && url.pathname === '/health') {
sendJson(res, 200, {
ok: true,
service: 'BEHRAD M PLAYER realtime backend',
time: new Date().toISOString()
});

return;
}

if (req.method === 'GET' && url.pathname === '/api/rooms') {
sendJson(res, 200, {
ok: true,
rooms: Array.from(rooms.values()).map(roomState)
});

return;
}

const roomMatch = url.pathname.match(/^/api/rooms/([^/]+)`$/);

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
members: membersState(room)
});

return;
}

if (req.method === 'POST' && url.pathname === '/api/room/join') {
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

if (!validateRoomPassword(room, body.password)) {
sendJson(res, 403, {
ok: false,
error: 'INVALID_PASSWORD'
});

return;
}

ensureRoomCodes(room);

sendJson(res, 200, {
ok: true,
room: roomState(room),
members: membersState(room)
});
} catch (error) {
sendJson(res, 400, {
ok: false,
error: error.message
});
}

return;
}

if (req.method === 'POST' && url.pathname === '/api/room/leave') {
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

const member = room.members.get(body.peerId);

if (member) {
room.members.delete(body.peerId);

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

broadcastRoomState(room);

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

if (req.method === 'POST' && url.pathname === '/api/room/state') {
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

if (body.connectionCode) {
room.connectionCode = String(body.connectionCode);
}

if (body.responseCode) {
room.responseCode = String(body.responseCode);
}

room.revision += 1;
room.updatedAt = Date.now();

broadcastRoomState(room);

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

if (req.method === 'POST' && url.pathname === '/api/signal') {
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

const target = room.members.get(body.to);

if (!target || !target.socket) {
sendJson(res, 404, {
ok: false,
error: 'PEER_NOT_FOUND'
});

return;
}

if (target.socket.readyState === WebSocket.OPEN) {
target.socket.send(JSON.stringify({
type: 'signal',
from: body.from,
to: body.to,
signal: body.signal
}));
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

sendJson(res, 404, {
ok: false,
error: 'NOT_FOUND'
});
}

const server = http.createServer((req, res) => {
handleHttp(req, res).catch(error => {
console.error(error);

sendJson(res, 500, {
ok: false,
error: 'INTERNAL_SERVER_ERROR'
});
});
});

const wss = new WebSocket.Server({
server,
path: '/ws'
});

wss.on('connection', socket => {
socket.isAlive = true;
socket.roomId = null;
socket.peerId = null;

socket.on('pong', () => {
socket.isAlive = true;
});

socket.on('message', raw => {
try {
const message = JSON.parse(raw.toString());

if (message.type === 'hello') {
const room = getRoom(message.roomId);

if (!room) {
socket.send(JSON.stringify({
type: 'error',
error: 'ROOM_NOT_FOUND'
}));

return;
}

if (!validateRoomPassword(room, message.password)) {
socket.send(JSON.stringify({
type: 'error',
error: 'INVALID_PASSWORD'
}));

socket.close(1008, 'Invalid password');
return;
}

if (socket.roomId && socket.roomId !== room.id) {
const oldRoom = getRoom(socket.roomId);

if (oldRoom) {
removeMember(oldRoom, socket);
}
}

const peerId = String(message.peerId || crypto.randomUUID());
const name = String(message.name || 'کاربر');

ensureRoomCodes(room);

socket.roomId = room.id;
socket.peerId = peerId;

room.sockets.add(socket);

room.members.set(peerId, {
peerId,
name,
socket,
joinedAt: Date.now()
});

if (!room.hostPeerId) {
room.hostPeerId = peerId;
}

room.revision += 1;
room.updatedAt = Date.now();

socket.send(JSON.stringify({
type: 'welcome',
peerId,
room: roomState(room),
members: membersState(room)
}));

broadcast(
room,
{
type: 'peer-joined',
peer: {
peerId,
name
}
},
socket
);

broadcastRoomState(room);

return;
}

if (!socket.roomId || !socket.peerId) {
socket.send(JSON.stringify({
type: 'error',
error: 'NOT_JOINED'
}));

return;
}

const room = getRoom(socket.roomId);

if (!room) {
return;
}

if (message.type === 'room-state') {
if (message.connectionCode) {
room.connectionCode = String(message.connectionCode);
}

if (message.responseCode) {
room.responseCode = String(message.responseCode);
}

room.revision += 1;
room.updatedAt = Date.now();

broadcastRoomState(room);
return;
}

if (message.type === 'signal') {
const target = room.members.get(String(message.to));

if (
target &&
target.socket &&
target.socket.readyState === WebSocket.OPEN
) {
target.socket.send(JSON.stringify({
type: 'signal',
from: socket.peerId,
to: target.peerId,
signal: message.signal
}));
}

return;
}

if (message.type === 'chat') {
const sender = room.members.get(socket.peerId);

broadcast(room, {
type: 'chat',
message: {
id: crypto.randomUUID(),
peerId: socket.peerId,
name: sender ? sender.name : 'کاربر',
text: String(message.text || ''),
time: Date.now()
}
});

return;
}

if (message.type === 'presence') {
broadcast(room, {
type: 'presence',
peerId: socket.peerId,
status: message.status || 'online'
});

return;
}
} catch (error) {
socket.send(JSON.stringify({
type: 'error',
error: 'INVALID_MESSAGE'
}));
}
});

socket.on('close', () => {
if (!socket.roomId) {
return;
}

const room = getRoom(socket.roomId);

if (room) {
removeMember(room, socket);
}
});

socket.on('error', error => {
console.error('WebSocket error:', error.message);
});
});

const heartbeat = setInterval(() => {
for (const socket of wss.clients) {
if (socket.isAlive === false) {
socket.terminate();
continue;
}

socket.isAlive = false;
socket.ping();
}
}, 30000);

wss.on('close', () => {
clearInterval(heartbeat);
});

server.listen(PORT, HOST, () => {
console.log(
BEHRAD M PLAYER realtime server listening on ${HOST}:${PORT}
);
});
