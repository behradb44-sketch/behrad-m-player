const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const COMMUNITY_PASSWORD = process.env.BMP_COMMUNITY_PASSWORD || 'bM.pcom.unitybrsecrityu';

const ROOMS = {
  community: { id: 'community', name: 'B.M.P COMMUNITY', type: 'text', private: true, password: COMMUNITY_PASSWORD, inviteToken: '', permanent: true },
  public: { id: 'public', name: 'چت عمومی', type: 'text', private: false, password: '', inviteToken: '', permanent: true },
  public_voice: { id: 'public_voice', name: 'گفتگوی صوتی عمومی', type: 'voice', private: false, password: '', inviteToken: '', permanent: true },
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

function makeToken(bytes = 24) { return crypto.randomBytes(bytes).toString('hex'); }

function makeRoomId() {
  return 'room_' + crypto.randomBytes(9).toString('base64url');
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
    type: room.type || 'text',
    connectionCode: room.connectionCode,
    responseCode: room.responseCode,
    revision: room.revision,
    memberCount: room.members.size,
    hostPeerId: room.hostPeerId,
    updatedAt: room.updatedAt,
    permanent: !!room.permanent
  };
}

function publicMembers(room) {
  return Array.from(room.members.values()).map(m => ({ peerId: m.peerId, name: m.name, username: m.username || '', joinedAt: m.joinedAt }));
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


  if (req.method === 'GET' && path === '/api/aparat-videos') {
    const username = 'BEHRAD_M_PLAYER_1393';
    const cacheKey = '__bmp_aparat_cache';
    const now = Date.now();
    const decodeEntities = (value) => String(value || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .trim();
    const clean = (value) => decodeEntities(value).replace(/\\\//g, '/').trim();
    const absolute = (value) => {
      const x = clean(value);
      if (!x) return '';
      if (/^https?:\/\//i.test(x)) return x;
      if (x.startsWith('//')) return 'https:' + x;
      if (x.startsWith('/')) return 'https://www.aparat.com' + x;
      return '';
    };
    const tag = (xml, names) => {
      for (const name of names) {
        const re = new RegExp('<(?:[\\w-]+:)?' + name + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?' + name + '>', 'i');
        const m = xml.match(re);
        if (m && clean(m[1])) return clean(m[1]);
      }
      return '';
    };
    const parseRss = (xml) => {
      const items = [];
      const seen = new Set();
      const chunks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
      for (const item of chunks) {
        const title = tag(item, ['title']);
        const link = absolute(tag(item, ['link'])) || clean(tag(item, ['link']));
        const guid = clean(tag(item, ['guid']));
        const description = tag(item, ['description', 'summary']);
        const enclosure = absolute(tag(item, ['content', 'enclosure', 'thumbnail', 'image']));
        const hashMatch = (link + ' ' + guid).match(/(?:\/v\/|videohash\/)([A-Za-z0-9_-]{4,})/i);
        const id = hashMatch ? hashMatch[1] : (guid.match(/[A-Za-z0-9_-]{4,}$/) || [])[0];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        let thumbnail = enclosure;
        const descImg = description.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
        if (!thumbnail && descImg) thumbnail = absolute(descImg[1]);
        const mediaImg = item.match(/<(?:media:)?(?:thumbnail|content|image)\b[^>]*\burl=["']([^"']+)["']/i);
        if (!thumbnail && mediaImg) thumbnail = absolute(mediaImg[1]);
        thumbnail = thumbnail || `https://static.cdn.asset.aparat.com/avt/${id}/320.jpg`;
        items.push({ id, title: title || 'ویدیوی BEHRAD M PLAYER', thumbnail, url: link || `https://www.aparat.com/v/${id}` });
      }
      return items.slice(0, 100);
    };
    const fetchText = async (url) => {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*',
          'Referer': `https://www.aparat.com/${username}`
        },
        redirect: 'follow'
      });
      if (!r.ok) throw new Error(`upstream_${r.status}`);
      return await r.text();
    };
    try {
      if (globalThis[cacheKey] && now - globalThis[cacheKey].at < 45000) {
        return json(res, 200, { ...globalThis[cacheKey].data, cached: true });
      }

      // Aparat exposes a public RSS feed for channel uploads. Prefer it because it
      // is designed for syndication and does not depend on the site's private UI API.
      const rssUrls = [
        `https://www.aparat.com/rss/${encodeURIComponent(username)}`,
        `https://aparat.com/rss/${encodeURIComponent(username)}`
      ];
      let videos = [];
      let source = '';
      let lastError = null;
      for (const rssUrl of rssUrls) {
        try {
          const xml = await fetchText(rssUrl);
          const parsed = parseRss(xml);
          if (parsed.length) { videos = parsed; source = 'Aparat RSS'; break; }
          lastError = new Error('rss_empty');
        } catch (e) { lastError = e; }
      }

      // Compatibility fallback for deployments where the RSS endpoint is temporarily unavailable.
      if (!videos.length) {
        const candidates = [
          `https://www.aparat.com/api/fa/v1/video/video/list/username/${encodeURIComponent(username)}?per_page=100`,
          `https://www.aparat.com/api/fa/v1/video/video/list/user/${encodeURIComponent(username)}?per_page=100`,
          `https://www.aparat.com/api/fa/v1/video/video/list?username=${encodeURIComponent(username)}&per_page=100`
        ];
        for (const u of candidates) {
          try {
            const text = await fetchText(u);
            const data = JSON.parse(text);
            const list = Array.isArray(data) ? data : (data.data || data.videos || data.result || data.items || []);
            if (Array.isArray(list) && list.length) {
              videos = list.map(v => {
                const id = String(v.hash_id || v.videohash || v.uid || v.id || '').trim();
                return id ? {
                  id,
                  title: String(v.title || v.name || 'ویدیوی BEHRAD M PLAYER'),
                  thumbnail: absolute(v.thumbnail || v.big_poster || v.poster || v.image || '') || `https://static.cdn.asset.aparat.com/avt/${id}/320.jpg`,
                  url: absolute(v.url || v.link || '') || `https://www.aparat.com/v/${id}`
                } : null;
              }).filter(Boolean).slice(0, 100);
              if (videos.length) { source = 'Aparat API'; break; }
            }
          } catch (e) { lastError = e; }
        }
      }

      const payload = videos.length
        ? { ok: true, source, username, updatedAt: new Date().toISOString(), videos }
        : { ok: false, source: source || 'Aparat', username, updatedAt: new Date().toISOString(), videos: [], error: 'aparat_feed_empty', message: lastError?.message || 'No public videos were returned' };
      if (videos.length) globalThis[cacheKey] = { at: now, data: payload };
      return json(res, videos.length ? 200 : 502, payload);
    } catch (e) {
      return json(res, 502, { ok: false, source: 'Aparat', username, videos: [], error: 'aparat_fetch_failed', message: e.message || 'fetch_failed' });
    }
  }

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

  if (req.method === 'POST' && path === '/api/rooms/create') {
    try {
      const b = await readBody(req);
      const name = String(b.name || '').trim().slice(0, 50);
      const type = b.type === 'voice' ? 'voice' : 'text';
      const roomPassword = String(b.password || '').slice(0, 64);
      const privateRoom = !!b.private || !!roomPassword;
      const ownerPeerId = String(b.ownerPeerId || '').slice(0, 128);
      const ownerName = String(b.ownerName || 'سازنده روم').slice(0, 40);
      const ownerUsername = String(b.ownerUsername || '').slice(0, 24);
      const baseUrl = String(b.baseUrl || '').replace(/\/+$/, '');
      if (!name) return json(res, 400, { ok: false, error: 'room_name_required' });
      if (privateRoom && !roomPassword) return json(res, 400, { ok: false, error: 'room_password_required' });
      let id = makeRoomId();
      while (rooms.has(id)) id = makeRoomId();
      const inviteToken = makeToken(24);
      const room = {
        id, name, type, private: privateRoom, password: privateRoom ? roomPassword : '', inviteToken,
        connectionCode: '0', responseCode: '0', revision: 0, members: new Map(), sockets: new Set(),
        hostPeerId: ownerPeerId || null, ownerPeerId: ownerPeerId || null, ownerName, ownerUsername, ownerToken: makeToken(32), permanent: false, updatedAt: Date.now()
      };
      rooms.set(id, room);
      const shareUrl = (baseUrl || 'https://behrad-m-player.github.io') + '/?room=' + encodeURIComponent(id) + '&key=' + encodeURIComponent(inviteToken);
      return json(res, 201, { ok: true, room: publicRoom(room), shareUrl, ownerToken: room.ownerToken });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'bad_request' }); }
  }

  if (req.method === 'POST' && path === '/api/room/join') {
    try {
      const b = await readBody(req);
      const room = validRoom(String(b.roomId || ''));
      const peerId = String(b.peerId || '').slice(0, 128);
      const name = String(b.name || 'کاربر').slice(0, 40);
      if (!room || !peerId) return json(res, 400, { ok: false, error: 'bad_request' });
      const inviteOk = !!room.inviteToken && String(b.inviteToken || '') === room.inviteToken;
      if (room.private && !inviteOk && String(b.password || '') !== room.password) return json(res, 403, { ok: false, error: 'invalid_password' });
      const username = String(b.username || '').replace(/^@/, '').slice(0, 24);
      room.members.set(peerId, { peerId, name, username, joinedAt: Date.now() });
      ensureCodes(room);
      room.revision++;
      room.updatedAt = Date.now();
      broadcastState(room);
      return json(res, 200, { ok: true, room: publicRoom(room), members: publicMembers(room) });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'bad_request' }); }
  }

  if (req.method === 'POST' && path === '/api/rooms/delete') {
    try {
      const b = await readBody(req);
      const id = String(b.roomId || '');
      const room = validRoom(id);
      if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });
      if (room.permanent || id === 'community' || id === 'public') {
        return json(res, 403, { ok: false, error: 'room_cannot_be_deleted' });
      }
      const ownerToken = String(b.ownerToken || '');
      if (!ownerToken || ownerToken !== room.ownerToken) {
        return json(res, 403, { ok: false, error: 'not_room_owner' });
      }
      const notice = JSON.stringify({ event: 'room-deleted', roomId: room.id, name: room.name });
      for (const ws of room.sockets) {
        if (ws.readyState === 1) { try { ws.send(notice); } catch {} }
      }
      for (const ws of room.sockets) { try { ws.close(4004, 'room_deleted'); } catch {} }
      rooms.delete(id);
      return json(res, 200, { ok: true, roomId: id });
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
      const inviteOk = !!nextRoom.inviteToken && String(m.inviteToken || '') === nextRoom.inviteToken;
      if (nextRoom.private && !inviteOk && String(m.password || '') !== nextRoom.password) return ws.send(JSON.stringify({ event: 'error', error: 'invalid_password' }));
      if (room && room !== nextRoom) removeMember(room, peerId);
      room = nextRoom;
      peerId = nextPeer;

      // One live WebSocket per peerId. A stale/reconnecting socket must never
      // be allowed to remove the newer connection's presence on close.
      const existingMember = room.members.get(peerId);
      const existingSocket = existingMember?.ws;
      if (existingSocket && existingSocket !== ws) {
        room.sockets.delete(existingSocket);
        try { existingSocket.close(4001, 'replaced_by_new_connection'); } catch {}
      }
      room.sockets.add(ws);
      room.members.set(peerId, {
        peerId,
        name: String(m.name || existingMember?.name || 'کاربر').slice(0, 40),
        username: String(m.username || existingMember?.username || '').replace(/^@/, '').slice(0, 24),
        joinedAt: existingMember?.joinedAt || Date.now(),
        ws
      });
      ensureCodes(room);
      room.revision++;
      room.updatedAt = Date.now();
      ws.send(JSON.stringify({ event: 'ready', room: publicRoom(room), members: publicMembers(room) }));
      broadcastState(room);
      return;
    }

    if (!room || !peerId) return ws.send(JSON.stringify({ event: 'error', error: 'not_joined' }));

    if (m.type === 'profile') {
      const member = room.members.get(peerId);
      if (member) {
        member.name = String(m.name || member.name || 'کاربر').slice(0, 40);
        member.username = String(m.username || member.username || '').replace(/^@/, '').slice(0, 24);
        member.ws = ws;
        room.members.set(peerId, member);
        room.updatedAt = Date.now();
        broadcast(room, { event: 'presence', members: publicMembers(room), state: publicRoom(room) });
      }
      return;
    }

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
      broadcast(room, {
        event: 'chat',
        from: peerId,
        name: room.members.get(peerId)?.name || 'کاربر',
        text,
        msgId: m.msgId || '',
        replyTo: String(m.replyTo || '').slice(0, 200),
        replyName: String(m.replyName || '').slice(0, 80),
        replyText: String(m.replyText || '').slice(0, 2000),
        ts: Date.now()
      }, null);
      return;
    }
  });

  ws.on('close', () => {
    if (!room || !peerId) return;
    room.sockets.delete(ws);
    // Only the currently registered socket may remove this peer.
    // This prevents ghost "online" members during reconnect races.
    const current = room.members.get(peerId);
    if (current?.ws === ws) removeMember(room, peerId);
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
