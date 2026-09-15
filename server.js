/**
• BEHRAD M PLAYER
• Realtime backend for Render
• امکانات:
◦ دو روم ثابت
◦ کد اتصال ۱۰ رقمی
◦ کد پاسخ ۱۰ رقمی
◦ وضعیت مشترک روم
◦ WebSocket
◦ Chat
◦ Presence
◦ WebRTC signaling relay
*/

'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';

const COMMUNITY_PASSWORD =
process.env.BMP_COMMUNITY_PASSWORD ||
'bM.pcom.unitybrsecrityu';

const ROOM_DEFS = {
public: {
id: 'public',
name: 'چت عمومی',
private: false
},

community: {
id: 'community',
name: 'B.M.P COMMUNITY',
private: true
}
};

const MAX_NAME = 40;
const MAX_CHAT = 4000;
const MEMBER_TTL = 35000;

/* =========================
Utility
========================= */

function random10() {
let result = '';

while (result.length < 10) {
result += String(
crypto.randomInt(0, 10)
);
}

return result;
}

function cleanName(value) {
const name = String(value ?? '')
.trim()
.slice(0, MAX_NAME);

return name || 'کاربر';
}

function cleanPeerId(value) {
return String(value ?? '')
.trim()
.slice(0, 120);
}

/* =========================
Room State
========================= */

function emptyState(roomId) {
return {
roomId,
connectionCode: '0',
responseCode: '0',
hostPeerId: '',
revision: 0,
updatedAt: 0
};
}

const rooms = new Map(
Object.values(ROOM_DEFS).map(def => [
def.id,

{
...def,

state: emptyState(def.id),

members: new Map(),

sockets: new Set()
}
])
);

/*
peerId -> client
*/
const clients = new Map();

/* =========================
Public Room Data
========================= */

function publicRoom(room) {
return {
roomId: room.id,

name: room.name,

private: room.private,

connectionCode:
room.state.connectionCode,

responseCode:
room.state.responseCode,

hostPeerId:
room.state.hostPeerId,

revision:
room.state.revision,

updatedAt:
room.state.updatedAt,

online:
room.members.size
};
}

/* =========================
WebSocket helpers
========================= */

function send(ws, data) {
if (
!ws ||
ws.readyState !== WebSocket.OPEN
) {
return false;
}

try {
ws.send(
JSON.stringify(data)
);

return true;
} catch {
return false;
}
}

function broadcast(
room,
data,
exceptWs = null
) {
for (const ws of room.sockets) {
if (ws !== exceptWs) {
send(ws, data);
}
}
}

function broadcastRoomState(room) {
broadcast(room, {
event: 'room-state',

state: publicRoom(room)
});
}

/* =========================
Generate room codes
========================= */

function ensureRoomCodes(
room,
peerId
) {
/*
اگر روم خالی بوده:
دو کد جدید تولید می‌شود.

اگر قبلاً کد داشته:
همان کد حفظ می‌شود.
*/

if (
room.state.connectionCode !== '0' ||
room.state.responseCode !== '0'
) {
return false;
}

room.state = {
roomId: room.id,

connectionCode:
random10(),

responseCode:
random10(),

hostPeerId:
peerId,

revision: 1,

updatedAt:
Date.now()
};

broadcastRoomState(room);

return true;
}

/* =========================
Presence
========================= */

function getPresence(room) {
return [
...room.members.values()
 ].map(member => ({
peerId: member.peerId,

name: member.name,

roomId: room.id,

online: true,

lastSeen: member.lastSeen
}));
}

function broadcastPresence(room) {
broadcast(room, {
event: 'presence',

roomId: room.id,

members:
getPresence(room)
});
}

/* =========================
Member management
========================= */

function removeMember(
room,
peerId,
expectedWs = null
) {
const member =
room.members.get(peerId);

if (!member) {
return;
}

const client =
clients.get(peerId);

/*
اگر اتصال جدید جایگزین شده،
اتصال جدید را حذف نکن.
*/

if (
expectedWs &&
client?.ws &&
client.ws !== expectedWs
) {
return;
}

room.members.delete(peerId);

if (client?.ws) {
room.sockets.delete(
client.ws
);
}

if (
client?.roomId === room.id
) {
clients.delete(peerId);
}

broadcastPresence(room);

/*
وقتی آخرین نفر خارج شد،
روم دوباره 0 / 0 می‌شود.
*/

if (room.members.size === 0) {
room.state =
emptyState(room.id);

broadcastRoomState(room);
}
}

