const artworks = [
  {
    id: "illustration_1",
    title: "イラスト1",
    image: "./assets/illustration1.png",
    actualCreator: "human",
    labels: { A: "human", B: "ai" },
  },
  {
    id: "illustration_2",
    title: "イラスト2",
    image: "./assets/illustration2.png",
    actualCreator: "ai",
    labels: { A: "ai", B: "human" },
  },
  {
    id: "illustration_3",
    title: "イラスト3",
    image: "./assets/illustration3.png",
    actualCreator: "human",
    labels: { A: "human", B: "ai" },
  },
  {
    id: "illustration_4",
    title: "イラスト4",
    image: "./assets/illustration4.png",
    actualCreator: "ai",
    labels: { A: "ai", B: "human" },
  },
];

const ratingItems = [
  { key: "liking", label: "好感度", text: "このイラストに好感が持てる" },
  { key: "beauty", label: "美しさ", text: "このイラストは美しいと感じる" },
  { key: "technical_quality", label: "技術的完成度", text: "このイラストは完成度が高いと感じる" },
  { key: "warmth", label: "温かみ", text: "このイラストには温かみがあると感じる" },
  { key: "value", label: "価値", text: "このイラストには価値があると感じる" },
];

const creatorText = {
  human: "人間のイラストレーターが制作したイラストです",
  ai: "画像生成AIによって制作されたイラストです",
};

const screens = {
  start: document.querySelector("#start-screen"),
  survey: document.querySelector("#survey-screen"),
  complete: document.querySelector("#complete-screen"),
};

const startForm = document.querySelector("#start-form");
const participantNameInput = document.querySelector("#participant-name");
const participantIdInput = document.querySelector("#participant-id");
const startError = document.querySelector("#start-error");
const progressLabel = document.querySelector("#progress-label");
const artworkTitle = document.querySelector("#artwork-title");
const creatorLabel = document.querySelector("#creator-label");
const artworkImage = document.querySelector("#artwork-image");
const ratingForm = document.querySelector("#rating-form");
const ratingItemsNode = document.querySelector("#rating-items");
const backButton = document.querySelector("#back-button");
const nextButton = document.querySelector("#next-button");
const completeMessage = document.querySelector("#complete-message");
const restartButton = document.querySelector("#restart-button");

let participant = null;
let currentIndex = 0;
let responses = {};

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("is-active"));
  screens[name].classList.add("is-active");
}

function assignGroup(participantId) {
  return Number(participantId) % 2 === 1 ? "A" : "B";
}

async function fetchUsedParticipants() {
  const response = await fetch("./api/participants");
  if (!response.ok) throw new Error("回答状況を取得できませんでした");
  return response.json();
}

async function populateParticipantOptions() {
  startError.textContent = "";
  participantIdInput.innerHTML = '<option value="">番号を選択してください</option>';

  try {
    const { usedIds } = await fetchUsedParticipants();
    const used = new Set(usedIds.map(Number));

    for (let id = 1; id <= 30; id += 1) {
      if (used.has(id)) continue;
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = `${id}`;
      participantIdInput.appendChild(option);
    }

    if (participantIdInput.options.length === 1) {
      participantIdInput.disabled = true;
      startForm.querySelector("button[type='submit']").disabled = true;
      startError.textContent = "回答可能な番号はすべて使用済みです。";
    }
  } catch (error) {
    startError.textContent = error.message;
  }
}

function normalizeName(name) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

async function reserveParticipant(participantData) {
  const response = await fetch("./api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant: participantData }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "開始できませんでした。");
  }
  return payload;
}

function renderRatingItems(artworkId) {
  ratingItemsNode.innerHTML = "";
  const saved = responses[artworkId]?.ratings ?? {};

  ratingItems.forEach((item) => {
    const wrapper = document.createElement("fieldset");
    wrapper.className = "rating-item";

    const legend = document.createElement("legend");
    legend.className = "rating-title";
    legend.textContent = `${item.label}: ${item.text}`;
    wrapper.appendChild(legend);

    const scale = document.createElement("div");
    scale.className = "scale";

    for (let value = 1; value <= 5; value += 1) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = item.key;
      input.value = String(value);
      input.required = true;
      input.checked = saved[item.key] === value;
      label.append(input, document.createTextNode(String(value)));
      scale.appendChild(label);
    }

    const scaleLabels = document.createElement("div");
    scaleLabels.className = "scale-labels";
    scaleLabels.innerHTML = "<span>1 あてはまらない</span><span>5 あてはまる</span>";

    wrapper.append(scale, scaleLabels);
    ratingItemsNode.appendChild(wrapper);
  });
}

