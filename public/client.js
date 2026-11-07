'use strict';

const socket = io();

const COLORS = ['red', 'green', 'yellow', 'blue'];
const TEAM_BY_SEAT = [0, 1, 0, 1];
const TEAM_NAMES = ['Red & Yellow', 'Green & Blue'];
const START_OFFSET = [0, 13, 26, 39];
const SAFE_RING = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const GOAL = 56;
const ACTIVE_SEATS_BY_SIZE = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const SIZE_LABELS = { 2: '1v1', 3: '3 players', 4: '2v2' };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

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
  red: { main: '#ef5350', dark: '#c73e3b', soft: '#f9d5d3' },
  green: { main: '#2ecc71', dark: '#22a85c', soft: '#c9f1da' },
  yellow: { main: '#f4c542', dark: '#cfa318', soft: '#fbe9b8' },
  blue: { main: '#4aa0e0', dark: '#2f7db8', soft: '#cbe4f8' },
};

const SIZE = 720;
const CELL = SIZE / 15;
const canvas = document.getElementById('board');
canvas.width = SIZE;
canvas.height = SIZE;
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
const SIZE_KEY = 'ludoTeams.size';

function normalizeSize(value) {
  const size = Number(value);
  return [2, 3, 4].includes(size) ? size : 4;
}

let selectedSize = normalizeSize(localStorage.getItem(SIZE_KEY) || 4);

const els = {
  home: document.getElementById('homeScreen'),
  wait: document.getElementById('waitScreen'),
  game: document.getElementById('gameScreen'),
  name: document.getElementById('nameInput'),
  code: document.getElementById('codeInput'),
  quick: document.getElementById('quickBtn'),
  quickSub: document.getElementById('quickSub'),
  create: document.getElementById('createBtn'),
  join: document.getElementById('joinBtn'),
  coinBalance: document.getElementById('coinBalance'),
  supporterBadge: document.getElementById('supporterBadge'),
  storeBtn: document.getElementById('storeBtn'),
  storeModal: document.getElementById('storeModal'),
  closeStore: document.getElementById('closeStoreBtn'),
  packList: document.getElementById('packList'),
  storeStatus: document.getElementById('storeStatus'),
  homeSizePicker: document.getElementById('homeSizePicker'),
  waitSizePicker: document.getElementById('waitSizePicker'),
  sizeHint: document.getElementById('sizeHint'),
  queueOverlay: document.getElementById('queueOverlay'),
  queueCount: document.getElementById('queueCount'),
  cancelQueue: document.getElementById('cancelQueueBtn'),
  solo: document.getElementById('soloBtn'),
  connBar: document.getElementById('connBar'),
  leaveWait: document.getElementById('leaveWaitBtn'),
  leaveGame: document.getElementById('leaveGameBtn'),
  roomCode: document.getElementById('roomCode'),
  copy: document.getElementById('copyBtn'),
  seatList: document.getElementById('seatList'),
  fillBots: document.getElementById('fillBotsBtn'),
  start: document.getElementById('startBtn'),
  waitMsg: document.getElementById('waitMsg'),
  roomPill: document.getElementById('roomPill'),
  teamBar: document.getElementById('teamBar'),
  turnCard: document.getElementById('turnCard'),
  turnKicker: document.getElementById('turnKicker'),
  turnInfo: document.getElementById('turnInfo'),
  turnSub: document.getElementById('turnSub'),
  playerList: document.getElementById('playerList'),
  moveHint: document.getElementById('moveHint'),
  diceBtn: document.getElementById('diceBtn'),
  diceVal: document.getElementById('diceVal'),
  diceHint: document.getElementById('diceHint'),
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
let lastGameId = null;
let lastNoticeSeq = 0;
let lastDice = null;
let moveLock = false;
let autoMoveKey = null;
let autoMoveTimer = null;
let pulseOn = false;
let pulseTimer = null;
let animations = [];
let animFrame = null;
let wallet = { coins: 0, supporter: false };
let storePacks = [];
let storeConfigured = false;
let storeLoading = false;
let storeReturnFocus = null;

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
  els.connBar.classList.add('hidden');
  const code = localStorage.getItem(ROOM_KEY);
  const name = localStorage.getItem(NAME_KEY) || '';
  if (code) socket.emit('resume', { code, playerId: myId, name });
});

