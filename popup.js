"use strict";

// --- Pure functions (percent <-> volume conversion) ---

// "0.25" or "0,25" -> 0.25; returns null if invalid or outside [0, 100].
function parsePercent(text) {
  const normalized = String(text).trim().replace(",", ".");
  if (normalized === "" || !/^\d*\.?\d+$/.test(normalized)) {
    return null;
  }
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return null;
  }
  return percent;
}

// 0.1 (%) -> 0.001 (volume in [0, 1])
function percentToVolume(percent) {
  return Math.min(1, Math.max(0, percent / 100));
}

// 0.001 -> "0.1%" (up to 2 decimals, trailing zeros removed)
function formatVolume(volume) {
  const percent = volume * 100;
  const text = percent.toFixed(2).replace(/\.?0+$/, "");
  return (text === "" ? "0" : text) + "%";
}

// --- Self-contained functions injected into YouTube page (runs in MAIN world) ---
// Note: Injected functions cannot call outside helper functions because executeScript serializes only the passed function.

function pageGetVolume() {
  // 1. Find active video (YouTube Shorts or standard video)
  let video = document.querySelector("ytd-reel-video-renderer[is-active] video, #shorts-player video");
  if (!video) {
    const videos = Array.from(document.querySelectorAll("video"));
    video = videos.find(v => !v.paused && v.currentTime > 0) ||
            videos.find(v => v.offsetWidth > 0 && v.offsetHeight > 0) ||
            videos[0];
  }

  // 2. Find player element
  const player = document.getElementById("movie_player") ||
                 document.getElementById("shorts-player") ||
                 document.querySelector(".html5-video-player");

  let vol = null;
  let muted = false;

  if (video) {
    vol = video.volume;
    muted = video.muted;
  } else if (player && typeof player.getVolume === "function") {
    vol = player.getVolume() / 100;
    muted = typeof player.isMuted === "function" ? player.isMuted() : false;
  }

  if (vol !== null) {
    window.__ytPrecisionVolume = vol;
    return { ok: true, volume: vol, muted: muted };
  }

  return { ok: false };
}

function pageSetVolume(targetPercent) {
  const volumeRatio = Math.min(1, Math.max(0, targetPercent / 100));

  const player = document.getElementById("movie_player") ||
                 document.getElementById("shorts-player") ||
                 document.querySelector(".html5-video-player");

  const allVideos = document.querySelectorAll("video");

  if (allVideos.length === 0 && !player) {
    return { ok: false };
  }

  window.__ytPrecisionVolume = volumeRatio;

  // 1. Inform YouTube player API if available
  if (player) {
    try {
      if (typeof player.unMute === "function" && volumeRatio > 0) {
        player.unMute();
      }
      if (typeof player.setVolume === "function") {
        player.setVolume(targetPercent);
      }
    } catch (e) {}
  }

  // 2. Set volume on ALL video elements (critical for YouTube Shorts feed & standard videos)
  allVideos.forEach(video => {
    try {
      video.volume = volumeRatio;
      if (volumeRatio > 0 && video.muted) {
        video.muted = false;
      }
    } catch (e) {}
  });

  // 3. Update YouTube's internal localStorage & sessionStorage
  try {
    const volData = {
      volume: Math.round(targetPercent),
      muted: targetPercent === 0
    };
    const storageItem = JSON.stringify({
      data: JSON.stringify(volData),
      expiration: Date.now() + 30 * 24 * 3600 * 1000,
      creation: Date.now()
    });
    localStorage.setItem("yt-player-volume", storageItem);
    sessionStorage.setItem("yt-player-volume", storageItem);
  } catch (e) {}

  return { ok: true, volume: volumeRatio, muted: volumeRatio === 0 };
}

// --- Popup UI & Interaction Logic ---

const currentBox = document.getElementById("current");
const currentFill = document.querySelector(".current-fill");
const currentVolumeEl = document.getElementById("current-volume");
const statusEl = document.getElementById("status");
const customInput = document.getElementById("custom-percent");

let isDragging = false;

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function updateVisualLevel(percent) {
  currentBox.style.setProperty("--vol-percent", `${percent}%`);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runInPage(func, args) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return null;
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func,
      args: args || [],
    });
    return result ? result.result : null;
  } catch (err) {
    console.error("Script execution failed:", err);
    return null;
  }
}

async function refreshCurrentVolume() {
  if (isDragging) return;
  try {
    const result = await runInPage(pageGetVolume);
    if (result && result.ok) {
      const percent = result.volume * 100;
      currentVolumeEl.textContent =
        formatVolume(result.volume) + (result.muted ? " (muted)" : "");
      updateVisualLevel(percent);
      setStatus("");
    } else {
      currentVolumeEl.textContent = "—";
      setStatus("No video found in this tab.", true);
    }
  } catch (error) {
    currentVolumeEl.textContent = "—";
    setStatus("Open a YouTube video, then try again.", true);
  }
}

async function applyPercent(percent, showStatusMsg = true) {
  try {
    const result = await runInPage(pageSetVolume, [percent]);
    if (result && result.ok) {
      currentVolumeEl.textContent = formatVolume(result.volume);
      updateVisualLevel(result.volume * 100);
      if (showStatusMsg) {
        setStatus("Volume applied.");
      }
    } else {
      setStatus("No video found in this tab.", true);
    }
  } catch (error) {
    setStatus("Cannot change the volume on this page.", true);
  }
}

// Preset buttons
for (const button of document.querySelectorAll(".preset")) {
  button.addEventListener("click", () => {
    applyPercent(Number(button.dataset.percent));
  });
}

// Custom input form
document.getElementById("custom-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const percent = parsePercent(customInput.value);
  if (percent === null) {
    setStatus("Invalid value: enter a number between 0 and 100.", true);
    return;
  }
  applyPercent(percent);
});

// --- Mouse Drag / Slide Volume Scrubber on "Current Volume" ---

function getPercentFromMouse(event) {
  const rect = currentBox.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const rawPercent = (x / rect.width) * 100;
  const percent = Math.round(rawPercent);
  return Math.min(100, Math.max(0, percent));
}

currentBox.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  currentBox.classList.add("dragging");
  const percent = getPercentFromMouse(e);
  applyPercent(percent, false);
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const percent = getPercentFromMouse(e);
  applyPercent(percent, false);
});

window.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    currentBox.classList.remove("dragging");
    setStatus("Volume applied.");
  }
});

// Initial read on popup open
refreshCurrentVolume();

// Live poll while popup is open
const pollInterval = setInterval(refreshCurrentVolume, 500);
window.addEventListener("unload", () => clearInterval(pollInterval));
