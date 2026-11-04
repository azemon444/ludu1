'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const gameLogic = require('./game');

const APP_VERSION = '1.1.0';
const rooms = new Map();
const quickQueue = [];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    rooms: rooms.size,
    queue: quickQueue.length,
    uptime: Math.round(process.uptime()),
  });
});

app.use(express.static(path.join(__dirname, 'public')));

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 16) || 'Player';
}

function createRoom(hostId) {
  const code = makeCode();
  const room = { code, hostId, started: false, players: [], game: null, timer: null, createdAt: Date.now() };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, playerId, name, isBot = false) {
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    return existing;
  }
  if (room.started || room.players.length >= 4) return null;
  const player = {
    id: playerId,
    name: cleanName(name),
    seat: room.players.length,
    isBot,
    connected: true,
  };
  room.players.push(player);
  return player;
}

function transferHost(room) {
  const current = room.players.find((p) => p.id === room.hostId);
  if (current && current.connected !== false && !current.isBot) return;
  const next = room.players.find((p) => p.connected !== false && !p.isBot);
  if (next) room.hostId = next.id;
}

function removeLobbyPlayer(room, player) {
  room.players = room.players.filter((p) => p.id !== player.id);
  if (room.hostId === player.id) {
    const next = room.players.find((p) => !p.isBot);
    room.hostId = next ? next.id : room.players[0]?.id || null;
  }
  if (room.players.length === 0) {
    removeRoom(room);
    return false;
  }
  room.players.forEach((p, index) => {
    p.seat = index;
  });
  return true;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function removeRoom(room) {
  clearRoomTimer(room);
  rooms.delete(room.code);
}

function publicState(room) {
  const game = room.game
    ? {
        gameId: room.game.gameId,
        tokens: room.game.tokens,
        turn: room.game.turn,
        moveCount: room.game.moveCount,
        dice: room.game.dice,
        phase: room.game.phase,
        validMoves: room.game.validMoves,
        winnerTeam: room.game.winnerTeam,
        noticeSeq: room.game.noticeSeq,
        noticeText: room.game.noticeText,
        log: room.game.log,
      }
    : null;

  return {
    version: APP_VERSION,
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      isBot: !!p.isBot,
      connected: p.connected !== false,
    })),
    game,
    teamBySeat: gameLogic.TEAM_BY_SEAT,
  };
}

