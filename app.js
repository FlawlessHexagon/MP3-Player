const state = {
  library: [],
  activeQueue: [],
  playQueue: [],
  playlists: {},
  selectedIds: new Set(),
  currentTrackId: null,
  isPlaying: false,
  isShuffled: false,
  repeatMode: 'none', // 'none' | 'one' | 'all'
  currentView: 'library',
  sortCategory: 'Artist',
  sortOrder: 'A→Z',
  isMobile: false,
  selectMode: false,
  stereoWidth: 1.0,
  loudnessMode: 'OFF',
  analyzedCount: 0
};

const SORT_CATEGORIES = ['Artist', 'Type', 'Length', 'Quality'];
const SORT_ORDERS = ['A→Z', 'Z→A', 'Shortest first', 'Longest first', 'Artist A→Z', 'Artist Z→A'];

const audio = new Audio();
let idb;

// Web Audio API Globals
let audioCtx = null;
let sourceNode = null;
let normalizeGainNode = null;
let compressorNode = null;
let splitter = null;
let widthGain = null;

function initWebAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioCtx = new AudioContext();
  sourceNode = audioCtx.createMediaElementSource(audio);

  normalizeGainNode = audioCtx.createGain();
  
  compressorNode = audioCtx.createDynamicsCompressor();
  compressorNode.threshold.value = -3;
  compressorNode.knee.value = 0;
  compressorNode.ratio.value = 20;
  compressorNode.attack.value = 0.001;
  compressorNode.release.value = 0.1;

  splitter = audioCtx.createChannelSplitter(2);

  sourceNode.connect(normalizeGainNode);
  updateLoudnessRouting();

  const mid = audioCtx.createGain(); mid.gain.value = 1;
  const side = audioCtx.createGain(); side.gain.value = 1;
  const invert = audioCtx.createGain(); invert.gain.value = -1;

  // Mid = L + R
  splitter.connect(mid, 0); // L
  splitter.connect(mid, 1); // R

  // Side = L - R
  splitter.connect(side, 0); // L
  splitter.connect(invert, 1); // R -> inverted
  invert.connect(side);

  // Apply stereo width to Side
  widthGain = audioCtx.createGain();
  widthGain.gain.value = state.stereoWidth;
  side.connect(widthGain);

  const merger = audioCtx.createChannelMerger(2);

  // L out = Mid + Side
  mid.connect(merger, 0, 0);
  widthGain.connect(merger, 0, 0);

  // R out = Mid - Side
  const invertSide = audioCtx.createGain();
  invertSide.gain.value = -1;
  widthGain.connect(invertSide);
  mid.connect(merger, 0, 1);
  invertSide.connect(merger, 0, 1);

  // 0.5 Master Gain to prevent +6dB clipping from the Mid/Side math
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.5;
  
  merger.connect(masterGain);
  masterGain.connect(audioCtx.destination);
}

function updateLoudnessRouting() {
  if (!normalizeGainNode) return;
  
  try { normalizeGainNode.disconnect(); } catch(e){}
  try { compressorNode.disconnect(); } catch(e){}

  if (state.loudnessMode === 'LIMIT') {
    normalizeGainNode.connect(compressorNode);
    compressorNode.connect(splitter);
  } else {
    normalizeGainNode.connect(splitter);
  }
}

function setStereoWidth(val) {
  const w = Math.max(0, Math.min(2, parseFloat(val)));
  state.stereoWidth = w;
  if (widthGain) widthGain.gain.value = w;
  
  const str = w.toFixed(2);
  const progressPct = `${(w / 2) * 100}%`;
  
  const pbWidth = document.getElementById('pb-width');
  if (pbWidth) {
     pbWidth.value = w;
     pbWidth.style.setProperty('--range-progress', progressPct);
  }
  
  const setWidth = document.getElementById('settings-width');
  if (setWidth) {
     setWidth.value = w;
     setWidth.style.setProperty('--range-progress', progressPct);
  }
  
  const pbLabel = document.getElementById('pb-width-label');
  if (pbLabel) pbLabel.innerText = `WIDTH ${str}`;
  
  const setLabel = document.getElementById('settings-width-label');
  if (setLabel) setLabel.innerText = `Width: ${str}`;
  
  localStorage.setItem('tp-width', w);
}

function setLoudnessMode(mode) {
  state.loudnessMode = mode;
  localStorage.setItem('tp-loudness-mode', mode);

  document.querySelectorAll('.loud-btn').forEach(b => b.classList.remove('active'));
  if (mode === 'OFF') document.getElementById('btn-loud-off').classList.add('active');
  if (mode === 'NORMALIZE') document.getElementById('btn-loud-norm').classList.add('active');
  if (mode === 'LIMIT') document.getElementById('btn-loud-limit').classList.add('active');

  updateLoudnessRouting();
  updateLoudnessStatus();

  const currentTrack = state.library.find(t => t.id === state.currentTrackId);
  applyNormalizeGain(currentTrack);

  if (mode === 'NORMALIZE') {
    analyzeTracks();
  }
}

function updateLoudnessStatus() {
  const status = document.getElementById('loudness-status');
  if (state.loudnessMode === 'OFF') {
    status.style.display = 'none';
  } else if (state.loudnessMode === 'LIMIT') {
    status.style.display = 'block';
    status.innerText = 'Real-time peak limiter active';
  } else if (state.loudnessMode === 'NORMALIZE') {
    status.style.display = 'block';
    const total = state.library.length;
    const analyzed = state.library.filter(t => t.normalizeGain !== undefined).length;
    if (total === 0) {
      status.innerText = 'No tracks loaded';
    } else if (analyzed < total) {
      status.innerText = `Analyzing: ${analyzed} / ${total}`;
    } else {
      status.innerText = '✓ All tracks analyzed';
    }
  }
}

