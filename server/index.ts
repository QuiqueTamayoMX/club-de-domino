import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../shared/types.ts';
import { RoomManager } from './roomManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json());

// Allow CORS for local Vite dev server and mobile LAN testing
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const httpServer = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager({
  sendState: (socketId, state) => {
    io.to(socketId).emit('state:update', state);
  },
  sendToast: (socketId, payload) => {
    io.to(socketId).emit('toast', payload);
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: roomManager.getRoomCount() });
});

// Serve built production frontend when dist/ exists
if (fs.existsSync(DIST_DIR)) {
  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/socket.io') &&
      fs.existsSync(indexHtmlPath)
    ) {
      res.sendFile(indexHtmlPath);
      return;
    }
    next();
  });
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload) => {
    roomManager.createRoom(socket.id, payload);
  });

  socket.on('room:join', (payload) => {
    roomManager.joinRoom(socket.id, payload);
  });

  socket.on('room:update_settings', (payload) => {
    roomManager.updateSettings(socket.id, payload);
  });

  socket.on('room:swap_seat', (payload) => {
    roomManager.swapSeat(socket.id, payload);
  });

  socket.on('room:swap_two_seats', (payload) => {
    roomManager.swapTwoSeats(socket.id, payload);
  });

  socket.on('room:rotate_partners', () => {
    roomManager.rotatePartners(socket.id);
  });

  socket.on('room:randomize_partners', () => {
    roomManager.randomizePartners(socket.id);
  });

  socket.on('room:fill_bots', () => {
    roomManager.fillBots(socket.id);
  });

  socket.on('room:remove_bot', (payload) => {
    roomManager.removeBot(socket.id, payload);
  });

  socket.on('room:start_match', () => {
    roomManager.startMatch(socket.id);
  });

  socket.on('game:play_tile', (payload) => {
    roomManager.playTile(socket.id, payload);
  });

  socket.on('game:pass', () => {
    roomManager.passTurn(socket.id);
  });

  socket.on('game:next_hand', () => {
    roomManager.nextHand(socket.id);
  });

  socket.on('game:rematch', () => {
    roomManager.rematch(socket.id);
  });

  socket.on('game:return_to_lobby', () => {
    roomManager.returnToLobby(socket.id);
  });

  socket.on('disconnect', () => {
    roomManager.handleDisconnect(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Domino server listening on http://localhost:${PORT}`);
});
