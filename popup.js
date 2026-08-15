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

// 0.001 -> "0.1%" (up to 4 decimals, trailing zeros removed)
function formatVolume(volume) {
  const percent = volume * 100;
  const text = percent.toFixed(4).replace(/\.?0+$/, "");
  return (text === "" ? "0" : text) + "%";
}

// --- Functions injected into the YouTube page (runs in MAIN world) ---
// They are serialized by chrome.scripting.executeScript, so they must only
// reference the page, never the popup scope.

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

  // 1. Store target precision volume on window so listeners can enforce it
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

  // 5. Attach an active volume lock listener to prevent YouTube's background sync from resetting it
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

// --- Popup logic ---

const currentVolumeEl = document.getElementById("current-volume");
const statusEl = document.getElementById("status");
const customInput = document.getElementById("custom-percent");

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
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
      currentVolumeEl.textContent =
        formatVolume(result.volume) + (result.muted ? " (muted)" : "");
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

async function applyPercent(percent) {
  try {
    const result = await runInPage(pageSetVolume, [percent]);
    if (result && result.ok) {
      currentVolumeEl.textContent = formatVolume(result.volume);
      setStatus("Volume applied.");
    } else {
      setStatus("No video found in this tab.", true);
    }
  } catch (error) {
    setStatus("Cannot change the volume on this page.", true);
  }
}

for (const button of document.querySelectorAll(".preset")) {
  button.addEventListener("click", () => {
    applyPercent(Number(button.dataset.percent));
  });
}

document.getElementById("custom-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const percent = parsePercent(customInput.value);
  if (percent === null) {
    setStatus("Invalid value: enter a number between 0 and 100.", true);
    return;
  }
  applyPercent(percent);
});

refreshCurrentVolume();
