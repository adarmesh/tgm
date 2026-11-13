// Content script: injects a download button next to media in Telegram Web chat bubbles.

const BUTTON_CLASS = "td-download-action";
const BUTTON_SIZE = 32;
const CONFIG_KEY = "td-configs";
const DEFAULT_CONFIG = { enable: true, lang: "en" };

// ---------------------------------------------------------------------------
// Settings (chrome.storage.local, live-updated)
// ---------------------------------------------------------------------------

let config = { ...DEFAULT_CONFIG };

async function loadConfig() {
  const stored = await chrome.storage.local.get([CONFIG_KEY]);
  config = stored[CONFIG_KEY] ?? DEFAULT_CONFIG;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[CONFIG_KEY]) return;
  config = changes[CONFIG_KEY].newValue ?? DEFAULT_CONFIG;
  sync();
});

// ---------------------------------------------------------------------------
// Finding media (chat bubbles only)
// ---------------------------------------------------------------------------

let documents = [];

// Returns [{ mid, type: "audio" | "video" | "image", node }]
function getDocumentsFromNode(root) {
  const result = [];
  const mid = root.dataset.mid ?? "";

  const audioElements = root.querySelectorAll("audio-element");
  if (audioElements.length) {
    audioElements.forEach((el) => {
      result.push({ mid: el.dataset.mid || mid, type: "audio", node: el });
    });
    return result;
  }

  const playIcons = root.querySelectorAll("div.audio-play-icon");
  if (playIcons.length) {
    playIcons.forEach((icon) => {
      result.push({ mid, type: "audio", node: icon });
    });
    return result;
  }

  const photo = root.querySelector("img.media-photo, canvas.media-photo");
  const isVideo = root.querySelector("span.video-time") && photo;
  if (isVideo) {
    result.push({ mid, type: "video", node: photo });
  } else if (photo) {
    result.push({ mid, type: "image", node: photo });
  }
  return result;
}

function getDocumentList() {
  const result = [];

  const bubblesContainer = document
    .querySelector("div.chat.tabs-tab.active")
    ?.querySelector("div.bubbles>div.scrollable.scrollable-y");
  if (!bubblesContainer) return result;

  bubblesContainer.querySelectorAll("div.bubble").forEach((bubble) => {
    // Kick off Telegram's own manual preloader if it is waiting for a click.
    bubble.querySelector("div.preloader-container.is-visible.manual")?.click();

    const albumItems = bubble.querySelectorAll("div.album-item");
    if (albumItems.length) {
      albumItems.forEach((item) => result.push(...getDocumentsFromNode(item)));
    } else {
      result.push(...getDocumentsFromNode(bubble));
    }
  });

  return result;
}