function upsertMember(
room,
peerId,
name,
ws = null
) {
const now = Date.now();

room.members.set(
peerId,
{
peerId,

name,

roomId: room.id,

lastSeen: now
}
);

clients.set(
peerId,
{
peerId,

name,

roomId: room.id,

ws,

lastSeen: now
}
);
}

/* =========================
HTTP helpers
========================= */

function corsHeaders() {
return {
'Access-Control-Allow-Origin': '*',

'Access-Control-Allow-Headers':
'Content-Type',

'Access-Control-Allow-Methods':
'GET,POST,OPTIONS',

'Cache-Control':
'no-store'
};
}

function json(
res,
status,
payload
) {
res.writeHead(
status,

{
...corsHeaders(),

'Content-Type':
'application/json; charset=utf-8'
}
);

res.end(
JSON.stringify(payload)
);
}

async function readJson(req) {
let data = '';

for await (const chunk of req) {
data += chunk;

if (
data.length >
256 * 1024
) {
throw new Error(
'request_too_large'
);
}
}

return data
? JSON.parse(data)
: {};
}

function authenticateRoom(
room,
password
) {
if (!room.private) {
return true;
}

return password ===
COMMUNITY_PASSWORD;
}

/* =========================
HTTP SERVER
========================= */

const server =
http.createServer(
async (req, res) => {

/*
CORS preflight
*/

if (
req.method === 'OPTIONS'
) {
res.writeHead(
204,
corsHeaders()
);

return res.end();
}

const requestUrl =
new URL(
req.url,

http://${req.headers.host || 'localhost'}`
);

/* =====================
Health
===================== */

if (
req.method === 'GET' &&
requestUrl.pathname ===
'/health'
) {
return json(
res,

200,

{
ok: true,

service:
'BEHRAD M PLAYER realtime backend',

rooms:
[...rooms.values()]
.map(publicRoom),

time:
Date.now()
}
);
}

/* =====================
All rooms
===================== */

if (
req.method === 'GET' &&
requestUrl.pathname ===
'/api/rooms'
) {
return json(
res,

200,

{
ok: true,

rooms:
[...rooms.values()]
.map(publicRoom)
}
);
}

/* =====================
Single room
===================== */

if (
req.method === 'GET' &&
requestUrl.pathname
.startsWith('/api/rooms/')
) {
const roomId =
requestUrl.pathname
.split('/')
.pop();

const room =
rooms.get(roomId);

if (!room) {
return json(
res,

404,

{
ok: false,

error:
'room_not_found'
}
);
}

return json(
res,

200,

{
ok: true,

room:
publicRoom(room)
}
);
}

try {

/* =====================
Join room
===================== */

if (
req.method === 'POST' &&
requestUrl.pathname ===
'/api/room/join'
) {
const input =
await readJson(req);

const room =
rooms.get(
String(
input.roomId || ''
)
);

const peerId =
cleanPeerId(
input.peerId
);

const name =
cleanName(
input.name
);

if (
!room ||
!peerId
) {
return json(
res,

400,

{
ok: false,

error:
'invalid_room_or_peer'
}
);
}

if (
!authenticateRoom(
room,
input.password
)
) {
return json(
res,

403,

{
ok: false,

error:
'invalid_password'
}
);
}

const oldClient =
clients.get(peerId);

/*
اگر کاربر در روم دیگری بوده،
از روم قبلی خارجش کن.
*/

if (
oldClient?.roomId &&
oldClient.roomId !==
room.id
) {
const oldRoom =
rooms.get(
oldClient.roomId
);

if (oldRoom) {
removeMember(
oldRoom,
peerId
);
}
}

/*
اگر اولین نفر است،
کدها ساخته می‌شوند.
*/

ensureRoomCodes(
room,
peerId
);

upsertMember(
room,
peerId,
name,
oldClient?.ws || null
);

broadcastRoomState(room);

broadcastPresence(room);

return json(
res,

200,

{
ok: true,

room:
publicRoom(room),

members:
getPresence(room)
}
);
}

/* =====================
Leave room
===================== */

if (
req.method === 'POST' &&
requestUrl.pathname ===
'/api/room/leave'
) {
const input =
await readJson(req);

const room =
rooms.get(
String(
input.roomId || ''
)
);

const peerId =
cleanPeerId(
input.peerId
);

if (
!room ||
!peerId
) {
return json(
res,

400,

{
ok: false,

error:
'invalid_room_or_peer'
}
);
}

removeMember(
room,
peerId
);

return json(
res,

200,

{
ok: true,

room:
publicRoom(room)
}
);
}

/* =====================
Update room state
===================== */

if (
req.method === 'POST' &&
requestUrl.pathname ===
'/api/room/state'
) {
const input =
await readJson(req);

const room =
rooms.get(
String(
input.roomId || ''
)
);

const peerId =
cleanPeerId(
input.peerId
);

const connectionCode =
String(
input.connectionCode ||
''
);

const responseCode =
String(
input.responseCode ||
''
);

if (
!room ||
!peerId ||
!room.members.has(peerId)
) {
return json(
res,

403,

{
ok: false,

error:
'not_in_room'
}
);
}

/*
هر دو کد باید دقیقاً
۱۰ رقم باشند.
*/

if (
!/^\d{10}`$/.test(
connectionCode
) ||

!/^\d{10}$`/.test(
responseCode
)
) {
return json(
res,

400,

{
ok: false,

error:
'codes_must_be_10_digits'
}
);
}

const incomingRevision =
Number(
input.revision || 0
);

if (
incomingRevision >=
room.state.revision
) {
room.state = {
roomId:
room.id,

connectionCode,

responseCode,

hostPeerId:
cleanPeerId(
input.hostPeerId
) || peerId,

revision:
Math.max(
room.state.revision + 1,
incomingRevision
),

updatedAt:
Date.now()
};

/*
آپدیت برای تمام
کاربران روم ارسال می‌شود.
*/

broadcastRoomState(
room
);
}

return json(
res,

200,

{
ok: true,

room:
publicRoom(room)
}
);
}

/* =====================
HTTP WebRTC signaling
===================== */

if (
req.method === 'POST' &&
requestUrl.pathname ===
'/api/signal'
) {
const input =
await readJson(req);

const room =
rooms.get(
String(
input.roomId || ''
)
);

const from =
cleanPeerId(
input.from
);

const to =
cleanPeerId(
input.to
);

if (
!room ||
!from ||
!to ||
!room.members.has(from)
) {
return json(
res,

403,

{
ok: false,

error:
'invalid_signal_sender'
}
);
}

const target =
clients.get(to);

if (
!target ||
target.roomId !==
room.id ||
!target.ws
) {
return json(
res,

404,

{
ok: false,

error:
'target_not_connected'
}
);
}

send(
target.ws,

{
event:
'signal',

roomId:
room.id,

from,

to,

signalType:
input.signalType ||
'signal',

payload:
input.payload ||
{}
}
);

return json(
res,

200,

{
ok: true
}
);
}

return json(
res,

404,

{
ok: false,

error:
'not_found'
}
);

} catch (error) {

console.error(
'Request error:',
error
);

return json(
res,

400,

{
ok: false,

error:
'invalid_request'
}
);
}
}
);

