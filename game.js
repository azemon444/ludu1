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

function ringIndex(seat, rel) {
  return (START_OFFSET[seat] + rel + 52) % 52;
}

function newGame(names) {
  return {
    names: names.slice(0, 4),
    tokens: [0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => ({ pos: YARD }))),
    turn: 0,
    dice: null,
    phase: 'roll',
    validMoves: [],
    sixStreak: 0,
    winnerTeam: null,
    log: [],
  };
}

function pushLog(game, text) {
  game.log.push(text);
  if (game.log.length > 40) game.log.shift();
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

  const die = forcedDie || 1 + Math.floor(Math.random() * 6);
  game.dice = die;
  pushLog(game, `${game.names[seat]} rolled a ${die}`);

  const moves = getValidMoves(game, seat, die);
  if (moves.length === 0) {
    pushLog(game, `No moves for ${game.names[seat]}`);
    game.validMoves = [];
    game.phase = 'roll';
    game.dice = null;
    game.sixStreak = 0;
    game.turn = (seat + 1) % 4;
    return { ok: true, passed: true };
  }

  game.validMoves = moves;
  game.phase = 'move';
  return { ok: true, moves };
}

function captureOnRing(game, seat, absIndex) {
  const captured = [];
  if (SAFE_RING.has(absIndex)) return captured;
  const team = TEAM_BY_SEAT[seat];
  for (let s = 0; s < 4; s++) {
    if (s === seat || TEAM_BY_SEAT[s] === team) continue;
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
      pushLog(game, `Three sixes in a row - ${game.names[seat]} loses the turn`);
      game.sixStreak = 0;
      game.phase = 'roll';
      game.dice = null;
      game.validMoves = [];
      game.turn = (seat + 1) % 4;
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
    game.turn = (seat + 1) % 4;
  }
}

function moveToken(game, seat, tokenIndex) {
  if (game.winnerTeam !== null) return { error: 'Game is over' };
  if (game.phase !== 'move' || game.turn !== seat) return { error: 'Not your turn to move' };
  if (!game.validMoves.includes(tokenIndex)) return { error: 'Invalid move' };

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
        pushLog(game, `${game.names[seat]} captured ${names}!`);
      }
    } else if (target === GOAL) {
      pushLog(game, `${game.names[seat]} sent a token home`);
    }
  }

  const allHome = game.tokens[seat].every((t) => t.pos === GOAL);
  if (allHome) {
    game.winnerTeam = TEAM_BY_SEAT[seat];
    game.phase = 'over';
    game.dice = null;
    game.validMoves = [];
    const teammates = game.names.filter((_, s) => TEAM_BY_SEAT[s] === game.winnerTeam);
    pushLog(game, `${game.names[seat]} finished! ${teammates.join(' & ')} win!`);
    return { ok: true, won: true };
  }

  finishTurn(game, seat, die, die === 6);
  return { ok: true };
}

function skipTurn(game, reason) {
  if (game.winnerTeam !== null) return;
  const name = game.names[game.turn];
  pushLog(game, reason === 'offline' ? `${name} is offline - turn skipped` : `${name} skipped`);
  game.phase = 'roll';
  game.dice = null;
  game.validMoves = [];
  game.sixStreak = 0;
  game.turn = (game.turn + 1) % 4;
}

module.exports = {
  START_OFFSET,
  TEAM_BY_SEAT,
  SAFE_RING,
  YARD,
  GOAL,
  ringIndex,
  newGame,
  getValidMoves,
  rollDice,
  moveToken,
  skipTurn,
};
