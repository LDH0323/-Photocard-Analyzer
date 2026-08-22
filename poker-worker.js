"use strict";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const DECK = Array.from(RANKS, (rank) => Array.from(SUITS, (suit) => `${rank}${suit}`)).flat();
const combinationCache = new Map();

const rankValue = (card) => RANKS.indexOf(card[0]) + 2;
const baseScore = 15 ** 5;

function scoreFive(cards) {
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((card) => card[1] === cards[0][1]);
  const distinct = [...new Set(values)];
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0];
    else if (distinct.join(",") === "14,5,4,3,2") straightHigh = 5;
  }
  const groups = [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map()).entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  let category = 0;
  let tiebreak = values;
  if (flush && straightHigh) { category = 8; tiebreak = [straightHigh]; }
  else if (groups[0].count === 4) { category = 7; tiebreak = [groups[0].rank, groups[1].rank]; }
  else if (groups[0].count === 3 && groups[1].count === 2) { category = 6; tiebreak = [groups[0].rank, groups[1].rank]; }
  else if (flush) { category = 5; }
  else if (straightHigh) { category = 4; tiebreak = [straightHigh]; }
  else if (groups[0].count === 3) { category = 3; tiebreak = [groups[0].rank, ...groups.slice(1).map((group) => group.rank).sort((a, b) => b - a)]; }
  else if (groups[0].count === 2 && groups[1].count === 2) { category = 2; tiebreak = [Math.max(groups[0].rank, groups[1].rank), Math.min(groups[0].rank, groups[1].rank), groups[2].rank]; }
  else if (groups[0].count === 2) { category = 1; tiebreak = [groups[0].rank, ...groups.slice(1).map((group) => group.rank).sort((a, b) => b - a)]; }
  while (tiebreak.length < 5) tiebreak.push(0);
  return category * baseScore + tiebreak[0] * 15 ** 4 + tiebreak[1] * 15 ** 3 + tiebreak[2] * 15 ** 2 + tiebreak[3] * 15 + tiebreak[4];
}

function combinationsOfFive(cardCount) {
  if (combinationCache.has(cardCount)) return combinationCache.get(cardCount);
  const combinations = [];
  const build = (selection, next) => {
    if (selection.length === 5) { combinations.push(selection); return; }
    for (let index = next; index <= cardCount - (5 - selection.length); index += 1) build([...selection, index], index + 1);
  };
  build([], 0);
  combinationCache.set(cardCount, combinations);
  return combinations;
}

function scoreCards(cards) {
  let best = -1;
  for (const combination of combinationsOfFive(cards.length)) {
    const score = scoreFive(combination.map((index) => cards[index]));
    if (score > best) best = score;
  }
  return best;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

function judge(players, board, wins, equities) {
  const scores = players.map((player) => scoreCards([...player.cards, ...board]));
  const best = Math.max(...scores);
  const winners = scores.reduce((all, score, index) => (score === best ? [...all, index] : all), []);
  if (winners.length === 1) wins[winners[0]] += 1;
  winners.forEach((index) => { equities[index] += 1 / winners.length; });
}

function drawCards(deck, count) {
  const pool = deck.slice();
  const drawn = [];
  for (let index = 0; index < count; index += 1) {
    const randomIndex = index + Math.floor(Math.random() * (pool.length - index));
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
    drawn.push(pool[index]);
  }
  return drawn;
}

function resultPayload(gameState) {
  const players = gameState.players.map((player) => ({ ...player, cards: [...player.cards] }));
  const board = [...gameState.board];
  const dead = (gameState.dead || []).filter(Boolean);
  const used = [...board, ...players.flatMap((player) => player.cards), ...dead].filter(Boolean);
  const remaining = DECK.filter((card) => !used.includes(card));
  const boardUnknownIndexes = board.map((card, index) => card ? -1 : index).filter((index) => index >= 0);
  const allHolesKnown = players.every((player) => player.cards.every(Boolean));
  const exactCases = allHolesKnown ? choose(remaining.length, boardUnknownIndexes.length) : Infinity;
  const wins = new Array(players.length).fill(0);
  const equities = new Array(players.length).fill(0);

  if (exactCases <= 150000) {
    const pickCount = boardUnknownIndexes.length;
    const indexes = Array.from({ length: pickCount }, (_, index) => index);
    let iterations = 0;
    const run = (selection) => {
      const trialBoard = [...board];
      selection.forEach((deckIndex, index) => { trialBoard[boardUnknownIndexes[index]] = remaining[deckIndex]; });
      judge(players, trialBoard, wins, equities);
      iterations += 1;
    };
    if (pickCount === 0) run([]);
    else {
      while (true) {
        run(indexes);
        let position = pickCount - 1;
        while (position >= 0 && indexes[position] === remaining.length - pickCount + position) position -= 1;
        if (position < 0) break;
        indexes[position] += 1;
        for (let index = position + 1; index < pickCount; index += 1) indexes[index] = indexes[index - 1] + 1;
      }
    }
    return { method: "exact", iterations, results: players.map((player, index) => ({ name: player.name, win: wins[index] * 100 / iterations, equity: equities[index] * 100 / iterations })) };
  }

  const unknownSlots = [];
  players.forEach((player, playerIndex) => player.cards.forEach((card, cardIndex) => { if (!card) unknownSlots.push({ type: "player", playerIndex, cardIndex }); }));
  board.forEach((card, boardIndex) => { if (!card) unknownSlots.push({ type: "board", boardIndex }); });
  const scoringCost = players.length * choose(board.length + players[0].cards.length, 5);
  const iterations = scoringCost >= 3000 ? 1500 : scoringCost >= 1500 ? 4000 : scoringCost >= 600 ? 8000 : players.length >= 6 ? 16000 : players.length >= 4 ? 24000 : 32000;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const drawn = drawCards(remaining, unknownSlots.length);
    const trialPlayers = players.map((player) => ({ ...player, cards: [...player.cards] }));
    const trialBoard = [...board];
    unknownSlots.forEach((slot, index) => {
      if (slot.type === "player") trialPlayers[slot.playerIndex].cards[slot.cardIndex] = drawn[index];
      else trialBoard[slot.boardIndex] = drawn[index];
    });
    judge(trialPlayers, trialBoard, wins, equities);
  }
  return { method: "monteCarlo", iterations, results: players.map((player, index) => ({ name: player.name, win: wins[index] * 100 / iterations, equity: equities[index] * 100 / iterations })) };
}

self.onmessage = ({ data }) => {
  const result = resultPayload(data.gameState);
  self.postMessage({ version: data.version, ...result });
};