/* =========================
WebSocket server
========================= */

const wss =
new WebSocket.Server({
server,

path: '/ws'
});

wss.on(
'connection',

ws => {

ws.isAlive = true;

ws.peerId = '';

ws.roomId = '';

ws.on(
'pong',

() => {
ws.isAlive = true;
}
);

ws.on(
'message',

raw => {

if (
raw.length >
256 * 1024
) {
return;
}

let message;

try {
message =
JSON.parse(
raw.toString()
);
} catch {
return;
}

const type =
String(
message.type || ''
);

/* =====================
HELLO / JOIN
===================== */

if (
type === 'hello'
) {
const peerId =
cleanPeerId(
message.peerId
);

const room =
rooms.get(
String(
message.roomId || ''
)
);

const name =
cleanName(
message.name
);

if (
!peerId ||
!room
) {
send(
ws,

{
event:
'error',

error:
'invalid_room_or_peer'
}
);

return;
}

if (
room.private &&
message.password !==
COMMUNITY_PASSWORD
) {
send(
ws,

{
event:
'error',

error:
'invalid_password'
}
);

try {
ws.close(
1008,
'invalid_password'
);
} catch {}

return;
}

const oldClient =
clients.get(peerId);

/*
اتصال قبلی همین peer
را جایگزین کن.
*/

if (
oldClient?.ws &&
oldClient.ws !== ws
) {
try {
oldClient.ws.close(
1000,
'replaced'
);
} catch {}
}

if (
oldClient?.roomId &&
oldClient.roomId !==
room.id
) {
const oldRoom =
rooms.get(
oldClient.roomId
);

if (oldRoom) {
removeMember(
oldRoom,
peerId
);
}
}

ws.peerId =
peerId;

ws.roomId =
room.id;

/*
کاربر وارد روم شد.
*/

upsertMember(
room,
peerId,
name,
ws
);

room.sockets.add(ws);

/*
اگر اولین نفر است،
کدهای ۱۰ رقمی ساخته می‌شوند.
*/

ensureRoomCodes(
room,
peerId
);

send(
ws,

{
event:
'ready',

room:
publicRoom(room),

members:
getPresence(room)
}
);

broadcastRoomState(
room
);

broadcastPresence(
room
);

return;
}

/* =====================
Authenticate message
===================== */

const peerId =
cleanPeerId(
message.peerId ||
ws.peerId
);

const room =
rooms.get(
String(
message.roomId ||
ws.roomId ||
''
)
);

const client =
clients.get(peerId);

/*
فقط WebSocket صاحب
همین peer اجازه دارد.
*/

if (
!client ||
!room ||
client.roomId !==
room.id ||
client.ws !== ws
) {
return;
}

client.lastSeen =
Date.now();

const member =
room.members.get(
peerId
);

if (member) {
member.lastSeen =
client.lastSeen;
}

/* =====================
Room State
===================== */

if (
type === 'room-state'
) {
const state =
message.payload ||
{};

const connectionCode =
String(
state.connectionCode ||
''
);

const responseCode =
String(
state.responseCode ||
''
);

if (
!/^\d{10}`$/.test(
connectionCode
) ||

!/^\d{10}$`/.test(
responseCode
)
) {
return;
}

const incomingRevision =
Number(
state.revision || 0
);

if (
incomingRevision >=
room.state.revision
) {
room.state = {
roomId:
room.id,

connectionCode,

responseCode,

hostPeerId:
cleanPeerId(
state.hostPeerId
) || peerId,

revision:
Math.max(
room.state.revision + 1,
incomingRevision
),

updatedAt:
Date.now()
};

broadcastRoomState(
room
);
}

return;
}

/* =====================
WebRTC SIGNAL
===================== */

if (
type === 'signal'
) {
const targetPeerId =
cleanPeerId(
message.to
);

const target =
clients.get(
targetPeerId
);

if (
!target ||
target.roomId !==
room.id ||
!target.ws
) {
return;
}

send(
target.ws,

{
event:
'signal',

roomId:
room.id,

from:
peerId,

to:
targetPeerId,

signalType:
message.signalType ||
'signal',

payload:
message.payload ||
{}
}
);

return;
}

/* =====================
CHAT
===================== */

if (
type === 'chat'
) {
const text =
String(
message.text || ''
)
.trim()
.slice(
0,
MAX_CHAT
);

if (!text) {
return;
}

broadcast(
room,

{
event:
'chat',

roomId:
room.id,

message: {
id:
crypto.randomUUID(),

peerId,

name:
client.name,

text,

at:
Date.now()
}
}
);

return;
}

/* =====================
Presence
===================== */

if (
type === 'presence'
) {
broadcastPresence(
room
);
}
}
);

/* =====================
WebSocket closed
===================== */

ws.on(
'close',

() => {

const peerId =
ws.peerId;

const room =
rooms.get(
ws.roomId
);

if (room) {
room.sockets.delete(
ws
);

removeMember(
room,
peerId,
ws
);
}
}
);

ws.on(
'error',

() => {}
);
}
);

