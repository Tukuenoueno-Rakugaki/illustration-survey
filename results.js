const metricKeys = [
  ["liking", "好感度"],
  ["beauty", "美しさ"],
  ["technicalQuality", "技術的完成度"],
  ["warmth", "温かみ"],
  ["value", "価値"],
];

const creatorNames = {
  human: "人間作条件",
  ai: "AI生成条件",
};

const participantCount = document.querySelector("#participant-count");
const groupACount = document.querySelector("#group-a-count");
const groupBCount = document.querySelector("#group-b-count");
const usedIdList = document.querySelector("#used-id-list");
const summaryBody = document.querySelector("#summary-body");
const responseBody = document.querySelector("#response-body");
const refreshButton = document.querySelector("#refresh-button");
const downloadButton = document.querySelector("#download-results");

let currentRows = [];

async function loadResults() {
  const response = await fetch("./api/results");
  if (!response.ok) throw new Error("結果を取得できませんでした");
  return response.json();
}

function flattenResults(results) {
  return results.flatMap((record) =>
    record.responses.map((row) => ({
      ...row,
      submittedAt: record.submittedAt,
    })),
  );
}

function average(rows, key) {
  if (rows.length === 0) return "-";
  const total = rows.reduce((sum, row) => sum + Number(row[key]), 0);
  return (total / rows.length).toFixed(2);
}

function renderUsedIds(usedIds) {
  usedIdList.innerHTML = "";
  for (let id = 1; id <= 30; id += 1) {
    const item = document.createElement("span");
    item.className = usedIds.includes(id) ? "id-chip is-used" : "id-chip";
    item.textContent = String(id);
    usedIdList.appendChild(item);
  }
}

function renderSummary(rows) {
  summaryBody.innerHTML = "";

  ["human", "ai"].forEach((creator) => {
    const creatorRows = rows.filter((row) => row.displayedCreator === creator);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${creatorNames[creator]}</td>
      <td>${creatorRows.length}</td>
      ${metricKeys.map(([key]) => `<td>${average(creatorRows, key)}</td>`).join("")}
    `;
    summaryBody.appendChild(tr);
  });
}

function renderResponses(rows) {
  responseBody.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.participantId}</td>
      <td>${row.participantName ?? ""}</td>
      <td>${row.group}</td>
      <td>${row.order}</td>
      <td>${row.artworkTitle}</td>
      <td>${creatorNames[row.actualCreator]}</td>
      <td>${creatorNames[row.displayedCreator]}</td>
      <td>${row.liking}</td>
      <td>${row.beauty}</td>
      <td>${row.technicalQuality}</td>
      <td>${row.warmth}</td>
      <td>${row.value}</td>
    `;
    responseBody.appendChild(tr);
  });
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\n");
}

async function refresh() {
  const { results, usedIds } = await loadResults();
  const groups = results.map((record) => record.participant.group);
  currentRows = flattenResults(results);

  participantCount.textContent = String(results.length);
  groupACount.textContent = String(groups.filter((group) => group === "A").length);
  groupBCount.textContent = String(groups.filter((group) => group === "B").length);

  renderUsedIds(usedIds);
  renderSummary(currentRows);
  renderResponses(currentRows);
}

refreshButton.addEventListener("click", refresh);
downloadButton.addEventListener("click", () => {
  downloadFile("illustration_survey_results.csv", toCsv(currentRows), "text/csv;charset=utf-8");
});

refresh();
