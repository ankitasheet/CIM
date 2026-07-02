const API_URL =
  "https://script.google.com/macros/s/AKfycbwwZ0X7ZA8lssuN5zEltUQWQLkltVulFbvcQbpM2dL0tshPrF3216Aq1XjieCdbEiyiow/exec";

// ── Config ────────────────────────────────────────────────────
// Question bank: 100 shared questions, 20 per category (6 easy / 8 medium / 6 hard each).
const CATEGORIES        = ["Aptitude", "C Programming", "Mathematics", "Microcontrollers & ARM", "Python Programming"];
const PER_CATEGORY       = { easy: 3, medium: 4, hard: 3 }; // 10 per category -> 50 total (30% easy / 40% medium / 30% hard, enforced per category)
const TOTAL_QUESTIONS    = CATEGORIES.length * (PER_CATEGORY.easy + PER_CATEGORY.medium + PER_CATEGORY.hard); // 50
const TOTAL_TIME         = 60 * 60; // seconds (1 hour)
const MAX_WARNINGS       = 3;

// ── Shuffle helper (Fisher-Yates) ────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Build a stratified, per-student randomized 50-question set ─
// 30% easy / 40% medium / 30% hard, evenly enforced within EACH category,
// so the overall test is exactly 15 easy / 20 medium / 15 hard (30/40/30 of 50).
function buildExamSet() {
  const byCategory = {};
  CATEGORIES.forEach(cat => { byCategory[cat] = { easy: [], medium: [], hard: [] }; });

  questions.forEach(q => {
    if (byCategory[q.category] && byCategory[q.category][q.difficulty]) {
      byCategory[q.category][q.difficulty].push(q);
    }
  });

  let picked = [];
  CATEGORIES.forEach(cat => {
    Object.entries(PER_CATEGORY).forEach(([diff, count]) => {
      const pool = shuffle(byCategory[cat][diff]);
      picked = picked.concat(pool.slice(0, count));
    });
  });

  // Shuffle final question order, and shuffle each question's own option order
  // (safe because answer-correctness is checked by matching the option TEXT, not its index)
  const finalSet = shuffle(picked).map(q => ({
    ...q,
    options: shuffle(q.options),
  }));

  return finalSet;
}

// ── State ─────────────────────────────────────────────────────
let selectedQuestions = buildExamSet();

// Per-question state: null = not visited, "" = skipped, "<value>" = answered
let answers   = new Array(TOTAL_QUESTIONS).fill(null);
let visited   = new Array(TOTAL_QUESTIONS).fill(false);

let currentQuestion = 0;
let score           = 0;
let warnings        = 0;
let totalTime       = TOTAL_TIME;
let examSubmitted   = false;
let timerInterval   = null;
let examStarted     = false;   // true once student clicked "Start Test"
let awaitingResume  = false;   // true while resumeGate is showing

// ── Init ──────────────────────────────────────────────────────
function init() {
  // Guard: redirect if no login
  const name = localStorage.getItem("name");
  const usn  = localStorage.getItem("usn");
  if (!name || !usn) {
    window.location.href = "index.html";
    return;
  }
  // cgpa / backlogs are optional-but-expected extra fields collected at login;
  // fall back gracefully if a student somehow lands here without them.

  document.getElementById("headerName").textContent = name;
  document.getElementById("headerUsn").textContent  = usn;

  buildProgressRail();
  loadQuestion();

  // If fullscreen was already granted on the login page click, start immediately.
  // Otherwise (e.g. browser blocked it, or page was reloaded directly), show the
  // start gate so the next click can request fullscreen properly.
  if (isFullscreen()) {
    examStarted = true;
    startTimer();
  } else {
    document.getElementById("startGate").classList.add("active");
  }
}

// ── Fullscreen handling ──────────────────────────────────────
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

function requestFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) return req.call(el);
  return Promise.reject(new Error("Fullscreen API not supported"));
}

// Start button — this IS the user gesture, so requestFullscreen is allowed to succeed
document.getElementById("startBtn").addEventListener("click", () => {
  requestFullscreen()
    .then(() => {
      document.getElementById("startGate").classList.remove("active");
      examStarted = true;
      startTimer();
    })
    .catch(() => {
      // Even if fullscreen is blocked by the browser, don't trap the student —
      // start the test anyway so the timer runs, but keep nudging via toast.
      document.getElementById("startGate").classList.remove("active");
      examStarted = true;
      startTimer();
      showToast("▲ Couldn't enter fullscreen automatically — please press F11 or allow fullscreen for this site.", 4000);
    });
});

// Resume button — shown after an exit mid-test
document.getElementById("resumeBtn").addEventListener("click", () => {
  requestFullscreen()
    .then(() => {
      document.getElementById("resumeGate").classList.remove("active");
      awaitingResume = false;
    })
    .catch(() => {
      showToast("▲ Please allow fullscreen to continue your test.", 3000);
    });
});

