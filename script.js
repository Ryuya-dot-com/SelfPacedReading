/* Jiang-style Self-Paced Reading (Moving Window)
   - Practice session: 10 trials with feedback
   - Main session: randomized trials; comprehension question on 50% of trials (Jiang design)
   - Records RT per token; records question response only when a question is presented
   - List assignment & RNG seed are derived from participant name + ID (can be overridden via URL params)
*/

const DEFAULT_JSON = "./jiang_full_materials_with_fillers_list1_list2.json";

const screens = {
  setup: document.getElementById("setup"),
  instructions: document.getElementById("instructions"),
  practiceIntro: document.getElementById("practiceIntro"),
  practiceFeedback: document.getElementById("practiceFeedback"),
  mainIntro: document.getElementById("mainIntro"),
  breakFix: document.getElementById("breakFix"),
  break: document.getElementById("break"),
  reading: document.getElementById("reading"),
  question: document.getElementById("question"),
  done: document.getElementById("done"),
};

const btnProceed = document.getElementById("btnProceed");
const btnToPractice = document.getElementById("btnToPractice");

const participantNameInput = document.getElementById("participantName");
const participantIdInput = document.getElementById("participantId");
const loadStatus = document.getElementById("loadStatus");
const loadError = document.getElementById("loadError");

const mwLineEls = document.querySelectorAll("#mwLine");
const qText = document.getElementById("questionText");
const breakFixLine = document.getElementById("breakFixLine");

const fbText = document.getElementById("fbText");

const btnDownloadCsv  = document.getElementById("btnDownloadCsv");
const btnRestart      = document.getElementById("btnRestart");

const summaryPill = document.getElementById("summaryPill");
const filePill = document.getElementById("filePill");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const trialCountText = document.getElementById("trialCountText");

// participant / run state
let participantName = "";
let participantId = "";
let assignedList = "List1";
let seedUsed = null;
let seedSource = "auto_name_id";
let listSource = "auto_name_id";
let runStartMs = null;
let runStartedAtIso = null;
let questionStartT = null;
let breakTimer = null;
const BREAK_INTERVAL = 20;
let warnOnUnload = true;

function showScreen(name) {
  Object.values(screens).forEach(el => el.classList.remove("active"));
  screens[name].classList.add("active");
}

function getParam(name, fallback=null) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) ?? fallback;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a += 0x6D2B79F5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let MATERIALS = null;
let RNG = Math.random;

// MAIN trials
let MAIN_TRIALS = [];         // objects
let MAIN_HAS_Q = new Map();   // item_id -> boolean
let mainTrialIndex = -1;

// PRACTICE trials
let PRACTICE_TRIALS = [];
let practiceIndex = -1;
let PRACTICE_HAS_Q = [];

// shared state
let tokenIndex = -1;
let tokenStartT = 0;
let currentTrial = null;
let phase = "idle"; // "practice" | "main"
let awaitingPracticeFeedbackAdvance = false;

// collected data
let data = [];

