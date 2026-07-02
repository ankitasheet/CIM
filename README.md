# CIM Screening Test — Full Platform

This package extends your existing screening-test app into a complete
platform: a shared 100-question bank, per-student randomized 50-question
exams, CGPA/backlog capture at login, a hidden-score submission flow, and
an admin results dashboard.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html`, `login.js` | Student login (name, USN, CGPA, backlogs) + rules modal |
| `exam.html`, `exam.js` | The exam itself — pulls from the 100-question bank with stratified per-student randomization, never shows the score on submission |
| `questions.js` | The shared 100-question bank (5 categories × 20 questions) |
| `style.css` | All styling, including the login form's new CGPA/Backlogs fields and the admin dashboard |
| `admin.html`, `admin.js` | Key-gated admin dashboard for viewing results |
| `Code.gs` | Google Apps Script backend — paste this into your existing Apps Script project |

## The question bank

100 questions total: **20 each** in Aptitude, C Programming, Mathematics,
Microcontrollers & ARM, and Python Programming. Within every category the
split is **6 easy / 8 medium / 6 hard** (a 30/40/30 ratio).

## How the per-student randomization works

On loading `exam.html`, `buildExamSet()` in `exam.js`:

1. Buckets all 100 questions by `category` × `difficulty`.
2. For each of the 5 categories, randomly picks **3 easy + 4 medium + 3
   hard** questions (10 per category, 50 total) — so every student's test
   is exactly **15 easy / 20 medium / 15 hard overall (30/40/30)**, and
   that same ratio holds within each individual category too.
3. Shuffles the final question order, and independently shuffles each
   question's own option order (safe because answers are matched by
   option **text**, not position).

This is regenerated fresh per page load, so two students sitting the test
side by side get different questions in a different order with options in
a different order.

## Login fields: CGPA and Backlogs

The login page now also collects:

- **CGPA** — a number field (0–10, two decimal places).
- **Active Backlogs** — a Yes/No dropdown.

Both are required to proceed, stored in `localStorage` alongside name/USN,
sent with the final submission payload, and cleared after submit (same as
name/USN already were). They show up as their own columns (`CGPA`,
`Backlogs`) in the admin table, detail view, and the Google Sheet.

## The hidden-score submission flow

On submit (manual, timeout, or auto-kick after 3 warnings), `exam.js`:

1. Computes the score **only for the backend record** — the variable never
   touches the UI.
2. Builds a full per-question breakdown (`id`, `category`, `subtopic`,
   `difficulty`, the question text, the options as shown, what the student
   chose, the correct answer, and whether it was correct) for all 50
   questions.
3. POSTs everything — including `cgpa` and `backlogs` — to your Apps
   Script `doPost` endpoint, retrying with backoff (2s/5s/10s) if the
   first attempt fails or times out.
4. Shows a "Your test has been submitted" overlay with a countdown, then
   redirects to `index.html`. No score, percentage, or correct/incorrect
   indication ever appears on the student's screen.

## Setting up the backend (Code.gs)

1. Open your existing Apps Script project (the one behind the URL already
   in `exam.js`'s `API_URL`).
2. Replace its `Code.gs` contents with the `Code.gs` in this folder.
3. The `ADMIN_KEY` constant is already set to match what your `admin.js`
   expects. Change it if you want a different secret — just remember to
   also update it wherever your admin dashboard/team enters the key.
4. Deploy → Manage deployments → click the pencil/edit icon on your
   existing deployment → Version: **New version** → Deploy.
   - Keep **Execute as: Me** and **Who has access: Anyone** (the GET
     endpoint is protected by the `ADMIN_KEY`, not by Google login, since
     students and the admin dashboard both need to reach it
     unauthenticated).
5. The script automatically creates a "Submissions" sheet in whichever
   spreadsheet the Apps Script project is bound to, with one row per
   submission (including a JSON column with the full 50-question
   breakdown, plus CGPA and Backlogs columns).

If you already have a "Submissions" sheet from before this update, the
script auto-migrates it on the next request: it appends `CGPA` and
`Backlogs` as two new columns at the **end** of the header row (never
inserted in the middle), so your existing rows stay exactly aligned with
their original columns — only the new columns are blank for old rows.

If you create a **brand-new** deployment instead of updating the existing
one, you'll get a new `/exec` URL — copy it into the `API_URL` constant at
the top of **both** `exam.js` and `admin.js`.

## Concurrency: safe writes at 300-student scale

Google Sheets/Apps Script can corrupt or drop a row if two `appendRow()`
calls execute at the exact same moment — which is a real risk when
hundreds of students hit "Submit" within the same few seconds of each
other (e.g., everyone's timer hitting zero together).

`Code.gs` now guards every write with `LockService.getScriptLock()`:

- Each incoming submission waits up to 25 seconds to acquire an
  exclusive lock before touching the sheet.
- Only one submission at a time is ever inside the `appendRow()` +
  `flush()` section — so rows can never interleave, overwrite each other,
  or get corrupted, no matter how many students submit simultaneously.
- Everyone else just queues briefly (typically well under a second per
  student, a few seconds at worst under heavy simultaneous load) and gets
  written right after.
- If a request can't get the lock within 25 seconds (extremely unlikely,
  but possible under heavy simultaneous load), it returns an error to the
  client instead of hanging — and the client (`exam.js`) already retries
  automatically after 2s, 5s, and 10s, so the row still lands.

You said you're fine waiting a few seconds for results to land — that's
exactly the trade-off this makes: slightly queued writes, in exchange for
zero corrupted or lost rows.

**One caveat worth knowing:** this fixes data integrity (no corruption),
but Google Apps Script itself imposes a platform-wide cap on how many
script executions can run *simultaneously* per account (roughly 30 at a
time on a standard/free Google account; higher on Google Workspace). With
300 students submitting close together, requests beyond that cap simply
queue for a lock slot rather than failing — combined with the client-side
retry logic, submissions will still land, just not all in the same
instant. If your account is a personal Gmail (not Workspace) and you want
zero risk of any request timing out under a true instantaneous 300-way
spike, consider deploying under a Google Workspace account, which raises
these platform limits.

## Using the admin dashboard

Open `admin.html` in a browser, paste in the `ADMIN_KEY` you set in
`Code.gs`, and click "Unlock Dashboard." You'll see:

- Summary cards (total submissions, average score, flagged attempts,
  average time taken).
- An average-score-by-category bar chart across all submissions.
- A sortable table of every submission (now including CGPA and Backlogs)
  — click any row to open a detail view showing all 50 questions for that
  student, with each option highlighted (correct answer in green, the
  student's wrong pick in red).

The admin key is kept only in `sessionStorage` for that browser tab, so
it's not persisted to disk and isn't visible to students.

## Hosting

Since all data persistence is handled by the Apps Script + Google Sheet
backend, the front end is just static files — host `index.html`,
`exam.html`, `admin.html`, and their JS/CSS on any static host (GitHub
Pages, Netlify, a plain web server, etc.). No build step is required.