function handleFullscreenChange() {
  if (!examStarted || examSubmitted) return;
  if (!isFullscreen() && !awaitingResume) {
    awaitingResume = true;
    document.getElementById("resumeGate").classList.add("active");
    registerWarning("Fullscreen exited");
  } else if (isFullscreen() && awaitingResume) {
    document.getElementById("resumeGate").classList.remove("active");
    awaitingResume = false;
  }
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("msfullscreenchange", handleFullscreenChange);

// ── Progress Rail ─────────────────────────────────────────────
function buildProgressRail() {
  const rail = document.getElementById("progressRail");
  rail.innerHTML = "";
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const dot = document.createElement("div");
    dot.className = "rail-dot";
    dot.id = `dot-${i}`;
    rail.appendChild(dot);
  }
}

function updateProgressRail() {
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const dot = document.getElementById(`dot-${i}`);
    dot.className = "rail-dot";
    if (i === currentQuestion) {
      dot.classList.add("current");
    } else if (answers[i] && answers[i] !== "") {
      dot.classList.add("answered");
    } else if (visited[i]) {
      dot.classList.add("visited");
    }
  }
}

// ── Stats Strip ───────────────────────────────────────────────
function updateStats() {
  let answered   = 0;
  let skipped    = 0;
  let notVisited = 0;

  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    if (answers[i] && answers[i] !== "") {
      answered++;
    } else if (visited[i]) {
      skipped++;
    } else {
      notVisited++;
    }
  }

  document.getElementById("statAnswered").textContent   = answered;
  document.getElementById("statSkipped").textContent    = skipped;
  document.getElementById("statNotVisited").textContent = notVisited;
}

// ── Load Question ─────────────────────────────────────────────
const OPTION_LETTERS = ["A", "B", "C", "D", "E"];

function loadQuestion() {
  visited[currentQuestion] = true;

  const q       = selectedQuestions[currentQuestion];
  const isLast  = currentQuestion === TOTAL_QUESTIONS - 1;
  const isFirst = currentQuestion === 0;
  const nextBtn = document.getElementById("nextBtn");
  const backBtn = document.getElementById("backBtn");

  document.getElementById("qMeta").textContent =
    `Question ${currentQuestion + 1} of ${TOTAL_QUESTIONS}`;

  // Question text may contain a fenced code block (```lang ... ```) for
  // Python / C / ARM "predict the output" style questions — render it
  // as a <pre><code> block; render everything else as plain text.
  renderQuestionText(q.question);

  // Options
  const container = document.getElementById("options");
  container.innerHTML = "";
  q.options.forEach((option, idx) => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.innerHTML = `<span class="opt-letter">${OPTION_LETTERS[idx]}</span><span class="opt-text"></span>`;
    btn.querySelector(".opt-text").textContent = option;

    if (answers[currentQuestion] === option) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => chooseAnswer(option));
    container.appendChild(btn);
  });

  nextBtn.textContent = isLast ? "Submit Exam" : "Next Question";
  nextBtn.className   = isLast ? "btn-next submit" : "btn-next";

  backBtn.disabled = isFirst;
  backBtn.classList.toggle("disabled", isFirst);

  updateProgressRail();
  updateStats();
}

function renderQuestionText(text) {
  const el = document.getElementById("question");
  el.innerHTML = "";

  const fenceMatch = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (!fenceMatch) {
    el.textContent = text;
    return;
  }

  const before = text.slice(0, fenceMatch.index).trim();
  const code   = fenceMatch[1];
  const after  = text.slice(fenceMatch.index + fenceMatch[0].length).trim();

  if (before) {
    const p = document.createElement("div");
    p.className = "q-text-prose";
    p.textContent = before;
    el.appendChild(p);
  }

  const pre = document.createElement("pre");
  pre.className = "q-code-block";
  const codeEl = document.createElement("code");
  codeEl.textContent = code.replace(/\n$/, "");
  pre.appendChild(codeEl);
  el.appendChild(pre);

  if (after) {
    const p2 = document.createElement("div");
    p2.className = "q-text-prose";
    p2.textContent = after;
    el.appendChild(p2);
  }
}

// ── Choose Answer ─────────────────────────────────────────────
function chooseAnswer(answer) {
  answers[currentQuestion] = answer;

  document.querySelectorAll(".option-btn").forEach(btn => {
    const text = btn.querySelector(".opt-text").textContent;
    btn.classList.toggle("selected", text === answer);
  });

  updateProgressRail();
  updateStats();
}

// ── Skip ──────────────────────────────────────────────────────
function skipQuestion() {
  if (!answers[currentQuestion]) {
    answers[currentQuestion] = "";
  }
  advance();
}

