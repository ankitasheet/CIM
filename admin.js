// 🔧 Must match the deployed Apps Script Web App URL (same one used in exam.js)
const API_URL =
  "https://script.google.com/macros/s/AKfycbwwZ0X7ZA8lssuN5zEltUQWQLkltVulFbvcQbpM2dL0tshPrF3216Aq1XjieCdbEiyiow/exec";

let submissions = [];

document.getElementById("unlockBtn").addEventListener("click", unlock);
document.getElementById("adminKeyInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlock();
});
document.getElementById("refreshBtn").addEventListener("click", () => {
  const key = sessionStorage.getItem("adminKey");
  if (key) loadData(key);
});

function unlock() {
  const key = document.getElementById("adminKeyInput").value.trim();
  if (!key) return;
  loadData(key, true);
}

function loadData(key, isUnlockAttempt = false) {
  const errEl = document.getElementById("keyError");
  errEl.textContent = "";

  fetch(`${API_URL}?key=${encodeURIComponent(key)}`)
    .then(res => res.json())
    .then(data => {
      if (!data.ok) {
        if (isUnlockAttempt) {
          errEl.textContent = "Incorrect admin key. Please check your Apps Script ADMIN_KEY and try again.";
        }
        return;
      }
      sessionStorage.setItem("adminKey", key);
      submissions = data.submissions || [];
      document.getElementById("keyGate").style.display = "none";
      document.getElementById("adminWrap").classList.add("active");
      document.body.classList.remove("login-page");
      document.body.classList.add("admin-page");
      render();
    })
    .catch(() => {
      errEl.textContent = "Could not reach the backend. Check the API_URL in admin.js and your network connection.";
    });
}

// Auto-unlock if a key is already stored in this browser tab's session
(function tryAutoUnlock() {
  const stored = sessionStorage.getItem("adminKey");
  if (stored) loadData(stored, false);
})();

// ── Rendering ───────────────────────────────────────────────
function render() {
  renderStats();
  renderCategoryBars();
  renderTable();
}

