/**
 * CIM Screening Test — Google Apps Script backend
 * ------------------------------------------------
 * Paste this entire file into your Apps Script project (replacing the
 * existing Code.gs), then redeploy as a Web App:
 *   Deploy → Manage deployments → Edit (pencil) → New version → Deploy
 *
 * It must stay deployed at the SAME URL your exam.js / admin.js already
 * point to (API_URL), OR if you create a brand-new deployment, copy the
 * new /exec URL into API_URL in both exam.js and admin.js.
 *
 * Required deployment settings:
 *   - Execute as: Me
 *   - Who has access: Anyone (so unauthenticated students can POST results
 *     and the admin page can GET them — the GET endpoint is protected by
 *     the ADMIN_KEY secret below, not by Google account login).
 *
 * Data is stored in a Google Sheet in the SAME spreadsheet this script is
 * bound to (Apps Script → the sheet will be created automatically on first
 * submission if it doesn't exist, named "Submissions").
 *
 * CONCURRENCY NOTE (important at 300-student scale):
 * doPost() takes a script lock (LockService) before touching the sheet, and
 * releases it right after the row is written. This makes each submission
 * atomic — Apps Script serializes concurrent doPost() calls onto the lock,
 * so appendRow() can never interleave and corrupt/overwrite a row even if
 * many students submit in the same second. Waiting students queue briefly
 * (a few seconds at worst) instead of colliding. Combined with the client's
 * own retry-with-backoff (in exam.js), a submission will land even if a
 * particular attempt times out waiting for the lock.
 */

// 🔑 CHANGE THIS to your own secret before deploying.
// The admin dashboard must send this exact value to read results.
const ADMIN_KEY = "Qcar2026";

const SHEET_NAME = "Submissions";
// NOTE: CGPA and Backlogs are appended at the END, not inserted after USN.
// This is deliberate — if you already have a "Submissions" sheet with rows
// in it from before this update, inserting columns in the middle would
// shift every existing row out of alignment with its header. Appending at
// the end means old rows stay exactly as they were (CGPA/Backlogs just
// show blank for them), and every new submission fills all 15 columns.
const HEADERS = [
  "Timestamp", "Name", "USN", "Score", "TotalQuestions", "Percentage",
  "TimeTakenSec", "Warnings", "Flagged", "Answered", "Skipped", "NotVisited",
  "BreakdownJSON", "CGPA", "Backlogs"
];

// Max time (ms) a request will wait for the sheet lock before giving up.
// Client already retries on failure (2s/5s/10s backoff), so it's safe to
// fail fast here rather than let requests pile up and time out the caller.
const LOCK_WAIT_MS = 25000;

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Migration: if this sheet was created before CGPA/Backlogs existed, its
  // header row will be missing them. Add the missing header cells at the
  // end (never reorder/insert in the middle — see note above) so old rows
  // stay aligned and new submissions have somewhere correct to land.
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];
  const missing = HEADERS.filter(h => existingHeaders.indexOf(h) === -1);
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Serialize all writes: with 300 students potentially submitting
    // within the same minute, this guarantees appendRow() calls never
    // interleave, so no row is ever partially overwritten or skipped.
    const gotLock = lock.tryLock(LOCK_WAIT_MS);
    if (!gotLock) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "Server busy, please retry" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();

    sheet.appendRow([
      new Date(),
      data.name || "",
      data.usn || "",
      typeof data.score === "number" ? data.score : "",
      data.totalQuestions || "",
      typeof data.percentage === "number" ? data.percentage : "",
      data.timeTaken || "",
      data.warnings || 0,
      !!data.flagged,
      data.answered || 0,
      data.skipped || 0,
      data.notVisited || 0,
      JSON.stringify(data.breakdown || []),
      data.cgpa || "",
      data.backlogs || "",
    ]);

    // Flush so the row is durably written before we release the lock and
    // let the next queued submission proceed.
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  // Optional JSONP support: if a `callback` param is present, the response
  // is wrapped as `callbackName({...})` and served as JavaScript instead of
  // JSON. This lets admin.html load it via a <script> tag, which (unlike
  // fetch) is NOT subject to CORS — Apps Script web apps don't return
  // Access-Control-Allow-Origin headers, so cross-origin fetch() of the
  // /exec URL is blocked by the browser even though the request itself
  // succeeds. See: https://developers.google.com/apps-script/guides/content
  const callback = e.parameter.callback || "";

  const respond = (result) => {
    const json = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${json})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  };

  const key = e.parameter.key || "";
  if (key !== ADMIN_KEY) {
    return respond({ ok: false, error: "Unauthorized" });
  }

  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) {
    return respond({ ok: true, submissions: [] });
  }

  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });

  const submissions = rows.slice(1).map(row => {
    let breakdown = [];
    try {
      breakdown = JSON.parse(row[idx["BreakdownJSON"]] || "[]");
    } catch (err) {
      breakdown = [];
    }
    return {
      timestamp: row[idx["Timestamp"]] instanceof Date
        ? row[idx["Timestamp"]].toISOString()
        : String(row[idx["Timestamp"]]),
      name: row[idx["Name"]],
      usn: row[idx["USN"]],
      cgpa: row[idx["CGPA"]],
      backlogs: row[idx["Backlogs"]],
      score: row[idx["Score"]],
      totalQuestions: row[idx["TotalQuestions"]],
      percentage: row[idx["Percentage"]],
      timeTaken: row[idx["TimeTakenSec"]],
      warnings: row[idx["Warnings"]],
      flagged: row[idx["Flagged"]],
      answered: row[idx["Answered"]],
      skipped: row[idx["Skipped"]],
      notVisited: row[idx["NotVisited"]],
      breakdown: breakdown,
    };
  });

  return respond({ ok: true, submissions: submissions });
}
