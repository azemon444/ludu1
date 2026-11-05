'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 4199;
const URL = `http://localhost:${PORT}`;

let nextId = 0;
function uid(prefix = 'P') {
  nextId += 1;
  return `${prefix}${nextId}`;
}

function waitFor(socket, event, predicate, timeout = 5000) {
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

async function createRoom(socket, id, name, size) {
  const event = waitFor(socket, 'state', (s) => s.players.length === 1);
  socket.emit('create', { playerId: id, name, size });
  return event;
}

async function joinRoom(socket, code, id, name) {
  const event = waitFor(socket, 'state', (s) => s.players.some((p) => p.id === id));
  socket.emit('join', { code, playerId: id, name });
  return event;
}

async function startRoom(socket) {
  const event = waitFor(socket, 'state', (s) => s.started && !!s.game);
  socket.emit('start');
  return event;
}

function autoplay(sockets, ids, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const acted = new Map();
    const timer = setTimeout(() => reject(new Error('Autoplay timed out')), timeoutMs);

    sockets.forEach((socket, index) => {
      socket.on('state', (state) => {
        if (!state.started || !state.game) return;
        if (state.game.winnerTeam !== null) {
          clearTimeout(timer);
          resolve(state);
          return;
        }
        const player = state.players.find((p) => p.id === ids[index]);
        if (!player || state.game.turn !== player.seat) return;

        const key = `${state.game.gameId}:${state.game.moveCount}`;
        if (acted.get(index) === key) return;
        acted.set(index, key);

        const snapshot = state;
        setImmediate(() => {
          if (snapshot.game.phase === 'roll') {
            socket.emit('roll');
          } else if (snapshot.game.phase === 'move' && snapshot.game.validMoves.length > 0) {
            const moves = snapshot.game.validMoves;
            socket.emit('move', { token: moves[Math.floor(Math.random() * moves.length)] });
          }
        });
      });
    });
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BOT_DELAY: '15', OFFLINE_DELAY: '150' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (data) => process.stderr.write(data));

  const sockets = [];
  const track = (socket) => {
    sockets.push(socket);
    return socket;
  };

  try {
    await new Promise((resolve) => setTimeout(resolve, 700));

    /* 1. Private room: create, join, start, roll */
    {
      const a = track(await connect());
      const b = track(await connect());
      const c = track(await connect());
      const d = track(await connect());
      const ids = [uid('A'), uid('B'), uid('C'), uid('D')];

      const initial = await createRoom(a, ids[0], 'Alice');
      assert.equal(initial.code.length, 4);

      await joinRoom(b, initial.code, ids[1], 'Bob');
      await joinRoom(c, initial.code, ids[2], 'Cara');
      const lobby = await joinRoom(d, initial.code, ids[3], 'Dan');
      assert.equal(lobby.players.length, 4);
      assert.deepEqual(lobby.players.map((p) => p.seat), [0, 1, 2, 3]);
      assert.deepEqual(lobby.teamBySeat, [0, 1, 0, 1]);

      const started = await startRoom(a);
      assert.equal(started.game.turn, 0);
      assert.equal(started.game.phase, 'roll');

      const rolledEvent = waitFor(a, 'state', (s) => s.game.phase === 'move' || s.game.turn !== 0);
      a.emit('roll');
      const rolled = await rolledEvent;
      assert.ok(rolled.game.phase === 'move' || rolled.game.turn !== 0);

      a.close();
      b.close();
      c.close();
      d.close();
    }

    /* 2. Full 4-human game reaches a winner */
    {
      const clients = await Promise.all([connect(), connect(), connect(), connect()]);
      clients.forEach(track);
      const ids = clients.map(() => uid('H'));
      const initial = await createRoom(clients[0], ids[0], 'H1');
      await joinRoom(clients[1], initial.code, ids[1], 'H2');
      await joinRoom(clients[2], initial.code, ids[2], 'H3');
      await joinRoom(clients[3], initial.code, ids[3], 'H4');

      const finished = autoplay(clients, ids);
      clients[0].emit('start');
      const final = await finished;
      assert.ok(final.game.winnerTeam === 0 || final.game.winnerTeam === 1);
      assert.equal(final.game.phase, 'over');
      for (const seat of final.game.tokens) {
        for (const token of seat) {
          assert.ok(token.pos === -1 || (token.pos >= 0 && token.pos <= 56));
        }
      }
      clients.forEach((s) => s.close());
    }

    /* 3. Bots fill empty seats and play */
    {
      const host = track(await connect());
      const id = uid('HOST');
      const initial = await createRoom(host, id, 'Host');
      const botsEvent = waitFor(host, 'state', (s) => s.players.length === 4);
      host.emit('fillBots');
      const lobby = await botsEvent;
      assert.equal(lobby.players.filter((p) => p.isBot).length, 3);

      const started = await startRoom(host);
      assert.equal(started.players.length, 4);
      assert.equal(started.code, initial.code);
      host.close();
    }

    /* 4. Solo vs bots from matchmaking overlay */
    {
      const solo = track(await connect());
      const id = uid('SOLO');
      const event = waitFor(solo, 'state', (s) => s.started && s.players.length === 4);
      solo.emit('soloBots', { playerId: id, name: 'Solo' });
      const state = await event;
      assert.equal(state.players.filter((p) => p.isBot).length, 3);
      assert.equal(state.game.turn, 0);
      solo.close();
    }

    /* 5. Quick match groups exactly four players automatically */
    {
      const quick = await Promise.all([connect(), connect(), connect(), connect()]);
      quick.forEach(track);
      const ids = quick.map(() => uid('Q'));
      const states = quick.map((s) => waitFor(s, 'state', (st) => st.started && st.players.length === 4));
      quick.forEach((s, i) => s.emit('quickMatch', { playerId: ids[i], name: `Q${i + 1}` }));
      const matched = await Promise.all(states);
      assert.equal(new Set(matched.map((s) => s.code)).size, 1);
      assert.equal(matched[0].game.phase, 'roll');
      quick.forEach((s) => s.close());
    }

    /* 5b. 2-player room starts a 1v1 on opposite seats */
    {
      const two = await Promise.all([connect(), connect()]);
      two.forEach(track);
      const ids = two.map(() => uid('T'));
      const initial = await createRoom(two[0], ids[0], 'TwoA', 2);
      assert.equal(initial.size, 2);
      const lobby = await joinRoom(two[1], initial.code, ids[1], 'TwoB');
      assert.deepEqual(lobby.players.map((p) => p.seat).sort((a, b) => a - b), [0, 2]);

      const started = await startRoom(two[0]);
      assert.equal(started.size, 2);
      assert.deepEqual(started.game.activeSeats, [0, 2]);
      assert.deepEqual(started.teamBySeat, [0, null, 1, null]);
      assert.equal(started.game.turn, 0);
      two.forEach((s) => s.close());
    }

    /* 5c. 3-player room starts a three-seat game */
    {
      const three = await Promise.all([connect(), connect(), connect()]);
      three.forEach(track);
      const ids = three.map(() => uid('3P'));
      const initial = await createRoom(three[0], ids[0], 'ThreeA', 3);
      assert.equal(initial.size, 3);
      await joinRoom(three[1], initial.code, ids[1], 'ThreeB');
      const lobby = await joinRoom(three[2], initial.code, ids[2], 'ThreeC');
      assert.deepEqual(lobby.players.map((p) => p.seat).sort((a, b) => a - b), [0, 1, 2]);

      const started = await startRoom(three[0]);
      assert.deepEqual(started.game.activeSeats, [0, 1, 2]);
      assert.equal(started.game.turn, 0);
      three.forEach((s) => s.close());
    }

    /* 5d. Host can shrink the room and extra bots are removed */
    {
      const host = track(await connect());
      const id = uid('SIZE');
      const initial = await createRoom(host, id, 'Sizer', 4);
      const botsEvent = waitFor(host, 'state', (s) => s.players.length === 4);
      host.emit('fillBots');
      await botsEvent;

      const resizedEvent = waitFor(host, 'state', (s) => s.size === 2);
      host.emit('setSize', { size: 2 });
      const resized = await resizedEvent;
      assert.equal(resized.players.length, 2);
      assert.equal(resized.players.filter((p) => p.isBot).length, 1);
      assert.deepEqual(resized.activeSeats, [0, 2]);

      const started = await startRoom(host);
      assert.equal(started.game.size, 2);
      assert.deepEqual(started.game.activeSeats, [0, 2]);
      host.close();
    }

    /* 5e. Quick match supports 2 players, and solo bots honors the size */
    {
      const quick = await Promise.all([connect(), connect()]);
      quick.forEach(track);
      const ids = quick.map(() => uid('Q2'));
      const states = quick.map((s) => waitFor(s, 'state', (st) => st.started && st.players.length === 2));
      quick.forEach((s, i) => s.emit('quickMatch', { playerId: ids[i], name: `Q2${i}`, size: 2 }));
      const matched = await Promise.all(states);
      assert.equal(matched[0].size, 2);
      assert.equal(new Set(matched.map((s) => s.code)).size, 1);
      quick.forEach((s) => s.close());
    }

    {
      const solo = track(await connect());
      const id = uid('SOLO2');
      const event = waitFor(solo, 'state', (s) => s.started && s.players.length === 2);
      solo.emit('soloBots', { playerId: id, name: 'Solo2', size: 2 });
      const state = await event;
      assert.equal(state.size, 2);
      assert.equal(state.players.filter((p) => p.isBot).length, 1);
      assert.deepEqual(state.game.activeSeats, [0, 2]);
      solo.close();
    }

    /* 5f. Full 2-player game reaches a winner over the wire */
    {
      const clients = await Promise.all([connect(), connect()]);
      clients.forEach(track);
      const ids = clients.map(() => uid('G2'));
      const initial = await createRoom(clients[0], ids[0], 'G2A', 2);
      await joinRoom(clients[1], initial.code, ids[1], 'G2B');

      const finished = autoplay(clients, ids, 120000);
      clients[0].emit('start');
      const final = await finished;
      assert.ok(final.game.activeSeats.includes(final.game.winnerSeat));
      assert.ok(final.game.winnerTeam === 0 || final.game.winnerTeam === 1);
      assert.equal(final.game.phase, 'over');
      clients.forEach((s) => s.close());
    }

    /* 6. Reconnect resumes a running game; bad resume is reported */
    {
      const host = track(await connect());
      const id = uid('RES');
      await createRoom(host, id, 'Resumer');
      const botsEvent = waitFor(host, 'state', (s) => s.players.length === 4);
      host.emit('fillBots');
      await botsEvent;
      const started = await startRoom(host);
      const code = started.code;

      host.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 250));

      const again = track(await connect());
      const resumed = waitFor(again, 'state', (s) => s.started && s.code === code);
      again.emit('resume', { code, playerId: id });
      const state = await resumed;
      assert.equal(state.players.find((p) => p.id === id).connected, true);

      const bad = track(await connect());
      const failed = waitFor(bad, 'resumeFailed');
      bad.emit('resume', { code: 'ZZZZ', playerId: 'nobody' });
      const failure = await failed;
      assert.equal(failure.reason, 'room');

      again.close();
      bad.close();
    }

    /* 6b. Refresh in the lobby re-adds the player via resume */
    {
      const first = track(await connect());
      const second = track(await connect());
      const firstId = uid('R1');
      const secondId = uid('R2');
      const initial = await createRoom(first, firstId, 'One');
      await joinRoom(second, initial.code, secondId, 'Two');

      second.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const returned = track(await connect());
      const event = waitFor(returned, 'state', (s) => s.players.some((p) => p.id === secondId));
      returned.emit('resume', { code: initial.code, playerId: secondId, name: 'Two' });
      const state = await event;
      assert.equal(state.players.length, 2);
      assert.equal(state.started, false);

      first.close();
      returned.close();
    }

    /* 7. Leave removes a lobby player and reassigns host */
    {
      const first = track(await connect());
      const second = track(await connect());
      const firstId = uid('L');
      const secondId = uid('M');
      const initial = await createRoom(first, firstId, 'First');
      const lobby = await joinRoom(second, initial.code, secondId, 'Second');

      const afterLeave = waitFor(second, 'state', (s) => s.players.length === 1);
      first.emit('leave');
      const state = await afterLeave;
      assert.equal(state.players[0].id, secondId);
      assert.equal(state.hostId, secondId);
      second.close();
    }

    /* 8. Out-of-turn actions are rejected */
    {
      const first = track(await connect());
      const second = track(await connect());
      const firstId = uid('X');
      const secondId = uid('Y');
      const initial = await createRoom(first, firstId, 'X');
      await joinRoom(second, initial.code, secondId, 'Y');
      const botsEvent = waitFor(first, 'state', (s) => s.players.length === 4);
      first.emit('fillBots');
      await botsEvent;
      const started = await startRoom(first);
      assert.equal(started.game.turn, 0);

      const error = waitFor(second, 'errorMsg', (msg) => /not your turn/i.test(msg));
      second.emit('roll');
      await error;
      first.close();
      second.close();
    }

    /* 9. Health endpoint reports the running version */
    {
      const response = await fetch(`${URL}/health`);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.version, require('../package.json').version);
    }

    console.log('integration ok: rooms, 2/3/4-player modes, full games, bots, quick match, reconnect, leave, validation, health');
  } finally {
    sockets.forEach((socket) => {
      try { socket.close(); } catch { /* ignore */ }
    });
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
