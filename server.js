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
  public_video: { id: 'public_video', name: 'تماس ویدیویی', type: 'video', private: false, password: '', inviteToken: '', permanent: true }
};

const rooms = new Map();
for (const r of Object.values(ROOMS)) {
  rooms.set(r.id, { ...r, connectionCode: '0', responseCode: '0', revision: 0, members: new Map(), sockets: new Set(), hostPeerId: null, updatedAt: Date.now() });
}

const USERS=new Map();
const GAME_ROOMS=new Map();

// V41: intentionally database-free. User/rank state lives in server memory.
function normalizeUsername(v){return String(v||'').replace(/^@/,'').trim().replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,24)}
function ensureUser(username,name){username=normalizeUsername(username);if(!username)return null;let u=USERS.get(username);if(!u)u={username,name:String(name||'کاربر').slice(0,40),rank:'عضو جدید',wins:0,streak:0,lastGames:[],lastSeen:Date.now()};else{u.name=String(name||u.name||'کاربر').slice(0,40);u.lastSeen=Date.now()}USERS.set(username,u);return u}
function updateRank(u,gameId,won){if(!u||!won)return;u.wins++;u.streak++;u.lastGames=[...u.lastGames.slice(-4),gameId];const unique3=new Set(u.lastGames.slice(-3));if(u.wins>=50)u.rank='گاد پلیر';else if(u.streak>=10)u.rank='پرو پلیر';else if(u.streak>=3&&unique3.size===3)u.rank='پلیر'}
function makeGameRoomId(){return 'game_'+crypto.randomBytes(8).toString('base64url')}
function publicGameRoom(g){return {id:g.id,gameId:g.gameId,maxPlayers:g.maxPlayers,playerCount:g.players.size,inviteToken:g.inviteToken,private:g.private,state:g.state}}
function broadcastGame(g,msg,except){const d=JSON.stringify(msg);for(const ws of g.sockets){if(ws!==except&&ws.readyState===1)try{ws.send(d)}catch{}}}
function gamePlayerList(g){return [...g.players.values()].map(p=>({peerId:p.peerId,username:p.username,name:p.name,rank:p.rank,score:p.score||0,index:p.index}))}

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
  return Array.from(room.members.values()).map(m => ({ peerId: m.peerId, name: m.name, username: m.username || '', rank: USERS.get(m.username)?.rank || 'عضو جدید', joinedAt: m.joinedAt }));
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

  if (req.method === 'GET' && (path === '/health' || path === '/api/health')) {
    return json(res, 200, { ok: true, service: 'BEHRAD M PLAYER realtime', database: false, usersInMemory: USERS.size, rooms: rooms.size, gameRooms: GAME_ROOMS.size, time: Date.now() });
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
      const type = b.type === 'video' ? 'video' : (b.type === 'voice' ? 'voice' : 'text');
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
      const username = normalizeUsername(b.username || '');
      const profileUser=ensureUser(username,name);
      
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
      if (room.permanent || id === 'community' || id === 'public' || id === 'public_voice' || id === 'public_video') {
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
  if (req.method === 'POST' && path === '/api/games/create') { try{const b=await readBody(req);const allowed=['ttt','connect4','reaction'];const gameId=allowed.includes(String(b.gameId))?String(b.gameId):'ttt';const id=makeGameRoomId(),token=makeToken(18);const state=gameId==='ttt'?{board:Array(9).fill(''),turn:0,winner:null}:gameId==='connect4'?{board:Array(42).fill(''),turn:0,winner:null}:{status:'waiting',goAt:0,winner:null};const g={id,gameId,maxPlayers:2,inviteToken:token,private:true,players:new Map(),sockets:new Set(),state};GAME_ROOMS.set(id,g);const base=String(b.baseUrl||'').replace(/\/+$/,'')||'https://behrad-m-player.github.io';return json(res,201,{ok:true,room:publicGameRoom(g),shareUrl:base+'/?game='+encodeURIComponent(id)+'&key='+encodeURIComponent(token)});}catch(e){return json(res,400,{ok:false,error:e.message});} }
  if (req.method === 'POST' && path === '/api/games/quick') { try{const b=await readBody(req);const allowed=['clickrush','memory','tapbattle'];const gameId=allowed.includes(String(b.gameId))?String(b.gameId):'clickrush';let g=[...GAME_ROOMS.values()].find(x=>!x.private&&x.gameId===gameId&&x.players.size<x.maxPlayers);if(!g){const id=makeGameRoomId();g={id,gameId,maxPlayers:8,inviteToken:'',private:false,players:new Map(),sockets:new Set(),state:gameId==='memory'?{cards:[],flips:[],scores:{}}:{scores:{},round:1}};GAME_ROOMS.set(id,g);if(gameId==='memory'){const vals=['🍎','🍋','🍇','🍉','🍒','🥝','🥭','🍓'];g.state.cards=[...vals,...vals].sort(()=>Math.random()-.5)}}return json(res,200,{ok:true,room:publicGameRoom(g)});}catch(e){return json(res,400,{ok:false,error:e.message});} }
  if (req.method === 'GET' && path === '/') return json(res, 200, { ok: true, service: 'BEHRAD M PLAYER realtime', database: false, endpoints: ['/health', '/api/rooms', '/ws'] });
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
      ensureUser(normalizeUsername(m.username || existingMember?.username || ''), String(m.name || existingMember?.name || 'کاربر'));
      room.members.set(peerId, {
        peerId,
        name: String(m.name || existingMember?.name || 'کاربر').slice(0, 40),
        username: normalizeUsername(m.username || existingMember?.username || ''),
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

    if ((!room || !peerId) && !String(m.type||'').startsWith('game-')) return ws.send(JSON.stringify({ event: 'error', error: 'not_joined' }));

    if (m.type === 'profile') {
      const member = room.members.get(peerId);
      if (member) {
        member.name = String(m.name || member.name || 'کاربر').slice(0, 40);
        member.username = normalizeUsername(m.username || member.username || '');
        const profileUser=ensureUser(member.username,member.name);
        
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
        username: room.members.get(peerId)?.username || '',
        rank: USERS.get(room.members.get(peerId)?.username || '')?.rank || 'عضو جدید',
        text,
        msgId: m.msgId || '',
        replyTo: String(m.replyTo || '').slice(0, 200),
        replyName: String(m.replyName || '').slice(0, 80),
        replyText: String(m.replyText || '').slice(0, 2000),
        ts: Date.now()
      }, null);
      return;
    }


    if (m.type === 'game-hello') { if(!peerId) peerId=String(m.peerId||'').slice(0,128); const g=GAME_ROOMS.get(String(m.gameRoomId||'')); if(!g)return ws.send(JSON.stringify({event:'game-error',error:'game_not_found'})); if(g.private&&String(m.inviteToken||'')!==g.inviteToken)return ws.send(JSON.stringify({event:'game-error',error:'invalid_game_link'})); if(!g.players.has(peerId)&&g.players.size>=g.maxPlayers)return ws.send(JSON.stringify({event:'game-error',error:'game_full'})); const u=ensureUser(m.username,m.name); g.sockets.add(ws); const old=g.players.get(peerId); g.players.set(peerId,{peerId,name:String(m.name||'کاربر').slice(0,40),username:normalizeUsername(m.username),rank:u?.rank||'عضو جدید',score:old?.score||0,index:old?.index??g.players.size}); ws._gameRoom=g;ws._gamePeer=peerId; ws.send(JSON.stringify({event:'game-ready',room:publicGameRoom(g),players:gamePlayerList(g),state:g.state})); broadcastGame(g,{event:'game-state',players:gamePlayerList(g),state:g.state},ws); return; }
    if (m.type === 'game-action') { const g=ws._gameRoom,p=g?.players.get(peerId);if(!g||!p)return;const a=m.action||{};
      if(g.gameId==='ttt'){const s=g.state;if(s.winner!==null||s.turn!==p.index||!Number.isInteger(a.cell)||a.cell<0||a.cell>8||s.board[a.cell])return;s.board[a.cell]=p.index===0?'X':'O';const W=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];const won=W.some(w=>w.every(i=>s.board[i]));if(won){s.winner=p.index;updateRank(ensureUser(p.username,p.name),g.gameId,true);p.rank=USERS.get(p.username)?.rank||p.rank}else if(s.board.every(Boolean))s.winner='draw';else s.turn=1-s.turn;}
      else if(g.gameId==='connect4'){const s=g.state;if(s.winner!==null||s.turn!==p.index||!Number.isInteger(a.col)||a.col<0||a.col>6)return;let row=-1;for(let r=5;r>=0;r--){const i=r*7+a.col;if(!s.board[i]){s.board[i]=p.index===0?'R':'Y';row=r;break}}if(row<0)return;const dirs=[[1,0],[0,1],[1,1],[1,-1]];let won=false;for(const [dr,dc] of dirs){let c=1;for(const q of [1,-1]){let rr=row+dr*q,cc=a.col+dc*q;while(rr>=0&&rr<6&&cc>=0&&cc<7&&s.board[rr*7+cc]===s.board[row*7+a.col]){c++;rr+=dr*q;cc+=dc*q}}if(c>=4)won=true}if(won){s.winner=p.index;updateRank(ensureUser(p.username,p.name),g.gameId,true);p.rank=USERS.get(p.username)?.rank||p.rank}else if(s.board.every(Boolean))s.winner='draw';else s.turn=1-s.turn;}
      else if(g.gameId==='reaction'){const s=g.state;if(g.players.size<2)return;if(s.status==='waiting'){s.status='ready';s.goAt=Date.now()+1500+Math.floor(Math.random()*1500)}else if(s.status==='ready'&&Date.now()>=s.goAt){s.status='done';s.winner=p.index;updateRank(ensureUser(p.username,p.name),g.gameId,true);p.rank=USERS.get(p.username)?.rank||p.rank}}
      else if(g.gameId==='clickrush'||g.gameId==='tapbattle'){if(a.click){p.score=(p.score||0)+1;g.state.scores[p.index]=p.score}}
      else if(g.gameId==='memory'){const s=g.state;if(!Number.isInteger(a.index)||a.index<0||a.index>=s.cards.length||s.flips.includes(a.index)||s.flips.length>=2)return;s.flips.push(a.index);if(s.flips.length===2){const [x,y]=s.flips;if(s.cards[x]===s.cards[y]){p.score=(p.score||0)+1;s.scores[p.index]=p.score;s.flips=[]}else setTimeout(()=>{s.flips=[];broadcastGame(g,{event:'game-state',players:gamePlayerList(g),state:g.state})},650)}}
      broadcastGame(g,{event:'game-state',players:gamePlayerList(g),state:g.state});return; }  });




  ws.on('close', () => {
    const g=ws._gameRoom;if(g){g.sockets.delete(ws);if(ws._gamePeer)g.players.delete(ws._gamePeer);broadcastGame(g,{event:'game-state',players:gamePlayerList(g),state:g.state})}
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
}, 20000);


setInterval(() => {
  for (const g of GAME_ROOMS.values()) {
    for (const ws of g.sockets) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }
}, 20000);
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

server.listen(PORT, HOST, () => console.log('BEHRAD M PLAYER realtime server listening on ' + HOST + ':' + PORT + ' (database-free, in-memory ranks)'));