socket.on('disconnect', () => {
  els.connBar.classList.remove('hidden');
  if (!els.queueOverlay.classList.contains('hidden')) {
    els.queueOverlay.classList.add('hidden');
    toast('Matchmaking was interrupted — please try again');
  }
});

socket.on('resumeFailed', () => {
  localStorage.removeItem(ROOM_KEY);
  room = null;
  lastGameId = null;
  lastNoticeSeq = 0;
  lastDice = null;
  animations = [];
  render();
  toast('That game is no longer available');
});

socket.on('left', () => {
  localStorage.removeItem(ROOM_KEY);
  room = null;
  lastGameId = null;
  lastNoticeSeq = 0;
  lastDice = null;
  animations = [];
  render();
  toast('You left the game');
});

socket.on('state', (state) => {
  const oldGame = room && room.game;
  const oldPositions = lastTokenPositions.slice();
  room = state;
  moveLock = false;
  localStorage.setItem(ROOM_KEY, state.code);
  els.queueOverlay.classList.add('hidden');

  if (state.game) {
    if (state.game.gameId !== lastGameId) {
      lastGameId = state.game.gameId;
      lastNoticeSeq = state.game.noticeSeq;
      lastDice = null;
    } else if (state.game.noticeSeq > lastNoticeSeq) {
      lastNoticeSeq = state.game.noticeSeq;
      if (state.game.noticeText) toast(state.game.noticeText);
    }

    const rolled = Number(state.game.dice);
    if (rolled >= 1 && rolled <= 6) lastDice = rolled;

    if (oldGame && oldGame.gameId === state.game.gameId) {
      createAnimations(oldGame, state.game, oldPositions);
    } else {
      animations = [];
    }
  } else {
    lastDice = null;
    animations = [];
  }

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

function renderWallet() {
  els.coinBalance.textContent = Number(wallet.coins || 0).toLocaleString('en-US');
  els.supporterBadge.classList.toggle('hidden', !wallet.supporter);
}

async function loadWallet() {
  try {
    const response = await fetch(`/api/wallet/${encodeURIComponent(myId)}`, { cache: 'no-store' });
    if (!response.ok) return;
    wallet = await response.json();
    renderWallet();
  } catch {
  }
}

function closeStore() {
  els.storeModal.classList.add('hidden');
  if (storeReturnFocus && typeof storeReturnFocus.focus === 'function') {
    storeReturnFocus.focus();
  }
  storeReturnFocus = null;
}

async function loadStore() {
  if (storeLoading) return;
  storeLoading = true;
  els.storeStatus.textContent = 'Loading coin packs…';
  try {
    const response = await fetch('/api/store', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load the store');
    storePacks = Array.isArray(data.packs) ? data.packs : [];
    storeConfigured = !!data.configured;
    renderStorePacks();
    els.storeStatus.textContent = storeConfigured
      ? ''
      : 'Top-ups are not available yet. Connect your payment page to enable checkout.';
  } catch (error) {
    els.storeStatus.textContent = error.message;
  } finally {
    storeLoading = false;
  }
}

function renderStorePacks() {
  els.packList.innerHTML = storePacks.map((pack) => `
    <button class="pack-option" data-pack="${esc(pack.id)}" ${storeConfigured ? '' : 'disabled'}>
      ${pack.bonus ? `<span class="pack-bonus">${esc(pack.bonus)}</span>` : ''}
      <span class="pack-coins">${Number(pack.coins).toLocaleString('en-US')}</span>
      <span class="pack-unit">coins</span>
      <span class="pack-price">৳${Number(pack.amount).toLocaleString('en-US')}</span>
      <span class="pack-label">${esc(pack.label)}</span>
    </button>
  `).join('');
}

async function buyPack(packId) {
  const pack = storePacks.find((item) => item.id === packId);
  if (!pack || !storeConfigured) return;

  const name = (els.name.value || '').trim() || localStorage.getItem(NAME_KEY) || 'Player';
  els.storeStatus.textContent = 'Creating secure payment…';
  for (const button of els.packList.querySelectorAll('button')) button.disabled = true;

  try {
    const response = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myId, name, packId: pack.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.paymentUrl) {
      throw new Error(data.error || 'Could not start payment');
    }
    window.location.assign(data.paymentUrl);
  } catch (error) {
    els.storeStatus.textContent = error.message;
    for (const button of els.packList.querySelectorAll('button')) {
      button.disabled = !storeConfigured;
    }
  }
}

function openStore() {
  storeReturnFocus = document.activeElement;
  els.storeModal.classList.remove('hidden');
  els.storeStatus.textContent = storePacks.length && !storeConfigured
    ? 'Top-ups are not available yet. Connect your payment page to enable checkout.'
    : '';
  if (!storePacks.length) loadStore();
  els.closeStore.focus();
}


function chooseSize(size) {
  selectedSize = normalizeSize(size);
  localStorage.setItem(SIZE_KEY, String(selectedSize));
  updateSizePickers();
}

function updateSizePickers() {
  const roomSize = room && !room.started ? room.size : selectedSize;
  const isHost = !!(room && room.hostId === myId);

  for (const btn of els.homeSizePicker.querySelectorAll('[data-size]')) {
    btn.classList.toggle('active', Number(btn.dataset.size) === selectedSize);
  }
  for (const btn of els.waitSizePicker.querySelectorAll('[data-size]')) {
    const size = Number(btn.dataset.size);
    btn.classList.toggle('active', size === roomSize);
    btn.disabled = !isHost || !room;
  }
  els.quickSub.textContent = SIZE_LABELS[selectedSize];
}

els.homeSizePicker.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-size]');
  if (!btn) return;
  chooseSize(btn.dataset.size);
});