/* =========================
Heartbeat + cleanup
========================= */

const heartbeatTimer =
setInterval(
() => {

const now =
Date.now();

/*
WebSocket heartbeat
*/

for (
const ws of wss.clients
) {

if (
ws.isAlive === false
) {
try {
ws.terminate();
} catch {}

continue;
}

ws.isAlive = false;

try {
ws.ping();
} catch {}
}

/*
Remove stale members
*/

for (
const room of rooms.values()
) {

for (
const [
peerId,
member
 ] of room.members
) {

if (
now - member.lastSeen >
MEMBER_TTL
) {

const client =
clients.get(
peerId
);

if (
!client ||
client.roomId !==
room.id ||
!client.ws ||
client.ws.readyState !==
WebSocket.OPEN
) {
removeMember(
room,
peerId
);
}
}
}
}

},

10000
);

/* =========================
Start
========================= */

server.listen(
PORT,
HOST,

() => {
console.log(
BEHRAD M PLAYER backend listening on${HOST}:${PORT}`
);
}
);

/* =========================
Graceful shutdown
========================= */

function shutdown() {

clearInterval(
heartbeatTimer
);

try {
wss.close();
} catch {}

server.close(
() => {
process.exit(0);
}
);
}

process.on(
'SIGTERM',
shutdown
);

process.on(
'SIGINT',
shutdown
);