function applyNormalizeGain(track) {
  if (!normalizeGainNode) return;
  if (state.loudnessMode === 'NORMALIZE' && track && track.normalizeGain !== undefined) {
    normalizeGainNode.gain.value = track.normalizeGain;
  } else {
    normalizeGainNode.gain.value = 1.0;
  }
}

let isAnalyzing = false;
async function analyzeTracks() {
  if (state.loudnessMode !== 'NORMALIZE' || isAnalyzing) return;
  isAnalyzing = true;
  
  const unanalyzed = state.library.filter(t => t.normalizeGain === undefined);
  let done = state.library.length - unanalyzed.length;
  updateLoudnessStatus();

  for (const t of unanalyzed) {
    if (state.loudnessMode !== 'NORMALIZE') break;
    try {
      const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await t.file.arrayBuffer();
      const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
      tempCtx.close();

      const length = Math.min(audioBuffer.length, audioBuffer.sampleRate * 30);
      let sumSquares = 0;
      let totalSamples = 0;
      
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const data = audioBuffer.getChannelData(c);
        for (let i = 0; i < length; i++) {
          sumSquares += data[i] * data[i];
          totalSamples++;
        }
      }
      
      const rms = Math.sqrt(sumSquares / totalSamples);
      let gain = 1.0;
      if (rms > 0) {
        gain = 0.1 / rms;
        gain = Math.max(0.1, Math.min(6.0, gain));
      }
      t.normalizeGain = gain;
    } catch (err) {
      console.error('Failed to analyze', t.title, err);
      t.normalizeGain = 1.0; 
    }
    
    done++;
    state.analyzedCount = done;
    updateLoudnessStatus();

    if (state.currentTrackId === t.id) applyNormalizeGain(t);
  }
  isAnalyzing = false;
}

// IndexedDB Wrapper
const DB_NAME = 'TerminalPlayerDB';
const STORE_NAME = 'folders';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = e => { idb = e.target.result; resolve(); };
    request.onerror = e => reject(e.target.error);
  });
}

function idbGet(key) {
  return new Promise(resolve => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idbSet(key, value) {
  return new Promise(resolve => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: key, ...value });
    tx.oncomplete = () => resolve();
  });
}

function idbDelete(key) {
  return new Promise(resolve => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
  });
}

function idbGetAll() {
  return new Promise(resolve => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

// Utils
const formatTime = secs => {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const parseDuration = str => {
  if (str === '--:--') return 0;
  const p = str.split(':').map(Number);
  return p[0] * 60 + p[1];
};

function getDurationBucket(dur) {
  if (dur < 60) return { val: 0, label: '0–1 MIN' };
  if (dur < 120) return { val: 1, label: '1–2 MIN' };
  if (dur < 180) return { val: 2, label: '2–3 MIN' };
  if (dur < 300) return { val: 3, label: '3–5 MIN' };
  return { val: 4, label: '5+ MIN' };
}

function getQualityRank(format) {
  const f = format.toLowerCase();
  if (f === 'flac' || f === 'wav') return 1;
  if (f === 'mp3') return 2;
  return 3;
}

function stableId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// UI Rendering
function renderSidebar() {
  const list = document.getElementById('sidebar-playlists');
  list.innerHTML = '';
  Object.keys(state.playlists).forEach(name => {
    const div = document.createElement('div');
    div.className = `nav-item ${state.currentView === 'playlist:' + name ? 'active' : ''}`;
    div.innerHTML = `
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" class="playlist-label">
        <i data-lucide="list-music" style="width:14px; height:14px; margin-right:8px; vertical-align:-2px;"></i>${name}
      </span>
      <div style="display:flex; gap:5px;">
        <button class="export-playlist" data-name="${name}" style="padding:2px; border:none; color:var(--text-dim);"><i data-lucide="download" style="width:14px;height:14px;"></i></button>
        <button class="delete-playlist" data-name="${name}" style="padding:2px; border:none; color:#ff4444;"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
      </div>`;
    div.onclick = (e) => {
      const target = e.target.closest('button');
      if (target && target.classList.contains('delete-playlist')) return deletePlaylist(name);
      if (target && target.classList.contains('export-playlist')) return exportSinglePlaylist(name);
      switchView('playlist:' + name);
    };
    list.appendChild(div);
  });
  lucide.createIcons();
}

function switchView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));

  const isPlaylist = viewName.startsWith('playlist:');
  const bBar = document.getElementById('breadcrumb-bar');
  
  if (isPlaylist) {
    bBar.style.display = 'flex';
    document.getElementById('breadcrumb-playlist-name').innerText = viewName.split(':')[1];
    document.title = `Audio Player — ${viewName.split(':')[1]}`;
  } else {
    bBar.style.display = 'none';
    if (viewName === 'library') document.title = "Audio Player";
    else if (viewName === 'settings') document.title = "Audio Player — Settings";
    else if (viewName === 'help') document.title = "Audio Player — Help";
  }

  if (viewName === 'settings') {
    document.getElementById('view-settings').classList.add('active');
    document.querySelector('.nav-item[data-view="settings"]')?.classList.add('active');
    document.querySelector('.tab-item[data-view="settings"]')?.classList.add('active');
  } else if (viewName === 'help') {
    document.getElementById('view-help').classList.add('active');
    document.querySelector('.nav-item[data-view="help"]')?.classList.add('active');
    document.querySelector('.tab-item[data-view="help"]')?.classList.add('active');
  } else if (viewName === 'playlists-mobile') {
    document.getElementById('tab-playlists').classList.add('active');
    renderSidebar(); 
    const list = document.getElementById('track-list');
    list.innerHTML = `<div style="padding: 20px; color: var(--accent); font-weight:700;">PLAYLISTS</div>`;
    Object.keys(state.playlists).forEach(name => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.innerHTML = `<div style="grid-column:1/-1; display:flex; justify-content:space-between;"><span>${name}</span><span style="color:#ff4444;" onclick="event.stopPropagation();deletePlaylist('${name}')">DEL</span></div>`;
      row.onclick = () => switchView('playlist:' + name);
      list.appendChild(row);
    });
    document.getElementById('view-library').classList.add('active');
  } else {
    document.getElementById('view-library').classList.add('active');
    if (viewName === 'library') {
      document.querySelector('.nav-item[data-view="library"]')?.classList.add('active');
      document.querySelector('.tab-item[data-view="library"]')?.classList.add('active');
    } else if (isPlaylist) {
      document.getElementById('tab-playlists')?.classList.add('active');
      document.querySelector(`.nav-item[data-view="library"]`)?.classList.remove('active');
    }
    renderLibrary();
  }
}