function haveSameDocuments(a, b) {
  const ids = (list) => list.map((d) => d.mid).sort().join("");
  return ids(a) === ids(b);
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

function createButton(styles, onClick) {
  const img = document.createElement("img");
  img.src = chrome.runtime.getURL("icon.webp");
  img.width = BUTTON_SIZE;
  img.height = BUTTON_SIZE;
  img.style.width = `${BUTTON_SIZE}px`;
  img.style.height = `${BUTTON_SIZE}px`;
  img.style.cursor = "pointer";
  Object.assign(img.style, styles);

  img.addEventListener("click", async (event) => {
    event.stopPropagation();
    await onClick(event);
  });

  return img;
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

const DOWNLOAD_EVENT = "tvd_media_download";
const PROGRESS_EVENT = "tvd_media_download_progress";
const DOWNLOADING_CLASS = "tv-downloading";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Score a quality menu label: "1080p" -> 1080, "4K" -> 2160, "12 MB" -> 12 ...
function parseQualityScore(text) {
  const normalized = text.replace(/\s+/g, " ").trim();

  const pixels = normalized.match(/(\d+)\s*p\b/i);
  if (pixels) return parseInt(pixels[1], 10);
  if (/\b4\s*k\b/i.test(normalized)) return 2160;
  if (/\b2\s*k\b/i.test(normalized)) return 1440;

  const size = normalized.match(/([\d.]+)\s*(GB|MB|KB)\b/i);
  if (size) {
    const value = parseFloat(size[1]);
    const unit = size[2].toUpperCase();
    if (unit === "GB") return value * 1024;
    if (unit === "MB") return value;
    return value / 1024;
  }
  return 0;
}

function getQualityMenuItems() {
  const selectors = [
    ".btn-menu.active .btn-menu-item",
    ".btn-menu.was-open .btn-menu-item",
    ".quality-download-options-button-menu .btn-menu-item",
  ];
  for (const selector of selectors) {
    const items = Array.from(document.querySelectorAll(selector));
    if (items.length) return items;
  }
  return [];
}

function findHighestQualityMenuItem(items) {
  if (!items.length) return null;
  return items.reduce((best, item) =>
    parseQualityScore(item.textContent ?? "") >
    parseQualityScore(best.textContent ?? "")
      ? item
      : best,
  );
}

async function waitForQualityMenuItems(timeout = 2000, interval = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const items = getQualityMenuItems();
    if (items.length) return items;
    await sleep(interval);
  }
  return [];
}

function parseStreamUrlInfo(url) {
  if (!url.includes("stream/")) return null;
  try {
    const encoded = url.substring(url.indexOf("stream/") + 7).split("?")[0];
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function getAudioTitle(audioElement) {
  const title = audioElement.querySelector(".audio-title middle-ellipsis-element");
  return title?.getAttribute("title") ?? title?.textContent?.trim() ?? "";
}

// Finds an <audio> whose src is a Telegram stream URL for the given title.
function findAudioStreamUrl(title) {
  for (const audio of Array.from(document.querySelectorAll("audio"))) {
    const src = audio.src;
    if (!src?.includes("stream/")) continue;
    if (!title) return src;
    if (parseStreamUrlInfo(src)?.fileName === title) return src;
  }
  return null;
}

// Makes Telegram create the stream URL by briefly pressing play, then pauses.
async function resolveAudioStreamUrl(audioElement, timeout = 15000) {
  const title = getAudioTitle(audioElement);
  const existing = findAudioStreamUrl(title);
  if (existing) return existing;

  const toggle = audioElement.querySelector(".audio-toggle");
  const wasPlaying = toggle?.classList.contains("playing") ?? false;
  if (!wasPlaying) {
    (toggle ?? audioElement.querySelector(".audio-play-icon"))?.click();
  }

  const url = await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error("Timeout waiting for audio stream"));
    }, timeout);
    const intervalId = setInterval(() => {
      const found = findAudioStreamUrl(title);
      if (found) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(found);
      }
    }, 200);
  }).catch(() => null);

  if (!wasPlaying && toggle?.classList.contains("playing")) toggle.click();
  return url;
}

function waitForAudioPreload(timeout = 15000, interval = 500) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error("Timeout audio preload"));
    }, timeout);
    const intervalId = setInterval(() => {
      const loading = document.querySelectorAll(
        "div.audio-download > div.preloader-container.is-visible, audio-element .preloader-container.is-visible",
      );
      if (loading.length === 0) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, interval);
  });
}

function waitForMediaPreload(timeout = 15000, interval = 500) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error("Timeout media preload"));
    }, timeout);
    const intervalId = setInterval(() => {
      if (document.querySelectorAll(".media-viewer-buttons > .btn-icon").length) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, interval);
  });
}

// Asks downloader.js (page context) to download `url`; resolves on completion.
function downloadMediaFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      document.removeEventListener(PROGRESS_EVENT, onProgressEvent);
      reject(new Error("Download timeout"));
    }, 20 * 60 * 1000);

    function onProgressEvent(event) {
      if (event.detail.url !== url) return;
      onProgress?.(event.detail.progress);

      if (event.detail.progress === 100 || event.detail.progress === -1) {
        document.removeEventListener(PROGRESS_EVENT, onProgressEvent);
        clearTimeout(timeoutId);
        if (event.detail.progress === -1) reject(new Error("Download failed"));
        else resolve();
      }
    }

    document.addEventListener(PROGRESS_EVENT, onProgressEvent);
    document.dispatchEvent(
      new CustomEvent(DOWNLOAD_EVENT, { detail: { urls: [url] } }),
    );
  });
}