els.waitSizePicker.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-size]');
  if (!btn || btn.disabled) return;
  chooseSize(btn.dataset.size);
  socket.emit('setSize', { size: selectedSize });
});

els.storeBtn.addEventListener('click', openStore);
els.closeStore.addEventListener('click', closeStore);
els.storeModal.addEventListener('click', (event) => {
  if (event.target === els.storeModal) closeStore();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.storeModal.classList.contains('hidden')) closeStore();
});
els.packList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-pack]');
  if (!button || button.disabled) return;
  buyPack(button.dataset.pack);
});
window.addEventListener('focus', loadWallet);

els.quick.addEventListener('click', () => {
  const name = desiredName();
  if (!name) return;
  socket.emit('quickMatch', { playerId: myId, name, size: selectedSize });
});

els.cancelQueue.addEventListener('click', () => {
  socket.emit('cancelQueue');
  els.queueOverlay.classList.add('hidden');
});

els.solo.addEventListener('click', () => {
  const name = desiredName();
  if (!name) return;
  els.queueOverlay.classList.add('hidden');
  socket.emit('soloBots', { playerId: myId, name, size: selectedSize });
});

function leaveRoom() {
  socket.emit('leave');
}

els.leaveWait.addEventListener('click', leaveRoom);
els.leaveGame.addEventListener('click', leaveRoom);