function renderLibrary() {
  const list = document.getElementById('track-list');
  list.innerHTML = '';
  
  let source = state.library;
  if (state.currentView.startsWith('playlist:')) {
    const plName = state.currentView.split(':')[1];
    const trackIds = state.playlists[plName] || [];
    source = trackIds.map(id =>
      state.library.find(t => t.id === id) ||
      state.library.find(t => stableId(t.name) === id)
    ).filter(Boolean);
  }

  const query = document.getElementById('search-input').value.toLowerCase();
  let filtered = source.filter(t => t.title.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query));

  filtered.sort((a, b) => {
    let primary = 0;
    if (state.sortCategory === 'Artist') primary = a.artist.localeCompare(b.artist);
    else if (state.sortCategory === 'Type') primary = a.format.localeCompare(b.format);
    else if (state.sortCategory === 'Quality') primary = getQualityRank(a.format) - getQualityRank(b.format);
    else if (state.sortCategory === 'Length') {
      const bA = getDurationBucket(parseDuration(a.durationLabel));
      const bB = getDurationBucket(parseDuration(b.durationLabel));
      primary = bA.val - bB.val;
    }

    if (primary !== 0) return primary;

    let secondary = 0;
    const durA = parseDuration(a.durationLabel);
    const durB = parseDuration(b.durationLabel);

    if (state.sortOrder === 'A→Z') secondary = a.title.localeCompare(b.title);
    else if (state.sortOrder === 'Z→A') secondary = b.title.localeCompare(a.title);
    else if (state.sortOrder === 'Shortest first') secondary = durA - durB;
    else if (state.sortOrder === 'Longest first') secondary = durB - durA;
    else if (state.sortOrder === 'Artist A→Z') secondary = a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
    else if (state.sortOrder === 'Artist Z→A') secondary = b.artist.localeCompare(a.artist) || b.title.localeCompare(a.title);

    return secondary;
  });

  state.activeQueue = filtered;

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-dim);">No tracks found.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  let currentBucket = null;

  filtered.forEach((t, i) => {
    if (state.sortCategory === 'Length') {
      const b = getDurationBucket(parseDuration(t.durationLabel));
      if (currentBucket !== b.val) {
        currentBucket = b.val;
        const header = document.createElement('div');
        header.className = 'group-header';
        header.innerHTML = b.label;
        frag.appendChild(header);
      }
    }

    const el = document.createElement('div');
    el.className = `track-row ${state.selectedIds.has(t.id) ? 'selected' : ''} ${state.currentTrackId === t.id ? 'playing' : ''}`;
    el.dataset.id = t.id;
    el.dataset.index = i;
    
    const isPlaying = state.currentTrackId === t.id;
    const indexHTML = state.isMobile && state.selectMode ? `<div class="mobile-checkbox"></div>` : `<span class="track-index">${isPlaying ? '▶ ' : i + 1}</span>`;
    
    el.innerHTML = `
      ${indexHTML}
      <div class="track-info-col">
        <div class="track-title">${t.title}</div>
        <div class="track-artist">${t.artist}</div>
      </div>
      <div class="track-format" style="font-size:11px; color:var(--text-dim); text-transform:uppercase;">${t.format}</div>
      <div style="font-size:11px; text-align:right;">${t.durationLabel}</div>
    `;

    // Events
    el.onclick = (e) => handleTrackClick(e, t, filtered);
    el.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e, t.id); };

    // Mobile long press
    let touchTimer;
    el.addEventListener('touchstart', (e) => {
      touchTimer = setTimeout(() => {
        state.selectMode = true;
        document.body.classList.add('mobile-select-mode');
        document.getElementById('btn-mobile-select').classList.add('active');
        handleTrackClick({ ctrlKey: true }, t, filtered); 
      }, 500);
    });
    el.addEventListener('touchmove', () => clearTimeout(touchTimer));
    el.addEventListener('touchend', () => clearTimeout(touchTimer));

    frag.appendChild(el);
  });
  list.appendChild(frag);
}