// ── Next ──────────────────────────────────────────────────────
function nextQuestion() {
  if (currentQuestion >= TOTAL_QUESTIONS - 1) {
    openConfirmSubmit();
    return;
  }
  advance();
}

function advance() {
  currentQuestion++;
  if (currentQuestion >= TOTAL_QUESTIONS) {
    currentQuestion = TOTAL_QUESTIONS - 1;
  }
  loadQuestion();
}

// ── Back ──────────────────────────────────────────────────────
function prevQuestion() {
  if (currentQuestion === 0) return;
  currentQuestion--;
  loadQuestion();
}

// ── Review Panel ──────────────────────────────────────────────
function openReview() {
  const grid = document.getElementById("reviewGrid");
  grid.innerHTML = "";
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const cell = document.createElement("button");
    cell.className = "review-cell";
    cell.textContent = i + 1;
    if (i === currentQuestion) {
      cell.classList.add("current");
    } else if (answers[i] && answers[i] !== "") {
      cell.classList.add("answered");
    } else if (visited[i]) {
      cell.classList.add("visited");
    } else {
      cell.classList.add("notvisit");
    }
    cell.addEventListener("click", () => {
      currentQuestion = i;
      loadQuestion();
      closeReview();
    });
    grid.appendChild(cell);
  }
  document.getElementById("reviewModal").classList.add("active");
}

function closeReview() {
  document.getElementById("reviewModal").classList.remove("active");
}

// ── Confirm Submit Modal ──────────────────────────────────────
function openConfirmSubmit() {
  const input = document.getElementById("confirmInput");
  input.value = "";
  document.getElementById("confirmModal").classList.add("active");
  setTimeout(() => input.focus(), 50);
}

function closeConfirmSubmit() {
  document.getElementById("confirmModal").classList.remove("active");
}

function trySubmitConfirm() {
  const input = document.getElementById("confirmInput");
  if (input.value.trim().toUpperCase() === "CONFIRM") {
    closeConfirmSubmit();
    submitExam();
  } else {
    input.classList.add("input-error");
    showToast("Please type CONFIRM exactly to submit.", 2500);
    setTimeout(() => input.classList.remove("input-error"), 1200);
  }
}

document.getElementById("confirmInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    trySubmitConfirm();
  }
});

// ── Submit (with retry) ──────────────────────────────────────
// At 300-student scale, a POST can occasionally fail or time out
// (network blip, or the backend briefly busy under a lock). The student
// already sees "submitted" either way, so retrying quietly in the
// background just makes it more likely the row actually lands — no
// real-time guarantee needed, late is fine.
function postSubmission(payload, attempt = 1) {
  fetch(API_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(json => {
      if (!json || json.ok !== true) throw new Error(json && json.error || "submission rejected");
    })
    .catch(() => {
      if (attempt < 4) {
        // Backoff: 2s, 5s, 10s — gives the backend lock time to clear.
        const delay = [2000, 5000, 10000][attempt - 1];
        setTimeout(() => postSubmission(payload, attempt + 1), delay);
      }
      // After the final attempt, give up silently — nothing else to do
      // client-side, and the student has already moved on.
    });
}

function submitExam(opts = {}) {
  if (examSubmitted) return;
  examSubmitted = true;

  clearInterval(timerInterval);

  // Score is computed for the backend/admin record only — it is
  // never shown to the student on this device.
  score = 0;
  const breakdown = selectedQuestions.map((q, i) => {
    const chosen    = answers[i] || null;
    const isCorrect = chosen === q.answer;
    if (isCorrect) score++;
    return {
      id: q.id,
      category: q.category,
      subtopic: q.subtopic,
      difficulty: q.difficulty,
      question: q.question,
      options: q.options,
      chosenAnswer: chosen,
      correctAnswer: q.answer,
      isCorrect,
    };
  });

  const name       = localStorage.getItem("name");
  const usn        = localStorage.getItem("usn");
  const cgpa       = localStorage.getItem("cgpa") || "";
  const backlogs   = localStorage.getItem("backlogs") || "";
  const percentage = (score / TOTAL_QUESTIONS) * 100;

  postSubmission({
    name,
    usn,
    cgpa,
    backlogs,
    score,
    totalQuestions: TOTAL_QUESTIONS,
    percentage,
    timeTaken: TOTAL_TIME - totalTime,
    warnings,
    flagged: !!opts.flagged,
    answered: answers.filter(a => a && a !== "").length,
    skipped:  answers.filter(a => a === "").length,
    notVisited: answers.filter(a => a === null).length,
    breakdown,
  });

  localStorage.removeItem("name");
  localStorage.removeItem("usn");
  localStorage.removeItem("cgpa");
  localStorage.removeItem("backlogs");

  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});

  showSubmittedScreen();
}

