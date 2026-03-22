# 🎵 FH's Web MP3 Player

A fully offline, single-file web music player. No installs, no servers, no accounts — just open the HTML file in your browser and play your local music.

---

## ✨ Features

### 🎧 Playback
- Plays **MP3, OGG, and WAV** files
- Play, pause, previous, next controls
- Seekable progress bar with live timestamps
- Volume slider
- **Shuffle** mode — randomises the play queue
- **Repeat One** mode — loops the current track indefinitely

### 📂 Music Loading
- **Folder Picker** (Chrome / Edge / Safari) — open an entire music folder in one click; the app remembers it for next time
- **File Select fallback** (Firefox / all browsers) — manually select individual audio files
- **Unlimited recent folders** — saved to IndexedDB, reload any previous folder with a single browser permission tap
- Automatic artist/title parsing from filenames using the `Artist - Title.mp3` convention
- Duration analysis runs in the background after the initial scan

### 📋 Playlists
- Create, rename-by-delete-and-recreate, and delete playlists from the sidebar
- Add tracks via right-click context menu; supports multi-select
- Remove tracks from a playlist via right-click while viewing it
- **Playlists are saved to `localStorage`** — they persist across sessions automatically
- **Playlist folder sync** — point the app at a folder and every playlist create/edit/delete is mirrored as an individual `PlaylistName.json` file in real time
- Import playlist folders (re-scans all `.json` files in a folder)
- Import individual `.json` files (single playlist array or multi-playlist object format)
- Export / backup via "View & Copy Playlist Data" or clipboard paste

### 🔍 Library
- **Search** by song name or artist (live filtering)
- **Sort** by: Alphabetical, Length, File Format
- **Reverse order** toggle
- Track count display
- Multi-select with `Ctrl/Cmd + Click` and range-select with `Shift + Click`
- Right-click context menu on any selection

### ⌨️ Keyboard Shortcuts
| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `→` Arrow Right | Skip forward 5 seconds |
| `←` Arrow Left | Skip backward 5 seconds |
| `Ctrl/Cmd + Click` | Multi-select tracks |
| `Shift + Click` | Select a range of tracks |

### 📱 Responsive Design
- Full desktop layout with a floating player bar
- Mobile layout with a slide-in sidebar and fixed bottom player bar
- Track list adapts to smaller screens (hides file type and duration columns)

---

## 🚀 Getting Started

### Option A — Open directly (simplest)
1. Download `audio_player.html`
2. Double-click to open in your browser
3. Go to **Settings → Open Music Folder** and select your music directory

> **Note:** Opening as a `file://` URL blocks the `config.json` fetch due to browser security. The app falls back to a default volume of `0.5` — everything else works fine.

### Option B — Serve locally (recommended for full config support)
```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .
```
Then open `http://localhost:8080` in your browser.

---

## ⚙️ Configuration

Create a `config.json` in the same directory as `audio_player.html`:

```json
{
  "default_volume": 0.7
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `default_volume` | `float` | `0.5` | Volume on startup. Range: `0.0` – `1.0` |

---

## 📁 Filename Convention

The player parses artist and track name directly from filenames:

```
Artist - Song Title.mp3   →   Artist: "Artist",  Title: "Song Title"
Just A Song.mp3           →   Artist: "",         Title: "Just A Song"
```

---

## 🗂 Playlist File Format

Each playlist is stored as a `.json` file containing an array of track names (without extension):

```json
[
  "Artist - Song One",
  "Artist - Song Two",
  "Another Artist - Song Three"
]
```

A multi-playlist export (from "View & Copy Playlist Data") uses an object format:

```json
{
  "My Playlist": ["Artist - Song One", "Artist - Song Two"],
  "Chill Mix":   ["Another Artist - Song Three"]
}
```

---

## 🌐 Browser Compatibility

| Feature | Chrome | Edge | Safari | Firefox |
|---|---|---|---|---|
| Basic playback | ✅ | ✅ | ✅ | ✅ |
| Folder picker (FSA) | ✅ | ✅ | ✅ 15.2+ | ❌ |
| Remember folders (IndexedDB) | ✅ | ✅ | ✅ | ✅ |
| Playlist file write-back | ✅ | ✅ | ✅ 15.2+ | ❌ |
| File select fallback | ✅ | ✅ | ✅ | ✅ |

Firefox users can still use the manual file select and import/export playlists via file picker or clipboard.

---

## 📂 Repository Structure

```
/
├── audio_player.html   # The entire application
├── config.json         # Optional startup configuration
└── README.md
```

---

## 📄 License

This project is released for personal use. Feel free to fork, modify, and build on it.
 