function handleTrackClick(e, track, contextList) {
  const id = track.id;
  if (e.metaKey || e.ctrlKey) {
    state.selectedIds.has(id) ? state.selectedIds.delete(id) : state.selectedIds.add(id);
  } else if (e.shiftKey && state.selectedIds.size > 0) {
    const allIds = contextList.map(t => t.id);
    const lastId = Array.from(state.selectedIds).pop();
    const start = allIds.indexOf(lastId);
    const end = allIds.indexOf(id);
    const [min, max] = [Math.min(start, end), Math.max(start, end)];
    for (let i = min; i <= max; i++) state.selectedIds.add(allIds[i]);
  } else {
    state.selectedIds.clear();
    state.selectedIds.add(id);
    if (e.detail === 2 && !state.isMobile) {
      playTrack(track, contextList);
    } else if (state.isMobile && !state.selectMode) {
      playTrack(track, contextList);
    }
  }
  renderLibrary();
}

// Playback Engine
function playTrack(track, queueSource = null) {
  if (!track) return;
  
  initWebAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  
  if (queueSource) {
    state.playQueue = [...queueSource];
    if (state.isShuffled) state.playQueue.sort(() => Math.random() - 0.5);
  }

  state.currentTrackId = track.id;
  if (track.file) {
    if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(track.file);
  }
  
  applyNormalizeGain(track);
  
  audio.play().then(() => {
    state.isPlaying = true;
    updatePlayerUI(track);
    updateMediaSession(track);
    renderLibrary();
  }).catch(e => console.error("Playback error", e));
}

function togglePlay() {
  if (!audio.src) return;
  
  initWebAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  
  if (audio.paused) { audio.play(); state.isPlaying = true; }
  else { audio.pause(); state.isPlaying = false; }
  updatePlayButtonUI();
}

function nextTrack(force = false) {
  if (!state.playQueue.length) return;
  if (state.repeatMode === 'one' && !force) {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  const idx = state.playQueue.findIndex(t => t.id === state.currentTrackId);
  if (idx === -1) return;
  let nextIdx = idx + 1;
  if (nextIdx >= state.playQueue.length) {
    if (state.repeatMode === 'all') nextIdx = 0;
    else return; // Stop at end of queue
  }
  playTrack(state.playQueue[nextIdx]);
}

function prevTrack() {
  if (!state.playQueue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const idx = state.playQueue.findIndex(t => t.id === state.currentTrackId);
  if (idx === -1) return;
  let prevIdx = idx - 1;
  if (prevIdx < 0) {
    if (state.repeatMode === 'all') prevIdx = state.playQueue.length - 1;
    else prevIdx = 0;
  }
  playTrack(state.playQueue[prevIdx]);
}

function toggleShuffle() {
  state.isShuffled = !state.isShuffled;
  document.getElementById('btn-shuffle').classList.toggle('active', state.isShuffled);
  document.getElementById('sheet-btn-shuffle').classList.toggle('active', state.isShuffled);
  if (state.isShuffled) {
    const current = state.playQueue.find(t => t.id === state.currentTrackId);
    state.playQueue.sort(() => Math.random() - 0.5);
    if (current) {
      state.playQueue = state.playQueue.filter(t => t.id !== current.id);
      state.playQueue.unshift(current);
    }
  } else {
    // Restore original sort order based on activeQueue (which honors current sort mode)
    const map = new Map(state.activeQueue.map((t, i) => [t.id, i]));
    state.playQueue.sort((a, b) => map.get(a.id) - map.get(b.id));
  }
}

function cycleRepeat() {
  const modes = ['none', 'one', 'all'];
  state.repeatMode = modes[(modes.indexOf(state.repeatMode) + 1) % modes.length];
  
  const icon = state.repeatMode === 'one' ? 'repeat-1' : 'repeat';
  const isActive = state.repeatMode !== 'none';
  
  const updateBtn = (id) => {
    const btn = document.getElementById(id);
    btn.classList.toggle('active', isActive);
    btn.innerHTML = `<i data-lucide="${icon}"></i>`;
  };
  updateBtn('btn-repeat');
  updateBtn('sheet-btn-repeat');
  lucide.createIcons();
}

// Audio Events
audio.addEventListener('timeupdate', () => {
  const pct = (audio.currentTime / audio.duration) * 100 || 0;
  const cStr = formatTime(audio.currentTime);
  const dStr = formatTime(audio.duration);
  
  const syncRange = (id, val, str1, str2) => {
    const el = document.getElementById(id);
    el.value = val;
    el.style.setProperty('--range-progress', `${val}%`);
    document.getElementById(id.replace('seek', 'time-cur')).innerText = str1;
    document.getElementById(id.replace('seek', 'time-dur')).innerText = str2;
  };
  syncRange('pb-seek', pct, cStr, dStr);
  syncRange('sheet-seek', pct, cStr, dStr);
});

audio.addEventListener('ended', () => nextTrack(false));

audio.addEventListener('loadedmetadata', () => {
  const track = state.library.find(t => t.id === state.currentTrackId);
  if (track && track.durationLabel === '--:--') {
    track.durationLabel = formatTime(audio.duration);
    renderLibrary();
  }
});

function updatePlayerUI(track) {
  document.getElementById('pb-title').innerText = track.title;
  document.getElementById('pb-artist').innerText = track.artist;
  document.getElementById('sheet-title').innerText = track.title;
  document.getElementById('sheet-artist').innerText = track.artist;
  updatePlayButtonUI();
}

function updatePlayButtonUI() {
  const icon = state.isPlaying ? 'pause' : 'play';
  document.getElementById('btn-play').innerHTML = `<i data-lucide="${icon}"></i>`;
  document.getElementById('sheet-btn-play').innerHTML = `<i data-lucide="${icon}" style="width:32px;height:32px;"></i>`;
  lucide.createIcons();
}

function updateMediaSession(track) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'Audio Player',
      artwork: []
    });
  }
}

