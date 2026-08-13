# YouTube Precision Volume

A tiny Chrome extension to set the volume of YouTube videos with real precision, down to 0.01%. Useful when even the lowest step of YouTube's slider is still too loud.

<img src="screenshot.png" alt="Extension popup" width="290">

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.

## Use

Open a YouTube video, click the extension icon, then pick a preset or type your own percentage. The value is applied straight to the page's video element: 0.1% sets `video.volume = 0.001`.

Plain HTML, CSS and JavaScript. No frameworks, no tracking, no network requests. Only two permissions: `activeTab` and `scripting`.

## License

[MIT](LICENSE)
