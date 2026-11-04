'use strict';

const assert = require('node:assert/strict');
const game = require('../game');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function fresh() {
  return game.newGame(['Red', 'Green', 'Yellow', 'Blue']);
}

test('new game starts with all tokens in the yard', () => {
  const g = fresh();
  assert.equal(g.turn, 0);
  assert.equal(g.phase, 'roll');
  for (const seat of g.tokens) {
    for (const token of seat) assert.equal(token.pos, -1);
  }
});

test('rolling a 6 can release any of the four tokens', () => {
  const g = fresh();
  const result = game.rollDice(g, 0, 6);
  assert.deepEqual(result.moves, [0, 1, 2, 3]);
  assert.equal(g.phase, 'move');
});

test('rolling a non-6 with all tokens in the yard passes the turn', () => {
  const g = fresh();
  const result = game.rollDice(g, 0, 3);
  assert.equal(result.passed, true);
  assert.equal(g.turn, 1);
  assert.equal(g.phase, 'roll');
});

test('a 6 grants an extra roll', () => {
  const g = fresh();
  game.rollDice(g, 0, 6);
  game.moveToken(g, 0, 0);
  assert.equal(g.turn, 0);
  assert.equal(g.phase, 'roll');
  assert.equal(g.tokens[0][0].pos, 0);
});

test('three consecutive sixes forfeit the turn', () => {
  const g = fresh();
  game.rollDice(g, 0, 6);
  game.moveToken(g, 0, 0);
  game.rollDice(g, 0, 6);
  game.moveToken(g, 0, 0);
  game.rollDice(g, 0, 6);
  game.moveToken(g, 0, 0);
  assert.equal(g.turn, 1);
  assert.equal(g.sixStreak, 0);
});

test('captures an opponent on the main ring', () => {
  const g = fresh();
  g.tokens[0][0].pos = 4;
  g.tokens[1][0].pos = 45; // ring index (13 + 45) % 52 === 6
  game.rollDice(g, 0, 2);
  game.moveToken(g, 0, 0);
  assert.equal(g.tokens[0][0].pos, 6);
  assert.equal(g.tokens[1][0].pos, -1);
});

test('does not capture a partner', () => {
  const g = fresh();
  g.tokens[0][0].pos = 4;
  g.tokens[2][0].pos = 32; // ring index (26 + 32) % 52 === 6
  game.rollDice(g, 0, 2);
  game.moveToken(g, 0, 0);
  assert.equal(g.tokens[2][0].pos, 32);
});

test('safe cells prevent capture', () => {
  const g = fresh();
  g.tokens[0][0].pos = 4;
  g.tokens[1][0].pos = 47; // ring index (13 + 47) % 52 === 8 (safe)
  game.rollDice(g, 0, 4);
  game.moveToken(g, 0, 0);
  assert.equal(g.tokens[0][0].pos, 8);
  assert.equal(g.tokens[1][0].pos, 47);
});

test('an exact roll is required to reach home', () => {
  const g = fresh();
  for (let i = 0; i < 3; i++) g.tokens[0][i].pos = 56;
  g.tokens[0][3].pos = 55;
  game.rollDice(g, 0, 2);
  assert.equal(g.phase, 'roll');
  assert.equal(g.turn, 1);
  assert.equal(g.tokens[0][3].pos, 55);
});

test('finishing all tokens wins the team', () => {
  const g = fresh();
  for (let i = 0; i < 3; i++) g.tokens[0][i].pos = 56;
  g.tokens[0][3].pos = 55;
  game.rollDice(g, 0, 1);
  game.moveToken(g, 0, 3);
  assert.equal(g.tokens[0][3].pos, 56);
  assert.equal(g.winnerTeam, 0);
  assert.equal(g.phase, 'over');
});

test('random games always terminate with a winner and valid positions', () => {
  for (let run = 0; run < 40; run++) {
    const g = fresh();
    let steps = 0;
    while (g.winnerTeam === null && steps < 200000) {
      steps += 1;
      if (g.phase === 'roll') {
        game.rollDice(g, g.turn);
      } else if (g.phase === 'move') {
        const choice = g.validMoves[Math.floor(Math.random() * g.validMoves.length)];
        game.moveToken(g, g.turn, choice);
      }
      for (const seat of g.tokens) {
        for (const token of seat) {
          assert.ok(token.pos === -1 || (token.pos >= 0 && token.pos <= 56));
        }
      }
    }
    assert.notEqual(g.winnerTeam, null, `game ${run} did not finish`);
    assert.equal(g.phase, 'over');
  }
});

console.log(`\n${passed} tests passed`);