function renderCurrentArtwork() {
  const artwork = artworks[currentIndex];
  const displayedCreator = artwork.labels[participant.group];

  progressLabel.textContent = `${currentIndex + 1} / ${artworks.length}`;
  artworkTitle.textContent = artwork.title;
  creatorLabel.textContent = creatorText[displayedCreator];
  artworkImage.classList.remove("is-missing");
  artworkImage.src = artwork.image;
  artworkImage.onerror = () => artworkImage.classList.add("is-missing");
  artworkImage.onload = () => artworkImage.classList.remove("is-missing");

  renderRatingItems(artwork.id);
  backButton.disabled = currentIndex === 0;
  nextButton.textContent = currentIndex === artworks.length - 1 ? "完了" : "次へ";
}

function collectCurrentRatings() {
  const artwork = artworks[currentIndex];
  const formData = new FormData(ratingForm);
  const ratings = {};
  let answeredCount = 0;

  ratingItems.forEach((item) => {
    const value = formData.get(item.key);
    if (value !== null) {
      ratings[item.key] = Number(value);
      answeredCount += 1;
    }
  });

  if (answeredCount !== ratingItems.length) return;

  responses[artwork.id] = {
    artworkId: artwork.id,
    artworkTitle: artwork.title,
    actualCreator: artwork.actualCreator,
    displayedCreator: artwork.labels[participant.group],
    ratings,
    answeredAt: new Date().toISOString(),
  };
}

function makeRows() {
  return artworks.map((artwork, orderIndex) => {
    const response = responses[artwork.id];
    return {
      participantId: participant.id,
      participantName: participant.name,
      group: participant.group,
      order: orderIndex + 1,
      artworkId: artwork.id,
      artworkTitle: artwork.title,
      actualCreator: artwork.actualCreator,
      displayedCreator: response.displayedCreator,
      liking: response.ratings.liking,
      beauty: response.ratings.beauty,
      technicalQuality: response.ratings.technical_quality,
      warmth: response.ratings.warmth,
      value: response.ratings.value,
      answeredAt: response.answeredAt,
    };
  });
}

async function submitResponses() {
  nextButton.disabled = true;
  nextButton.textContent = "保存中";

  const response = await fetch("./api/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant,
      responses: makeRows(),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "回答を保存できませんでした");
  }
}

startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  startError.textContent = "";
  const name = participantNameInput.value.trim();
  const id = Number(participantIdInput.value);
  if (!name || !id) return;

  const participantData = {
    id,
    name,
    group: assignGroup(id),
    startedAt: new Date().toISOString(),
  };

  try {
    const { startToken } = await reserveParticipant(participantData);
    participant = {
      ...participantData,
      startToken,
    };
    currentIndex = 0;
    responses = {};
    renderCurrentArtwork();
    showScreen("survey");
  } catch (error) {
    startError.textContent = error.message;
    await populateParticipantOptions();
  }
});

ratingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ratingForm.reportValidity()) return;

  collectCurrentRatings();

  if (currentIndex < artworks.length - 1) {
    currentIndex += 1;
    renderCurrentArtwork();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  try {
    await submitResponses();
    completeMessage.textContent = `${participant.name}さんの回答を保存しました。`;
    showScreen("complete");
  } catch (error) {
    nextButton.disabled = false;
    nextButton.textContent = "完了";
    completeMessage.textContent = "";
    await populateParticipantOptions();
    startError.textContent = error.message;
    showScreen("start");
  }
});

backButton.addEventListener("click", () => {
  collectCurrentRatings();
  currentIndex = Math.max(0, currentIndex - 1);
  renderCurrentArtwork();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

restartButton.addEventListener("click", () => {
  participant = null;
  currentIndex = 0;
  responses = {};
  startForm.reset();
  populateParticipantOptions();
  showScreen("start");
});

populateParticipantOptions();
