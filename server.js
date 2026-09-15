const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const COMMUNITY_PASSWORD = process.env.BMP_COMMUNITY_PASSWORD || 'bM.pcom.unitybrsecrityu';

const ROOMS = {
  community: { id: 'community', name: 'B.M.P COMMUNITY', private: true, password: COMMUNITY_PASSWORD },
  public: { id: 'public', name: 'چت عمومی', private: false, password: '' }
};

const rooms = new Map();
for (const r of Object.values(ROOMS)) {
  rooms.set(r.id, { ...r, connectionCode: '0', responseCode: '0', revision: 0, members: new Map(), sockets: new Set(), hostPeerId: null, updatedAt: Date.now() });
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function makeCode() {
  let n = '';
  for (let i = 0; i < 10; i++) n += crypto.randomInt(0, 10).toString();
  return n;
}

function ensureCodes(room) {
  if (room.members.size === 0) {
    room.connectionCode = '0';
    room.responseCode = '0';
    room.hostPeerId = null;
    return false;
  }
  let changed = false;
  if (room.connectionCode === '0') { room.connectionCode = makeCode(); changed = true; }
  if (room.responseCode === '0') { room.responseCode = makeCode(); changed = true; }
  if (!room.hostPeerId) room.hostPeerId = room.members.keys().next().value;
  if (changed) room.revision++;
  room.updatedAt = Date.now();
  return changed;
}

function publicRoom(room) {
  return {
    roomId: room.id,
    name: room.name,
    private: room.private,
    connectionCode: room.connectionCode,
    responseCode: room.responseCode,
    revision: room.revision,
    memberCount: room.members.size,
    hostPeerId: room.hostPeerId,
    updatedAt: room.updatedAt
  };
}

function publicMembers(room) {
  return Array.from(room.members.values()).map(m => ({ peerId: m.peerId, name: m.name, joinedAt: m.joinedAt }));
}

function broadcast(room, message, except) {
  const data = JSON.stringify(message);
  for (const ws of room.sockets) {
    if (ws !== except && ws.readyState === 1) ws.send(data);
  }
}

function broadcastState(room) {
  broadcast(room, { event: 'room-state', state: publicRoom(room), members: publicMembers(room) });
}

function validRoom(id) { return rooms.get(id); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1000000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function removeMember(room, peerId) {
  if (!peerId) return false;
  const existed = room.members.delete(peerId);
  if (!existed) return false;
  room.revision++;
  room.updatedAt = Date.now();
  if (room.members.size === 0) {
    room.connectionCode = '0';
    room.responseCode = '0';
    room.hostPeerId = null;
    room.revision++;
  } else if (room.hostPeerId === peerId) {
    room.hostPeerId = room.members.keys().next().value || null;
  }
  broadcast(room, { event: 'presence', members: publicMembers(room), state: publicRoom(room) });
  broadcast(room, { event: 'room-state', state: publicRoom(room), members: publicMembers(room) });
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { ok: true, service: 'BEHRAD M PLAYER realtime', time: new Date().toISOString() });
  }

  if (req.method === 'GET' && path === '/api/rooms') {
    return json(res, 200, { ok: true, rooms: Array.from(rooms.values()).map(publicRoom) });
  }

  if (req.method === 'GET' && path.indexOf('/api/rooms/') === 0) {
    const id = decodeURIComponent(path.slice('/api/rooms/'.length));
    const room = validRoom(id);
    if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });
    return json(res, 200, { ok: true, room: publicRoom(room), members: publicMembers(room) });
  }

  if (req.method === 'POST' && path === '/api/room/join') {
    try {
      const b = await readBody(req);
      const room = validRoom(String(b.roomId || ''));
      const peerId = String(b.peerId || '').slice(0, 128);
      const name = String(b.name || 'کاربر').slice(0, 40);
      if (!room || !peerId) return json(res, 400, { ok: false, error: 'bad_request' });
      if (room.private && String(b.password || '') !== room.password) return json(res, 403, { ok: false, error: 'invalid_password' });
      room.members.set(peerId, { peerId, name, joinedAt: Date.now() });
      ensureCodes(room);
      room.revision++;
      room.updatedAt = Date.now();
      broadcastState(room);
      return json(res, 200, { ok: true, room: publicRoom(room), members: publicMembers(room) });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'bad_request' }); }
  }

  if (req.method === 'POST' && path === '/api/room/leave') {
    try {
      const b = await readBody(req);
      const room = validRoom(String(b.roomId || ''));
      if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });
      removeMember(room, String(b.peerId || ''));
      return json(res, 200, { ok: true, room: publicRoom(room), members: publicMembers(room) });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'bad_request' }); }
  }

  if (req.method === 'POST' && path === '/api/room/state') {
    try {
      const b = await readBody(req);
      const room = validRoom(String(b.roomId || ''));
      if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });
      if (room.private && String(b.password || '') !== room.password) return json(res, 403, { ok: false, error: 'invalid_password' });
      if (b.connectionCode && /^\d{10}$/.test(String(b.connectionCode))) room.connectionCode = String(b.connectionCode);
      if (b.responseCode && /^\d{10}$/.test(String(b.responseCode))) room.responseCode = String(b.responseCode);
      room.revision++;
      room.updatedAt = Date.now();
      broadcastState(room);
      return json(res, 200, { ok: true, room: publicRoom(room) });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'bad_request' }); }
  }

  if (req.method === 'POST' && path === '/api/signal') {
    try {
      const b = await readBody(req);
      const room = validRoom(String(b.roomId || ''));
      if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });
      const from = String(b.from || '');
      const to = String(b.to || '');
      const target = room.members.get(to);
      const sender = room.members.get(from);
      if (!sender || !target) return json(res, 404, { ok: false, error: 'peer_not_found' });
      broadcast(room, { event: 'signal', from, to, data: b.data }, null);
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'bad_request' }); }
  }

  if (req.method === 'GET' && path === '/') return json(res, 200, { ok: true, service: 'BEHRAD M PLAYER realtime', endpoints: ['/health', '/api/rooms', '/ws'] });
  return json(res, 404, { ok: false, error: 'NOT_FOUND' });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
  let room = null;
  let peerId = null;

  ws.send(JSON.stringify({ event: 'connected', time: Date.now() }));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.type === 'hello') {
      const nextRoom = validRoom(String(m.roomId || ''));
      const nextPeer = String(m.peerId || '').slice(0, 128);
      if (!nextRoom || !nextPeer) return ws.send(JSON.stringify({ event: 'error', error: 'bad_hello' }));
      if (nextRoom.private && String(m.password || '') !== nextRoom.password) return ws.send(JSON.stringify({ event: 'error', error: 'invalid_password' }));
      if (room && room !== nextRoom) removeMember(room, peerId);
      room = nextRoom;
      peerId = nextPeer;
      room.sockets.add(ws);
      room.members.set(peerId, { peerId, name: String(m.name || 'کاربر').slice(0, 40), joinedAt: Date.now() });
      ensureCodes(room);
      room.revision++;
      room.updatedAt = Date.now();
      ws.send(JSON.stringify({ event: 'ready', room: publicRoom(room), members: publicMembers(room) }));
      broadcastState(room);
      return;
    }

    if (!room || !peerId) return ws.send(JSON.stringify({ event: 'error', error: 'not_joined' }));

    if (m.type === 'room-state') {
      if (m.connectionCode && /^\d{10}$/.test(String(m.connectionCode))) room.connectionCode = String(m.connectionCode);
      if (m.responseCode && /^\d{10}$/.test(String(m.responseCode))) room.responseCode = String(m.responseCode);
      room.revision++;
      room.updatedAt = Date.now();
      broadcastState(room);
      return;
    }

    if (m.type === 'presence') {
      broadcast(room, { event: 'presence', members: publicMembers(room), state: publicRoom(room) });
      return;
    }

    if (m.type === 'signal') {
      const to = String(m.to || '');
      if (!room.members.has(to)) return;
      broadcast(room, { event: 'signal', from: peerId, to, data: m.data }, null);
      return;
    }

    if (m.type === 'chat') {
      const text = String(m.text || '').trim().slice(0, 2000);
      if (!text) return;
      broadcast(room, { event: 'chat', from: peerId, name: room.members.get(peerId)?.name || 'کاربر', text, ts: Date.now() }, null);
      return;
    }
  });

  ws.on('close', () => {
    if (!room || !peerId) return;
    room.sockets.delete(ws);
    removeMember(room, peerId);
  });

  ws.on('error', () => {});
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const ws of room.sockets) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }
}, 30000);

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

server.listen(PORT, HOST, () => console.log('BEHRAD M PLAYER realtime server listening on ' + HOST + ':' + PORT));