// ── Submitted screen (no score shown) ──────────────────────────
function showSubmittedScreen() {
  document.getElementById("startGate").classList.remove("active");
  document.getElementById("resumeGate").classList.remove("active");
  document.getElementById("kickedScreen").classList.remove("active");
  document.getElementById("submittedScreen").classList.add("active");

  let secondsLeft = 18;
  const counterEl = document.getElementById("submittedCountdown");
  counterEl.textContent = secondsLeft;
  const iv = setInterval(() => {
    secondsLeft--;
    counterEl.textContent = secondsLeft;
    if (secondsLeft <= 0) {
      clearInterval(iv);
    }
  }, 1000);

  setTimeout(() => {
    window.location.href = "index.html";
  }, 18000);
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() {
  updateTimerDisplay();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    totalTime--;
    updateTimerDisplay();
    if (totalTime <= 0) {
      clearInterval(timerInterval);
      showToast("■ Time is up! Submitting your exam...", 2000);
      setTimeout(submitExam, 1500);
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el  = document.getElementById("timer");
  const blk = document.getElementById("timerBlock");
  el.textContent = formatTime(totalTime);
  blk.classList.toggle("urgent", totalTime <= 30);
}

function formatTime(secs) {
  const m = Math.floor(Math.abs(secs) / 60);
  const s = Math.abs(secs) % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Warning / Kick logic (shared by tab-switch + fullscreen exit) ──
function registerWarning(reason) {
  if (examSubmitted) return;
  warnings++;
  document.getElementById("warnCount").textContent = warnings;

  if (warnings >= MAX_WARNINGS) {
    kickStudent();
  } else {
    const left = MAX_WARNINGS - warnings;
    showToast(`▲ Warning ${warnings}/${MAX_WARNINGS} — ${reason}! ${left} warning(s) left before you are removed from the test.`, 3500);
    const resumeText = document.getElementById("resumeWarnText");
    if (resumeText) {
      resumeText.textContent = `Warning ${warnings}/${MAX_WARNINGS}. ${left} more and your test will be auto-submitted. Click below to return to fullscreen and continue.`;
    }
  }
}

function kickStudent() {
  if (examSubmitted) return;
  examSubmitted = true;
  clearInterval(timerInterval);

  document.getElementById("startGate").classList.remove("active");
  document.getElementById("resumeGate").classList.remove("active");
  document.getElementById("kickedScreen").classList.add("active");

  // Build the same detailed breakdown as a normal submission, but the
  // student is flagged and never sees the score on this device either.
  score = 0;
  const breakdown = selectedQuestions.map((q, i) => {
    const chosen    = answers[i] || null;
    const isCorrect = chosen === q.answer;
    if (isCorrect) score++;
    return {
      id: q.id,
      category: q.category,
      subtopic: q.subtopic,
      difficulty: q.difficulty,
      question: q.question,
      options: q.options,
      chosenAnswer: chosen,
      correctAnswer: q.answer,
      isCorrect,
    };
  });

  const name       = localStorage.getItem("name");
  const usn        = localStorage.getItem("usn");
  const cgpa       = localStorage.getItem("cgpa") || "";
  const backlogs   = localStorage.getItem("backlogs") || "";
  const percentage = (score / TOTAL_QUESTIONS) * 100;

  postSubmission({
    name, usn,
    cgpa,
    backlogs,
    score,
    totalQuestions: TOTAL_QUESTIONS,
    percentage,
    timeTaken: TOTAL_TIME - totalTime,
    warnings,
    flagged: true,
    answered: answers.filter(a => a && a !== "").length,
    skipped:  answers.filter(a => a === "").length,
    notVisited: answers.filter(a => a === null).length,
    breakdown,
  });

  localStorage.removeItem("name");
  localStorage.removeItem("usn");
  localStorage.removeItem("cgpa");
  localStorage.removeItem("backlogs");

  setTimeout(() => { window.location.href = "index.html"; }, 18000);
}

// ── Tab Switch Detection ──────────────────────────────────────
document.addEventListener("visibilitychange", () => {
  if (document.hidden && examStarted && !examSubmitted) {
    registerWarning("Tab switch / window left detected");
  }
});

// ── Toast Helper ──────────────────────────────────────────────
function showToast(msg, duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

// ── Prevent right-click & keyboard shortcuts (light deterrence) ──
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("keydown", e => {
  if (
    e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && ["I","J","C"].includes(e.key)) ||
    (e.ctrlKey && ["u","s","p"].includes(e.key.toLowerCase()))
  ) {
    e.preventDefault();
  }
});

// ── Start everything — placed last so every const/function above is ready ──
init();
