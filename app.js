"use strict";

const DEBOUNCE_MS = 180;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const state = {
  board: ["", "", "", "", ""],
  players: [
    { id: newId(), name: "ME", cards: ["", ""] },
    { id: newId(), name: "PLAYER 2", cards: ["", ""] },
    { id: newId(), name: "PLAYER 3", cards: ["", ""] },
  ],
};

let analysisTimer = null;
let analysisVersion = 0;
let activeWorker = null;
let displayedResults = null;

const elements = {
  boardInputs: document.querySelector("#boardInputs"),
  playersInputs: document.querySelector("#playersInputs"),
  playerCount: document.querySelector("#playerCount"),
  localCardCount: document.querySelector("#localCardCount"),
  playerCardCount: document.querySelector("#playerCardCount"),
  localCardCaption: document.querySelector("#localCardCaption"),
  liveState: document.querySelector("#liveState"),
  statusText: document.querySelector("#statusText"),
  updatedAt: document.querySelector("#updatedAt"),
  validationMessage: document.querySelector("#validationMessage"),
  methodBadge: document.querySelector("#methodBadge"),
  resultsList: document.querySelector("#resultsList"),
  potSize: document.querySelector("#potSize"),
  opponentBet: document.querySelector("#opponentBet"),
  callAmount: document.querySelector("#callAmount"),
  ownStack: document.querySelector("#ownStack"),
  betEquity: document.querySelector("#betEquity"),
  requiredEquity: document.querySelector("#requiredEquity"),
  callEv: document.querySelector("#callEv"),
  maxCall: document.querySelector("#maxCall"),
  recommendedBet: document.querySelector("#recommendedBet"),
  betDecision: document.querySelector("#betDecision"),
};