function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  }
}

// File Loading
async function scanDirectory(dirHandle, path = '') {
  const files = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const ext = entry.name.split('.').pop().toLowerCase();
      if (['mp3', 'flac', 'ogg', 'wav', 'aac', 'm4a'].includes(ext)) {
        files.push(await entry.getFile());
      }
    } else if (entry.kind === 'directory') {
      files.push(...await scanDirectory(entry, path + entry.name + '/'));
    }
  }
  return files;
}

function parseFile(file) {
  const nameNoExt = file.name.substring(0, file.name.lastIndexOf('.'));
  const parts = nameNoExt.split(' - ');
  const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : nameNoExt;
  const artist = parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
  return {
    id: stableId(file.name),
    name: file.name,
    title,
    artist,
    format: file.name.split('.').pop().toLowerCase(),
    durationLabel: '--:--',
    file,
    src: null
  };
}

async function handleDesktopFSA() {
  try {
    const handle = await window.showDirectoryPicker();
    document.getElementById('current-folder-name').innerText = handle.name;
    const files = await scanDirectory(handle);
    loadFiles(files);
    await idbSet(handle.name, { handle, date: Date.now() });
    renderRecentFolders();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

function handleMobileFiles(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  document.getElementById('mobile-file-count').innerText = `${files.length} files loaded`;
  loadFiles(files);
}

function loadFiles(files) {
  state.library = files.map(parseFile);
  switchView('library');
  
  // async load durations
  state.library.forEach(async t => {
    const url = URL.createObjectURL(t.file);
    const tempAudio = new Audio(url);
    tempAudio.onloadedmetadata = () => {
      t.durationLabel = formatTime(tempAudio.duration);
      URL.revokeObjectURL(url);
      if (state.currentView === 'library') renderLibrary();
    };
  });
  
  if (state.loudnessMode === 'NORMALIZE') {
    analyzeTracks();
  }
}

async function renderRecentFolders() {
  const list = document.getElementById('recent-folders-list');
  list.innerHTML = '';
  const folders = await idbGetAll();
  folders.sort((a,b) => b.date - a.date).forEach(f => {
    const div = document.createElement('div');
    div.className = 'settings-row';
    div.style.padding = '5px 0';
    div.innerHTML = `
      <span style="font-size:13px; color:var(--text);"><i data-lucide="folder" style="width:14px;height:14px;margin-right:6px;vertical-align:-2px;"></i>${f.id}</span>
      <div style="display:flex; gap:10px;">
        <button class="btn-reload" data-id="${f.id}" style="padding:2px 6px;"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i></button>
        <button class="btn-remove" data-id="${f.id}" style="padding:2px 6px; border-color:#ff4444; color:#ff4444;"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
      </div>
    `;
    div.querySelector('.btn-reload').onclick = async () => {
      try {
        const perm = await f.handle.requestPermission({mode: 'read'});
        if (perm === 'granted') {
          const files = await scanDirectory(f.handle);
          loadFiles(files);
          document.getElementById('current-folder-name').innerText = f.handle.name;
        }
      } catch (e) { console.error(e); alert("Folder moved or deleted."); }
    };
    div.querySelector('.btn-remove').onclick = async () => {
      await idbDelete(f.id);
      renderRecentFolders();
    };
    list.appendChild(div);
  });
  lucide.createIcons();
}

// Playlists
function savePlaylistsToStorage() {
  localStorage.setItem('tp-playlists', JSON.stringify(state.playlists));
}

function loadPlaylistsFromStorage() {
  try {
    state.playlists = JSON.parse(localStorage.getItem('tp-playlists')) || {};
  } catch { state.playlists = {}; }
}

function createPlaylist(name) {
  if (!name || state.playlists[name]) return;
  state.playlists[name] = [];
  savePlaylistsToStorage();
  renderSidebar();
}

function deletePlaylist(name) {
  if (!confirm(`Delete playlist ${name}?`)) return;
  delete state.playlists[name];
  savePlaylistsToStorage();
  if (state.currentView === 'playlist:' + name) switchView('library');
  renderSidebar();
}

function addTracksToPlaylist(name, trackIds) {
  if (!state.playlists[name]) return;
  const current = new Set(state.playlists[name]);
  trackIds.forEach(id => current.add(id));
  state.playlists[name] = Array.from(current);
  savePlaylistsToStorage();
}

function removeTracksFromPlaylist(name, trackIds) {
  if (!state.playlists[name]) return;
  const toRemove = new Set(trackIds);
  state.playlists[name] = state.playlists[name].filter(id => !toRemove.has(id));
  savePlaylistsToStorage();
  renderLibrary();
}

// Playlist Folder & File Parsers
async function parsePlaylistFileContent(text, filename) {
  try {
    const data = JSON.parse(text);
    const baseName = filename.replace(/\.json$/i, '');
    let count = 0;
    if (Array.isArray(data)) {
      state.playlists[baseName] = data;
      count = 1;
    } else if (typeof data === 'object') {
      for (const key in data) {
        if (Array.isArray(data[key])) {
          state.playlists[key] = data[key];
          count++;
        }
      }
    }
    return count;
  } catch (e) {
    console.error('Failed to parse playlist:', filename);
    return 0;
  }
}

async function handlePlaylistFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    let loadedCount = 0;
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
        const file = await entry.getFile();
        const text = await file.text();
        loadedCount += await parsePlaylistFileContent(text, entry.name);
      }
    }
    const status = document.getElementById('playlist-folder-status');
    status.innerText = loadedCount > 0 ? `✓ ${loadedCount} playlist(s) loaded` : 'No valid playlists found';
    if (loadedCount > 0) {
      savePlaylistsToStorage();
      renderSidebar();
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

async function handlePlaylistFiles(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  let loadedCount = 0;
  for (const file of files) {
    const text = await file.text();
    loadedCount += await parsePlaylistFileContent(text, file.name);
  }
  const status = document.getElementById('playlist-files-status');
  status.innerText = loadedCount > 0 ? `✓ ${loadedCount} playlist(s) loaded` : 'No valid playlists found';
  if (loadedCount > 0) {
    savePlaylistsToStorage();
    renderSidebar();
  }
  e.target.value = '';
}

function exportSinglePlaylist(name) {
  const ids = state.playlists[name] || [];
  const content = JSON.stringify(ids, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Context Menu
function showContextMenu(e, id) {
  if (!state.selectedIds.has(id)) {
    state.selectedIds.clear();
    state.selectedIds.add(id);
    renderLibrary();
  }
  const menu = document.getElementById('context-menu');
  menu.style.display = 'flex';
  menu.style.left = Math.min(e.pageX, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(e.pageY, window.innerHeight - 150) + 'px';
  
  document.getElementById('ctx-remove').style.display = state.currentView.startsWith('playlist:') ? 'block' : 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display = 'none';
  if (e.target.closest('.modal-overlay') === e.target) closeModals();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModals(); document.getElementById('context-menu').style.display = 'none'; } });

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
}
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

// Themes & Config
const THEMES = [
  { name: 'Terminal Green', value: '#00ff99' },
  { name: 'Amber', value: '#ffb300' },
  { name: 'Cyan', value: '#00d4ff' },
  { name: 'Red', value: '#ff4444' },
  { name: 'Lavender', value: '#a78bfa' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Gold', value: '#fbbf24' },
  { name: 'White', value: '#e8e8e8' }
];

function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-dim', color + '26'); // ~15% opacity
  localStorage.setItem('tp-accent', color);
  document.getElementById('color-accent').value = color;
  renderThemeSwatches();
}
function setTextMain(color) { document.documentElement.style.setProperty('--text', color); localStorage.setItem('tp-text-main', color); document.getElementById('color-text-main').value = color; }
function setTextDim(color) { document.documentElement.style.setProperty('--text-dim', color); localStorage.setItem('tp-text-dim', color); document.getElementById('color-text-dim').value = color; }
function resetColors() {
  setAccent('#a855f7');
  setTextMain('#e8e8e8');
  setTextDim('#666666');
}

function renderThemeSwatches() {
  const container = document.getElementById('theme-swatches');
  container.innerHTML = '';
  const current = localStorage.getItem('tp-accent') || '#a855f7';
  THEMES.forEach(t => {
    const s = document.createElement('div');
    s.className = `theme-swatch ${current.toLowerCase() === t.value.toLowerCase() ? 'active' : ''}`;
    s.style.backgroundColor = t.value;
    s.title = t.name;
    s.onclick = () => setAccent(t.value);
    container.appendChild(s);
  });
}

async function loadConfig() {
  try {
    const res = await fetch('./config.json');
    if (!res.ok) throw new Error('No config');
    const cfg = await res.json();
    applyConfig(cfg);
  } catch {} // Ignore
}

function applyConfig(cfg) {
  if (cfg.volume !== undefined) { audio.volume = cfg.volume; document.getElementById('pb-vol').value = cfg.volume; document.getElementById('pb-vol').style.setProperty('--range-progress', `${cfg.volume * 100}%`); }
  if (cfg.accentColor) setAccent(cfg.accentColor);
  if (cfg.textMain) setTextMain(cfg.textMain);
  if (cfg.textDim) setTextDim(cfg.textDim);
}

// Shortcuts
const SHORTCUTS = [
  { key: 'Space', desc: 'Play / Pause' },
  { key: '← / →', desc: 'Seek 5s backward / forward' },
  { key: '↑ / ↓', desc: 'Volume up / down' },
  { key: 'M', desc: 'Toggle Mute' },
  { key: 'Cmd/Ctrl + Click', desc: 'Toggle track selection' },
  { key: 'Shift + Click', desc: 'Range select tracks' }
];

function setupKeyboardShortcuts() {
  const settingsTable = document.getElementById('shortcuts-table');
  const helpTable = document.getElementById('help-shortcuts-table');
  
  const renderRow = (s) => `<div style="color:var(--text);">${s.key}</div><div>${s.desc}</div>`;
  
  SHORTCUTS.forEach(s => {
    if (settingsTable) settingsTable.innerHTML += renderRow(s);
    if (helpTable) helpTable.innerHTML += renderRow(s);
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    switch(e.code) {
      case 'Space': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); audio.currentTime -= 5; break;
      case 'ArrowRight': e.preventDefault(); audio.currentTime += 5; break;
      case 'ArrowUp': 
        e.preventDefault(); 
        audio.volume = Math.min(1, audio.volume + 0.05); 
        document.getElementById('pb-vol').value = audio.volume; 
        document.getElementById('pb-vol').style.setProperty('--range-progress', `${audio.volume * 100}%`);
        break;
      case 'ArrowDown': 
        e.preventDefault(); 
        audio.volume = Math.max(0, audio.volume - 0.05); 
        document.getElementById('pb-vol').value = audio.volume; 
        document.getElementById('pb-vol').style.setProperty('--range-progress', `${audio.volume * 100}%`);
        break;
      case 'KeyM': e.preventDefault(); audio.muted = !audio.muted; break;
    }
  });
}

