'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 4199;
const URL = `http://localhost:${PORT}`;

function waitFor(socket, event, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);

    function handler(payload) {
      if (!predicate || predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    }
    socket.on(event, handler);
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { forceNew: true, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BOT_DELAY: '15', OFFLINE_DELAY: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(d));

  try {
    await new Promise((resolve) => setTimeout(resolve, 700));

    const sockets = await Promise.all([connect(), connect(), connect(), connect()]);
    const [a, b, c, d] = sockets;
    const ids = ['A', 'B', 'C', 'D'];

    const created = waitFor(a, 'state', (s) => s.players.length === 1);
    a.emit('create', { playerId: ids[0], name: 'Alice' });
    const initial = await created;
    const code = initial.code;
    assert.equal(code.length, 4);

    const joined = waitFor(a, 'state', (s) => s.players.length === 4);
    b.emit('join', { code, playerId: ids[1], name: 'Bob' });
    c.emit('join', { code, playerId: ids[2], name: 'Cara' });
    d.emit('join', { code, playerId: ids[3], name: 'Dan' });
    const lobby = await joined;
    assert.equal(lobby.started, false);
    assert.deepEqual(lobby.players.map((p) => p.seat), [0, 1, 2, 3]);
    assert.deepEqual(lobby.teamBySeat, [0, 1, 0, 1]);

    const startedEvent = waitFor(a, 'state', (s) => s.started);
    a.emit('start');
    const started = await startedEvent;
    assert.equal(started.game.turn, 0);
    assert.equal(started.game.phase, 'roll');

    const rolledEvent = waitFor(a, 'state', (s) => s.game && (s.game.phase === 'move' || s.game.turn !== 0));
    a.emit('roll');
    const rolled = await rolledEvent;
    assert.ok(rolled.game.phase === 'move' || rolled.game.turn !== 0);
    if (rolled.game.dice !== null) {
      assert.ok(rolled.game.dice >= 1 && rolled.game.dice <= 6);
    }

    const host = await connect();
    const botCreated = waitFor(host, 'state', (s) => s.players.length === 1);
    host.emit('create', { playerId: 'HOST', name: 'Host' });
    const hostState = await botCreated;

    const botsAdded = waitFor(host, 'state', (s) => s.players.length === 4);
    host.emit('fillBots');
    const botLobby = await botsAdded;
    assert.equal(botLobby.players.filter((p) => p.isBot).length, 3);

    const botStarted = waitFor(host, 'state', (s) => s.started);
    host.emit('start');
    const botGame = await botStarted;
    assert.equal(botGame.players.length, 4);
    assert.equal(botGame.game.phase, 'roll');
    assert.equal(botGame.code, hostState.code);

    const host2 = await connect();
    const autoCreated = waitFor(host2, 'state', (s) => s.players.length === 1);
    host2.emit('create', { playerId: 'HOST2', name: 'Auto' });
    await autoCreated;

    const autoReady = waitFor(host2, 'state', (s) => s.players.length === 4);
    host2.emit('fillBots');
    await autoReady;

    host2.on('state', (state) => {
      if (!state.started || !state.game || state.game.winnerTeam !== null) return;
      const self = state.players.find((p) => p.id === 'HOST2');
      if (!self || state.game.turn !== self.seat) return;
      if (state.game.phase === 'roll') {
        host2.emit('roll');
      } else if (state.game.phase === 'move' && state.game.validMoves.length > 0) {
        host2.emit('move', { token: state.game.validMoves[0] });
      }
    });

    const finished = waitFor(host2, 'state', (s) => s.game && s.game.winnerTeam !== null, 30000);
    host2.emit('start');
    const finalState = await finished;
    assert.ok(finalState.game.winnerTeam === 0 || finalState.game.winnerTeam === 1);
    assert.equal(finalState.game.phase, 'over');

    const restarted = waitFor(host2, 'state', (s) => s.game && s.game.winnerTeam === null);
    host2.emit('restart');
    const fresh = await restarted;
    assert.equal(fresh.game.turn, 0);

    const quickSockets = await Promise.all([connect(), connect(), connect(), connect()]);
    const quickIds = ['Q1', 'Q2', 'Q3', 'Q4'];
    const quickStates = quickSockets.map((s) =>
      waitFor(s, 'state', (state) => state.started && state.players.length === 4)
    );
    quickSockets.forEach((s, i) => {
      s.emit('quickMatch', { playerId: quickIds[i], name: `Q${i + 1}` });
    });
    const matched = await Promise.all(quickStates);
    assert.equal(new Set(matched.map((s) => s.code)).size, 1);
    assert.equal(matched[0].game.turn, 0);
    quickSockets.forEach((s) => s.close());

    console.log('integration ok: create, join, start, roll, bots, full game, restart, quick match');
    host.close();
    host2.close();
    sockets.forEach((s) => s.close());
  } finally {
    server.kill('SIGKILL');
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
