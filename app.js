"use strict";

const DEBOUNCE_MS = 180;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const state = {
  board: ["", "", "", "", ""],
  dead: ["", "", "", ""],
  players: [
    { id: newId(), name: "PLAYER 1", cards: ["", ""] },
    { id: newId(), name: "PLAYER 2", cards: ["", ""] },
    { id: newId(), name: "PLAYER 3", cards: ["", ""] },
  ],
};

let analysisTimer = null;
let analysisVersion = 0;
let activeWorker = null;

const elements = {
  boardInputs: document.querySelector("#boardInputs"),
  deadInputs: document.querySelector("#deadInputs"),
  deadCaption: document.querySelector("#deadCardCaption"),
  playersInputs: document.querySelector("#playersInputs"),
  playerCount: document.querySelector("#playerCount"),
  localCardCount: document.querySelector("#localCardCount"),
  deadCardCount: document.querySelector("#deadCardCount"),
  playerCardCount: document.querySelector("#playerCardCount"),
  localCardCaption: document.querySelector("#localCardCaption"),
  liveState: document.querySelector("#liveState"),
  statusText: document.querySelector("#statusText"),
  updatedAt: document.querySelector("#updatedAt"),
  validationMessage: document.querySelector("#validationMessage"),
  methodBadge: document.querySelector("#methodBadge"),
  resultsList: document.querySelector("#resultsList"),
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
  // 수트+랭크 형식: S/H/D/C + 랭크 (예: Sa, H4, D10, CK)
  // 10은 T로 정규화
  if (/^[SHDC]10$/i.test(compact)) return `T${compact[0].toLowerCase()}`;
  if (/^[SHDC][2-9TJQKA]$/i.test(compact)) return `${compact[1].toUpperCase()}${compact[0].toLowerCase()}`;
  return null;
}

function cardInput(value, location, index) {
  const ariaLabel = location === "board"
    ? `로컬 카드 ${index + 1} (예: Sa, H4, D10)`
    : location === "dead"
      ? `버린 카드 ${index + 1} (예: Sa, H4, D10)`
      : `플레이어 카드 ${index + 1} (예: Sa, H4, D10)`;
  return `<input class="card-input" inputmode="text" maxlength="3" spellcheck="false" autocomplete="off" placeholder="?" value="${escapeHtml(value)}" data-location="${location}" data-index="${index}" aria-label="${ariaLabel}" />`;
}

function renderSelectors() {
  elements.playerCount.innerHTML = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, offset) => {
    const count = offset + MIN_PLAYERS;
    return `<option value="${count}" ${count === state.players.length ? "selected" : ""}>${count}명</option>`;
  }).join("");
  elements.localCardCount.innerHTML = Array.from({ length: 6 }, (_, count) => `<option value="${count}" ${count === state.board.length ? "selected" : ""}>${count}장</option>`).join("");
  elements.deadCardCount.innerHTML = Array.from({ length: 13 }, (_, count) => `<option value="${count}" ${count === state.dead.length ? "selected" : ""}>${count}장</option>`).join("");
  const playerCardCount = state.players[0].cards.length;
  elements.playerCardCount.innerHTML = Array.from({ length: 7 }, (_, offset) => {
    const count = offset + 1;
    return `<option value="${count}" ${count === playerCardCount ? "selected" : ""}>${count}장</option>`;
  }).join("");
}

function renderInputs() {
  elements.boardInputs.innerHTML = state.board.map((card, index) => cardInput(card, "board", index)).join("");
  elements.localCardCaption.textContent = `${state.board.length} CARDS`;
  elements.deadInputs.innerHTML = state.dead.map((card, index) => cardInput(card, "dead", index)).join("");
  elements.deadCaption.textContent = `${state.dead.length} CARDS`;
  elements.playersInputs.innerHTML = state.players.map((player, playerIndex) => `
    <div class="player-row ${playerIndex === 0 ? "me" : ""}" data-player-id="${player.id}">
      <input class="player-name" maxlength="18" value="${escapeHtml(player.name)}" data-name-id="${player.id}" aria-label="플레이어 이름" />
      <div class="card-inputs">${player.cards.map((card, cardIndex) => cardInput(card, player.id, cardIndex)).join("")}</div>
      ${playerIndex === 0 || state.players.length <= 1 ? "" : `<button class="remove-player" type="button" data-remove-id="${player.id}" aria-label="${escapeHtml(player.name)} 삭제">×</button>`}
    </div>
  `).join("");
  applyInputValidity();
}

function getCardsWithLocations() {
  const cards = state.board.map((value, index) => ({ value, label: `공개 카드 ${index + 1}` }));
  state.dead.forEach((value, index) => cards.push({ value, label: `버린 카드 ${index + 1}` }));
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
  const cardsInPlay = state.board.length + state.players.length * state.players[0].cards.length + state.dead.length;
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
  elements.validationMessage.textContent = validation.configurationError || (validation.invalid.length ? "카드는 Sa, H4, D10, CK처럼 수트+랭크 순서로 입력하세요." : validation.duplicateLabels.length ? `같은 카드가 중복되었습니다: ${validation.duplicateLabels.join(", ")}` : "");
  return validation;
}

function snapshotState() {
  const normalizeCards = (cards) => cards.map((card) => normalizeCard(card) || "");
  return {
    board: normalizeCards(state.board),
    dead: normalizeCards(state.dead),
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
    else if (card.dataset.location === "dead") state.dead[index] = card.value;
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
elements.deadCardCount.addEventListener("change", () => {
  state.dead = resizeCards(state.dead, Number(elements.deadCardCount.value));
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

renderSelectors();
renderInputs();
scheduleAnalysis();