function newId() {
  return globalThis.crypto?.randomUUID?.() || `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function normalizeCard(value) {
  const compact = value.trim().replace(/\s/g, "");
  if (!compact || compact === "?") return "";
  if (/^10[CDHS]$/i.test(compact)) return `T${compact[2].toLowerCase()}`;
  if (/^[2-9TJQKA][CDHS]$/i.test(compact)) return `${compact[0].toUpperCase()}${compact[1].toLowerCase()}`;
  return null;
}

function cardInput(value, location, index) {
  return `<input class="card-input" inputmode="text" maxlength="3" spellcheck="false" autocomplete="off" placeholder="?" value="${escapeHtml(value)}" data-location="${location}" data-index="${index}" aria-label="${location === "board" ? `로컬 카드 ${index + 1}` : `플레이어 카드 ${index + 1}`}" />`;
}

function renderSelectors() {
  elements.playerCount.innerHTML = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, offset) => {
    const count = offset + MIN_PLAYERS;
    return `<option value="${count}" ${count === state.players.length ? "selected" : ""}>${count}명</option>`;
  }).join("");
  elements.localCardCount.innerHTML = Array.from({ length: 6 }, (_, count) => `<option value="${count}" ${count === state.board.length ? "selected" : ""}>${count}장</option>`).join("");
  const playerCardCount = state.players[0].cards.length;
  elements.playerCardCount.innerHTML = Array.from({ length: 7 }, (_, offset) => {
    const count = offset + 1;
    return `<option value="${count}" ${count === playerCardCount ? "selected" : ""}>${count}장</option>`;
  }).join("");
}

function renderInputs() {
  elements.boardInputs.innerHTML = state.board.map((card, index) => cardInput(card, "board", index)).join("");
  elements.localCardCaption.textContent = `${state.board.length} CARDS`;
  elements.playersInputs.innerHTML = state.players.map((player, playerIndex) => `
    <div class="player-row ${playerIndex === 0 ? "me" : ""}" data-player-id="${player.id}">
      <input class="player-name" maxlength="18" value="${escapeHtml(player.name)}" data-name-id="${player.id}" aria-label="플레이어 이름" />
      <div class="card-inputs">${player.cards.map((card, cardIndex) => cardInput(card, player.id, cardIndex)).join("")}</div>
      ${playerIndex === 0 ? "" : `<button class="remove-player" type="button" data-remove-id="${player.id}" aria-label="${escapeHtml(player.name)} 삭제">×</button>`}
    </div>
  `).join("");
  applyInputValidity();
}

function getCardsWithLocations() {
  const cards = state.board.map((value, index) => ({ value, label: `공개 카드 ${index + 1}` }));
  state.players.forEach((player) => player.cards.forEach((value, index) => cards.push({ value, label: `${player.name || "플레이어"} 카드 ${index + 1}` })));
  return cards;
}

function validateState() {
  const invalid = [];
  const duplicateLabels = [];
  const seen = new Map();

  getCardsWithLocations().forEach(({ value, label }) => {
    const normalized = normalizeCard(value);
    if (normalized === null) invalid.push(`${label}: 카드 형식`);
    if (normalized) {
      if (seen.has(normalized)) duplicateLabels.push(`${normalized} (${seen.get(normalized)}, ${label})`);
      else seen.set(normalized, label);
    }
  });
  const totalCardsPerHand = state.board.length + state.players[0].cards.length;
  const cardsInPlay = state.board.length + state.players.length * state.players[0].cards.length;
  const configurationError = totalCardsPerHand < 5
    ? "로컬 카드와 플레이어 카드를 합쳐 최소 5장으로 설정하세요."
    : cardsInPlay > 52
      ? "선택한 카드 수와 플레이어 수가 한 덱의 52장을 초과합니다. 플레이어 수 또는 카드 수를 줄이세요."
      : "";
  return { valid: invalid.length === 0 && duplicateLabels.length === 0 && !configurationError, invalid, duplicateLabels, configurationError };
}

function applyInputValidity() {
  const validation = validateState();
  const duplicates = new Set(validation.duplicateLabels.map((item) => item.slice(0, 2)));
  document.querySelectorAll(".card-input").forEach((input) => {
    const normalized = normalizeCard(input.value);
    input.classList.toggle("invalid", normalized === null || Boolean(normalized && duplicates.has(normalized)));
    input.classList.toggle("known", Boolean(normalized));
  });
  elements.validationMessage.textContent = validation.configurationError || (validation.invalid.length ? "카드는 Ah, Kd, 7c처럼 입력하세요." : validation.duplicateLabels.length ? `같은 카드가 중복되었습니다: ${validation.duplicateLabels.join(", ")}` : "");
  return validation;
}

function snapshotState() {
  const normalizeCards = (cards) => cards.map((card) => normalizeCard(card) || "");
  return {
    board: normalizeCards(state.board),
    players: state.players.map((player) => ({ name: player.name.trim() || "PLAYER", cards: normalizeCards(player.cards) })),
  };
}

function setStatus(kind, text) {
  elements.statusText.textContent = text;
  elements.liveState.style.color = kind === "error" ? "var(--danger)" : kind === "analyzing" ? "#ffd478" : "var(--mint)";
}

function setMethod(method) {
  elements.methodBadge.textContent = method;
  elements.methodBadge.classList.toggle("waiting", method === "WAITING");
}

function scheduleAnalysis() {
  const version = ++analysisVersion;
  clearTimeout(analysisTimer);
  const validation = applyInputValidity();
  if (!validation.valid) {
    if (activeWorker) { activeWorker.terminate(); activeWorker = null; }
    setStatus("error", "INPUT CHECK");
    setMethod("WAITING");
    return;
  }
  setStatus("live", "LIVE ANALYSIS");
  setMethod("WAITING");
  analysisTimer = window.setTimeout(() => startAnalysis(version), DEBOUNCE_MS);
}

function startAnalysis(version) {
  if (version !== analysisVersion) return;
  if (activeWorker) activeWorker.terminate();
  setStatus("analyzing", "ANALYZING...");
  activeWorker = new Worker("poker-worker.js");
  activeWorker.onmessage = ({ data }) => {
    if (data.version !== analysisVersion) return;
    activeWorker?.terminate();
    activeWorker = null;
    updateResultUI(data);
  };
  activeWorker.onerror = () => {
    if (version !== analysisVersion) return;
    activeWorker = null;
    setStatus("error", "WORKER ERROR");
    setMethod("WAITING");
  };
  activeWorker.postMessage({ version, gameState: snapshotState() });
}

function updateResultUI(result) {
  displayedResults = result.results;
  setStatus("live", "ANALYSIS UPDATED");
  setMethod(result.method === "exact" ? "EXACT" : "MONTE CARLO");
  elements.updatedAt.textContent = `Updated: ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date())}`;
  elements.resultsList.innerHTML = result.results.map((player, index) => `
    <article class="result-card ${index === 0 ? "me" : ""}">
      <div class="result-card-header"><strong>${escapeHtml(player.name)}</strong><span>WIN ${player.win.toFixed(2)}%</span></div>
      <div class="result-line"><span>EQUITY</span><b>${player.equity.toFixed(2)}%</b></div>
      <div class="equity-bar" aria-label="${escapeHtml(player.name)} Equity ${player.equity.toFixed(2)}%"><span style="width: ${player.equity.toFixed(2)}%"></span></div>
    </article>
  `).join("");
  updateBettingGuide();
}

function inputAmount(input) {
  return Math.max(0, Number(input.value) || 0);
}

function formatAmount(amount) {
  if (!Number.isFinite(amount)) return "무제한";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(Math.max(0, amount));
}

function setBetDecision(text, kind) {
  elements.betDecision.textContent = text;
  elements.betDecision.className = `bet-decision ${kind}`;
}

function updateBettingGuide() {
  const meEquity = displayedResults?.[0]?.equity;
  const pot = inputAmount(elements.potSize);
  const opponentBet = inputAmount(elements.opponentBet);
  const suppliedCall = inputAmount(elements.callAmount);
  const call = suppliedCall || opponentBet;
  const stack = inputAmount(elements.ownStack);
  const potBeforeCall = pot + opponentBet;

  elements.betEquity.textContent = Number.isFinite(meEquity) ? `${meEquity.toFixed(2)}%` : "—";
  if (!Number.isFinite(meEquity) || potBeforeCall <= 0) {
    elements.requiredEquity.textContent = "—";
    elements.callEv.textContent = "—";
    elements.maxCall.textContent = "—";
    elements.recommendedBet.textContent = "—";
    setBetDecision("WAITING", "");
    return;
  }

  const equity = meEquity / 100;
  const requiredEquity = call > 0 ? call / (potBeforeCall + call) : 0;
  const expectedValue = call > 0 ? equity * potBeforeCall - (1 - equity) * call : 0;
  const theoreticalMaxCall = equity >= 1 ? Infinity : equity * potBeforeCall / (1 - equity);
  const cappedMaxCall = stack > 0 ? Math.min(theoreticalMaxCall, stack) : theoreticalMaxCall;
  elements.requiredEquity.textContent = call > 0 ? `${(requiredEquity * 100).toFixed(2)}%` : "0.00%";
  elements.callEv.textContent = call > 0 ? `${expectedValue >= 0 ? "+" : "−"}${formatAmount(Math.abs(expectedValue))}` : "—";
  elements.callEv.style.color = call > 0 ? (expectedValue >= 0 ? "var(--mint)" : "var(--danger)") : "";
  elements.maxCall.textContent = formatAmount(cappedMaxCall);

  const bettingPot = potBeforeCall || pot;
  let betFraction = 0;
  if (equity >= 0.7) betFraction = 0.75;
  else if (equity >= 0.58) betFraction = 0.5;
  else if (equity >= 0.5) betFraction = 0.33;
  const betAmount = stack > 0 ? Math.min(bettingPot * betFraction, stack) : bettingPot * betFraction;
  elements.recommendedBet.textContent = betFraction ? `팟 ${(betFraction * 100).toFixed(0)}% · ${formatAmount(betAmount)}` : "CHECK / 소액 베팅";

  if (call > 0) setBetDecision(expectedValue >= 0 ? "CALL +EV" : "FOLD −EV", expectedValue >= 0 ? "positive" : "negative");
  else setBetDecision(betFraction ? "BET SPOT" : "CAUTION", betFraction ? "positive" : "neutral");
}

function addPlayer() {
  if (state.players.length >= MAX_PLAYERS) return;
  const number = state.players.length + 1;
  state.players.push({ id: newId(), name: `PLAYER ${number}`, cards: Array(state.players[0].cards.length).fill("") });
  renderSelectors();
  renderInputs();
  scheduleAnalysis();
}

function resizeCards(cards, count) {
  return [...cards.slice(0, count), ...Array(Math.max(0, count - cards.length)).fill("")];
}

function handleDocumentInput(event) {
  const card = event.target.closest(".card-input");
  if (card) {
    const index = Number(card.dataset.index);
    if (card.dataset.location === "board") state.board[index] = card.value;
    else {
      const player = state.players.find(({ id }) => id === card.dataset.location);
      if (player) player.cards[index] = card.value;
    }
    scheduleAnalysis();
    return;
  }
  const name = event.target.closest(".player-name");
  if (name) {
    const player = state.players.find(({ id }) => id === name.dataset.nameId);
    if (player) { player.name = name.value; scheduleAnalysis(); }
  }
}

document.addEventListener("input", handleDocumentInput);
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-id]");
  if (!button) return;
  state.players = state.players.filter(({ id }) => id !== button.dataset.removeId);
  renderSelectors();
  renderInputs();
  scheduleAnalysis();
});
elements.playerCount.addEventListener("change", () => {
  const targetCount = Number(elements.playerCount.value);
  while (state.players.length < targetCount) addPlayer();
  if (state.players.length > targetCount) {
    state.players = state.players.slice(0, targetCount);
    renderSelectors();
    renderInputs();
    scheduleAnalysis();
  }
});
elements.localCardCount.addEventListener("change", () => {
  state.board = resizeCards(state.board, Number(elements.localCardCount.value));
  renderSelectors();
  renderInputs();
  scheduleAnalysis();
});
elements.playerCardCount.addEventListener("change", () => {
  const count = Number(elements.playerCardCount.value);
  state.players.forEach((player) => { player.cards = resizeCards(player.cards, count); });
  renderSelectors();
  renderInputs();
  scheduleAnalysis();
});
[elements.potSize, elements.opponentBet, elements.callAmount, elements.ownStack].forEach((input) => input.addEventListener("input", updateBettingGuide));

renderSelectors();
renderInputs();
scheduleAnalysis();
