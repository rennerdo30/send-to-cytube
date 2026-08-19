(function () {
  function applyExistingLayoutTweaks() {
    if (!window.CyTube || !CyTube.ui) {
      return;
    }

    CyTube.ui.changeVideoWidth = function uiChangeVideoWidth(direction) {
      var body = document.body;
      if (/hd/.test(body.className)) {
        throw new Error("ui::changeVideoWidth does not work with the 'hd' layout");
      }

      var videoWrap = document.getElementById("videowrap");
      var leftControls = document.getElementById("leftcontrols");
      var leftPane = document.getElementById("leftpane");
      var chatWrap = document.getElementById("chatwrap");
      var rightControls = document.getElementById("rightcontrols");
      var rightPane = document.getElementById("rightpane");

      if (
        !videoWrap ||
        !leftControls ||
        !leftPane ||
        !chatWrap ||
        !rightControls ||
        !rightPane
      ) {
        return;
      }

      var match = videoWrap.className.match(/col-md-(\d+)/);
      if (!match) {
        throw new Error("ui::changeVideoWidth: videowrap is missing bootstrap class!");
      }

      var videoWidth = parseInt(match[1], 10) + direction;
      if (videoWidth < 3 || videoWidth > 10) {
        return;
      }

      var chatWidth = 12 - videoWidth;
      videoWrap.className = "col-md-" + videoWidth + " col-lg-" + videoWidth;
      rightControls.className = "col-md-" + videoWidth + " col-lg-" + videoWidth;
      rightPane.className = "col-md-" + videoWidth + " col-lg-" + videoWidth;
      chatWrap.className = "col-md-" + chatWidth + " col-lg-" + chatWidth;
      leftControls.className = "col-md-" + chatWidth + " col-lg-" + chatWidth;
      leftPane.className = "col-md-" + chatWidth + " col-lg-" + chatWidth;

      if (typeof window.handleVideoResize === "function") {
        handleVideoResize();
      }
    };

    try {
      var i;
      for (i = 0; i < 11; i++) {
        CyTube.ui.changeVideoWidth(1);
      }
    } catch (error) {
      if (window.console && console.warn) {
        console.warn("[CyTube SponsorBlock] layout tweak skipped:", error.message);
      }
    }
  }

  applyExistingLayoutTweaks();

  if (window.__cytubeSponsorBlockInstalled) {
    return;
  }
  window.__cytubeSponsorBlockInstalled = true;

  var CONFIG = {
    apiBase: "https://sponsor.ajay.app",
    categories: [
      "sponsor",
      "selfpromo",
      "interaction",
      "intro",
      "outro",
      "preview",
      "filler"
    ],
    pollMs: 400,
    mergeGapSeconds: 0.35,
    seekPaddingSeconds: 0.08,
    ui: true,
    debug: false
  };

  var state = {
    mediaKey: "",
    videoId: "",
    mediaHint: null,
    segments: [],
    mergedSegments: [],
    loading: false,
    lastSkipKey: "",
    lastSkipAt: 0,
    lastSkipTarget: 0,
    leaderName: "",
    localSyncOffset: 0,
    localSyncSegments: {},
    statusNode: null,
    statusTextNode: null
  };

  function log() {
    if (!CONFIG.debug || !window.console || !console.log) {
      return;
    }
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CyTube SponsorBlock]");
    console.log.apply(console, args);
  }

  function setStatus(message, tone) {
    if (!CONFIG.ui) {
      return;
    }

    var node = ensureStatusNode();
    if (!node || !state.statusTextNode) {
      return;
    }

    state.statusTextNode.textContent = message;
    node.className = "sb-status";
    applyStatusTone(node, state.statusTextNode, tone || "muted");
    node.setAttribute("aria-label", message);
  }

  function ensureStatusNode() {
    if (state.statusNode && document.body.contains(state.statusNode)) {
      return state.statusNode;
    }

    if (!document.body) {
      return null;
    }

    var styleId = "sb-channel-style";
    if (!document.getElementById(styleId)) {
      var style = document.createElement("style");
      style.id = styleId;
      style.type = "text/css";
      style.textContent =
        "#sb-channel-status:hover + #sb-channel-status-tooltip," +
        "#sb-channel-status-tooltip:hover{display:block}";
      document.head.appendChild(style);
    }

    var node = document.createElement("div");
    node.id = "sb-channel-status";
    node.className = "sb-status";
    node.textContent = "SB";
    node.style.position = "fixed";
    node.style.right = "10px";
    node.style.bottom = "10px";
    node.style.zIndex = "2147483647";
    node.style.width = "34px";
    node.style.height = "34px";
    node.style.borderRadius = "999px";
    node.style.display = "flex";
    node.style.alignItems = "center";
    node.style.justifyContent = "center";
    node.style.font = "700 13px/1 Arial,sans-serif";
    node.style.color = "#fff";
    node.style.cursor = "default";
    node.style.userSelect = "none";
    node.style.boxShadow = "0 8px 20px rgba(0,0,0,0.24)";

    var textNode = document.createElement("div");
    textNode.id = "sb-channel-status-tooltip";
    textNode.style.position = "fixed";
    textNode.style.right = "52px";
    textNode.style.bottom = "10px";
    textNode.style.zIndex = "2147483647";
    textNode.style.display = "none";
    textNode.style.maxWidth = "220px";
    textNode.style.padding = "8px 10px";
    textNode.style.borderRadius = "10px";
    textNode.style.font = "600 11px/1.25 Arial,sans-serif";
    textNode.style.color = "#fff";
    textNode.style.whiteSpace = "normal";
    textNode.style.wordBreak = "break-word";
    textNode.style.boxShadow = "0 8px 20px rgba(0,0,0,0.24)";

    node.onmouseenter = function () {
      textNode.style.display = "block";
    };
    node.onmouseleave = function () {
      textNode.style.display = "none";
    };
    textNode.onmouseenter = function () {
      textNode.style.display = "block";
    };
    textNode.onmouseleave = function () {
      textNode.style.display = "none";
    };

    document.body.appendChild(node);
    document.body.appendChild(textNode);
    state.statusNode = node;
    state.statusTextNode = textNode;
    applyStatusTone(node, textNode, "muted");
    return node;
  }

  function applyStatusTone(iconNode, tooltipNode, tone) {
    var background = "rgba(22,22,22,0.9)";

    if (tone === "success") {
      background = "rgba(18,109,70,0.94)";
    } else if (tone === "error") {
      background = "rgba(140,29,46,0.95)";
    } else if (tone === "warn") {
      background = "rgba(133,87,18,0.95)";
    }

    iconNode.style.background = background;
    tooltipNode.style.background = background;
  }

  function getCurrentMedia() {
    if (!window.PLAYER || !PLAYER.mediaType || !PLAYER.mediaId) {
      return null;
    }

    return {
      type: PLAYER.mediaType,
      id: PLAYER.mediaId,
      key: PLAYER.mediaType + ":" + PLAYER.mediaId
    };
  }

  function parseMedia(data) {
    if (!data || !data.type || !data.id) {
      return null;
    }

    return {
      type: data.type,
      id: data.id,
      key: data.type + ":" + data.id
    };
  }

  function setMediaHint(media) {
    state.mediaHint = media
      ? {
          type: media.type,
          id: media.id,
          key: media.key,
          at: Date.now()
        }
      : null;
  }

  function getObservedMedia() {
    var playerMedia = getCurrentMedia();
    var hintedMedia = state.mediaHint;

    if (!hintedMedia) {
      return playerMedia;
    }

    if (!playerMedia) {
      return hintedMedia;
    }

    if (playerMedia.key === hintedMedia.key) {
      state.mediaHint = null;
      return playerMedia;
    }

    if (Date.now() - hintedMedia.at < 10000) {
      return hintedMedia;
    }

    state.mediaHint = null;
    return playerMedia;
  }

  function isPlayerReadyForActiveMedia() {
    var playerMedia = getCurrentMedia();
    return Boolean(playerMedia && state.mediaKey && playerMedia.key === state.mediaKey);
  }

  function isLeader() {
    return Boolean(window.CLIENT && CLIENT.leader);
  }

  function resetForMedia(media) {
    state.mediaKey = media ? media.key : "";
    state.videoId = media ? media.id : "";
    if (!media) {
      state.mediaHint = null;
    }
    state.segments = [];
    state.mergedSegments = [];
    state.loading = false;
    state.lastSkipKey = "";
    state.lastSkipAt = 0;
    state.lastSkipTarget = 0;
    resetLocalSyncOffset();
  }

  function activateMedia(media) {
    if (!media) {
      if (state.mediaKey) {
        resetForMedia(null);
      }
      setStatus("SponsorBlock waiting for media", "muted");
      return true;
    }

    if (media.key === state.mediaKey) {
      return false;
    }

    resetForMedia(media);
    if (media.type !== "yt") {
      setStatus("SponsorBlock idle: not a YouTube video", "muted");
      return true;
    }

    fetchSegments(media.id);
    return true;
  }

  function tick() {
    var media = getObservedMedia();

    if (activateMedia(media)) {
      return;
    }

    if (media.type !== "yt") {
      return;
    }

    if (state.loading) {
      setStatus("SponsorBlock loading segments...", "warn");
      return;
    }

    if (!state.mergedSegments.length) {
      setStatus("SponsorBlock active: no segments for this video", "muted");
      return;
    }

    setStatus("SponsorBlock active: " + state.mergedSegments.length + " skip range(s)", "success");
  }

  function fetchSegments(videoId) {
    var requestMediaKey = state.mediaKey;
    state.loading = true;
    setStatus("SponsorBlock loading segments...", "warn");

    var url = buildApiUrl(videoId);
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) {
        return;
      }

      if (state.mediaKey !== requestMediaKey || state.videoId !== videoId) {
        log("ignoring stale segment response for", videoId);
        return;
      }

      state.loading = false;

      if (xhr.status === 404) {
        state.segments = [];
        state.mergedSegments = [];
        setStatus("SponsorBlock active: no segments for this video", "muted");
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        log("segment request failed", xhr.status, xhr.responseText);
        setStatus("SponsorBlock request failed (" + xhr.status + ")", "error");
        return;
      }

      try {
        var rawSegments = JSON.parse(xhr.responseText);
        state.segments = normalizeSegments(rawSegments || []);
        state.mergedSegments = mergeSegments(state.segments);
        setStatus(
          state.mergedSegments.length
            ? "SponsorBlock ready: " + state.mergedSegments.length + " skip range(s)"
            : "SponsorBlock active: no segments for this video",
          state.mergedSegments.length ? "success" : "muted"
        );
      } catch (error) {
        log("failed to parse segments", error);
        setStatus("SponsorBlock parse error", "error");
      }
    };
    xhr.send();
  }

  function installCyTubeHooks() {
    if (
      !window.Callbacks ||
      typeof Callbacks.changeMedia !== "function" ||
      typeof Callbacks.mediaUpdate !== "function" ||
      typeof Callbacks.setLeader !== "function"
    ) {
      window.setTimeout(installCyTubeHooks, 250);
      return;
    }

    if (Callbacks.changeMedia.__sbWrapped && Callbacks.mediaUpdate.__sbWrapped) {
      return;
    }

    var originalChangeMedia = Callbacks.changeMedia;
    var wrappedChangeMedia = function (data) {
      var media = parseMedia(data);
      if (media) {
        setMediaHint(media);
        activateMedia(media);
      }
      return originalChangeMedia.call(this, applyLocalSyncOffset(data));
    };

    wrappedChangeMedia.__sbWrapped = true;
    Callbacks.changeMedia = wrappedChangeMedia;

    var originalMediaUpdate = Callbacks.mediaUpdate;
    var wrappedMediaUpdate = function (data) {
      return originalMediaUpdate.call(this, applyLocalSyncOffset(data));
    };

    wrappedMediaUpdate.__sbWrapped = true;
    Callbacks.mediaUpdate = wrappedMediaUpdate;

    var originalSetLeader = Callbacks.setLeader;
    var wrappedSetLeader = function (name) {
      state.leaderName = typeof name === "string" ? name : "";
      resetLocalSyncOffset();
      return originalSetLeader.apply(this, arguments);
    };

    wrappedSetLeader.__sbWrapped = true;
    Callbacks.setLeader = wrappedSetLeader;
  }

  function buildApiUrl(videoId) {
    var params = ["videoID=" + encodeURIComponent(videoId), "service=YouTube", "actionType=skip"];
    for (var i = 0; i < CONFIG.categories.length; i++) {
      params.push("category=" + encodeURIComponent(CONFIG.categories[i]));
    }
    return CONFIG.apiBase + "/api/skipSegments?" + params.join("&");
  }

  function normalizeSegments(rawSegments) {
    var normalized = [];

    for (var i = 0; i < rawSegments.length; i++) {
      var item = rawSegments[i];
      if (!item || !item.segment || item.segment.length < 2) {
        continue;
      }

      var start = Number(item.segment[0]);
      var end = Number(item.segment[1]);

      if (!isFinite(start) || !isFinite(end) || end <= start) {
        continue;
      }

      normalized.push({
        key: (item.UUID || "segment-" + i) + ":" + start + ":" + end,
        start: start,
        end: end,
        category: item.category || "unknown"
      });
    }

    normalized.sort(function (left, right) {
      return left.start - right.start;
    });

    return normalized;
  }

  function mergeSegments(segments) {
    if (!segments.length) {
      return [];
    }

    var merged = [];
    var current = {
      key: segments[0].key,
      start: segments[0].start,
      end: segments[0].end
    };

    for (var i = 1; i < segments.length; i++) {
      var segment = segments[i];
      if (segment.start <= current.end + CONFIG.mergeGapSeconds) {
        current.end = Math.max(current.end, segment.end);
        current.key += "|" + segment.key;
      } else {
        merged.push(current);
        current = {
          key: segment.key,
          start: segment.start,
          end: segment.end
        };
      }
    }

    merged.push(current);
    return merged;
  }

  function runSkipCheck() {
    if (
      !state.mergedSegments.length ||
      !window.PLAYER ||
      typeof PLAYER.getTime !== "function" ||
      !isPlayerReadyForActiveMedia()
    ) {
      return;
    }

    PLAYER.getTime(function (seconds) {
      if (typeof seconds !== "number" || !isFinite(seconds)) {
        return;
      }

      var activeSegment = findActiveSegment(seconds);
      if (!activeSegment) {
        return;
      }

      var now = Date.now();
      var target = activeSegment.end + CONFIG.seekPaddingSeconds;
      if (
        state.lastSkipKey === activeSegment.key &&
        now - state.lastSkipAt < 1500 &&
        seconds >= state.lastSkipTarget - 0.25
      ) {
        return;
      }

      if (target <= seconds + 0.02) {
        return;
      }

      if (!seekPlayer(target)) {
        setStatus("SponsorBlock could not seek this player", "error");
        return;
      }

      state.lastSkipKey = activeSegment.key;
      state.lastSkipAt = now;
      state.lastSkipTarget = target;
      rememberLocalSyncOffset(activeSegment, seconds, target);
      setStatus("SponsorBlock skipped to " + formatTime(target), "success");
      if (isLeader()) {
        pushMediaUpdate(target);
      }
    });
  }

  function hasServerAutolead() {
    return state.leaderName === "";
  }

  function resetLocalSyncOffset() {
    state.localSyncOffset = 0;
    state.localSyncSegments = {};
  }

  function rememberLocalSyncOffset(segment, fromSeconds, target) {
    if (isLeader() || !hasServerAutolead() || state.localSyncSegments[segment.key]) {
      return;
    }

    var delta = target - fromSeconds;
    if (delta <= 0 || !isFinite(delta)) {
      return;
    }

    state.localSyncOffset += delta;
    state.localSyncSegments[segment.key] = true;
    log("local sync offset is now", state.localSyncOffset);
  }

  function applyLocalSyncOffset(data) {
    if (!data || !hasServerAutolead() || state.localSyncOffset <= 0) {
      return data;
    }

    if (
      !state.mediaKey ||
      state.mediaKey.indexOf("yt:") !== 0 ||
      typeof data.currentTime !== "number" ||
      data.currentTime < 0
    ) {
      return data;
    }

    var adjusted = {};
    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        adjusted[key] = data[key];
      }
    }
    adjusted.currentTime = data.currentTime + state.localSyncOffset;
    return adjusted;
  }

  function findActiveSegment(seconds) {
    for (var i = 0; i < state.mergedSegments.length; i++) {
      var segment = state.mergedSegments[i];
      if (seconds >= segment.start && seconds < segment.end - 0.02) {
        return segment;
      }
    }
    return null;
  }

  function seekPlayer(seconds) {
    try {
      if (typeof PLAYER.seekTo === "function") {
        PLAYER.seekTo(seconds);
        return true;
      }
      if (typeof PLAYER.seek === "function") {
        PLAYER.seek(seconds);
        return true;
      }
      if (typeof PLAYER.setTime === "function") {
        PLAYER.setTime(seconds);
        return true;
      }
      if (PLAYER.player) {
        if (typeof PLAYER.player.seekTo === "function") {
          PLAYER.player.seekTo(seconds, true);
          return true;
        }
        if (typeof PLAYER.player.seek === "function") {
          PLAYER.player.seek(seconds);
          return true;
        }
        if (typeof PLAYER.player.setCurrentTime === "function") {
          PLAYER.player.setCurrentTime(seconds);
          return true;
        }
        if ("currentTime" in PLAYER.player) {
          PLAYER.player.currentTime = seconds;
          return true;
        }
      }
    } catch (error) {
      log("seek failed", error);
    }

    return false;
  }

  function pushMediaUpdate(seconds) {
    if (!window.socket || typeof socket.emit !== "function" || !window.PLAYER) {
      return;
    }

    window.setTimeout(function () {
      socket.emit("mediaUpdate", {
        id: PLAYER.mediaId,
        currentTime: seconds,
        paused: Boolean(PLAYER.paused),
        type: PLAYER.mediaType
      });
    }, 80);
  }

  function formatTime(seconds) {
    var total = Math.max(0, Math.floor(seconds));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    if (hours > 0) {
      return hours + ":" + pad(minutes) + ":" + pad(secs);
    }

    return minutes + ":" + pad(secs);
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  installCyTubeHooks();
  tick();
  window.setInterval(tick, 1000);
  window.setInterval(runSkipCheck, CONFIG.pollMs);
})();
