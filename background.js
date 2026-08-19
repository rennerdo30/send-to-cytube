const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);
const CONTEXT_MENU_QUEUE = "send-to-cytube-queue";

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_QUEUE) {
    return;
  }

  queueFromContextMenu(info, tab).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    flashActionStatus(tab?.id, "ERR", "#8c1d2e", message);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "queue-video") {
    queueVideo(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "list-cytube-tabs") {
    listCyTubeTabs()
      .then((tabs) => sendResponse({ ok: true, tabs }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "ensure-origin-permission") {
    ensureOriginPermission(message.originPattern)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  return undefined;
});

async function createContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_QUEUE,
    title: "Send to CyTube",
    contexts: ["link"],
    documentUrlPatterns: [
      "https://www.youtube.com/*",
      "https://youtube.com/*",
      "https://m.youtube.com/*",
      "https://music.youtube.com/*"
    ],
    targetUrlPatterns: [
      "https://www.youtube.com/*",
      "https://youtube.com/*",
      "https://m.youtube.com/*",
      "https://music.youtube.com/*",
      "https://youtu.be/*"
    ]
  });
}

async function queueFromContextMenu(info, tab) {
  const clickedUrl = typeof info.linkUrl === "string" ? info.linkUrl : "";
  const video = parseYouTubeInput(clickedUrl);
  if (!video) {
    throw new Error("This link is not a supported YouTube video.");
  }

  const settings = await getSavedSettings();
  const tabs = await listCyTubeTabs();
  if (!tabs.length) {
    throw new Error("Open your CyTube channel in another tab first.");
  }

  const targetTabId = resolveQuickTargetTabId(tabs, settings.targetTabId);
  const targetTab = tabs.find((item) => item.id === targetTabId);
  if (!targetTab?.url) {
    throw new Error("The selected CyTube tab is no longer available.");
  }

  const permissionResult = await ensureOriginPermission(getOriginPattern(targetTab.url));
  if (!permissionResult?.ok) {
    throw new Error(permissionResult?.error || "Site access is required for the selected CyTube tab.");
  }

  const result = await queueVideo({
    targetTabId,
    videoUrl: video.canonicalUrl,
    position: settings.position,
    temp: settings.temp
  });

  if (!result?.ok) {
    throw new Error(result?.error || "CyTube rejected the request.");
  }

  await chrome.storage.sync.set({
    lastTargetTabId: targetTabId,
    defaultPosition: settings.position,
    defaultTemp: settings.temp
  });

  flashActionStatus(
    tab?.id,
    "OK",
    "#126d46",
    result.pending
      ? `Request sent to #${result.channelName || "channel"}.`
      : `Queued in #${result.channelName || "channel"}.`
  );
}

function flashActionStatus(tabId, text, color, title) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title });

  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({ tabId, title: "Send to CyTube" });
  }, 3500);
}

async function queueVideo(message) {
  const video = parseYouTubeInput(message.videoUrl);
  if (!video) {
    return {
      ok: false,
      error: "Enter a valid YouTube watch, short, or youtu.be URL."
    };
  }

  if (!Number.isInteger(message.targetTabId)) {
    return {
      ok: false,
      error: "Choose a CyTube tab first."
    };
  }

  const tab = await chrome.tabs.get(message.targetTabId);
  if (!tab?.id || !tab.url) {
    return {
      ok: false,
      error: "The selected CyTube tab is no longer available."
    };
  }

  const position = message.position === "next" ? "next" : "end";
  const temp = Boolean(message.temp);

  let injections;
  try {
    injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: injectQueueVideo,
      args: [
        {
          videoId: video.videoId,
          canonicalUrl: video.canonicalUrl,
          position,
          temp
        }
      ]
    });
  } catch (error) {
    return {
      ok: false,
      error:
        "Could not run on the selected tab. Make sure you granted access to that site and the tab is an open CyTube channel page."
    };
  }

  const result = injections?.[0]?.result;
  if (!result) {
    return {
      ok: false,
      error: "The selected tab did not return a result."
    };
  }

  return result;
}

async function listCyTubeTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => Number.isInteger(tab.id) && isHttpUrl(tab.url))
    .filter((tab) => isLikelyCyTubeTab(tab))
    .sort(compareTabs)
    .map((tab) => ({
      id: tab.id,
      title: (tab.title || "Untitled tab").trim(),
      url: tab.url
    }));
}

