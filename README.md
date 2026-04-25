# APlayer

APlayer is a fast, offline-first local MP3 player built as a Progressive Web App (PWA). Featuring a strict terminal aesthetic, powerful audio processing, and zero tracking, it runs entirely in your browser using local files — no accounts, no cloud, no internet required after install.

## Features

### Playback
- Supports MP3, FLAC, OGG, WAV, AAC, and M4A formats.
- Includes shuffle and repeat modes (off, repeat one, repeat all) for custom listening sessions.
- Standard previous, play/pause, and next playback controls.
- Interactive seek bar displaying both elapsed and total track time.
- Fully mapped keyboard shortcuts: Space (play/pause), Arrow keys (seek / volume), and M (mute).
- Media Session API integration enables hardware media keys, lock screen, and OS notification controls.

### Library
- Load an entire directory of music recursively via the File System Access API (Chrome/Edge desktop).
- Fallback to loading individual files manually (supports all browsers including Firefox and mobile).
- Recently opened folders are remembered via IndexedDB and can be reloaded with a single click.
- Real-time library search instantly filters tracks by title or artist.
- Independent Sort (Artist, Type, Length, Quality) and Order (A→Z, Z→A, Shortest first, Longest first, Artist A→Z, Artist Z→A) controls for precise organization.
- Sorting by Length groups tracks and renders section headers directly in the track list (e.g., 0–1 MIN, 1–2 MIN).
- Tracks are identified by their filename using the format `Artist Name - Track Title.ext` without relying on slow ID3 tag parsing.

### Playlists
- Create new playlists, rename them, and delete them at will.
- Quickly add tracks to any playlist using the right-click context menu.
- Remove tracks while viewing a specific playlist.
- Export individual playlists as standalone `.json` files.
- Load entire folders of `.json` playlist files at once (desktop).
- Load individual `.json` playlist files manually on any browser.
- Export all playlists together into a single backup `.json` file.
- Import a single backup `.json` with a prompt to either merge with or replace existing playlists.
- Playlist IDs are stable (generated from a hash of the filename) ensuring exported playlists remain valid across different sessions and devices.
- The active playlist is clearly indicated in a breadcrumb bar below the search input, and the page title updates dynamically.

### Audio Processing
- Adjustable stereo width control (0.0 mono → 1.0 original → 2.0 wide) powered by a custom Web Audio API mid-side matrix.
- Robust loudness control with three switchable modes:
  - OFF: Audio plays completely unmodified.
  - NORMALIZE: Analyzes each track's RMS loudness upon load (first 30 seconds) and applies a calculated per-track gain, matching the volume across your entire library.
  - LIMIT: Engages a real-time brick-wall limiter (DynamicsCompressorNode) to cleanly catch and squash sudden volume peaks within a single track.
- All audio processing is efficiently routed through a single, persistent Web Audio API chain: `normalize gain → limiter → stereo width → output`.

### Appearance
- Unapologetic terminal and developer aesthetic using the Cascadia Code font, sharp square corners, and zero glassmorphism or blur effects.
- Dark theme base dynamically styled by a single, global accent color.
- Choose from 8 built-in accent color presets: Terminal Green, Amber, Cyan, Red, Lavender, Rose, Gold, and White.
- Advanced color pickers allow custom selection for the accent color, main text, and dim text.
- All theme customizations are persisted to localStorage and applied immediately on reload.

### PWA & Offline
- Fully installable as a native-feeling Progressive Web App on desktop (Chrome/Edge) and mobile (iOS Safari, Android Chrome).
- A service worker caches the core app shell files (`index.html`, `app.js`, `manifest.json`), guaranteeing instant offline availability after the initial load.
- Because audio files are loaded locally from the user's file system, zero network connection is required for playback at any time.

### Mobile
- Features a fully responsive, mobile-specific layout that radically adapts the UI rather than simply scaling down the desktop view.
- A persistent bottom tab bar enables swift navigation between LIB, PLAYLISTS, SETTINGS, and HELP.
- The compact player bar sits directly above the tab bar and expands into a full-screen Now Playing sheet when tapped.
- Intuitive swipe gestures: swipe down on the Now Playing sheet to dismiss it, or swipe left/right across it to skip tracks.
- Long-pressing a track in the library automatically enters a multi-select mode exposing checkboxes.
- The iOS Web Audio context requirement is seamlessly unlocked on the first user interaction.

### Configuration
- Export a `config.json` file containing your volume level and custom theme colors.
- Import a `config.json` file to instantly restore your visual and audio preferences.
- A dedicated Danger Zone button clears all localStorage settings and IndexedDB folder handles with one click (does not affect actual audio files).

## File Naming Convention

APlayer derives track metadata entirely from filenames, expecting the format `Artist Name - Track Title.ext` separated by a space-hyphen-space.

```text
Daft Punk - Get Lucky.mp3
Aphex Twin - Avril 14th.flac
The Prodigy - Firestarter.wav
```

## Playlist Format

Each playlist is saved as a plain `.json` file where the filename itself (minus the extension) dictates the playlist name inside the app. The standard format is a flat array of deterministic track IDs strings.

```json
[
  "a3f9bc12",
  "d84e1f77",
  "cc029a31"
]
```
Alternatively, for bulk backups, a playlist file can contain an object where each key is a playlist name mapped to an array of IDs (e.g., `{"Chill Evening": ["a3f9bc12", "d84e1f77"]}`).

## Getting Started

### Requirements
Any modern web browser. Python 3 or Node.js is required to run a local HTTP server (browsers restrict service workers and local file access over the `file://` protocol).

### Run locally
```bash
git clone https://github.com/yourusername/APlayer.git
cd APlayer
python3 -m http.server 8080
```
Then open http://localhost:8080 in Chrome or Edge.

### Install as PWA
Desktop: Click the install icon (⊕ or a computer monitor icon) in the right side of the Chrome/Edge address bar after opening the local server URL.
Mobile iOS: Open the URL in Safari (use your local network IP) → Tap Share → Add to Home Screen.
Mobile Android: Open the URL in Chrome → Open the three-dot menu → Install App / Add to Home Screen.

## Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari iOS |
|---|---|---|---|---|
| Open Folder | ✓ | ✓ | ✗ | ✗ |
| Select Files | ✓ | ✓ | ✓ | ✓ |
| PWA Install | ✓ | ✓ | ✗ | ✓ |
| Audio Playback | ✓ | ✓ | ✓ | ✓ |
| Stereo Width | ✓ | ✓ | ✓ | ✓ |

## Stack

APlayer is contained in exactly four files with zero build tools, bundlers, or heavy frameworks.
- Vanilla JS (ES2020+)
- Web Audio API
- File System Access API
- IndexedDB
- Service Worker
- Lucide icons (CDN)
- Cascadia Code (Google Fonts)

## License

GPL-3.0. See LICENSE file.
