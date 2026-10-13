import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as SocketServer } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'data.json'));

const initialDb = {
  communities: [{
    id: 'nexo-lounge', name: 'Nexo Lounge', description: 'Um lugar para jogar, conversar e compartilhar a tela.', category: 'Comunidade', public: true,
    createdAt: new Date().toISOString(), channels: [
      { id: 'nexo-general', name: 'geral', type: 'text', category: 'TEXTO' },
      { id: 'nexo-clips', name: 'clips-e-links', type: 'text', category: 'TEXTO' },
      { id: 'nexo-lounge-voice', name: 'Sala Geral', type: 'voice', category: 'VOZ' },
      { id: 'nexo-squad-1', name: 'Squad 1', type: 'voice', category: 'VOZ' }
    ]
  }],
  messages: {}
};

function loadDb() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialDb, null, 2));
    }
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(loaded.communities) || typeof loaded.messages !== 'object') throw new Error('Formato de banco inválido');
    return loaded;
  } catch (err) {
    console.error('Não foi possível carregar os dados:', err.message);
    return structuredClone(initialDb);
  }
}
let db = loadDb();
function saveDb() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const cleanText = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const slugify = (value) => cleanText(value, 48).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'comunidade';
function findChannel(channelId) {
  for (const community of db.communities) {
    const channel = community.channels.find((c) => c.id === channelId);
    if (channel) return { community, channel };
  }
  return null;
}

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.RENDER_EXTERNAL_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean).flatMap(value => value.split(',').map(origin => origin.trim()));
const corsOptions = { origin: (origin, callback) => {
  // Desktop shell may send no Origin; the API itself still does not expose secrets.
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || origin === 'null') return callback(null, true);
  return callback(new Error('Origem não permitida pelo CORS'));
}, methods: ['GET', 'POST'], credentials: false };
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'", 'https:', 'wss:', 'ws:', 'http://localhost:*', 'http://127.0.0.1:*'],
    mediaSrc: ["'self'", 'blob:'], workerSrc: ["'self'", 'blob:']
  } }
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));

const io = new SocketServer(server, { cors: { origin: (origin, callback) => { if (!origin || origin === 'null' || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('Origem não permitida pelo CORS')); }, methods: ['GET', 'POST'] } });
const onlineUsers = new Map();
function broadcastPresence() {
  const unique = new Map();
  for (const [socketId, name] of onlineUsers.entries()) unique.set(name.toLowerCase(), { id: socketId, name });
  io.emit('presence:list', [...unique.values()]);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Nexo Voice API', timestamp: new Date().toISOString() }));
app.get('/api/config', (_req, res) => res.json({ livekitConfigured: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET), livekitUrl: process.env.LIVEKIT_URL || null }));
app.get('/api/communities', (_req, res) => res.json(db.communities.filter(c => c.public).map(c => ({ ...c, channels: c.channels }))));

app.post('/api/communities', (req, res) => {
  const name = cleanText(req.body?.name, 48);
  const description = cleanText(req.body?.description, 180);
  if (name.length < 2) return res.status(400).json({ error: 'O nome precisa ter ao menos 2 caracteres.' });
  if (db.communities.length >= 300) return res.status(429).json({ error: 'Limite de comunidades do MVP atingido.' });
  const id = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;
  const community = {
    id, name, description: description || 'Uma comunidade pública no Nexo Voice.', category: 'Comunidade', public: true, createdAt: new Date().toISOString(),
    channels: [
      { id: `${id}-geral`, name: 'geral', type: 'text', category: 'TEXTO' },
      { id: `${id}-midia`, name: 'links-e-midia', type: 'text', category: 'TEXTO' },
      { id: `${id}-voz`, name: 'Sala Geral', type: 'voice', category: 'VOZ' },
      { id: `${id}-squad`, name: 'Squad', type: 'voice', category: 'VOZ' }
    ]
  };
  db.communities.push(community); saveDb(); io.emit('communities:updated', db.communities.filter(c => c.public));
  res.status(201).json(community);
});

app.get('/api/messages/:channelId', (req, res) => {
  const found = findChannel(cleanText(req.params.channelId, 100));
  if (!found || found.channel.type !== 'text') return res.status(404).json({ error: 'Canal de texto não encontrado.' });
  res.json((db.messages[found.channel.id] || []).slice(-100));
});

app.post('/api/livekit/token', async (req, res) => {
  const username = cleanText(req.body?.username, 32);
  const channelId = cleanText(req.body?.channelId, 120);
  const found = findChannel(channelId);
  if (!username) return res.status(400).json({ error: 'Informe um nome de usuário.' });
  if (!found || found.channel.type !== 'voice') return res.status(400).json({ error: 'Selecione um canal de voz válido.' });
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'Voz ainda não configurada. Preencha LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env do servidor.' });
  }
  try {
    const roomName = `${found.community.id}__${found.channel.id}`;
    const identity = `${slugify(username)}-${Math.random().toString(36).slice(2, 7)}`;
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name: username, ttl: '2h' });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    res.json({ token: await token.toJwt(), serverUrl: process.env.LIVEKIT_URL, roomName });
  } catch (err) {
    console.error('Erro ao criar token LiveKit:', err.message);
    res.status(500).json({ error: 'Não foi possível preparar a conexão de voz.' });
  }
});

io.on('connection', (socket) => {
  socket.on('presence:join', (rawName) => {
    const name = cleanText(rawName, 32);
    if (!name) return;
    onlineUsers.set(socket.id, name);
    broadcastPresence();
  });
  socket.on('channel:join', (payload, callback) => {
    const channelId = cleanText(payload?.channelId, 120);
    const found = findChannel(channelId);
    if (!found || found.channel.type !== 'text') {
      if (typeof callback === 'function') callback({ ok: false, error: 'Canal inválido.' });
      return;
    }
    for (const room of socket.rooms) if (room.startsWith('text:')) socket.leave(room);
    socket.join(`text:${channelId}`);
    if (typeof callback === 'function') callback({ ok: true, messages: (db.messages[channelId] || []).slice(-100) });
  });
  socket.on('channel:message', (payload, callback) => {
    const channelId = cleanText(payload?.channelId, 120);
    const found = findChannel(channelId);
    const author = cleanText(payload?.author, 32);
    const text = cleanText(payload?.text, 2000);
    if (!found || found.channel.type !== 'text' || !author || !text) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Mensagem ou canal inválido.' });
      return;
    }
    if (!socket.rooms.has(`text:${channelId}`)) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Entre no canal antes de enviar mensagens.' });
      return;
    }
    const now = Date.now();
    socket.data.messageTimes = (socket.data.messageTimes || []).filter((time) => now - time < 5000);
    if (socket.data.messageTimes.length >= 8) { if (typeof callback === 'function') callback({ ok: false, error: 'Você está enviando mensagens rápido demais. Aguarde alguns segundos.' }); return; }
    socket.data.messageTimes.push(now);
    const message = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, channelId, author, text, createdAt: new Date().toISOString() };
    db.messages[channelId] ||= [];
    db.messages[channelId].push(message);
    if (db.messages[channelId].length > 500) db.messages[channelId] = db.messages[channelId].slice(-500);
    saveDb(); io.to(`text:${channelId}`).emit('channel:message', message);
    if (typeof callback === 'function') callback({ ok: true, id: message.id });
  });
  socket.on('disconnect', () => { onlineUsers.delete(socket.id); broadcastPresence(); });
});

const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexo Voice API ouvindo em http://localhost:${PORT}`);
  if (!process.env.LIVEKIT_API_KEY) console.log('LiveKit não configurado: voz/tela ficará indisponível até configurar o .env.');
});