async function ensureOriginPermission(originPattern) {
  if (typeof originPattern !== "string" || !originPattern) {
    return {
      ok: false,
      error: "Missing target site permission."
    };
  }

  const contains = await chrome.permissions.contains({
    origins: [originPattern]
  });

  if (contains) {
    return { ok: true, granted: true };
  }

  try {
    const granted = await chrome.permissions.request({
      origins: [originPattern]
    });

    return granted
      ? { ok: true, granted: true }
      : {
          ok: false,
          granted: false,
          error: "Site access is required for the selected CyTube tab."
        };
  } catch (error) {
    return {
      ok: false,
      error:
        "Chrome did not allow the site-access prompt here. Use the extension popup once for this CyTube host, then the YouTube button will keep working."
    };
  }
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

function getOriginPattern(url) {
  const parsed = new URL(url);
  return `${parsed.origin}/*`;
}

function injectQueueVideo(payload) {
  const { videoId, canonicalUrl, position, temp } = payload;

  function removeListener(socket, event, handler) {
    if (typeof socket.off === "function") {
      socket.off(event, handler);
      return;
    }

    if (typeof socket.removeListener === "function") {
      socket.removeListener(event, handler);
    }
  }

  return new Promise((resolve) => {
    try {
      const socket = window.socket;
      const channel = window.CHANNEL;

      if (!socket || typeof socket.emit !== "function") {
        resolve({
          ok: false,
          error: "This page does not expose an active CyTube socket."
        });
        return;
      }

      if (!channel || typeof channel.name !== "string") {
        resolve({
          ok: false,
          error: "This tab is not a CyTube channel page."
        });
        return;
      }

      if (socket.disconnected) {
        resolve({
          ok: false,
          error: "CyTube is disconnected in the selected tab."
        });
        return;
      }

      const canCheckPermissions = typeof window.hasPermission === "function";
      if (canCheckPermissions && !window.hasPermission("playlistadd")) {
        resolve({
          ok: false,
          error: "Your current CyTube user cannot add videos in this channel."
        });
        return;
      }

      if (
        position === "next" &&
        canCheckPermissions &&
        !window.hasPermission("playlistnext")
      ) {
        resolve({
          ok: false,
          error: 'Your current CyTube user cannot use the "Next" queue position in this channel.'
        });
        return;
      }

      const expectedQueueBy =
        typeof window.CLIENT?.name === "string" && window.CLIENT.name
          ? window.CLIENT.name
          : null;

      const timeoutId = window.setTimeout(() => {
        cleanup();
        resolve({
          ok: true,
          pending: true,
          channelName: channel.name,
          message: "Queue request sent. CyTube did not answer before the timeout, but the request may still have succeeded."
        });
      }, 5000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        removeListener(socket, "queue", onQueue);
        removeListener(socket, "queueFail", onQueueFail);
      };

      const matchesPacket = (packet) => {
        const media = packet?.item?.media;
        if (!media || media.type !== "yt" || media.id !== videoId) {
          return false;
        }

        if (!expectedQueueBy) {
          return true;
        }

        return packet?.item?.queueby === expectedQueueBy;
      };

      const onQueue = (packet) => {
        if (!matchesPacket(packet)) {
          return;
        }

        cleanup();
        resolve({
          ok: true,
          channelName: channel.name,
          position,
          temp,
          item: packet.item,
          message: `Queued ${canonicalUrl} in #${channel.name}.`
        });
      };

      const onQueueFail = (data) => {
        if (data?.id && data.id !== videoId) {
          return;
        }

        cleanup();
        resolve({
          ok: false,
          channelName: channel.name,
          error: data?.msg || "CyTube rejected the queue request."
        });
      };

      socket.on("queue", onQueue);
      socket.on("queueFail", onQueueFail);
      socket.emit("queue", {
        id: videoId,
        type: "yt",
        pos: position,
        temp
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
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

function isHttpUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
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

  if (haystack.includes("cytu.be")) {
    score += 4;
  }

  if (haystack.includes("/r/")) {
    score += 3;
  }

  return score;
}
