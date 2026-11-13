// Page-context script (injected by content-ui.js as a <script> tag).
// Listens for "tvd_media_download" events carrying Telegram Web stream URLs,
// downloads each file in chunks using HTTP Range requests (served by Telegram
// Web's service worker), and saves the assembled file via a temporary <a download>.
//
// Progress is reported back through "tvd_media_download_progress" events:
//   detail: { url, progress }   progress: 0..100, or -1 on failure.

const DOWNLOAD_EVENT = "tvd_media_download";
const PROGRESS_EVENT = "tvd_media_download_progress";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/117.0";

const MIME_TO_EXTENSION = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function reportProgress(url, progress) {
  document.dispatchEvent(
    new CustomEvent(PROGRESS_EVENT, { detail: { url, progress } }),
  );
}

// Stream URLs look like: .../stream/<URI-encoded JSON>?params
// JSON contains { location: { id }, mimeType, fileName, ... }.
function getMediaInfoFromLink(url) {
  const encoded = url.substring(url.indexOf("stream/") + 7).split("?")[0];
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function getExtensionFromMimeType(mimeType, fileName) {
  if (fileName) {
    const fromName = fileName.match(/\.([^.]+)$/)?.[1];
    if (fromName) return fromName;
  }
  return MIME_TO_EXTENSION[mimeType] ?? mimeType.split("/")[1] ?? "bin";
}

function applyExtension(fileName, extension) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1
    ? `${fileName}.${extension}`
    : `${fileName.slice(0, dot + 1)}${extension}`;
}

function saveBlob(blob, fileName) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  document.body.appendChild(link);
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(objectUrl);
}

function downloadTelegramMediaFile(url) {
  const chunks = [];
  let nextByte = 0;
  let totalSize = null;
  let extension = "mp4";
  let fileName = "";
  let mimeType = "application/octet-stream";
  let hasExplicitFileName = false;

  // Work out the initial file name / MIME type.
  if (url.includes("stream/")) {
    const info = getMediaInfoFromLink(url);
    if (info) {
      if (info.mimeType) mimeType = info.mimeType;
      if (info.fileName) {
        fileName = info.fileName;
        hasExplicitFileName = true;
        extension = getExtensionFromMimeType(mimeType, fileName);
      } else {
        extension = getExtensionFromMimeType(mimeType);
        fileName = `${info.location.id}.${extension}`;
      }
    }
  } else if (url.startsWith("blob")) {
    fileName = `${url.split("/").pop()}.${extension}`;
  } else {
    fileName = `${Math.random().toString(36).substring(2, 10)}.${extension}`;
  }

  // Fetch the next chunk starting at `nextByte`, then recurse until done.
  async function fetchNextChunk(retry = 0) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Range: `bytes=${nextByte}-`, "User-Agent": USER_AGENT },
      });

      if (![200, 206].includes(response.status)) {
        throw new Error(`Non 200/206 response received: ${response.status}`);
      }

      const contentType =
        response.headers.get("Content-Type")?.split(";")[0] || "";
      if (contentType) {
        mimeType = contentType;
        if (!hasExplicitFileName) {
          extension = getExtensionFromMimeType(contentType, fileName);
          fileName = applyExtension(fileName, extension);
        }
      }

      // Content-Range: "bytes <start>-<end>/<total>"
      const range = response.headers
        .get("Content-Range")
        ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range) throw new Error("Invalid Content-Range header");

      const start = parseInt(range[1]);
      const end = parseInt(range[2]);
      const total = parseInt(range[3]);

      if (start !== nextByte) throw new Error("Gap detected between responses.");
      if (totalSize && total !== totalSize) throw new Error("Total size differs");

      nextByte = end + 1;
      totalSize = total;
      reportProgress(url, Math.round((nextByte / totalSize) * 100));

      chunks.push(await response.blob());

      if (nextByte < totalSize) {
        await fetchNextChunk();
      } else {
        saveBlob(new Blob(chunks, { type: mimeType }), fileName);
        reportProgress(url, 100);
      }
    } catch (error) {
      // Retry only on timeouts (HTTP 408).
      if (error.message.includes("408") && retry < MAX_RETRIES) {
        setTimeout(() => fetchNextChunk(retry + 1), RETRY_DELAY_MS);
        return;
      }
      reportProgress(url, -1);
    }
  }

  fetchNextChunk();
}

document.addEventListener(DOWNLOAD_EVENT, (event) => {
  event.detail.urls.forEach(downloadTelegramMediaFile);
});

