'use strict';

// Board model
//  - 52-cell main ring
//  - 5-cell home column per player
//  - relative position: -1 = yard, 0..50 = ring, 51..55 = home column, 56 = goal
const START_OFFSET = [0, 13, 26, 39];
const TEAM_BY_SEAT = [0, 1, 0, 1];
const SAFE_RING = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const YARD = -1;
const GOAL = 56;
const SIZES = [2, 3, 4];
const ACTIVE_SEATS = {
  2: [0, 2],
  3: [0, 1, 2],
  4: [0, 1, 2, 3],
};

function normalizeSize(value) {
  const size = Number(value);
  return SIZES.includes(size) ? size : 4;
}

function seatsForSize(size) {
  return (ACTIVE_SEATS[normalizeSize(size)] || ACTIVE_SEATS[4]).slice();
}

function teamsForSize(size, seats = seatsForSize(size)) {
  const normalized = normalizeSize(size);
  const map = [null, null, null, null];
  if (normalized === 4) {
    for (const seat of seats) map[seat] = TEAM_BY_SEAT[seat];
  } else {
    seats.forEach((seat, index) => {
      map[seat] = index;
    });
  }
  return map;
}

function ringIndex(seat, rel) {
  return (START_OFFSET[seat] + rel + 52) % 52;
}

function teamOf(game, seat) {
  return game.teamBySeat[seat];
}

function nextSeat(game, seat) {
  const seats = game.activeSeats;
  const index = seats.indexOf(seat);
  return seats[(index + 1) % seats.length];
}

function newGame(names, options = {}) {
  const size = normalizeSize(options.size || 4);
  const activeSeats = options.activeSeats ? options.activeSeats.slice() : seatsForSize(size);
  const teamBySeat = options.teamBySeat ? options.teamBySeat.slice() : teamsForSize(size, activeSeats);
  const seatNames = ['', '', '', ''];
  const list = Array.isArray(names) ? names : [];

  if (list.length >= 4) {
    for (let seat = 0; seat < 4; seat++) seatNames[seat] = list[seat] || '';
  } else {
    list.forEach((name, index) => {
      const seat = activeSeats[index];
      if (seat !== undefined) seatNames[seat] = name || '';
    });
  }

  return {
    gameId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    size,
    activeSeats,
    teamBySeat,
    names: seatNames,
    tokens: [0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => ({ pos: YARD }))),
    turn: activeSeats[0],
    moveCount: 0,
    dice: null,
    phase: 'roll',
    validMoves: [],
    sixStreak: 0,
    winnerTeam: null,
    winnerSeat: null,
    log: [],
    noticeSeq: 0,
    noticeText: '',
  };
}

function pushLog(game, text) {
  game.log.push(text);
  if (game.log.length > 40) game.log.shift();
}

function setNotice(game, text) {
  game.noticeSeq += 1;
  game.noticeText = text;
  pushLog(game, text);
}

function getValidMoves(game, seat, die) {
  const moves = [];
  const tokens = game.tokens[seat];
  for (let i = 0; i < 4; i++) {
    const pos = tokens[i].pos;
    if (pos === GOAL) continue;
    if (pos === YARD) {
      if (die === 6) moves.push(i);
    } else if (pos + die <= GOAL) {
      moves.push(i);
    }
  }
  return moves;
}

function rollDice(game, seat, forcedDie) {
  if (game.winnerTeam !== null) return { error: 'Game is over' };
  if (game.phase !== 'roll' || game.turn !== seat) return { error: 'Not your turn to roll' };

  game.moveCount += 1;
  const die = forcedDie || 1 + Math.floor(Math.random() * 6);
  game.dice = die;
  pushLog(game, `${game.names[seat]} rolled a ${die}`);

  const moves = getValidMoves(game, seat, die);
  if (moves.length === 0) {
    setNotice(game, `No moves for ${game.names[seat]} — turn passed`);
    game.validMoves = [];
    game.phase = 'roll';
    game.dice = null;
    game.sixStreak = 0;
    game.turn = nextSeat(game, seat);
    return { ok: true, passed: true };
  }

  game.validMoves = moves;
  game.phase = 'move';
  return { ok: true, moves };
}

