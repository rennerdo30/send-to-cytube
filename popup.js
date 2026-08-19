const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

const videoUrlInput = document.getElementById("video-url");
const videoMeta = document.getElementById("video-meta");
const targetTabSelect = document.getElementById("target-tab");
const positionSelect = document.getElementById("position");
const tempCheckbox = document.getElementById("temp");
const refreshTabsButton = document.getElementById("refresh-tabs");
const sendButton = document.getElementById("send-button");
const statusNode = document.getElementById("status");

let availableTabs = [];

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});

refreshTabsButton.addEventListener("click", () => {
  populateTabs().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  });
});

videoUrlInput.addEventListener("input", () => {
  renderVideoMeta(videoUrlInput.value);
});

sendButton.addEventListener("click", async () => {
  setBusy(true);
  setStatus("");

  try {
    const parsedVideo = parseYouTubeInput(videoUrlInput.value);
    if (!parsedVideo) {
      throw new Error("Enter a valid YouTube video URL.");
    }

    const selectedTabId = Number(targetTabSelect.value);
    const selectedTab = availableTabs.find((tab) => tab.id === selectedTabId);
    if (!selectedTab?.url) {
      throw new Error("Choose a CyTube tab first.");
    }

    const originPattern = getOriginPattern(selectedTab.url);
    const hasPermission = await chrome.permissions.contains({
      origins: [originPattern]
    });

    if (!hasPermission) {
      const granted = await chrome.permissions.request({
        origins: [originPattern]
      });

      if (!granted) {
        throw new Error("Site access is required for the selected CyTube tab.");
      }
    }

    await chrome.storage.sync.set({
      lastTargetTabId: selectedTabId,
      defaultPosition: positionSelect.value,
      defaultTemp: tempCheckbox.checked
    });

    const response = await chrome.runtime.sendMessage({
      type: "queue-video",
      targetTabId: selectedTabId,
      videoUrl: parsedVideo.canonicalUrl,
      position: positionSelect.value,
      temp: tempCheckbox.checked
    });

    if (!response?.ok) {
      throw new Error(response?.error || "CyTube rejected the request.");
    }

    const channelLabel = response.channelName ? `#${response.channelName}` : "the selected channel";
    setStatus(
      response.pending
        ? `Request sent to ${channelLabel}.`
        : `Queued in ${channelLabel}.`,
      "success"
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
});

async function init() {
  const [{ lastTargetTabId, defaultPosition, defaultTemp }, activeTab] = await Promise.all([
    chrome.storage.sync.get(["lastTargetTabId", "defaultPosition", "defaultTemp"]),
    getActiveTab()
  ]);

  if (defaultPosition === "next" || defaultPosition === "end") {
    positionSelect.value = defaultPosition;
  }

  tempCheckbox.checked = defaultTemp !== false;

  if (activeTab?.url) {
    const parsed = parseYouTubeInput(activeTab.url);
    if (parsed) {
      videoUrlInput.value = parsed.canonicalUrl;
    }
  }

  renderVideoMeta(videoUrlInput.value);
  await populateTabs(lastTargetTabId);
}

async function populateTabs(preferredTabId) {
  const tabs = await chrome.tabs.query({});

  availableTabs = tabs
    .filter((tab) => Number.isInteger(tab.id) && isHttpUrl(tab.url) && isLikelyCyTubeTab(tab))
    .sort(compareTabs);

  targetTabSelect.replaceChildren();

  if (availableTabs.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No open CyTube tabs found";
    targetTabSelect.append(option);
    targetTabSelect.disabled = true;
    return;
  }

  const desiredId = preferredTabId && availableTabs.some((tab) => tab.id === preferredTabId)
    ? preferredTabId
    : findLikelyCyTubeTabId(availableTabs);

  availableTabs.forEach((tab) => {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = formatTabLabel(tab);
    if (tab.id === desiredId) {
      option.selected = true;
    }
    targetTabSelect.append(option);
  });

  targetTabSelect.disabled = false;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab || null;
}

function compareTabs(left, right) {
  const leftScore = getCyTubeLikelihoodScore(left);
  const rightScore = getCyTubeLikelihoodScore(right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return (left.index ?? 0) - (right.index ?? 0);
}

function getCyTubeLikelihoodScore(tab) {
  const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
  let score = 0;

  if (haystack.includes("cytube")) {
    score += 5;
  }

  if (haystack.includes("/r/")) {
    score += 3;
  }

  if (haystack.includes("cytu.be")) {
    score += 4;
  }

  return score;
}

function findLikelyCyTubeTabId(tabs) {
  return tabs[0]?.id ?? null;
}

function formatTabLabel(tab) {
  const title = (tab.title || "Untitled tab").trim();
  const host = safeHost(tab.url);
  return `${title} - ${host}`;
}

function isLikelyCyTubeTab(tab) {
  const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();

  if (haystack.includes("cytube") || haystack.includes("cytu.be")) {
    return true;
  }

  try {
    const parsed = new URL(tab.url);
    return /^\/r\/[a-z0-9_-]+$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function getOriginPattern(url) {
  const parsed = new URL(url);
  return `${parsed.origin}/*`;
}

function isHttpUrl(url) {
  if (typeof url !== "string") {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
}

function renderVideoMeta(url) {
  const parsed = parseYouTubeInput(url);
  if (!url.trim()) {
    videoMeta.textContent = "Open a YouTube video first, or paste a video URL here.";
    return;
  }

  if (!parsed) {
    videoMeta.textContent = "That does not look like a supported YouTube video URL.";
    return;
  }

  videoMeta.textContent = `Video ID: ${parsed.videoId}`;
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  refreshTabsButton.disabled = isBusy;
}

function setStatus(message, state = "") {
  statusNode.textContent = message;
  if (state) {
    statusNode.dataset.state = state;
  } else {
    delete statusNode.dataset.state;
  }
}

function parseYouTubeInput(input) {
  if (typeof input !== "string" || !input.trim()) {
    return null;
  }

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  }

  let videoId = "";
  if (url.hostname === "youtu.be") {
    videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v") || "";
  } else if (url.pathname.startsWith("/shorts/")) {
    videoId = url.pathname.split("/")[2] || "";
  } else if (url.pathname.startsWith("/live/")) {
    videoId = url.pathname.split("/")[2] || "";
  } else if (url.pathname.startsWith("/embed/")) {
    videoId = url.pathname.split("/")[2] || "";
  }

  videoId = videoId.trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
}