// Mobile Sheet Gestures
function setupMobileSheet() {
  const sheet = document.getElementById('now-playing-sheet');
  let startY = 0, startX = 0;
  sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; startX = e.touches[0].clientX; });
  sheet.addEventListener('touchend', e => {
    const diffY = e.changedTouches[0].clientY - startY;
    const diffX = e.changedTouches[0].clientX - startX;
    if (diffY > 80 && Math.abs(diffX) < 50) sheet.classList.remove('active');
    else if (Math.abs(diffX) > 60 && Math.abs(diffY) < 30) {
      diffX > 0 ? prevTrack() : nextTrack(true);
    }
  });
  document.getElementById('player-bar').addEventListener('click', (e) => {
    if (state.isMobile && !e.target.closest('input')) sheet.classList.add('active');
  });
}

// Bind Events
function bindAllEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item[data-view], .tab-item[data-view]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });
  document.getElementById('tab-playlists').addEventListener('click', () => switchView('playlists-mobile'));
  document.getElementById('btn-breadcrumb-lib').addEventListener('click', () => switchView('library'));

  // Top bar Sorting
  document.getElementById('search-input').addEventListener('input', renderLibrary);
  
  const btnSortCat = document.getElementById('btn-sort-cat');
  btnSortCat.addEventListener('click', () => {
    const idx = (SORT_CATEGORIES.indexOf(state.sortCategory) + 1) % SORT_CATEGORIES.length;
    state.sortCategory = SORT_CATEGORIES[idx];
    btnSortCat.querySelector('span').innerText = state.sortCategory;
    localStorage.setItem('tp-sort-cat', state.sortCategory);
    renderLibrary();
  });

  const btnSortOrder = document.getElementById('btn-sort-order');
  btnSortOrder.addEventListener('click', () => {
    const idx = (SORT_ORDERS.indexOf(state.sortOrder) + 1) % SORT_ORDERS.length;
    state.sortOrder = SORT_ORDERS[idx];
    btnSortOrder.querySelector('span').innerText = state.sortOrder;
    localStorage.setItem('tp-sort-order', state.sortOrder);
    renderLibrary();
  });

  document.getElementById('btn-mobile-select').addEventListener('click', function() {
    state.selectMode = !state.selectMode;
    this.classList.toggle('active', state.selectMode);
    document.body.classList.toggle('mobile-select-mode', state.selectMode);
    if (!state.selectMode) state.selectedIds.clear();
    renderLibrary();
  });

  // Player controls
  const binds = [
    {id: 'btn-play', fn: togglePlay}, {id: 'sheet-btn-play', fn: togglePlay},
    {id: 'btn-next', fn: () => nextTrack(true)}, {id: 'sheet-btn-next', fn: () => nextTrack(true)},
    {id: 'btn-prev', fn: prevTrack}, {id: 'sheet-btn-prev', fn: prevTrack},
    {id: 'btn-shuffle', fn: toggleShuffle}, {id: 'sheet-btn-shuffle', fn: toggleShuffle},
    {id: 'btn-repeat', fn: cycleRepeat}, {id: 'sheet-btn-repeat', fn: cycleRepeat}
  ];
  binds.forEach(b => document.getElementById(b.id).addEventListener('click', (e) => { e.stopPropagation(); b.fn(); }));

  // Seek, Vol, Width & Loudness
  ['pb-seek', 'sheet-seek'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      if(audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
    });
  });
  
  document.getElementById('pb-vol').addEventListener('input', e => {
    audio.volume = e.target.value;
    e.target.style.setProperty('--range-progress', `${e.target.value * 100}%`);
    localStorage.setItem('tp-vol', e.target.value);
  });

  document.getElementById('pb-width').addEventListener('input', e => setStereoWidth(e.target.value));
  document.getElementById('settings-width').addEventListener('input', e => setStereoWidth(e.target.value));
  document.getElementById('btn-reset-width').addEventListener('click', () => setStereoWidth(1.0));

  document.getElementById('btn-loud-off').addEventListener('click', () => setLoudnessMode('OFF'));
  document.getElementById('btn-loud-norm').addEventListener('click', () => setLoudnessMode('NORMALIZE'));
  document.getElementById('btn-loud-limit').addEventListener('click', () => setLoudnessMode('LIMIT'));

  // Context Menu
  document.getElementById('ctx-play').addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
    const first = state.library.find(t => t.id === Array.from(state.selectedIds)[0]);
    if (first) playTrack(first, state.activeQueue);
  });
  document.getElementById('ctx-add').addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
    const list = document.getElementById('add-playlist-list');
    list.innerHTML = '';
    Object.keys(state.playlists).forEach(name => {
      const b = document.createElement('button');
      b.innerText = name;
      b.style.width = '100%'; b.style.marginBottom = '5px';
      b.onclick = () => { addTracksToPlaylist(name, Array.from(state.selectedIds)); closeModals(); state.selectedIds.clear(); renderLibrary(); };
      list.appendChild(b);
    });
    openModal('modal-add-playlist');
  });
  document.getElementById('ctx-remove').addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
    const plName = state.currentView.split(':')[1];
    if (plName) removeTracksFromPlaylist(plName, Array.from(state.selectedIds));
    state.selectedIds.clear();
  });

  // Settings: Music Source
  if ('showDirectoryPicker' in window) {
    document.getElementById('desktop-fsa-ui').style.display = 'flex';
    document.getElementById('btn-open-folder').addEventListener('click', handleDesktopFSA);
    document.getElementById('desktop-playlist-folder-ui').style.display = 'flex';
    document.getElementById('btn-open-playlist-folder').addEventListener('click', handlePlaylistFolder);
  } else {
    document.getElementById('mobile-file-ui').style.display = 'flex';
    document.getElementById('file-input').addEventListener('change', handleMobileFiles);
    document.getElementById('desktop-playlist-folder-ui').style.display = 'none';
  }

  // Settings: Playlists Input
  document.getElementById('playlist-files-input').addEventListener('change', handlePlaylistFiles);

  // Modals
  document.getElementById('btn-new-playlist').addEventListener('click', () => openModal('modal-new-playlist'));
  document.getElementById('btn-create-playlist').addEventListener('click', () => {
    const val = document.getElementById('input-new-playlist').value.trim();
    if(val) createPlaylist(val);
    document.getElementById('input-new-playlist').value = '';
    closeModals();
  });
  document.querySelectorAll('.btn-cancel').forEach(b => b.addEventListener('click', closeModals));

  // Config & Backup
  document.getElementById('color-accent').addEventListener('input', e => setAccent(e.target.value));
  document.getElementById('color-text-main').addEventListener('input', e => setTextMain(e.target.value));
  document.getElementById('color-text-dim').addEventListener('input', e => setTextDim(e.target.value));
  document.getElementById('btn-reset-colors').addEventListener('click', resetColors);

  document.getElementById('btn-export-playlists').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.playlists, null, 2)], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'playlists.json'; a.click();
  });
  
  let importData = null;
  document.getElementById('playlist-import-input').addEventListener('change', async e => {
    if (!e.target.files.length) return;
    try {
      importData = JSON.parse(await e.target.files[0].text());
      openModal('modal-import-merge');
    } catch { alert('Invalid JSON'); }
    e.target.value = '';
  });
  document.getElementById('btn-import-merge').addEventListener('click', () => {
    Object.assign(state.playlists, importData);
    savePlaylistsToStorage(); renderSidebar(); closeModals();
  });
  document.getElementById('btn-import-replace').addEventListener('click', () => {
    state.playlists = importData;
    savePlaylistsToStorage(); renderSidebar(); closeModals();
  });

  document.getElementById('btn-export-config').addEventListener('click', () => {
    const cfg = {
      volume: audio.volume,
      accentColor: localStorage.getItem('tp-accent'),
      textMain: localStorage.getItem('tp-text-main'),
      textDim: localStorage.getItem('tp-text-dim')
    };
    const blob = new Blob([JSON.stringify(cfg, null, 2)], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'config.json'; a.click();
  });
  document.getElementById('config-import-input').addEventListener('change', async e => {
    if (!e.target.files.length) return;
    try { applyConfig(JSON.parse(await e.target.files[0].text())); } catch { alert('Invalid Config JSON'); }
    e.target.value = '';
  });

  document.getElementById('btn-clear-data').addEventListener('click', async () => {
    localStorage.clear();
    if(idb) {
      const keys = await idbGetAll();
      for(const k of keys) await idbDelete(k.id);
    }
    location.reload();
  });

  // Audio Context unlock for iOS
  const unlockAudio = () => {
    initWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  document.addEventListener('click', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  state.isMobile = window.innerWidth < 768;
  window.addEventListener('resize', () => { state.isMobile = window.innerWidth < 768; });

  const vol = localStorage.getItem('tp-vol');
  if (vol !== null) { 
    audio.volume = parseFloat(vol); 
    document.getElementById('pb-vol').value = vol;
    document.getElementById('pb-vol').style.setProperty('--range-progress', `${parseFloat(vol) * 100}%`);
  } else {
    document.getElementById('pb-vol').style.setProperty('--range-progress', `100%`);
  }

  const savedWidth = localStorage.getItem('tp-width');
  if (savedWidth !== null) {
    setStereoWidth(savedWidth);
  } else {
    setStereoWidth(1.0);
  }
  
  const savedLoudMode = localStorage.getItem('tp-loudness-mode');
  if (savedLoudMode !== null) {
    setLoudnessMode(savedLoudMode);
  } else {
    setLoudnessMode('OFF');
  }
  
  const savedSortCat = localStorage.getItem('tp-sort-cat');
  if (savedSortCat && SORT_CATEGORIES.includes(savedSortCat)) {
    state.sortCategory = savedSortCat;
    document.getElementById('btn-sort-cat').querySelector('span').innerText = savedSortCat;
  }
  const savedSortOrder = localStorage.getItem('tp-sort-order');
  if (savedSortOrder && SORT_ORDERS.includes(savedSortOrder)) {
    state.sortOrder = savedSortOrder;
    document.getElementById('btn-sort-order').querySelector('span').innerText = savedSortOrder;
  }

  if (localStorage.getItem('tp-accent')) setAccent(localStorage.getItem('tp-accent'));
  if (localStorage.getItem('tp-text-main')) setTextMain(localStorage.getItem('tp-text-main'));
  if (localStorage.getItem('tp-text-dim')) setTextDim(localStorage.getItem('tp-text-dim'));
  renderThemeSwatches();

  await idbOpen();
  loadPlaylistsFromStorage();
  renderSidebar();
  renderLibrary();
  bindAllEventListeners();
  await loadConfig();
  renderRecentFolders();
  setupMediaSession();
  setupKeyboardShortcuts();
  setupMobileSheet();
  lucide.createIcons();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW Registration failed:", err));
  }
});