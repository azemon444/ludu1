'use strict';

const socket = io();

const COLORS = ['red', 'green', 'yellow', 'blue'];
const TEAM_BY_SEAT = [0, 1, 0, 1];
const TEAM_NAMES = ['Team Red · Yellow', 'Team Green · Blue'];
const START_OFFSET = [0, 13, 26, 39];
const SAFE_RING = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const RING = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

const HOME_COLS = {
  0: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  1: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  2: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  3: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

const YARD_BLOCK = [
  { r: 0, c: 0 },
  { r: 0, c: 9 },
  { r: 9, c: 9 },
  { r: 9, c: 0 },
];

const PALETTE = {
  red: { main: '#ef5350', dark: '#c73e3b', soft: '#fbe3e2' },
  green: { main: '#2ecc71', dark: '#22a85c', soft: '#dcf7e8' },
  yellow: { main: '#f4c542', dark: '#cfa318', soft: '#fdf3d3' },
  blue: { main: '#4aa0e0', dark: '#2f7db8', soft: '#dcecf9' },
};

const SIZE = 720;
const CELL = SIZE / 15;
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const YARD_CENTER = YARD_BLOCK.map((b) => ({
  x: (b.c + 3) * CELL,
  y: (b.r + 3) * CELL,
}));
const YARD_OFFSETS = [
  { x: -1.25, y: -1.25 },
  { x: 1.25, y: -1.25 },
  { x: -1.25, y: 1.25 },
  { x: 1.25, y: 1.25 },
];
const GOAL_DIR = [
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

const ID_KEY = 'ludoTeams.playerId';
const ROOM_KEY = 'ludoTeams.roomCode';
const NAME_KEY = 'ludoTeams.name';

const els = {
  home: document.getElementById('homeScreen'),
  wait: document.getElementById('waitScreen'),
  game: document.getElementById('gameScreen'),
  name: document.getElementById('nameInput'),
  code: document.getElementById('codeInput'),
  quick: document.getElementById('quickBtn'),
  create: document.getElementById('createBtn'),
  join: document.getElementById('joinBtn'),
  queueOverlay: document.getElementById('queueOverlay'),
  queueCount: document.getElementById('queueCount'),
  cancelQueue: document.getElementById('cancelQueueBtn'),
  roomCode: document.getElementById('roomCode'),
  copy: document.getElementById('copyBtn'),
  seatList: document.getElementById('seatList'),
  fillBots: document.getElementById('fillBotsBtn'),
  start: document.getElementById('startBtn'),
  waitMsg: document.getElementById('waitMsg'),
  roomPill: document.getElementById('roomPill'),
  teamBar: document.getElementById('teamBar'),
  turnInfo: document.getElementById('turnInfo'),
  diceBtn: document.getElementById('diceBtn'),
  diceVal: document.getElementById('diceVal'),
  log: document.getElementById('log'),
  banner: document.getElementById('banner'),
  bannerTitle: document.getElementById('bannerTitle'),
  bannerText: document.getElementById('bannerText'),
  restart: document.getElementById('restartBtn'),
  toast: document.getElementById('toast'),
};

function loadPlayerId() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

const myId = loadPlayerId();
let room = null;
let lastTokenPositions = [];
let toastTimer = null;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function showScreen(name) {
  els.home.classList.toggle('hidden', name !== 'home');
  els.wait.classList.toggle('hidden', name !== 'wait');
  els.game.classList.toggle('hidden', name !== 'game');
}

function me() {
  return room ? room.players.find((p) => p.id === myId) : null;
}

/* ---------------- Socket events ---------------- */

socket.on('connect', () => {
  const code = localStorage.getItem(ROOM_KEY);
  if (code) socket.emit('resume', { code, playerId: myId });
});

socket.on('state', (state) => {
  room = state;
  localStorage.setItem(ROOM_KEY, state.code);
  els.queueOverlay.classList.add('hidden');
  render();
});

socket.on('queued', ({ inQueue, count, needed }) => {
  if (inQueue) {
    els.queueCount.textContent = `${count} / ${needed || 4} players`;
    els.queueOverlay.classList.remove('hidden');
  } else {
    els.queueOverlay.classList.add('hidden');
  }
});

socket.on('errorMsg', (message) => {
  toast(message);
  if (message === 'Room not found') localStorage.removeItem(ROOM_KEY);
});

/* ---------------- Lobby actions ---------------- */

els.name.value = localStorage.getItem(NAME_KEY) || '';

function desiredName() {
  const name = (els.name.value || '').trim();
  if (!name) {
    toast('Enter your name first');
    return null;
  }
  localStorage.setItem(NAME_KEY, name);
  return name;
}

els.quick.addEventListener('click', () => {
  const name = desiredName();
  if (!name) return;
  socket.emit('quickMatch', { playerId: myId, name });
});

els.cancelQueue.addEventListener('click', () => {
  socket.emit('cancelQueue');
  els.queueOverlay.classList.add('hidden');
});

els.create.addEventListener('click', () => {
  const name = desiredName();
  if (!name) return;
  socket.emit('create', { playerId: myId, name });
});

els.join.addEventListener('click', () => {
  const name = desiredName();
  if (!name) return;
  const code = (els.code.value || '').trim().toUpperCase();
  if (code.length !== 4) {
    toast('Enter the 4-character room code');
    return;
  }
  socket.emit('join', { code, playerId: myId, name });
});

els.code.addEventListener('input', () => {
  els.code.value = els.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

els.copy.addEventListener('click', async () => {
  if (!room) return;
  try {
    await navigator.clipboard.writeText(room.code);
    toast('Room code copied');
  } catch {
    toast(`Room code: ${room.code}`);
  }
});

els.fillBots.addEventListener('click', () => socket.emit('fillBots'));
els.start.addEventListener('click', () => socket.emit('start'));
els.restart.addEventListener('click', () => socket.emit('restart'));

/* ---------------- Rendering ---------------- */

function render() {
  if (!room) {
    showScreen('home');
    return;
  }
  if (!room.started) {
    showScreen('wait');
    renderWait();
  } else {
    showScreen('game');
    renderGame();
  }
}

function renderWait() {
  els.roomCode.textContent = room.code;
  const isHost = room.hostId === myId;
  els.start.disabled = !(isHost && room.players.length === 4);
  els.fillBots.disabled = !(isHost && room.players.length < 4);

  els.seatList.innerHTML = '';
  for (let seat = 0; seat < 4; seat++) {
    const color = COLORS[seat];
    const player = room.players.find((p) => p.seat === seat);
    const seatEl = document.createElement('div');
    seatEl.className = `seat${player ? '' : ' empty'}`;
    seatEl.style.setProperty('--seat-color', PALETTE[color].main);

    const dot = document.createElement('div');
    dot.className = 'dot';
    seatEl.appendChild(dot);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'seat-name';
    const subEl = document.createElement('div');
    subEl.className = 'seat-sub';

    if (player) {
      nameEl.textContent = player.name;
      subEl.textContent = `Team ${TEAM_BY_SEAT[seat] === 0 ? 'A' : 'B'} · ${color}`;
    } else {
      nameEl.textContent = 'Open seat';
      subEl.textContent = 'Waiting…';
    }
    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    seatEl.appendChild(meta);

    if (player && player.id === room.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag host';
      tag.textContent = 'Host';
      seatEl.appendChild(tag);
    }
    if (player && player.isBot) {
      const tag = document.createElement('span');
      tag.className = 'tag bot';
      tag.textContent = 'Bot';
      seatEl.appendChild(tag);
    }
    if (player && player.id === myId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'You';
      seatEl.appendChild(tag);
    }

    els.seatList.appendChild(seatEl);
  }

  if (!isHost) {
    els.waitMsg.textContent = 'Waiting for the host to start the game…';
  } else if (room.players.length < 4) {
    const missing = 4 - room.players.length;
    els.waitMsg.textContent = `Waiting for ${missing} more player${missing > 1 ? 's' : ''} — or fill with bots.`;
  } else {
    els.waitMsg.textContent = 'All seats filled. Ready to play!';
  }
}

function renderGame() {
  const game = room.game;
  const player = me();
  const mySeat = player ? player.seat : -1;
  const isOver = game.winnerTeam !== null;
  const isMyTurn = !isOver && game.turn === mySeat;
  const current = room.players.find((p) => p.seat === game.turn);

  els.roomPill.textContent = room.code;

  const activeTeam = isOver ? -1 : TEAM_BY_SEAT[game.turn];
  els.teamBar.innerHTML = [0, 1].map((team) => {
    const seats = team === 0 ? [0, 2] : [1, 3];
    const swatches = seats.map((s) => `<span class="sw" style="background:${PALETTE[COLORS[s]].main}"></span>`).join('');
    const color = team === 0 ? PALETTE.yellow.main : PALETTE.blue.main;
    return `<div class="team-chip${activeTeam === team ? ' active' : ''}" style="color:${color}">
      ${swatches}<span>Team ${team === 0 ? 'A' : 'B'}</span>
    </div>`;
  }).join('');

  drawBoard(game);

  if (isOver) {
    els.turnInfo.innerHTML = `<span class="who">${esc(TEAM_NAMES[game.winnerTeam])} win!</span>`;
  } else if (current) {
    const swatch = `<span class="sw" style="background:${PALETTE[COLORS[game.turn]].main}"></span>`;
    let suffix = '';
    if (isMyTurn) suffix = game.phase === 'move' ? ' — pick a token' : ' — your turn';
    else if (current.isBot) suffix = ' is thinking…';
    else if (!current.connected) suffix = ' is offline…';
    els.turnInfo.innerHTML = `<span class="who">${swatch}${esc(current.name)}${suffix}</span>`;
  } else {
    els.turnInfo.textContent = '';
  }

  const canRoll = isMyTurn && game.phase === 'roll';
  els.diceBtn.disabled = !canRoll;
  els.diceBtn.classList.toggle('pulse', canRoll);
  els.diceVal.textContent = game.dice ? String(game.dice) : '🎲';

  els.log.innerHTML = game.log.slice(-3).map((line) => esc(line)).join('<br>');
  els.log.scrollTop = els.log.scrollHeight;

  if (isOver) {
    els.banner.classList.remove('hidden');
    els.bannerTitle.textContent = `${TEAM_NAMES[game.winnerTeam]} win!`;
    els.bannerText.textContent = 'Great game — the paired team takes it.';
    els.restart.classList.toggle('hidden', room.hostId !== myId);
  } else {
    els.banner.classList.add('hidden');
  }
}

/* ---------------- Board drawing ---------------- */

function roundRectPath(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawStar(cx, cy, outer, inner, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawCell(r, c, fill, stroke, lineWidth = 1.5) {
  roundRectPath(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 7);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawYards() {
  for (let seat = 0; seat < 4; seat++) {
    const pal = PALETTE[COLORS[seat]];
    const block = YARD_BLOCK[seat];
    const x = block.c * CELL;
    const y = block.r * CELL;
    const size = 6 * CELL;

    roundRectPath(x + CELL * 0.18, y + CELL * 0.18, size - CELL * 0.36, size - CELL * 0.36, CELL * 0.6);
    ctx.fillStyle = pal.soft;
    ctx.fill();
    ctx.strokeStyle = pal.main;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    roundRectPath(x + CELL * 0.95, y + CELL * 0.95, size - CELL * 1.9, size - CELL * 1.9, CELL * 0.45);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const center = YARD_CENTER[seat];
    for (const off of YARD_OFFSETS) {
      ctx.beginPath();
      ctx.arc(center.x + off.x * CELL, center.y + off.y * CELL, CELL * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = pal.soft;
      ctx.fill();
      ctx.strokeStyle = `${pal.main}55`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawRing() {
  for (let idx = 0; idx < RING.length; idx++) {
    const [r, c] = RING[idx];
    const startSeat = START_OFFSET.indexOf(idx);

    if (startSeat >= 0) {
      const pal = PALETTE[COLORS[startSeat]];
      drawCell(r, c, pal.soft, pal.main, 2.5);
      drawStar(c * CELL + CELL / 2, r * CELL + CELL / 2, CELL * 0.22, CELL * 0.1, pal.main);
    } else if (SAFE_RING.has(idx)) {
      drawCell(r, c, '#ffffff', '#c8d1e0');
      drawStar(c * CELL + CELL / 2, r * CELL + CELL / 2, CELL * 0.2, CELL * 0.09, '#aeb9cd');
    } else {
      drawCell(r, c, '#ffffff', '#d9e0ec');
    }
  }
}

function drawHomeColumns() {
  for (let seat = 0; seat < 4; seat++) {
    const pal = PALETTE[COLORS[seat]];
    for (const [r, c] of HOME_COLS[seat]) {
      drawCell(r, c, pal.soft, pal.main, 2);
    }
  }
}

function drawCenter() {
  const x0 = 6 * CELL;
  const x1 = 9 * CELL;
  const cx = 7.5 * CELL;
  const cy = 7.5 * CELL;

  const triangles = [
    { pts: [[x0, x0], [x1, x0], [cx, cy]], color: PALETTE.green.main },
    { pts: [[x1, x0], [x1, x1], [cx, cy]], color: PALETTE.yellow.main },
    { pts: [[x1, x1], [x0, x1], [cx, cy]], color: PALETTE.blue.main },
    { pts: [[x0, x1], [x0, x0], [cx, cy]], color: PALETTE.red.main },
  ];

  for (const t of triangles) {
    ctx.beginPath();
    ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    ctx.lineTo(t.pts[1][0], t.pts[1][1]);
    ctx.lineTo(t.pts[2][0], t.pts[2][1]);
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, CELL * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function computeTokenPositions(game) {
  const positions = [];
  const groups = new Map();

  for (let seat = 0; seat < 4; seat++) {
    for (let i = 0; i < 4; i++) {
      const pos = game.tokens[seat][i].pos;
      if (pos >= 0 && pos <= 55) {
        let r;
        let c;
        if (pos <= 50) {
          [r, c] = RING[(START_OFFSET[seat] + pos) % 52];
        } else {
          [r, c] = HOME_COLS[seat][pos - 51];
        }
        const key = `${r},${c}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ seat, i });
      }
    }
  }

  for (const [key, list] of groups) {
    const [r, c] = key.split(',').map(Number);
    const cx = c * CELL + CELL / 2;
    const cy = r * CELL + CELL / 2;
    const n = list.length;
    list.forEach((token, k) => {
      let dx = 0;
      let dy = 0;
      if (n > 1) {
        const angle = (Math.PI * 2 * k) / n - Math.PI / 2;
        const radius = CELL * 0.16;
        dx = Math.cos(angle) * radius;
        dy = Math.sin(angle) * radius;
      }
      positions.push({ seat: token.seat, i: token.i, x: cx + dx, y: cy + dy, r: CELL * 0.3 });
    });
  }

  for (let seat = 0; seat < 4; seat++) {
    const center = YARD_CENTER[seat];
    for (let i = 0; i < 4; i++) {
      if (game.tokens[seat][i].pos === -1) {
        const off = YARD_OFFSETS[i];
        positions.push({
          seat, i,
          x: center.x + off.x * CELL,
          y: center.y + off.y * CELL,
          r: CELL * 0.35,
        });
      }
    }
  }

  for (let seat = 0; seat < 4; seat++) {
    let count = 0;
    for (let i = 0; i < 4; i++) {
      if (game.tokens[seat][i].pos === 56) {
        const dir = GOAL_DIR[seat];
        const perp = { x: -dir.y, y: dir.x };
        const base = CELL * 0.95;
        const spread = (count - 1.5) * CELL * 0.28;
        positions.push({
          seat, i,
          x: SIZE / 2 + dir.x * base + perp.x * spread,
          y: SIZE / 2 + dir.y * base + perp.y * spread,
          r: CELL * 0.16,
          home: true,
        });
        count += 1;
      }
    }
  }

  return positions;
}

function drawTokens(positions, game, movable, turnSeat) {
  for (const token of positions) {
    const pal = PALETTE[COLORS[token.seat]];
    const isMovable = token.seat === turnSeat && movable.has(token.i);
    const dim = movable.size > 0 && token.seat === turnSeat && !isMovable;

    ctx.save();
    if (dim) ctx.globalAlpha = 0.55;

    if (isMovable) {
      ctx.beginPath();
      ctx.arc(token.x, token.y, token.r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(token.x, token.y + 2.5, token.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 16, 30, 0.22)';
    ctx.fill();

    const grad = ctx.createRadialGradient(
      token.x - token.r * 0.35, token.y - token.r * 0.35, token.r * 0.15,
      token.x, token.y, token.r
    );
    grad.addColorStop(0, token.home ? pal.main : '#ffffff');
    grad.addColorStop(0.28, pal.main);
    grad.addColorStop(1, pal.dark);

    ctx.beginPath();
    ctx.arc(token.x, token.y, token.r, 0, Math.PI * 2);
    ctx.fillStyle = token.home ? pal.main : grad;
    ctx.fill();
    ctx.lineWidth = token.home ? 1.5 : 2.5;
    ctx.strokeStyle = token.home ? 'rgba(255,255,255,0.8)' : '#ffffff';
    ctx.stroke();

    if (token.r > 10) {
      ctx.beginPath();
      ctx.arc(token.x - token.r * 0.3, token.y - token.r * 0.32, token.r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawBoard(game) {
  const player = me();
  const mySeat = player ? player.seat : -1;
  const isMyTurn = game.winnerTeam === null && game.turn === mySeat;
  const movable = new Set(isMyTurn && game.phase === 'move' ? game.validMoves : []);

  ctx.clearRect(0, 0, SIZE, SIZE);
  roundRectPath(0, 0, SIZE, SIZE, 26);
  ctx.fillStyle = '#f6f8fc';
  ctx.fill();
  ctx.save();
  roundRectPath(0, 0, SIZE, SIZE, 26);
  ctx.clip();

  drawYards();
  drawRing();
  drawHomeColumns();
  drawCenter();

  const positions = computeTokenPositions(game);
  lastTokenPositions = positions;
  drawTokens(positions, game, movable, game.turn);

  ctx.restore();
}

/* ---------------- Interaction ---------------- */

els.diceBtn.addEventListener('click', () => {
  if (!room || !room.game) return;
  socket.emit('roll');
});

canvas.addEventListener('click', (event) => {
  if (!room || !room.started || !room.game) return;
  const game = room.game;
  const player = me();
  if (!player) return;
  if (game.winnerTeam !== null) return;
  if (game.turn !== player.seat || game.phase !== 'move') return;

  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (SIZE / rect.width);
  const y = (event.clientY - rect.top) * (SIZE / rect.height);

  let hit = null;
  for (const token of lastTokenPositions) {
    if (token.seat !== player.seat) continue;
    if (!game.validMoves.includes(token.i)) continue;
    const dist = Math.hypot(token.x - x, token.y - y);
    if (dist <= token.r + 16) {
      hit = token;
      break;
    }
  }
  if (hit) socket.emit('move', { token: hit.i });
});

els.code.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.join.click();
});

els.name.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.create.click();
});

render();
