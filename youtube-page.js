const ROOT_ID = "send-to-cytube-root";
const PANEL_ID = "send-to-cytube-panel";
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

let observer = null;
let setupScheduled = false;
let openPanel = null;

boot();

function boot() {
  setupUI();

  observer = new MutationObserver(() => {
    scheduleSetup();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", scheduleSetup, true);
  window.addEventListener("popstate", scheduleSetup, true);
  document.addEventListener("click", handleDocumentClick, true);
}

function scheduleSetup() {
  if (setupScheduled) {
    return;
  }

  setupScheduled = true;
  window.requestAnimationFrame(() => {
    setupScheduled = false;
    setupUI();
  });
}

function setupUI() {
  const existing = document.getElementById(ROOT_ID);
  const target = document.body;
  const currentVideo = parseYouTubeInput(location.href);

  if (!target || !currentVideo) {
    if (existing) {
      existing.remove();
    }
    openPanel = null;
    return;
  }

  if (existing && existing.parentElement === target) {
    updatePanelForVideo(existing, currentVideo);
    return;
  }

  if (existing) {
    existing.remove();
  }

  const root = buildUI(currentVideo);
  target.append(root);
}

function buildUI(video) {
  const root = document.createElement("div");
  root.id = ROOT_ID;

  const anchor = document.createElement("div");
  anchor.className = "stc-anchor";
  root.append(anchor);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "stc-trigger";
  trigger.dataset.defaultLabel = "Send to CyTube";
  trigger.innerHTML = '<span aria-hidden="true">+</span><span class="stc-trigger-label">Send to CyTube</span>';
  anchor.append(trigger);

  const optionsButton = document.createElement("button");
  optionsButton.type = "button";
  optionsButton.className = "stc-options";
  optionsButton.setAttribute("aria-label", "CyTube options");
  optionsButton.textContent = "⋯";
  anchor.append(optionsButton);

  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.className = "stc-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="stc-panel-header">
      <p class="stc-eyebrow">YouTube -> CyTube</p>
      <h2 class="stc-title">Queue this video</h2>
      <p class="stc-subtle">Uses the open CyTube tab you already have connected.</p>
    </header>
    <label class="stc-field">
      <span class="stc-field-label">Target tab</span>
      <select class="stc-select" data-role="target-tab"></select>
    </label>
    <div class="stc-row">
      <label class="stc-field">
        <span class="stc-field-label">Position</span>
        <select class="stc-select" data-role="position">
          <option value="end">End of queue</option>
          <option value="next">Next</option>
        </select>
      </label>
      <label class="stc-checkbox">
        <input data-role="temp" type="checkbox" checked />
        <span>Temp</span>
      </label>
    </div>
    <div class="stc-actions">
      <button class="stc-send" data-role="send" type="button">Send to CyTube</button>
      <button class="stc-refresh" data-role="refresh" type="button">Refresh</button>
    </div>
    <p class="stc-status" data-role="status" aria-live="polite"></p>
  `;
  anchor.append(panel);

  const state = {
    root,
    panel,
    trigger,
    video,
    tabs: []
  };

  trigger.addEventListener("click", async () => {
    await quickSendCurrentVideo(state);
  });

  optionsButton.addEventListener("click", async () => {
    const nextHidden = !panel.hidden;
    closeOpenPanelExcept(panel);
    panel.hidden = nextHidden;
    openPanel = nextHidden ? null : panel;

    if (!nextHidden) {
      await initializePanel(state);
    }
  });

  panel.querySelector('[data-role="refresh"]').addEventListener("click", async () => {
    await populateTabs(state, { forceRefresh: true });
  });

  panel.querySelector('[data-role="send"]').addEventListener("click", async () => {
    await sendCurrentVideo(state);
  });

  updatePanelForVideo(root, video);
  return root;
}

function updatePanelForVideo(root, video) {
  root.dataset.videoUrl = video.canonicalUrl;
}

async function initializePanel(state) {
  const positionSelect = state.panel.querySelector('[data-role="position"]');
  const tempCheckbox = state.panel.querySelector('[data-role="temp"]');
  const settings = await getSavedSettings();

  positionSelect.value = settings.position;
  tempCheckbox.checked = settings.temp;
  await populateTabs(state, { preferredTabId: settings.targetTabId });
}

async function populateTabs(state, options = {}) {
  const select = state.panel.querySelector('[data-role="target-tab"]');
  const status = state.panel.querySelector('[data-role="status"]');
  const response = await chrome.runtime.sendMessage({
    type: "list-cytube-tabs"
  });

  select.replaceChildren();

  if (!response?.ok) {
    setStatus(status, response?.error || "Could not load open CyTube tabs.", "error");
    select.disabled = true;
    return;
  }

  if (!response.tabs.length) {
    state.tabs = [];
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No open CyTube tabs found";
    select.append(option);
    select.disabled = true;
    setStatus(status, "Open your CyTube channel in another tab first.", "error");
    return;
  }

  const preferredTabId =
    response.tabs.some((tab) => tab.id === options.preferredTabId)
      ? options.preferredTabId
      : response.tabs[0].id;

  state.tabs = response.tabs;

  for (const tab of response.tabs) {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = `${tab.title} - ${safeHost(tab.url)}`;
    option.selected = tab.id === preferredTabId;
    select.append(option);
  }

  select.disabled = false;
  setStatus(status, "", "");
}

async function sendCurrentVideo(state) {
  const status = state.panel.querySelector('[data-role="status"]');
  const sendButton = state.panel.querySelector('[data-role="send"]');
  const refreshButton = state.panel.querySelector('[data-role="refresh"]');
  const select = state.panel.querySelector('[data-role="target-tab"]');
  const position = state.panel.querySelector('[data-role="position"]').value;
  const temp = state.panel.querySelector('[data-role="temp"]').checked;
  const selectedTabId = Number(select.value);

  if (!Number.isInteger(selectedTabId)) {
    setStatus(status, "Choose a CyTube tab first.", "error");
    return;
  }

  if (!state.tabs.find((tab) => tab.id === selectedTabId)) {
    setStatus(status, "Refresh the tab list and try again.", "error");
    return;
  }

  const video = parseYouTubeInput(location.href);
  if (!video) {
    setStatus(status, "This page is not a supported YouTube video URL.", "error");
    return;
  }

  setBusy(sendButton, refreshButton, true);
  setStatus(status, "", "");

  try {
    const result = await performSend({
      tabs: state.tabs,
      targetTabId: selectedTabId,
      position,
      temp,
      video
    });

    await chrome.storage.sync.set({
      lastTargetTabId: selectedTabId,
      defaultPosition: position,
      defaultTemp: temp
    });

    setStatus(
      status,
      result.pending
        ? `Request sent to #${result.channelName || "channel"}.`
        : `Queued in #${result.channelName || "channel"}.`,
      "success"
    );
    flashTrigger(state.trigger, result.pending ? "Sent" : "Queued", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(status, message, "error");
    flashTrigger(state.trigger, "Setup needed", "error");
  } finally {
    setBusy(sendButton, refreshButton, false);
  }
}

async function quickSendCurrentVideo(state) {
  const video = parseYouTubeInput(location.href);
  if (!video) {
    flashTrigger(state.trigger, "No video", "error");
    return;
  }

  const originalLabel = state.trigger.dataset.defaultLabel || "Send to CyTube";
  setTriggerState(state.trigger, "Sending...", "pending");

  try {
    const settings = await getSavedSettings();
    const response = await chrome.runtime.sendMessage({
      type: "list-cytube-tabs"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not load open CyTube tabs.");
    }

    state.tabs = response.tabs;
    if (!response.tabs.length) {
      throw new Error("Open your CyTube channel in another tab first.");
    }

    const targetTabId = resolveQuickTargetTabId(response.tabs, settings.targetTabId);
    const result = await performSend({
      tabs: response.tabs,
      targetTabId,
      position: settings.position,
      temp: settings.temp,
      video
    });

    await chrome.storage.sync.set({
      lastTargetTabId: targetTabId,
      defaultPosition: settings.position,
      defaultTemp: settings.temp
    });

    flashTrigger(state.trigger, result.pending ? "Sent" : "Queued", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    flashTrigger(state.trigger, "Setup needed", "error");
    closeOpenPanelExcept(state.panel);
    state.panel.hidden = false;
    openPanel = state.panel;
    await initializePanel(state);
    setStatus(state.panel.querySelector('[data-role="status"]'), message, "error");
  } finally {
    window.setTimeout(() => {
      setTriggerState(state.trigger, originalLabel, "");
    }, 1800);
  }
}

async function performSend({ tabs, targetTabId, position, temp, video }) {
  const target = tabs.find((tab) => tab.id === targetTabId);
  if (!target?.url) {
    throw new Error("The selected CyTube tab is no longer available.");
  }

  const permissionResult = await chrome.runtime.sendMessage({
    type: "ensure-origin-permission",
    originPattern: `${new URL(target.url).origin}/*`
  });

  if (!permissionResult?.ok) {
    throw new Error(permissionResult?.error || "Site access is required for the selected CyTube tab.");
  }

  const response = await chrome.runtime.sendMessage({
    type: "queue-video",
    targetTabId,
    videoUrl: video.canonicalUrl,
    position,
    temp
  });

  if (!response?.ok) {
    throw new Error(response?.error || "CyTube rejected the request.");
  }

  return response;
}

async function getSavedSettings() {
  const { defaultPosition, defaultTemp, lastTargetTabId } = await chrome.storage.sync.get([
    "defaultPosition",
    "defaultTemp",
    "lastTargetTabId"
  ]);

  return {
    position: defaultPosition === "next" ? "next" : "end",
    temp: defaultTemp !== false,
    targetTabId: Number.isInteger(lastTargetTabId) ? lastTargetTabId : null
  };
}

function resolveQuickTargetTabId(tabs, preferredTabId) {
  if (tabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }

  return tabs[0]?.id ?? null;
}

function setBusy(sendButton, refreshButton, isBusy) {
  sendButton.disabled = isBusy;
  refreshButton.disabled = isBusy;
}

function setTriggerState(trigger, label, state) {
  if (state) {
    trigger.dataset.state = state;
  } else {
    delete trigger.dataset.state;
  }
  const labelNode = trigger.querySelector(".stc-trigger-label");
  if (labelNode) {
    labelNode.textContent = label;
  }
}

function flashTrigger(trigger, label, state) {
  setTriggerState(trigger, label, state);
}

function setStatus(node, message, state) {
  node.textContent = message;
  if (state) {
    node.dataset.state = state;
  } else {
    delete node.dataset.state;
  }
}

function handleDocumentClick(event) {
  if (!openPanel) {
    return;
  }

  if (openPanel.contains(event.target) || event.target.closest(`#${ROOT_ID}`)) {
    return;
  }

  openPanel.hidden = true;
  openPanel = null;
}

function closeOpenPanelExcept(panel) {
  if (openPanel && openPanel !== panel) {
    openPanel.hidden = true;
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
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