function renderStats() {
  const el = document.getElementById("adminStats");
  el.innerHTML = "";

  const total = submissions.length;
  const flaggedCount = submissions.filter(s => s.flagged).length;
  const avgPct = total
    ? (submissions.reduce((sum, s) => sum + (Number(s.percentage) || 0), 0) / total)
    : 0;
  const avgTime = total
    ? (submissions.reduce((sum, s) => sum + (Number(s.timeTaken) || 0), 0) / total)
    : 0;

  const cards = [
    { label: "Total Submissions", value: total },
    { label: "Average Score", value: `${avgPct.toFixed(1)}%` },
    { label: "Flagged Attempts", value: flaggedCount },
    { label: "Average Time Taken", value: formatTime(avgTime) },
  ];

  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="stat-card-val">${c.value}</div><div class="stat-card-lbl">${c.label}</div>`;
    el.appendChild(card);
  });
}

function renderCategoryBars() {
  const el = document.getElementById("catBars");
  el.innerHTML = "";

  const categories = ["Aptitude", "C Programming", "Mathematics", "Microcontrollers & ARM", "Python Programming"];
  const totals = {}; // cat -> {correct, total}
  categories.forEach(c => { totals[c] = { correct: 0, total: 0 }; });

  submissions.forEach(s => {
    (s.breakdown || []).forEach(q => {
      if (!totals[q.category]) totals[q.category] = { correct: 0, total: 0 };
      totals[q.category].total++;
      if (q.isCorrect) totals[q.category].correct++;
    });
  });

  categories.forEach(cat => {
    const t = totals[cat];
    const pct = t.total ? (t.correct / t.total) * 100 : 0;
    const row = document.createElement("div");
    row.className = "cat-bar-row";
    row.innerHTML = `
      <div class="cat-bar-label">${cat}</div>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="cat-bar-pct">${pct.toFixed(1)}%</div>
    `;
    el.appendChild(row);
  });
}

function renderTable() {
  const body = document.getElementById("resultsBody");
  body.innerHTML = "";
  const emptyState = document.getElementById("emptyState");

  if (!submissions.length) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  // Most recent first
  const sorted = submissions.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  sorted.forEach((s, i) => {
    const tr = document.createElement("tr");
    tr.className = "result-row";
    tr.innerHTML = `
      <td>${escapeHtml(s.name || "—")}</td>
      <td>${escapeHtml(s.usn || "—")}</td>
      <td>${escapeHtml(s.cgpa || "—")}</td>
      <td>${escapeHtml(s.backlogs || "—")}</td>
      <td>${s.score ?? "—"} / ${s.totalQuestions ?? "—"}</td>
      <td>${Number(s.percentage || 0).toFixed(1)}%</td>
      <td>${formatTime(s.timeTaken)}</td>
      <td>${s.warnings ?? 0}</td>
      <td>${s.flagged ? '<span class="badge badge-danger">Flagged</span>' : '<span class="badge badge-ok">OK</span>'}</td>
      <td>${formatTimestamp(s.timestamp)}</td>
    `;
    tr.addEventListener("click", () => openDetail(s));
    body.appendChild(tr);
  });
}

// ── Detail Modal ────────────────────────────────────────────
function openDetail(s) {
  document.getElementById("detailTitle").textContent = `${s.name || "—"} (${s.usn || "—"})`;

  const summary = document.getElementById("detailSummary");
  summary.innerHTML = `
    <div class="detail-summary-grid">
      <div><strong>Score:</strong> ${s.score ?? "—"} / ${s.totalQuestions ?? "—"} (${Number(s.percentage || 0).toFixed(1)}%)</div>
      <div><strong>CGPA:</strong> ${escapeHtml(s.cgpa || "—")}</div>
      <div><strong>Backlogs:</strong> ${escapeHtml(s.backlogs || "—")}</div>
      <div><strong>Time Taken:</strong> ${formatTime(s.timeTaken)}</div>
      <div><strong>Warnings:</strong> ${s.warnings ?? 0}</div>
      <div><strong>Status:</strong> ${s.flagged ? "Flagged" : "Completed normally"}</div>
      <div><strong>Answered:</strong> ${s.answered ?? "—"}</div>
      <div><strong>Skipped:</strong> ${s.skipped ?? "—"}</div>
      <div><strong>Not Visited:</strong> ${s.notVisited ?? "—"}</div>
      <div><strong>Submitted:</strong> ${formatTimestamp(s.timestamp)}</div>
    </div>
  `;

  const qContainer = document.getElementById("detailQuestions");
  qContainer.innerHTML = "";

  (s.breakdown || []).forEach((q, idx) => {
    const card = document.createElement("div");
    card.className = "detail-q-card " + (q.isCorrect ? "q-correct" : "q-wrong");

    const optionsHtml = (q.options || []).map(opt => {
      let cls = "detail-opt";
      if (opt === q.correctAnswer) cls += " opt-correct";
      if (opt === q.chosenAnswer && opt !== q.correctAnswer) cls += " opt-chosen-wrong";
      if (opt === q.chosenAnswer && opt === q.correctAnswer) cls += " opt-chosen-correct";
      return `<div class="${cls}">${escapeHtml(opt)}</div>`;
    }).join("");

    card.innerHTML = `
      <div class="detail-q-meta">
        <span class="badge badge-cat">${escapeHtml(q.category)}</span>
        <span class="badge badge-diff diff-${q.difficulty}">${q.difficulty}</span>
        <span class="badge ${q.isCorrect ? 'badge-ok' : 'badge-danger'}">${q.isCorrect ? 'Correct' : (q.chosenAnswer ? 'Incorrect' : 'Not Answered')}</span>
      </div>
      <div class="detail-q-text">${idx + 1}. ${renderQuestionForAdmin(q.question)}</div>
      <div class="detail-q-options">${optionsHtml}</div>
    `;
    qContainer.appendChild(card);
  });

  document.getElementById("detailModal").classList.add("active");
}

function closeDetail() {
  document.getElementById("detailModal").classList.remove("active");
}

function renderQuestionForAdmin(text) {
  const fenceMatch = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (!fenceMatch) return escapeHtml(text);

  const before = text.slice(0, fenceMatch.index).trim();
  const code   = fenceMatch[1].replace(/\n$/, "");
  const after  = text.slice(fenceMatch.index + fenceMatch[0].length).trim();

  let html = "";
  if (before) html += `<div>${escapeHtml(before)}</div>`;
  html += `<pre class="q-code-block"><code>${escapeHtml(code)}</code></pre>`;
  if (after) html += `<div>${escapeHtml(after)}</div>`;
  return html;
}

// ── Helpers ─────────────────────────────────────────────────
function formatTime(secs) {
  secs = Number(secs) || 0;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
