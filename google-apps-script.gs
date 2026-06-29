const ADMIN_TOKEN = "";
const SHEET_RESPONSES = "Responses";
const SHEET_STARTS = "Starts";

const RESPONSE_HEADERS = [
  "submittedAt",
  "participantId",
  "participantName",
  "group",
  "order",
  "artworkId",
  "artworkTitle",
  "actualCreator",
  "displayedCreator",
  "liking",
  "beauty",
  "technicalQuality",
  "warmth",
  "value",
  "answeredAt",
  "startToken",
];

const START_HEADERS = [
  "startedAt",
  "participantId",
  "participantName",
  "normalizedName",
  "group",
  "startToken",
];

function doGet(e) {
  const callback = e.parameter.callback || "callback";
  const action = e.parameter.action || "";
  const payload = parsePayload_(e.parameter.payload);
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
    const result = handleAction_(action, payload);
    return jsonp_(callback, result);
  } catch (error) {
    return jsonp_(callback, { ok: false, error: error.message || String(error) });
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired.
    }
  }
}

function handleAction_(action, payload) {
  setupSheets_();

  if (action === "status") return getStatus_();
  if (action === "start") return startSurvey_(payload);
  if (action === "submit") return submitSurvey_(payload);
  if (action === "results") return getResults_(payload);

  return { ok: false, error: "不明な処理です。" };
}

function parsePayload_(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function jsonp_(callback, data) {
  const safeCallback = String(callback).replace(/[^\w.$]/g, "");
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function setupSheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(spreadsheet, SHEET_RESPONSES, RESPONSE_HEADERS);
  ensureSheet_(spreadsheet, SHEET_STARTS, START_HEADERS);
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => current[index] !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getRows_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row.some(value => value !== "")).map(row => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index];
    });
    return item;
  });
}

function normalizeName_(name) {
  return String(name || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function expectedGroup_(participantId) {
  return Number(participantId) % 2 === 1 ? "A" : "B";
}

function validateParticipant_(participant) {
  const participantId = Number(participant && participant.id);
  const participantName = String((participant && participant.name) || "").trim();
  const group = String((participant && participant.group) || "");

  if (!participantId || participantId < 1 || participantId > 30) {
    throw new Error("番号は1〜30から選択してください。");
  }
  if (!participantName) {
    throw new Error("名前を入力してください。");
  }
  if (group !== expectedGroup_(participantId)) {
    throw new Error("番号と条件の組み合わせが正しくありません。");
  }

  return {
    id: participantId,
    name: participantName,
    normalizedName: normalizeName_(participantName),
    group,
  };
}

function getStatus_() {
  const responseRows = getRows_(SHEET_RESPONSES);
  const startRows = getRows_(SHEET_STARTS);
  const usedIds = [...new Set(responseRows.map(row => Number(row.participantId)).filter(Boolean))].sort((a, b) => a - b);
  const usedNames = [...new Set([
    ...responseRows.map(row => String(row.participantName || "").trim()).filter(Boolean),
    ...startRows.map(row => String(row.participantName || "").trim()).filter(Boolean),
  ])];

  return { ok: true, usedIds, usedNames };
}

function startSurvey_(payload) {
  const participant = validateParticipant_(payload.participant);
  const status = getStatus_();

  if (status.usedIds.includes(participant.id)) {
    throw new Error("この番号はすでに回答済みです。別の番号を選択してください。");
  }
  if (status.usedNames.some(name => normalizeName_(name) === participant.normalizedName)) {
    throw new Error("この名前はすでに回答済みです。");
  }

  const startToken = Utilities.getUuid();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STARTS);
  sheet.appendRow([
    new Date().toISOString(),
    participant.id,
    participant.name,
    participant.normalizedName,
    participant.group,
    startToken,
  ]);

  return { ok: true, startToken };
}

function submitSurvey_(payload) {
  const participant = validateParticipant_(payload.participant);
  const startToken = String((payload.participant && payload.participant.startToken) || "");
  const rows = Array.isArray(payload.responses) ? payload.responses : [];
  const startRows = getRows_(SHEET_STARTS);
  const startExists = startRows.some(row =>
    Number(row.participantId) === participant.id &&
    String(row.normalizedName) === participant.normalizedName &&
    String(row.startToken) === startToken
  );

  if (!startToken || !startExists) {
    throw new Error("開始手続きが確認できませんでした。最初からやり直してください。");
  }

  const status = getStatus_();
  if (status.usedIds.includes(participant.id)) {
    throw new Error("この番号はすでに回答済みです。別の番号を選択してください。");
  }

  const responseRows = getRows_(SHEET_RESPONSES);
  if (responseRows.some(row => normalizeName_(row.participantName) === participant.normalizedName)) {
    throw new Error("この名前はすでに回答済みです。");
  }

  if (rows.length !== 4) {
    throw new Error("回答数が正しくありません。");
  }

  const submittedAt = new Date().toISOString();
  const values = rows.map(row => [
    submittedAt,
    participant.id,
    participant.name,
    participant.group,
    Number(row.order),
    row.artworkId,
    row.artworkTitle,
    row.actualCreator,
    row.displayedCreator,
    Number(row.liking),
    Number(row.beauty),
    Number(row.technicalQuality),
    Number(row.warmth),
    Number(row.value),
    row.answeredAt,
    startToken,
  ]);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RESPONSES);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, RESPONSE_HEADERS.length).setValues(values);
  return { ok: true };
}

function getResults_(payload) {
  if (ADMIN_TOKEN && payload.adminToken !== ADMIN_TOKEN) {
    throw new Error("管理キーが違います。");
  }

  const rows = getRows_(SHEET_RESPONSES);
  const grouped = {};
  rows.forEach(row => {
    const startToken = String(row.startToken || "");
    if (!grouped[startToken]) {
      grouped[startToken] = {
        participant: {
          id: Number(row.participantId),
          name: row.participantName,
          group: row.group,
          startToken,
        },
        responses: [],
        submittedAt: row.submittedAt,
      };
    }
    grouped[startToken].responses.push({
      participantId: Number(row.participantId),
      participantName: row.participantName,
      group: row.group,
      order: Number(row.order),
      artworkId: row.artworkId,
      artworkTitle: row.artworkTitle,
      actualCreator: row.actualCreator,
      displayedCreator: row.displayedCreator,
      liking: Number(row.liking),
      beauty: Number(row.beauty),
      technicalQuality: Number(row.technicalQuality),
      warmth: Number(row.warmth),
      value: Number(row.value),
      answeredAt: row.answeredAt,
    });
  });

  const results = Object.values(grouped).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const usedIds = [...new Set(results.map(record => record.participant.id))].sort((a, b) => a - b);
  return { ok: true, results, usedIds, usedNames: getStatus_().usedNames };
}