els.create.addEventListener('click', () => {
  const name = desiredName();
  if (!name) return;
  socket.emit('create', { playerId: myId, name, size: selectedSize });
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
  updateSizePickers();
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
  const size = room.size || 4;
  const seats = room.activeSeats || ACTIVE_SEATS_BY_SIZE[size] || [0, 1, 2, 3];
  const teamBySeat = room.teamBySeat || TEAM_BY_SEAT;

  els.start.disabled = !(isHost && room.players.length === size);
  els.fillBots.disabled = !(isHost && room.players.length < size);
  els.sizeHint.textContent = isHost ? 'host can change' : 'set by host';

  els.seatList.innerHTML = '';
  for (const seat of seats) {
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
      subEl.textContent = size === 4
        ? `Team ${teamBySeat[seat] === 0 ? 'A' : 'B'} · ${color}`
        : `${color}${size === 2 ? ' · 1v1' : ' · solo'}`;
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
  } else if (room.players.length < size) {
    const missing = size - room.players.length;
    els.waitMsg.textContent = `Waiting for ${missing} more player${missing > 1 ? 's' : ''} — or fill with bots.`;
  } else {
    els.waitMsg.textContent = 'All seats filled. Ready to play!';
  }
}

function autoTokenChoice(game, seat) {
  const moves = game.validMoves || [];
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  const tokens = game.tokens[seat];
  if (moves.every((i) => tokens[i].pos === -1)) return moves[0];
  return null;
}

function maybeAutoMove(game, seat) {
  if (animations.length) return;
  const pick = autoTokenChoice(game, seat);
  if (pick === null) return;
  const key = `${game.gameId}:${game.moveCount}`;
  if (autoMoveKey === key) return;
  autoMoveKey = key;
  clearTimeout(autoMoveTimer);
  autoMoveTimer = setTimeout(() => {
    const current = room && room.game;
    if (!current || current.gameId !== game.gameId || current.moveCount !== game.moveCount) return;
    if (current.phase !== 'move' || current.turn !== seat) return;
    if (!current.validMoves.includes(pick)) return;
    moveLock = true;
    socket.emit('move', { token: pick });
    setTimeout(() => { moveLock = false; }, 1500);
  }, 550);
}

function updatePulse(game, needed) {
  if (!needed) {
    if (pulseTimer) {
      clearInterval(pulseTimer);
      pulseTimer = null;
      pulseOn = false;
    }
    return;
  }
  if (pulseTimer) return;
  pulseTimer = setInterval(() => {
    const current = room && room.game;
    const player = me();
    if (!current || !player) return;
    if (current.winnerTeam !== null || current.turn !== player.seat || current.phase !== 'move') {
      clearInterval(pulseTimer);
      pulseTimer = null;
      pulseOn = false;
      drawBoard(current);
      return;
    }
    pulseOn = !pulseOn;
    drawBoard(current);
  }, 420);
}

function winnerLabel(game) {
  const size = game.size || room.size || 4;
  if (size === 4) {
    const team = game.winnerTeam;
    return `${TEAM_NAMES[team] || 'Team'} win!`;
  }
  const winner = room.players.find((p) => p.seat === game.winnerSeat);
  return `${winner ? winner.name : COLORS[game.winnerSeat] || 'Winner'} wins!`;
}

function renderDice(value, canRoll) {
  const dice = Number(value);
  if (dice >= 1 && dice <= 6) {
    const on = new Set(PIPS[dice]);
    els.diceVal.innerHTML = `<span class="dice-grid">${Array.from({ length: 9 }, (_, i) => `<i class="pip${on.has(i) ? ' on' : ''}"></i>`).join('')}</span>`;
  } else if (canRoll) {
    els.diceVal.innerHTML = '<span class="dice-roll">ROLL</span>';
  } else {
    els.diceVal.innerHTML = '<span class="dice-idle">🎲</span>';
  }
}

function renderGame() {
  const game = room.game;
  const player = me();
  const mySeat = player ? player.seat : -1;
  const isOver = game.winnerTeam !== null;
  const isMyTurn = !isOver && game.turn === mySeat;
  const canMove = isMyTurn && game.phase === 'move';
  const autoPick = canMove ? autoTokenChoice(game, mySeat) : null;
  const manualPick = canMove && autoPick === null;
  const current = room.players.find((p) => p.seat === game.turn);
  const size = game.size || room.size || 4;
  const activeSeats = game.activeSeats || room.activeSeats || ACTIVE_SEATS_BY_SIZE[size] || [0, 1, 2, 3];
  const teamBySeat = game.teamBySeat || room.teamBySeat || TEAM_BY_SEAT;
  const turnPal = PALETTE[COLORS[game.turn]] || PALETTE.red;

  els.roomPill.textContent = room.code;

  if (size === 4) {
    const activeTeam = isOver ? -1 : teamBySeat[game.turn];
    els.teamBar.innerHTML = [0, 1].map((team) => {
      const seats = activeSeats.filter((seat) => teamBySeat[seat] === team);
      const swatches = seats.map((s) => `<span class="sw" style="background:${PALETTE[COLORS[s]].main}"></span>`).join('');
      const color = team === 0 ? PALETTE.yellow.main : PALETTE.blue.main;
      return `<div class="team-chip${activeTeam === team ? ' active' : ''}" style="color:${color}">
        ${swatches}<span>Team ${team === 0 ? 'A' : 'B'}</span>
      </div>`;
    }).join('');
  } else {
    els.teamBar.innerHTML = activeSeats.map((seat) => {
      const owner = room.players.find((p) => p.seat === seat);
      const pal = PALETTE[COLORS[seat]];
      const active = !isOver && game.turn === seat;
      return `<div class="team-chip player-chip${active ? ' active' : ''}" style="--chip:${pal.main};color:${pal.main}">
        <span class="sw" style="background:${pal.main}"></span>
        <span class="chip-name">${esc(owner ? owner.name : COLORS[seat])}</span>
      </div>`;
    }).join('');
  }

  drawBoard(game);

  els.turnCard.style.setProperty('--turn-color', turnPal.main);
  els.turnCard.style.setProperty('--turn-soft', `${turnPal.main}22`);
  els.turnCard.classList.toggle('mine', isMyTurn);

  if (isOver) {
    els.turnKicker.textContent = 'Game over';
    els.turnInfo.innerHTML = `<span class="who">${esc(winnerLabel(game))}</span>`;
    els.turnSub.textContent = size === 4
      ? 'The paired team brought all pawns home.'
      : 'All four pawns made it home.';
  } else if (current) {
    const swatch = `<span class="sw" style="background:${PALETTE[COLORS[game.turn]].main}"></span>`;
    els.turnKicker.textContent = isMyTurn ? 'Your turn' : current.isBot ? 'Bot turn' : 'Opponent turn';
    els.turnInfo.innerHTML = `<span class="who">${swatch}${esc(current.name)}</span>`;
    if (isMyTurn) {
      els.turnSub.textContent = game.phase === 'move'
        ? (manualPick ? 'Tap a glowing pawn to move' : 'Moving your pawn…')
        : 'Roll the dice to play';
    } else if (current.isBot) {
      els.turnSub.textContent = 'Thinking about the next move…';
    } else if (!current.connected) {
      els.turnSub.textContent = 'Waiting for them to reconnect…';
    } else {
      els.turnSub.textContent = 'Rolling and moving…';
    }
  } else {
    els.turnKicker.textContent = 'Waiting';
    els.turnInfo.textContent = '';
    els.turnSub.textContent = 'Getting the board ready…';
  }

  const canRoll = isMyTurn && game.phase === 'roll' && animations.length === 0;
  els.diceBtn.disabled = !canRoll;
  els.diceBtn.classList.toggle('pulse', canRoll);
  renderDice(lastDice, canRoll);
  els.diceHint.textContent = isOver
    ? 'Game over'
    : isMyTurn
      ? (game.phase === 'roll' ? (canRoll ? 'Tap the die to roll' : 'Moving…') : 'Move a pawn')
      : current ? `${current.name} is up` : 'Waiting…';

  const showHint = canMove && !isOver;
  els.moveHint.classList.toggle('hidden', !showHint);
  els.moveHint.classList.toggle('auto', showHint && !manualPick);
  els.moveHint.textContent = manualPick ? 'Tap a glowing token' : 'Moving…';

  if (canMove) maybeAutoMove(game, mySeat);
  updatePulse(game, canMove);

  els.playerList.innerHTML = activeSeats.map((seat) => {
    const owner = room.players.find((p) => p.seat === seat);
    const pal = PALETTE[COLORS[seat]];
    const active = !isOver && game.turn === seat;
    const isYou = !!(owner && owner.id === myId);
    const home = game.tokens[seat] ? game.tokens[seat].filter((t) => t.pos === 56).length : 0;
    const team = teamBySeat[seat];
    const sub = [size === 4 ? `Team ${team === 0 ? 'A' : 'B'}` : size === 2 ? '1v1' : 'Solo'];
    if (isYou) sub.push('You');
    else if (owner && owner.isBot) sub.push('Bot');
    else if (owner && !owner.connected) sub.push('Offline');
    const name = owner ? owner.name : COLORS[seat];
    const initial = esc((name.trim().charAt(0) || '?').toUpperCase());
    return `<div class="player-row${active ? ' active' : ''}${isYou ? ' you' : ''}" style="--pc:${pal.main}">
      <span class="avatar">${initial}</span>
      <span class="player-meta">
        <span class="player-name">${esc(name)}</span>
        <span class="player-sub">${esc(sub.join(' · '))}</span>
      </span>
      <span class="home-pips">${[0, 1, 2, 3].map((k) => `<i class="${k < home ? 'on' : ''}"></i>`).join('')}</span>
    </div>`;
  }).join('');

  const logLines = game.log.slice(-5);
  els.log.innerHTML = logLines.length
    ? logLines.map((line) => esc(line)).join('<br>')
    : '<span class="log-empty">Waiting for the first move…</span>';
  els.log.scrollTop = els.log.scrollHeight;

  if (isOver) {
    els.banner.classList.toggle('hidden', animations.length > 0);
    els.bannerTitle.textContent = winnerLabel(game);
    els.bannerText.textContent = size === 4
      ? 'Great game — the paired team takes it.'
      : 'First to bring all 4 pawns home wins.';
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

function drawYards(activeSeats, turnSeat) {
  for (let seat = 0; seat < 4; seat++) {
    const inactive = activeSeats && !activeSeats.has(seat);
    const pal = PALETTE[COLORS[seat]];
    const block = YARD_BLOCK[seat];
    const x = block.c * CELL;
    const y = block.r * CELL;
    const size = 6 * CELL;

    ctx.save();
    if (inactive) ctx.globalAlpha = 0.32;
    if (seat === turnSeat) {
      ctx.shadowColor = pal.main;
      ctx.shadowBlur = 20;
    }

    roundRectPath(x + CELL * 0.18, y + CELL * 0.18, size - CELL * 0.36, size - CELL * 0.36, CELL * 0.6);
    ctx.fillStyle = pal.soft;
    ctx.fill();
    ctx.strokeStyle = pal.main;
    ctx.lineWidth = seat === turnSeat ? 4 : 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

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
    ctx.restore();
  }
}

function drawRing(activeSeats) {
  for (let idx = 0; idx < RING.length; idx++) {
    const [r, c] = RING[idx];
    const startSeat = START_OFFSET.indexOf(idx);
    const activeStart = startSeat >= 0 && (!activeSeats || activeSeats.has(startSeat));

    if (activeStart) {
      const pal = PALETTE[COLORS[startSeat]];
      drawCell(r, c, pal.soft, pal.main, 2.5);
      drawStar(c * CELL + CELL / 2, r * CELL + CELL / 2, CELL * 0.22, CELL * 0.1, pal.main);
    } else if (startSeat >= 0) {
      drawCell(r, c, '#f2f5fa', '#cdd5e3');
      drawStar(c * CELL + CELL / 2, r * CELL + CELL / 2, CELL * 0.18, CELL * 0.08, '#c3cbdb');
    } else if (SAFE_RING.has(idx)) {
      drawCell(r, c, '#ffffff', '#c8d1e0');
      drawStar(c * CELL + CELL / 2, r * CELL + CELL / 2, CELL * 0.2, CELL * 0.09, '#aeb9cd');
    } else {
      drawCell(r, c, '#ffffff', '#d9e0ec');
    }
  }
}

function drawHomeColumns(activeSeats, turnSeat) {
  for (let seat = 0; seat < 4; seat++) {
    const inactive = activeSeats && !activeSeats.has(seat);
    const pal = PALETTE[COLORS[seat]];
    ctx.save();
    if (inactive) ctx.globalAlpha = 0.35;
    if (seat === turnSeat) {
      ctx.shadowColor = pal.main;
      ctx.shadowBlur = 8;
    }
    for (const [r, c] of HOME_COLS[seat]) {
      drawCell(r, c, pal.soft, pal.main, seat === turnSeat ? 2.6 : 2);
    }
    ctx.restore();
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
  const seats = game.activeSeats || [0, 1, 2, 3];

  for (const seat of seats) {
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
      positions.push({ seat: token.seat, i: token.i, x: cx + dx, y: cy + dy, r: CELL * 0.32 });
    });
  }

  for (const seat of seats) {
    const center = YARD_CENTER[seat];
    for (let i = 0; i < 4; i++) {
      if (game.tokens[seat][i].pos === -1) {
        const off = YARD_OFFSETS[i];
        positions.push({
          seat, i,
          x: center.x + off.x * CELL,
          y: center.y + off.y * CELL,
          r: CELL * 0.37,
        });
      }
    }
  }

  for (const seat of seats) {
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
          r: CELL * 0.17,
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
      ctx.save();
      ctx.shadowColor = 'rgba(255, 213, 74, 0.95)';
      ctx.shadowBlur = pulseOn ? 18 : 7;
      ctx.beginPath();
      ctx.arc(token.x, token.y, token.r + (pulseOn ? 9 : 5), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = pulseOn ? 5 : 3.5;
      ctx.stroke();
      ctx.restore();
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

function cellCenter(seat, pos) {
  if (pos >= 0 && pos <= 50) {
    const [r, c] = RING[(START_OFFSET[seat] + pos) % 52];
    return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
  }
  if (pos >= 51 && pos <= 55) {
    const [r, c] = HOME_COLS[seat][pos - 51];
    return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
  }
  return null;
}

function createAnimations(oldGame, newGame, oldPositions) {
  animations = [];
  const oldMap = new Map(oldPositions.map((p) => [`${p.seat}:${p.i}`, p]));
  const newMap = new Map(computeTokenPositions(newGame).map((p) => [`${p.seat}:${p.i}`, p]));
  const seats = oldGame.activeSeats || [0, 1, 2, 3];
  const now = performance.now();

  for (const seat of seats) {
    for (let i = 0; i < 4; i++) {
      const oldPos = oldGame.tokens[seat][i].pos;
      const newPos = newGame.tokens[seat][i].pos;
      if (oldPos === newPos) continue;

      const key = `${seat}:${i}`;
      const from = oldMap.get(key);
      const to = newMap.get(key);
      if (!from || !to) continue;

      const points = [{ x: from.x, y: from.y }];
      if (oldPos === -1 && newPos === 0) {
        const start = cellCenter(seat, 0);
        if (start) points.push(start);
      } else if (oldPos >= 0 && newPos > oldPos && newPos <= GOAL) {
        for (let pos = oldPos + 1; pos < newPos; pos++) {
          const center = cellCenter(seat, pos);
          if (center) points.push(center);
        }
      } else if (oldPos >= 0 && newPos === -1) {
        // captured: slide straight back to the yard
      } else {
        continue;
      }

      points.push({ x: to.x, y: to.y });
      if (points.length < 2) continue;
      animations.push({
        seat,
        i,
        points,
        start: now,
        duration: Math.max(280, (points.length - 1) * 135),
      });
    }
  }

  if (animations.length) startAnimLoop();
}

function animPoint(animation, now) {
  const progress = Math.min(1, Math.max(0, (now - animation.start) / animation.duration));
  const segments = animation.points.length - 1;
  const scaled = progress * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = animation.points[index];
  const to = animation.points[index + 1];
  return {
    x: from.x + (to.x - from.x) * local,
    y: from.y + (to.y - from.y) * local - Math.sin(local * Math.PI) * CELL * 0.16,
  };
}

function startAnimLoop() {
  if (animFrame) return;
  const step = (now) => {
    animFrame = null;
    let active = false;
    for (const animation of animations) {
      if (now < animation.start + animation.duration) active = true;
    }
    if (room && room.game) drawBoard(room.game);
    if (active) {
      animFrame = requestAnimationFrame(step);
    } else {
      animations = [];
      if (room && room.started && room.game) renderGame();
    }
  };
  animFrame = requestAnimationFrame(step);
}

function drawBoard(game) {
  const player = me();
  const mySeat = player ? player.seat : -1;
  const isMyTurn = game.winnerTeam === null && game.turn === mySeat;
  const movable = new Set(isMyTurn && game.phase === 'move' ? game.validMoves : []);
  const activeSet = new Set(game.activeSeats || [0, 1, 2, 3]);
  const turnSeat = game.winnerTeam === null ? game.turn : -1;

  ctx.clearRect(0, 0, SIZE, SIZE);
  roundRectPath(0, 0, SIZE, SIZE, SIZE * 0.036);
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, '#fbfcff');
  bg.addColorStop(0.55, '#f4f7fd');
  bg.addColorStop(1, '#eef2fa');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  roundRectPath(0, 0, SIZE, SIZE, SIZE * 0.036);
  ctx.clip();

  drawYards(activeSet, turnSeat);
  drawRing(activeSet);
  drawHomeColumns(activeSet, turnSeat);
  drawCenter();

  const positions = computeTokenPositions(game);
  lastTokenPositions = positions;

  if (animations.length) {
    const now = performance.now();
    const drawn = positions.map((pos) => {
      const animation = animations.find((a) => a.seat === pos.seat && a.i === pos.i);
      if (!animation) return pos;
      const point = animPoint(animation, now);
      return { ...pos, x: point.x, y: point.y };
    });
    drawTokens(drawn, game, movable, game.turn);
  } else {
    drawTokens(positions, game, movable, game.turn);
  }

  ctx.restore();
}

/* ---------------- Interaction ---------------- */

els.diceBtn.addEventListener('click', () => {
  if (!room || !room.game || els.diceBtn.disabled) return;
  els.diceBtn.disabled = true;
  els.diceBtn.classList.remove('rolling');
  void els.diceBtn.offsetWidth;
  els.diceBtn.classList.add('rolling');
  setTimeout(() => els.diceBtn.classList.remove('rolling'), 500);
  socket.emit('roll');
});

canvas.addEventListener('click', (event) => {
  if (!room || !room.started || !room.game) return;
  const game = room.game;
  const player = me();
  if (!player) return;
  if (game.winnerTeam !== null) return;
  if (animations.length) return;
  if (game.turn !== player.seat || game.phase !== 'move' || moveLock) return;

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
  if (hit) {
    moveLock = true;
    socket.emit('move', { token: hit.i });
    setTimeout(() => {
      moveLock = false;
    }, 1500);
  }
});

els.code.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.join.click();
});

els.name.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.create.click();
});
render();
renderWallet();
loadWallet();