function hashStringToInt(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

function sanitizeForFilename(str, fallback = "anon") {
  const cleaned = str.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function computeAssignment() {
  participantName = participantNameInput.value.trim();
  participantId = participantIdInput.value.trim();

  if (!participantName || !participantId) {
    assignedList = getParam("list", "List1");
    listSource = "default";
    seedUsed = null;
    seedSource = "needs_participant";
    return;
  }

  const baseHash = hashStringToInt(`${participantId}|${participantName}`);
  const listOverride = getParam("list", null);
  const seedOverride = getParam("seed", null);

  assignedList = listOverride || (baseHash % 2 === 0 ? "List1" : "List2");
  listSource = listOverride ? "query_param" : "auto_name_id";

  const seedOverrideNum = seedOverride !== null ? Number(seedOverride) : null;
  seedUsed = Number.isFinite(seedOverrideNum) ? seedOverrideNum : baseHash;
  seedSource = Number.isFinite(seedOverrideNum) ? "query_param" : "auto_name_id";
}

function updateProceedEnabled() {
  const ready = MATERIALS && participantName && participantId;
  btnProceed.disabled = !ready;
}

function setMwLine(text) {
  mwLineEls.forEach(el => { el.textContent = text; });
}

function renderMovingWindow(tokens, idx) {
  return tokens[idx];
}

function normalizeAnswerKey(key) {
  if (key === "f" || key === "F") return "Yes";
  if (key === "j" || key === "J") return "No";
  return null;
}

function buildFilename(ext) {
  const pid = sanitizeForFilename(participantId || "id");
  const pname = sanitizeForFilename(participantName || "anon");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}_${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}${String(d.getSeconds()).padStart(2,"0")}`;
  return `SelfPacedReading_${pname}_${pid}_${stamp}.${ext}`;
}

function downloadText(text, filename, mime="application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delay revoke so Safari doesn't cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCSV(rows) {
  const headers = [
    "ts_iso","t_rel_ms","participant_id","participant_name","assigned_list","list","seed_used",
    "phase","event","trial_index","item_id","set_id","item_type","structure","condition",
    "has_question","token_index","token","rt_ms","question","correct_answer","response","correct"
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(","));
  return lines.join("\n");
}

function seedRNGFromAssignment() {
  if (seedUsed === null || !Number.isFinite(seedUsed)) {
    throw new Error("参加者名とIDからSeedを決めてください。");
  }
  RNG = mulberry32(seedUsed);
}

function buildMainTrials() {
  const listName = assignedList || getParam("list", "List1");
  const list = MATERIALS?.lists?.[listName];
  if (!list) throw new Error(`Listが見つかりません: ${listName}`);

  const byId = {};
  for (const it of MATERIALS.items) byId[it.item_id] = it;

  const testsPart = [];
  const testsSub = [];
  const fillers = [];
  for (const id of list) {
    const item = byId[id];
    if (!item) continue;
    if (item.type === "test_partitive_plural") testsPart.push(item);
    else if (item.type === "test_subcategorization") testsSub.push(item);
    else fillers.push(item);
  }

  const blockSizes = [];
  let remaining = list.length;
  while (remaining > 0) {
    const size = Math.min(BREAK_INTERVAL, remaining);
    blockSizes.push(size);
    remaining -= size;
  }

  shuffleInPlace(testsPart, RNG);
  shuffleInPlace(testsSub, RNG);
  shuffleInPlace(fillers, RNG);

  function allocateCounts(remCounts, blockSize) {
    const totalRem = remCounts.part + remCounts.sub + remCounts.fill;
    const base = { part: 0, sub: 0, fill: 0 };
    if (totalRem === 0) return base;
    const desired = {
      part: (remCounts.part / totalRem) * blockSize,
      sub: (remCounts.sub / totalRem) * blockSize,
      fill: (remCounts.fill / totalRem) * blockSize,
    };
    const order = ["part", "sub", "fill"];
    const remainders = {};
    let assigned = 0;
    for (const k of order) {
      base[k] = Math.floor(desired[k]);
      if (base[k] > remCounts[k]) base[k] = remCounts[k];
      assigned += base[k];
      remainders[k] = desired[k] - base[k];
    }
    let left = blockSize - assigned;
    const sorted = order.slice().sort((a,b)=>remainders[b]-remainders[a]);
    for (const k of sorted) {
      if (left <= 0) break;
      const give = Math.min(left, remCounts[k] - base[k]);
      base[k] += give;
      left -= give;
    }
    // if still left, distribute where possible
    if (left > 0) {
      for (const k of order) {
        if (left <= 0) break;
        const give = Math.min(left, remCounts[k] - base[k]);
        base[k] += give;
        left -= give;
      }
    }
    return base;
  }

  function buildBlock(counts) {
    let consecTest = 0;
    const block = [];
    const pools = { part: testsPart, sub: testsSub, fill: fillers };
    for (let i = 0; i < counts.part + counts.sub + counts.fill; i++) {
      const options = [];
      if (counts.fill > 0) options.push("fill");
      if (counts.part > 0 && consecTest < 3) options.push("part");
      if (counts.sub > 0 && consecTest < 3) options.push("sub");
      if (options.length === 0) return null;
      shuffleInPlace(options, RNG);
      const chosen = options[0];
      const item = pools[chosen].pop();
      if (!item) return null;
      block.push(item);
      counts[chosen] -= 1;
      if (chosen === "fill") consecTest = 0;
      else consecTest += 1;
    }
    return block;
  }

  MAIN_TRIALS = [];
  for (const size of blockSizes) {
    const remCounts = {
      part: testsPart.length,
      sub: testsSub.length,
      fill: fillers.length,
    };
    let counts = allocateCounts(remCounts, size);
    let block = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      // try to build; if fail, reshuffle pools within remaining and retry
      block = buildBlock({...counts});
      if (block) break;
      shuffleInPlace(testsPart, RNG);
      shuffleInPlace(testsSub, RNG);
      shuffleInPlace(fillers, RNG);
    }
    if (!block) throw new Error("ランダマイズに失敗しました（制約により配置不可）");
    MAIN_TRIALS.push(...block);
  }

  // 質問付与: 前半/後半ごとに50%±1かつ test/filler で均等（C案）
  MAIN_HAS_Q = new Map();
  function assignQuestionsForHalf(trialsHalf) {
    const testIdx = [];
    const fillerIdx = [];
    trialsHalf.forEach((t, i) => {
      if (t.type === "test_partitive_plural" || t.type === "test_subcategorization") testIdx.push(i);
      else fillerIdx.push(i);
    });
    const pick = (arr) => {
      const target = Math.round(arr.length / 2);
      const idxs = shuffleInPlace([...arr], RNG).slice(0, target);
      return new Set(idxs);
    };
    const qTest = pick(testIdx);
    const qFill = pick(fillerIdx);
    const result = new Set();
    qTest.forEach(i => result.add(i));
    qFill.forEach(i => result.add(i));
    return result;
  }

  const mid = Math.floor(MAIN_TRIALS.length / 2);
  const half1 = MAIN_TRIALS.slice(0, mid);
  const half2 = MAIN_TRIALS.slice(mid);
  const qHalf1 = assignQuestionsForHalf(half1);
  const qHalf2 = assignQuestionsForHalf(half2);
  half1.forEach((t, i) => MAIN_HAS_Q.set(t.item_id, qHalf1.has(i)));
  half2.forEach((t, i) => MAIN_HAS_Q.set(t.item_id, qHalf2.has(i)));

  if (trialCountText) {
    const total = MAIN_TRIALS.length;
    const nBreaks = blockSizes.length - 1;
    trialCountText.textContent = `全体 ${total} 試行（${BREAK_INTERVAL} 試行ごとに休憩 × ${nBreaks}）`;
  }
}

function buildPracticeTrials() {
  // 10 practice items: sample from MAIN_TRIALS (but do not remove from main; Jiang doesn't say removed)
  const pool = MAIN_TRIALS.filter(t => t.type !== "filler"); // practice from test items tends to be better
  const idxs = pool.map((_, i) => i);
  shuffleInPlace(idxs, RNG);
  PRACTICE_TRIALS = idxs.slice(0, 10).map(i => pool[i]);

  // Question presence in practice: 6 with Q, 4 without (shuffled)
  const pattern = Array(6).fill(true).concat(Array(4).fill(false));
  shuffleInPlace(pattern, RNG);
  PRACTICE_HAS_Q = pattern;

  practiceIndex = -1;
}

function resetRunState() {
  data = [];
  mainTrialIndex = -1;
  tokenIndex = -1;
  currentTrial = null;
  phase = "idle";
  awaitingPracticeFeedbackAdvance = false;
  runStartMs = null;
  runStartedAtIso = null;
  questionStartT = null;
}

function updateProgressBar(show, completed, total) {
  if (!progressWrap || !progressFill) return;
  if (!show || !total || total <= 0) {
    progressWrap.style.display = "none";
    progressFill.style.width = "0%";
    return;
  }
  const pct = Math.min(100, Math.round((completed / total) * 100));
  progressFill.style.width = `${pct}%`;
  progressWrap.style.display = "block";
}

function abortExperiment() {
  if (!confirm("実験を中断しますか？")) return;
  finishExperiment();
}

function beginSentence(trial) {
  currentTrial = trial;
  tokenIndex = 0;
  tokenStartT = performance.now();
  setMwLine(renderMovingWindow(trial.tokens, tokenIndex));
  showScreen("reading");
}

function logTokenRT(trial, trialIndex, hasQuestion) {
  if (runStartMs === null) {
    runStartMs = performance.now();
    runStartedAtIso = new Date().toISOString();
  }
  const now = performance.now();
  const tokens = trial.tokens;
  const token = tokens[tokenIndex];

  data.push({
    ts_iso: new Date().toISOString(),
    t_rel_ms: Math.round(now - runStartMs),
    participant_id: participantId,
    participant_name: participantName,
    assigned_list: assignedList,
    seed_used: seedUsed,
    list: assignedList,
    phase,
    event: "token",
    trial_index: trialIndex,
    item_id: trial.item_id,
    set_id: trial.set_id,
    item_type: trial.type,
    structure: trial.structure,
    condition: trial.condition,
    has_question: hasQuestion,
    token_index: tokenIndex,
    token,
    rt_ms: Math.round(now - tokenStartT),
    question: trial.question,
    correct_answer: trial.correct_answer,
    response: null,
    correct: null,
  });
}

function advanceToken(trial, trialIndex, hasQuestion) {
  logTokenRT(trial, trialIndex, hasQuestion);

  tokenIndex += 1;
  const tokens = trial.tokens;

  if (tokenIndex >= tokens.length) {
    // sentence end
    if (hasQuestion) {
      showScreen("question");
      qText.textContent = trial.question;
      questionStartT = performance.now();
    } else {
      // no question -> next trial immediately (Jiang design)
      updateProgressBar(false);
      if (phase === "practice") nextPracticeTrial();
      else nextMainTrial();
    }
    return;
  }

  tokenStartT = performance.now();
  setMwLine(renderMovingWindow(tokens, tokenIndex));
}

function logQuestionResponse(trial, trialIndex, hasQuestion, answer) {
  if (runStartMs === null) {
    runStartMs = performance.now();
    runStartedAtIso = new Date().toISOString();
  }
  const now = performance.now();
  const correct = (answer === trial.correct_answer);
  data.push({
    ts_iso: new Date().toISOString(),
    t_rel_ms: Math.round(now - runStartMs),
    participant_id: participantId,
    participant_name: participantName,
    assigned_list: assignedList,
    seed_used: seedUsed,
    list: assignedList,
    phase,
    event: "question",
    trial_index: trialIndex,
    item_id: trial.item_id,
    set_id: trial.set_id,
    item_type: trial.type,
    structure: trial.structure,
    condition: trial.condition,
    has_question: hasQuestion,
    token_index: null,
    token: null,
    rt_ms: questionStartT ? Math.round(now - questionStartT) : null,
    question: trial.question,
    correct_answer: trial.correct_answer,
    response: answer,
    correct,
  });
  questionStartT = null;
  return correct;
}

// ---------- PRACTICE flow ----------
function startPractice() {
  phase = "practice";
  practiceIndex = -1;
  if (runStartMs === null) {
    runStartMs = performance.now();
    runStartedAtIso = new Date().toISOString();
  }
  setMwLine("+");
  showScreen("practiceIntro");
}

function nextPracticeTrial() {
  practiceIndex += 1;
  tokenIndex = -1;

  if (practiceIndex >= PRACTICE_TRIALS.length) {
    // move to main
    phase = "main";
    mainTrialIndex = -1;
    setMwLine("+");
    showScreen("mainIntro");
    return;
  }

  setMwLine("+");
  showScreen("practiceIntro");
}

function showPracticeFeedback(isCorrect, correctAnswer) {
  awaitingPracticeFeedbackAdvance = true;
  const msg = isCorrect
    ? `正解です（Correct）`
    : `不正解です（Incorrect） 正しい答え：${correctAnswer}`;
  fbText.innerHTML = isCorrect
    ? `<span class="ok">${msg}</span>`
    : `<span class="error">${msg}</span>`;
  showScreen("practiceFeedback");
}

// ---------- MAIN flow ----------
function startMain() {
  phase = "main";
  mainTrialIndex = -1;
  nextMainTrial();
}

function nextMainTrial() {
  mainTrialIndex += 1;
  tokenIndex = -1;

  if (mainTrialIndex >= MAIN_TRIALS.length) {
    finishExperiment();
    return;
  }

  if (mainTrialIndex > 0 && mainTrialIndex % BREAK_INTERVAL === 0) {
    startBreak();
    return;
  }

  setMwLine("+");
  showScreen("mainIntro");
  updateProgressBar(false);
}

function finishExperiment() {
  showScreen("done");

  const qRows = data.filter(d => d.phase === "main" && d.response !== null);
  const nQ = qRows.length;
  const nCorrect = qRows.filter(d => d.correct).length;
  const acc = nQ ? Math.round((nCorrect / nQ) * 1000) / 10 : 0;
  summaryPill.textContent = `Main questions: ${nCorrect}/${nQ} (${acc}%)`;

  const csvName = buildFilename("csv");
  filePill.textContent = csvName;
  downloadText(toCSV(data), csvName, "text/csv");
  warnOnUnload = false;
  updateProgressBar(false);
}

function startBreak() {
  if (breakTimer) clearTimeout(breakTimer);
  breakFixLine.textContent = "+";
  showScreen("breakFix");
  breakTimer = setTimeout(() => {
    showScreen("break");
    const completed = mainTrialIndex; // trials finished so far
    updateProgressBar(true, completed, MAIN_TRIALS.length);
  }, 3000);
}

// ---------- Keyboard handling ----------
document.addEventListener("keydown", (ev) => {
  if (ev.repeat) {
    ev.preventDefault();
    return;
  }
  const key = ev.key;

  if (key === "Escape") {
    abortExperiment();
    return;
  }

  // SETUP / INSTRUCTIONS: keys handled by buttons
  if (screens.setup.classList.contains("active") || screens.instructions.classList.contains("active")) return;

  // PRACTICE feedback screen
  if (screens.practiceFeedback.classList.contains("active")) {
    if (key === " " || key === "Spacebar") {
      ev.preventDefault();
      awaitingPracticeFeedbackAdvance = false;
      nextPracticeTrial();
    }
    return;
  }

  // PRACTICE intro fixation
  if (screens.practiceIntro.classList.contains("active")) {
    if (key === " " || key === "Spacebar") {
      ev.preventDefault();
      if (practiceIndex === -1) nextPracticeTrial(); // go to first practice fixation (same screen)
      const t = PRACTICE_TRIALS[practiceIndex];
      beginSentence(t);
    }
    return;
  }

  // BREAK fixation (3s) — ignore keys
  if (screens.breakFix.classList.contains("active")) {
    return;
  }

  // BREAK screen
  if (screens.break.classList.contains("active")) {
    if (key === " " || key === "Spacebar") {
      ev.preventDefault();
      setMwLine("+");
      showScreen("mainIntro");
    }
    return;
  }

  // MAIN intro fixation
  if (screens.mainIntro.classList.contains("active")) {
    if (key === " " || key === "Spacebar") {
      ev.preventDefault();
      if (mainTrialIndex === -1) nextMainTrial(); // initialize
      const t = MAIN_TRIALS[mainTrialIndex];
      beginSentence(t);
    }
    return;
  }

  // READING
  if (screens.reading.classList.contains("active")) {
    if (key === " " || key === "Spacebar") {
      ev.preventDefault();
      if (phase === "practice") {
        const t = PRACTICE_TRIALS[practiceIndex];
        const hasQ = PRACTICE_HAS_Q[practiceIndex] === true;
        advanceToken(t, practiceIndex, hasQ);
      } else {
        const t = MAIN_TRIALS[mainTrialIndex];
        const hasQ = MAIN_HAS_Q.get(t.item_id) === true;
        advanceToken(t, mainTrialIndex, hasQ);
      }
    }
    return;
  }

  // QUESTION (practice always, main sometimes)
  if (screens.question.classList.contains("active")) {
    const ans = normalizeAnswerKey(key);
    if (ans) {
      ev.preventDefault();
      if (phase === "practice") {
        const t = PRACTICE_TRIALS[practiceIndex];
        const correct = logQuestionResponse(t, practiceIndex, true, ans);
        showPracticeFeedback(correct, t.correct_answer);
      } else {
        const t = MAIN_TRIALS[mainTrialIndex];
        const hasQ = MAIN_HAS_Q.get(t.item_id) === true;
        logQuestionResponse(t, mainTrialIndex, hasQ, ans);
        nextMainTrial();
      }
    }
    return;
  }
});

// ---------- Buttons ----------
async function loadMaterials() {
  loadError.textContent = "";
  loadStatus.textContent = "読み込み中…";
  try {
    const res = await fetch(DEFAULT_JSON, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    MATERIALS = await res.json();
    computeAssignment();
    if (participantName && participantId) {
      seedRNGFromAssignment();
      buildMainTrials();
      buildPracticeTrials();
      resetRunState();
      loadStatus.textContent = `読み込み完了: items=${MATERIALS.items?.length ?? 0}, trials(list)=${MAIN_TRIALS.length}, practice=${PRACTICE_TRIALS.length}`;
    } else {
      loadStatus.textContent = `読み込み完了: items=${MATERIALS.items?.length ?? 0}（名前とIDを入力してください）`;
    }
  } catch (e) {
    loadStatus.textContent = "";
    loadError.textContent = `JSONの読み込みに失敗しました: ${e.message}（同じフォルダにJSONを置いてください）`;
  }
  updateProceedEnabled();
}

btnProceed.addEventListener("click", () => {
  showScreen("instructions");
});

btnToPractice.addEventListener("click", () => {
  startPractice();
});

btnDownloadCsv.addEventListener("click", () => {
  downloadText(toCSV(data), buildFilename("csv"), "text/csv");
});

btnRestart.addEventListener("click", () => {
  location.reload();
});

// form inputs
participantNameInput.addEventListener("input", () => {
  computeAssignment();
  updateProceedEnabled();
  if (MATERIALS && participantName && participantId) {
    seedRNGFromAssignment();
    buildMainTrials();
    buildPracticeTrials();
    resetRunState();
    loadStatus.textContent = `OK: items=${MATERIALS.items?.length ?? 0}, trials(list)=${MAIN_TRIALS.length}, practice=${PRACTICE_TRIALS.length}`;
  }
});
participantIdInput.addEventListener("input", () => {
  computeAssignment();
  updateProceedEnabled();
  if (MATERIALS && participantName && participantId) {
    seedRNGFromAssignment();
    buildMainTrials();
    buildPracticeTrials();
    resetRunState();
    loadStatus.textContent = `OK: items=${MATERIALS.items?.length ?? 0}, trials(list)=${MAIN_TRIALS.length}, practice=${PRACTICE_TRIALS.length}`;
  }
});

// initialize assignment on load
computeAssignment();

// warn on reload/close during session
window.addEventListener("beforeunload", (e) => {
  if (!warnOnUnload) return;
  e.preventDefault();
  e.returnValue = "";
});

// preload materials automatically
loadMaterials();
