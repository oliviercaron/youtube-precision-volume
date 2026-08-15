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

// --- Functions injected into the YouTube page (runs in MAIN world) ---

function pageGetVolume() {
  const video = document.querySelector("video");
  if (video) {
    return { ok: true, volume: video.volume, muted: video.muted };
  }
  const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
  if (player && typeof player.getVolume === "function") {
    return {
      ok: true,
      volume: player.getVolume() / 100,
      muted: typeof player.isMuted === "function" ? player.isMuted() : false
    };
  }
  return { ok: false };
}

function pageSetVolume(targetPercent) {
  const volumeRatio = Math.min(1, Math.max(0, targetPercent / 100));
  const video = document.querySelector("video");
  const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");

  if (!video && !player) {
    return { ok: false };
  }

  // 1. Store target precision volume on window
  window.__ytPrecisionVolume = volumeRatio;

  // 2. Set HTML5 video element volume
  if (video) {
    video.volume = volumeRatio;
    if (volumeRatio > 0 && video.muted) {
      video.muted = false;
    }
  }

  // 3. Inform YouTube's internal player API
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

  // 4. Update YouTube's internal localStorage & sessionStorage
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

  // 5. Attach active lock listener
  if (video && !video.__ytPrecisionLockAttached) {
    video.__ytPrecisionLockAttached = true;
    video.addEventListener("volumechange", () => {
      if (window.__ytPrecisionVolume !== undefined) {
        if (Math.abs(video.volume - window.__ytPrecisionVolume) > 0.00001) {
          if (!window.__ytPrecisionLocking) {
            window.__ytPrecisionLocking = true;
            video.volume = window.__ytPrecisionVolume;
            setTimeout(() => {
              window.__ytPrecisionLocking = false;
            }, 30);
          }
        }
      }
    });
  }

  return { ok: true, volume: video ? video.volume : volumeRatio };
}

// --- Popup UI & Interaction Logic ---

const currentBox = document.getElementById("current");
const currentFill = document.querySelector(".current-fill");
const currentVolumeEl = document.getElementById("current-volume");
const statusEl = document.getElementById("status");
const customInput = document.getElementById("custom-percent");

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
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func,
    args: args || [],
  });
  return result ? result.result : null;
}

async function refreshCurrentVolume() {
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

let isDragging = false;

function getPercentFromMouse(event) {
  const rect = currentBox.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const rawPercent = (x / rect.width) * 100;
  // Round to nearest integer for intuitive smooth dragging
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

refreshCurrentVolume();