// Images / videos: open Telegram's viewer, pick the best quality and press its
// own download button. The viewer is hidden meanwhile (see injectPageStyles).
async function downloadViaMediaViewer(doc) {
  document.body.classList.add(DOWNLOADING_CLASS);
  doc.node?.click();
  await waitForMediaPreload();

  const video = document.querySelector(".media-viewer-whole video");
  if (video) video.muted = true;

  const buttons = document.querySelectorAll(".media-viewer-buttons > .btn-icon");
  const qualityButton =
    document.querySelector(".media-viewer-buttons .quality-download-options-button-menu") ??
    (buttons.length >= 3 ? buttons[2] : null);

  if (qualityButton) {
    qualityButton.click();
    const items = await waitForQualityMenuItems();
    findHighestQualityMenuItem(items)?.click();
    await sleep(1000);
    document.querySelector(".media-viewer-buttons > .btn-icon:last-child")?.click();
  }

  if (video) video.muted = false;
  await sleep(500);
  document.body.classList.remove(DOWNLOADING_CLASS);
}

// Audio: resolve Telegram's stream URL and hand it to downloader.js.
async function downloadAudio(doc) {
  const audioElement =
    doc.node?.tagName === "AUDIO-ELEMENT"
      ? doc.node
      : doc.node?.closest("audio-element");
  if (!audioElement) return;

  await waitForAudioPreload().catch(() => {});
  const url = await resolveAudioStreamUrl(audioElement);
  if (!url) return;

  await downloadMediaFile(url);
}

async function onDownloadClick(doc) {
  try {
    if (doc.type === "image" || doc.type === "video") {
      await downloadViaMediaViewer(doc);
    } else if (doc.type === "audio") {
      await downloadAudio(doc);
    }
  } catch (error) {
    console.error("Download failed:", error);
    document.body.classList.remove(DOWNLOADING_CLASS);
  }
}

// ---------------------------------------------------------------------------
// Page setup: downloader.js + the rule that hides the viewer while automating it
// ---------------------------------------------------------------------------

function injectDownloaderScript() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("downloader.js");
  document.head.appendChild(script);
}

function injectPageStyles() {
  const style = document.createElement("style");
  style.textContent = `.${DOWNLOADING_CLASS} .media-viewer-whole,
.${DOWNLOADING_CLASS} .media-viewer-whole .overlays { visibility: hidden !important; }`;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Injecting the button
// ---------------------------------------------------------------------------

function register() {
  const newDocuments = getDocumentList();

  if (haveSameDocuments(documents, newDocuments)) {
    documents = newDocuments;
    return;
  }
  documents = newDocuments;

  newDocuments.forEach((doc) => {
    // Audio: anchor to the <audio-element>'s parent.
    const audioElement =
      doc.type === "audio" && doc.node
        ? doc.node.tagName === "AUDIO-ELEMENT"
          ? doc.node
          : doc.node.closest("audio-element")
        : null;

    let parent =
      doc.type === "audio" && audioElement
        ? audioElement.parentElement
        : doc.node?.parentElement;

    // Audio without an <audio-element> ancestor (chat): go two levels higher
    // than the play icon's parent.
    if (parent && doc.type === "audio" && !audioElement) {
      parent = parent.parentElement?.parentElement;
    }
    if (!parent) return;

    // Don't inject twice.
    if (parent.querySelector(`.${BUTTON_CLASS}`)) return;

    const container = document.createElement("div");
    container.className = BUTTON_CLASS;
    parent.appendChild(container);

    const styles = {};
    if (doc.type === "audio") {
      styles.right = "-4px";
      styles.bottom = "16px";
    }

    container.appendChild(
      createButton(styles, async () => {
        const current = documents.find((d) => d.mid === doc.mid);
        if (current) await onDownloadClick(current);
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function unregister() {
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
  documents = [];
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

const isTelegramWeb = /^web[k,z]*.telegram.org$/.test(location.host);

function sync() {
  if (!isTelegramWeb) return;
  if (config.enable) register();
  else unregister();
}

// Leading + trailing throttle (same semantics as lodash.throttle).
function throttle(fn, wait) {
  let timer = null;
  let lastArgs = null;
  let lastCall = 0;

  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    lastArgs = args;

    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        lastCall = Date.now();
        fn(...lastArgs);
      }, remaining);
    }
  };
}

async function init() {
  injectDownloaderScript();
  injectPageStyles();
  await loadConfig();
  sync();

  const observer = new MutationObserver(throttle(sync, 100));
  observer.observe(document.body, { childList: true, subtree: true });
}

init();

