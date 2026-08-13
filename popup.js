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

// --- Functions injected into the YouTube page ---
// They are serialized by chrome.scripting.executeScript, so they must only
// reference the page, never the popup scope.

function pageGetVolume() {
  const video = document.querySelector("video");
  if (!video) {
    return { ok: false };
  }
  return { ok: true, volume: video.volume, muted: video.muted };
}

function pageSetVolume(volume) {
  const video = document.querySelector("video");
  if (!video) {
    return { ok: false };
  }
  video.volume = volume;
  if (volume > 0 && video.muted) {
    video.muted = false;
  }
  return { ok: true, volume: video.volume };
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
  if (!tab) {
    return null;
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
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
    const result = await runInPage(pageSetVolume, [percentToVolume(percent)]);
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