function chooseBotMove(game, seat, moves) {
  let best = moves[0];
  let bestScore = -Infinity;

  for (const index of moves) {
    const token = game.tokens[seat][index];
    let score;

    if (token.pos === gameLogic.YARD) {
      score = 70;
    } else {
      const target = token.pos + game.dice;
      score = target;
      if (target === gameLogic.GOAL) score = 2000;
      if (target <= 50 && !gameLogic.SAFE_RING.has(gameLogic.ringIndex(seat, target))) {
        const abs = gameLogic.ringIndex(seat, target);
        for (let s = 0; s < 4; s++) {
          if (s === seat || gameLogic.TEAM_BY_SEAT[s] === gameLogic.TEAM_BY_SEAT[seat]) continue;
          for (const other of game.tokens[s]) {
            if (other.pos >= 0 && other.pos <= 50 && gameLogic.ringIndex(s, other.pos) === abs) {
              score += 600;
            }
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
  scheduleAutomation(room);
}

function scheduleAutomation(room) {
  clearRoomTimer(room);
  const game = room.game;
  if (!room.started || !game || game.phase === 'over' || game.winnerTeam !== null) return;

  const player = room.players.find((p) => p.seat === game.turn);
  if (!player) return;

  const isBot = player.isBot;
  const offline = player.connected === false;
  if (!isBot && !offline) return;

  const expectedTurn = game.turn;
  const delay = isBot
    ? Number(process.env.BOT_DELAY || 900)
    : Number(process.env.OFFLINE_DELAY || 7000);

  room.timer = setTimeout(() => {
    room.timer = null;
    const current = room.game;
    if (!current || current.phase === 'over' || current.winnerTeam !== null) return;
    if (current.turn !== expectedTurn) return;

    if (isBot) {
      if (current.phase === 'roll') {
        gameLogic.rollDice(current, current.turn);
      } else if (current.phase === 'move') {
        const move = chooseBotMove(current, current.turn, current.validMoves);
        gameLogic.moveToken(current, current.turn, move);
      }
    } else {
      gameLogic.skipTurn(current, 'offline');
    }

    broadcast(room);
  }, delay);
}

function context(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  const player = room.players.find((p) => p.id === socket.data.playerId);
  return { room, player };
}

function bindSocket(socket, room, playerId) {
  socket.data.code = room.code;
  socket.data.playerId = playerId;
  socket.join(room.code);
}

function removeQueuedSocket(socketId) {
  const index = quickQueue.findIndex((entry) => entry.socketId === socketId);
  if (index >= 0) quickQueue.splice(index, 1);
  return index >= 0;
}

function notifyQueue() {
  for (const entry of quickQueue) {
    io.to(entry.socketId).emit('queued', {
      inQueue: true,
      count: quickQueue.length,
      needed: 4,
    });
  }
}

function maybeQuickMatch() {
  for (let i = quickQueue.length - 1; i >= 0; i--) {
    if (!io.sockets.sockets.get(quickQueue[i].socketId)) quickQueue.splice(i, 1);
  }

  while (quickQueue.length >= 4) {
    const group = quickQueue.splice(0, 4);
    const room = createRoom(group[0].playerId);
    for (const entry of group) {
      addPlayer(room, entry.playerId, entry.name);
      const socket = io.sockets.sockets.get(entry.socketId);
      if (socket) {
        socket.data.queued = false;
        bindSocket(socket, room, entry.playerId);
      }
    }
    room.started = true;
    room.game = gameLogic.newGame(room.players.map((p) => p.name));
    broadcast(room);
  }

  notifyQueue();
}

io.on('connection', (socket) => {
  socket.on('create', ({ playerId, name } = {}) => {
    const id = String(playerId || '').slice(0, 64) || `p_${socket.id}`;
    const room = createRoom(id);
    addPlayer(room, id, name);
    bindSocket(socket, room, id);
    broadcast(room);
  });

  socket.on('join', ({ code, playerId, name } = {}) => {
    const cleanCode = String(code || '').toUpperCase().trim();
    const room = rooms.get(cleanCode);
    if (!room) return socket.emit('errorMsg', 'Room not found');

    const id = String(playerId || '').slice(0, 64) || `p_${socket.id}`;
    const existing = room.players.find((p) => p.id === id);

    if (room.started && !existing) {
      return socket.emit('errorMsg', 'That game has already started');
    }
    if (!existing && room.players.length >= 4) {
      return socket.emit('errorMsg', 'Room is full');
    }

    if (existing) {
      existing.connected = true;
      if (name) existing.name = cleanName(name);
    } else {
      addPlayer(room, id, name);
    }

    bindSocket(socket, room, id);
    broadcast(room);
  });

  socket.on('resume', ({ code, playerId, name } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return socket.emit('resumeFailed', { reason: 'room' });

    let player = room.players.find((p) => p.id === playerId);
    if (!player) {
      if (room.started || room.players.length >= 4) {
        return socket.emit('resumeFailed', { reason: 'player' });
      }
      player = addPlayer(room, playerId, name);
      if (!player) return socket.emit('resumeFailed', { reason: 'player' });
    }

    player.connected = true;
    bindSocket(socket, room, playerId);
    broadcast(room);
  });

  socket.on('quickMatch', ({ playerId, name } = {}) => {
    if (socket.data.code && rooms.has(socket.data.code)) {
      return socket.emit('errorMsg', 'You are already in a room');
    }
    const id = String(playerId || '').slice(0, 64) || `p_${socket.id}`;
    for (let i = quickQueue.length - 1; i >= 0; i--) {
      if (quickQueue[i].playerId === id) quickQueue.splice(i, 1);
    }
    socket.data.playerId = id;
    socket.data.queued = true;
    quickQueue.push({ playerId: id, name: cleanName(name), socketId: socket.id });
    maybeQuickMatch();
  });

  socket.on('cancelQueue', () => {
    removeQueuedSocket(socket.id);
    socket.data.queued = false;
    socket.emit('queued', { inQueue: false, count: quickQueue.length, needed: 4 });
    notifyQueue();
  });

  socket.on('soloBots', ({ playerId, name } = {}) => {
    removeQueuedSocket(socket.id);
    socket.data.queued = false;
    notifyQueue();
    if (socket.data.code && rooms.has(socket.data.code)) {
      return socket.emit('errorMsg', 'You are already in a room');
    }
    const id = String(playerId || '').slice(0, 64) || `p_${socket.id}`;
    const room = createRoom(id);
    addPlayer(room, id, name);
    for (let i = 1; i <= 3; i++) {
      addPlayer(room, `bot_${Math.random().toString(36).slice(2, 10)}`, `Bot ${i}`, true);
    }
    bindSocket(socket, room, id);
    room.started = true;
    room.game = gameLogic.newGame(room.players.map((p) => p.name));
    broadcast(room);
  });

  socket.on('start', () => {
    const { room, player } = context(socket);
    if (!room || !player || room.started) return;
    if (room.hostId !== player.id) return socket.emit('errorMsg', 'Only the host can start');
    if (room.players.length !== 4) return socket.emit('errorMsg', 'Need 4 players (add bots to fill)');

    room.started = true;
    room.game = gameLogic.newGame(room.players.map((p) => p.name));
    broadcast(room);
  });

  socket.on('addBot', () => {
    const { room, player } = context(socket);
    if (!room || !player || room.started) return;
    if (room.hostId !== player.id) return;
    if (room.players.length >= 4) return;
    const botCount = room.players.filter((p) => p.isBot).length;
    addPlayer(room, `bot_${Math.random().toString(36).slice(2, 10)}`, `Bot ${botCount + 1}`, true);
    broadcast(room);
  });

  socket.on('fillBots', () => {
    const { room, player } = context(socket);
    if (!room || !player || room.started) return;
    if (room.hostId !== player.id) return;
    let botCount = room.players.filter((p) => p.isBot).length;
    while (room.players.length < 4) {
      botCount += 1;
      addPlayer(room, `bot_${Math.random().toString(36).slice(2, 10)}`, `Bot ${botCount}`, true);
    }
    broadcast(room);
  });

  socket.on('roll', () => {
    const { room, player } = context(socket);
    if (!room || !room.game || !player) return;
    if (room.game.winnerTeam !== null) return;
    if (player.seat !== room.game.turn) return socket.emit('errorMsg', 'Not your turn');
    const result = gameLogic.rollDice(room.game, player.seat);
    if (result.error) return socket.emit('errorMsg', result.error);
    broadcast(room);
  });

  socket.on('move', ({ token } = {}) => {
    const { room, player } = context(socket);
    if (!room || !room.game || !player) return;
    if (player.seat !== room.game.turn) return socket.emit('errorMsg', 'Not your turn');
    const result = gameLogic.moveToken(room.game, player.seat, Number(token));
    if (result.error) return socket.emit('errorMsg', result.error);
    broadcast(room);
  });

  socket.on('leave', () => {
    const room = rooms.get(socket.data.code);
    if (room) {
      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (player) {
        if (!room.started && !player.isBot) {
          if (removeLobbyPlayer(room, player)) broadcast(room);
        } else {
          player.connected = false;
          transferHost(room);
          broadcast(room);
        }
        socket.leave(room.code);
      }
    }
    socket.data.code = null;
    socket.data.playerId = null;
    socket.emit('left');
  });

  socket.on('restart', () => {
    const { room, player } = context(socket);
    if (!room || !player || !room.game) return;
    if (room.hostId !== player.id) return socket.emit('errorMsg', 'Only the host can restart');
    room.game = gameLogic.newGame(room.players.map((p) => p.name));
    broadcast(room);
  });

  socket.on('disconnect', () => {
    if (removeQueuedSocket(socket.id)) notifyQueue();

    const room = rooms.get(socket.data.code);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.data.playerId);
    if (!player) return;

    if (!room.started && !player.isBot) {
      if (removeLobbyPlayer(room, player)) broadcast(room);
    } else {
      player.connected = false;
      transferHost(room);
      broadcast(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const hasConnectedHuman = room.players.some((p) => !p.isBot && p.connected !== false);
    const age = now - room.createdAt;
    if (!room.started && age > 3 * 60 * 60 * 1000) {
      removeRoom(room);
    } else if (room.started && !hasConnectedHuman && age > 6 * 60 * 60 * 1000) {
      removeRoom(room);
    }
  }
}, 10 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ludo Teams running at http://localhost:${PORT}`);
});