function captureOnRing(game, seat, absIndex) {
  const captured = [];
  if (SAFE_RING.has(absIndex)) return captured;
  const team = teamOf(game, seat);
  for (const s of game.activeSeats) {
    if (s === seat || teamOf(game, s) === team) continue;
    for (const token of game.tokens[s]) {
      if (token.pos >= 0 && token.pos <= 50 && ringIndex(s, token.pos) === absIndex) {
        token.pos = YARD;
        captured.push(s);
      }
    }
  }
  return captured;
}

function finishTurn(game, seat, die, extra) {
  if (extra) {
    game.sixStreak += 1;
    if (game.sixStreak >= 3) {
      setNotice(game, `Three sixes in a row — ${game.names[seat]} loses the turn`);
      game.sixStreak = 0;
      game.phase = 'roll';
      game.dice = null;
      game.validMoves = [];
      game.turn = nextSeat(game, seat);
    } else {
      game.phase = 'roll';
      game.dice = null;
      game.validMoves = [];
    }
  } else {
    game.sixStreak = 0;
    game.phase = 'roll';
    game.dice = null;
    game.validMoves = [];
    game.turn = nextSeat(game, seat);
  }
}

function moveToken(game, seat, tokenIndex) {
  if (game.winnerTeam !== null) return { error: 'Game is over' };
  if (game.phase !== 'move' || game.turn !== seat) return { error: 'Not your turn to move' };
  if (!game.validMoves.includes(tokenIndex)) return { error: 'Invalid move' };

  game.moveCount += 1;
  const die = game.dice;
  const token = game.tokens[seat][tokenIndex];

  if (token.pos === YARD) {
    token.pos = 0;
    pushLog(game, `${game.names[seat]} brought a token onto the board`);
  } else {
    const target = token.pos + die;
    token.pos = target;

    if (target <= 50) {
      const abs = ringIndex(seat, target);
      const captured = captureOnRing(game, seat, abs);
      if (captured.length > 0) {
        const names = [...new Set(captured)].map((s) => game.names[s]).join(' & ');
        setNotice(game, `${game.names[seat]} captured ${names}!`);
      }
    } else if (target === GOAL) {
      setNotice(game, `${game.names[seat]} sent a token home!`);
    }
  }

  const allHome = game.tokens[seat].every((t) => t.pos === GOAL);
  if (allHome) {
    game.winnerSeat = seat;
    game.winnerTeam = teamOf(game, seat);
    game.phase = 'over';
    game.dice = null;
    game.validMoves = [];
    const mates = game.activeSeats.filter((s) => teamOf(game, s) === game.winnerTeam);
    const notice = mates.length > 1
      ? `${mates.map((s) => game.names[s]).join(' & ')} win!`
      : `${game.names[seat]} wins!`;
    setNotice(game, notice);
    return { ok: true, won: true };
  }

  finishTurn(game, seat, die, die === 6);
  return { ok: true };
}

function skipTurn(game, reason) {
  if (game.winnerTeam !== null) return;
  game.moveCount += 1;
  const name = game.names[game.turn];
  setNotice(game, reason === 'offline' ? `${name} is offline — turn skipped` : `${name} skipped`);
  game.phase = 'roll';
  game.dice = null;
  game.validMoves = [];
  game.sixStreak = 0;
  game.turn = nextSeat(game, game.turn);
}

module.exports = {
  START_OFFSET,
  TEAM_BY_SEAT,
  SAFE_RING,
  YARD,
  GOAL,
  SIZES,
  ACTIVE_SEATS,
  normalizeSize,
  seatsForSize,
  teamsForSize,
  teamOf,
  nextSeat,
  ringIndex,
  newGame,
  getValidMoves,
  rollDice,
  moveToken,
  skipTurn,
};
