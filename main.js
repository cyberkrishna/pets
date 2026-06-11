// main.js — Electron main process for the Agent Pet.
// Responsibilities: create the floating window, run a localhost HTTP webhook,
// tail log files, relay events to the renderer, and host a tray icon.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');

// Only one pet at a time — a second launch would lose the 7331 port bind and
// leave a confusing duplicate window. Focus the existing instance instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    win.show();
  }
});

// ── Paths ─────────────────────────────────────────────────────────────────────
// In dev everything lives in the repo. Packaged, the bundled pets ship in
// resources/ (read-only), the user gets a writable pets folder + config in
// userData, and the default config inside the asar seeds it on first run.
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'pet.config.json');
const BUILTIN_PETS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'pets')
  : path.join(__dirname, 'pets');

function userPetsDir() {
  return path.join(app.getPath('userData'), 'pets');
}

function configPath() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'pet.config.json')
    : DEFAULT_CONFIG_PATH;
}

// Packaged only: create the editable config + user pets dir on first launch.
function ensureUserFiles() {
  if (!app.isPackaged) return;
  try {
    if (!fs.existsSync(configPath())) {
      fs.copyFileSync(DEFAULT_CONFIG_PATH, configPath());
    }
    fs.mkdirSync(userPetsDir(), { recursive: true });
  } catch (err) {
    console.warn('[pet] could not seed user files:', err.message);
  }
}

let win = null;
let tray = null;
let server = null;
let savePosTimer = null;

// Where we remember the window position between runs (per-user, not in the repo).
function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadSavedPosition() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) return { x: s.x, y: s.y };
  } catch {
    /* no saved state yet */
  }
  return null;
}

// Debounced so dragging doesn't write to disk on every pixel.
function savePositionSoon() {
  if (savePosTimer) clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    try {
      fs.writeFileSync(statePath(), JSON.stringify({ x, y }));
    } catch (err) {
      console.warn('[pet] could not save window position:', err.message);
    }
  }, 400);
}

// ── Config ────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const cfg = JSON.parse(raw);
    return {
      port: Number(cfg.port) || 7331,
      logs: Array.isArray(cfg.logs) ? cfg.logs : [],
    };
  } catch (err) {
    console.warn('[pet] could not read pet.config.json, using defaults:', err.message);
    return { port: 7331, logs: [] };
  }
}

let config = { port: 7331, logs: [] }; // loaded in whenReady (needs userData)

// ── Pet catalog ───────────────────────────────────────────────────────────────
// Scan <dir>/<id>/pet.json. Sprite pets get an absolute file:// sheetUrl so the
// sandboxed renderer can load the image. Invalid packs are skipped, not fatal.
function scanPetsDir(dir, pets, seen) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir may not exist yet
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const jsonPath = path.join(dir, ent.name, 'pet.json');
    let def;
    try {
      def = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      continue; // no/invalid pet.json
    }
    const id = typeof def.id === 'string' ? def.id : ent.name;
    if (seen.has(id)) continue; // earlier dir wins (user packs shadow built-ins)
    const render = def.render === 'sprite' ? 'sprite' : 'svg';
    const entry = { id, name: def.name || id, render };

    if (render === 'sprite') {
      const sheetPath = path.join(dir, ent.name, def.sheet || 'sheet.png');
      if (!fs.existsSync(sheetPath) || !def.states || typeof def.states !== 'object') continue;
      entry.sheetUrl = pathToFileURL(sheetPath).href;
      entry.frameWidth = Number(def.frameWidth) || 32;
      entry.frameHeight = Number(def.frameHeight) || 32;
      entry.scale = Number(def.scale) || 4;
      entry.smooth = def.smooth === true; // high-res sheets scale down better smoothed
      entry.states = def.states;
    }
    seen.add(id);
    pets.push(entry);
  }
}

function loadCatalog() {
  const pets = [];
  const seen = new Set();
  scanPetsDir(userPetsDir(), pets, seen); // user packs first so they shadow built-ins
  scanPetsDir(BUILTIN_PETS_DIR, pets, seen);
  // Stable order with the built-in SVG pet first.
  pets.sort((a, b) => (a.render === 'svg' ? -1 : b.render === 'svg' ? 1 : a.id.localeCompare(b.id)));
  return pets;
}

let catalog = []; // loaded in whenReady (needs userData)

// Persisted pet selection (same per-user dir as window-state.json).
function petStatePath() {
  return path.join(app.getPath('userData'), 'pet-state.json');
}

function loadSelectedPet() {
  try {
    const s = JSON.parse(fs.readFileSync(petStatePath(), 'utf8'));
    if (typeof s.id === 'string' && catalog.some((p) => p.id === s.id)) return s.id;
  } catch {
    /* no saved selection */
  }
  // First run: prefer the OpenPets-style sprite companion over the SVG pet.
  if (catalog.some((p) => p.id === 'openpets-default')) return 'openpets-default';
  return catalog.length ? catalog[0].id : null;
}

let selectedPetId = null; // resolved once app is ready (needs userData path)

function saveSelectedPet(id) {
  try {
    fs.writeFileSync(petStatePath(), JSON.stringify({ id }));
  } catch (err) {
    console.warn('[pet] could not save pet selection:', err.message);
  }
}

// Apply a new pet: persist, tell the renderer, refresh the tray checkmarks.
function selectPet(id) {
  if (!catalog.some((p) => p.id === id)) return;
  selectedPetId = id;
  saveSelectedPet(id);
  if (win && !win.isDestroyed()) win.webContents.send('pet-select', id);
  if (tray) createTrayMenu(); // rebuild so the radio checkmark moves
}

// ── Window ──────────────────────────────────────────────────────────────────
// Same compact footprint as OpenPets' pet window: just the sprite + a bubble.
const WIN_W = 220;
const WIN_H = 320;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  // Default: bottom-right of the usable screen, with a small margin.
  let x = workArea.x + workArea.width - WIN_W - 24;
  let y = workArea.y + workArea.height - WIN_H - 24;

  // Restore the last dragged position, clamped into the work area of the
  // display it's nearest to (OpenPets-style) so the pet can never come back
  // off-screen after a resize, monitor change, or wild drag.
  const saved = loadSavedPosition();
  if (saved) {
    const center = { x: saved.x + WIN_W / 2, y: saved.y + WIN_H / 2 };
    const { workArea: wa } = screen.getDisplayNearestPoint(center);
    x = Math.min(Math.max(saved.x, wa.x), wa.x + Math.max(0, wa.width - WIN_W));
    y = Math.min(Math.max(saved.y, wa.y), wa.y + Math.max(0, wa.height - WIN_H));
  }

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The attention chime plays without a prior click on the window.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  win.on('moved', savePositionSoon);

  // Start with the window NOT click-through; the renderer toggles this on hover.
  win.setIgnoreMouseEvents(false);
}

// Keep a window origin (x,y) inside the visible work area of whatever display
// it's nearest to, so the pet can never be moved fully off-screen. Allowing a
// small `peek` of the window to hang past an edge keeps dragging feeling free
// while still guaranteeing a grabbable sliver stays on-screen.
function clampToWorkArea(x, y, peek = 0) {
  const center = { x: x + WIN_W / 2, y: y + WIN_H / 2 };
  const { workArea: wa } = screen.getDisplayNearestPoint(center);
  const minX = wa.x - peek;
  const maxX = wa.x + wa.width - WIN_W + peek;
  const minY = wa.y; // never let the title/sprite slide above the top edge
  const maxY = wa.y + wa.height - WIN_H + peek;
  return {
    x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY))),
  };
}

// Send an event to the renderer (no-op if the window is gone).
function emitEvent(payload) {
  lastEventTs = Date.now();
  if (win && !win.isDestroyed()) {
    win.webContents.send('pet-event', payload);
  }
}

// ── Ambient wander ────────────────────────────────────────────────────────────
// OpenPets-style liveness: when nothing is happening, the pet occasionally
// strolls a short distance left or right along the screen while the renderer
// plays its run animation. Paused while hidden, dragging, or recently busy.
let lastEventTs = 0;
let lastDragTs = 0;
let wandering = false;

const WANDER_MIN_GAP_MS = 45_000;   // min quiet time between strolls
const WANDER_BUSY_HOLD_MS = 90_000; // don't stroll this soon after agent activity

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function sendWalkState(state) {
  if (win && !win.isDestroyed()) win.webContents.send('pet-walk', state);
}

async function wanderOnce() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const distance = 60 + Math.random() * 100;
  const [startX, startY] = win.getPosition();

  // Clamp the target to the work area of whatever display the pet is on.
  const center = { x: startX + WIN_W / 2, y: startY + WIN_H / 2 };
  const { workArea } = screen.getDisplayNearestPoint(center);
  const targetX = Math.round(Math.min(
    Math.max(startX + dir * distance, workArea.x),
    workArea.x + workArea.width - WIN_W,
  ));
  if (Math.abs(targetX - startX) < 24) return; // nowhere to go — skip this stroll

  wandering = true;
  sendWalkState(targetX > startX ? 'running-right' : 'running-left');
  const durationMs = Math.abs(targetX - startX) * 14; // ~70 px/s stroll
  const steps = Math.max(8, Math.round(durationMs / 33));
  try {
    for (let step = 1; step <= steps; step++) {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      // The user grabbed the pet mid-stroll — let go immediately.
      if (Date.now() - lastDragTs < 300) return;
      const t = easeInOut(step / steps);
      win.setPosition(Math.round(startX + (targetX - startX) * t), startY, false);
      await new Promise((r) => setTimeout(r, durationMs / steps));
    }
    savePositionSoon();
  } finally {
    wandering = false;
    sendWalkState('idle');
  }
}

// ── Play physics ──────────────────────────────────────────────────────────────
// Fling the pet (fast drag + release) and it sails with gravity, bouncing off
// the work-area floor and walls — OpenPets-style liveness physics.
let tossTimer = null;

function stopToss() {
  if (!tossTimer) return;
  clearInterval(tossTimer);
  tossTimer = null;
  sendWalkState('idle');
}

function startToss(vx, vy) {
  if (!win || win.isDestroyed()) return;
  stopToss();
  let vX = Math.max(-45, Math.min(45, vx));
  let vY = Math.max(-55, Math.min(55, vy));
  let restTicks = 0;
  sendWalkState('jumping');
  tossTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return stopToss();
    const [x, y] = win.getPosition();
    const { workArea } = screen.getDisplayNearestPoint({ x: x + WIN_W / 2, y: y + WIN_H / 2 });
    const floor = workArea.y + workArea.height - WIN_H;
    const minX = workArea.x;
    const maxX = workArea.x + workArea.width - WIN_W;

    vY = Math.min(vY + 3, 48); // gravity
    let nx = x + Math.round(vX);
    let ny = y + Math.round(vY);
    if (nx <= minX || nx >= maxX) {
      nx = Math.max(minX, Math.min(nx, maxX));
      vX = -vX * 0.6; // wall bounce
    }
    if (ny >= floor) {
      ny = floor;
      if (Math.abs(vY) > 8) { vY = -vY * 0.45; vX *= 0.7; } // floor bounce
      else { vY = 0; vX *= 0.6; }
    }
    win.setPosition(nx, ny, false);

    if (ny >= floor && Math.abs(vY) < 1 && Math.abs(vX) < 1 && ++restTicks > 3) {
      stopToss();
      savePositionSoon();
    }
  }, 30);
}

// Attention hop: two quick bounces in place (used when a session needs input).
let hopping = false;
async function hopWindow() {
  if (!win || win.isDestroyed() || tossTimer || hopping) return;
  hopping = true;
  const [x, y] = win.getPosition();
  try {
    for (const dy of [-14, -22, -14, 0, -8, -13, -8, 0]) {
      if (!win || win.isDestroyed()) return;
      win.setPosition(x, y + dy, false);
      await new Promise((r) => setTimeout(r, 45));
    }
  } finally {
    hopping = false;
  }
}

function startWandering() {
  setInterval(() => {
    if (wandering) return;
    if (Date.now() - lastEventTs < WANDER_BUSY_HOLD_MS) return;
    if (Date.now() - lastDragTs < 10_000) return;
    if (Math.random() > 0.5) return; // skip about half the ticks so strolls feel random
    void wanderOnce();
  }, WANDER_MIN_GAP_MS).unref();
}

// ── HTTP webhook ─────────────────────────────────────────────────────────────
// Legacy statuses (running/done/error/idle) plus the richer OpenPets-inspired
// reaction set. The renderer maps all of these onto animation states.
const VALID_STATUS = new Set([
  'running', 'done', 'error', 'idle',
  'thinking', 'working', 'editing', 'testing', 'waiting', 'waving',
  'success', 'celebrating',
]);

function startServer(port) {
  server = http.createServer((req, res) => {
    // Permissive CORS so browser-based agents on any origin can post locally.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, port }));
    }

    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) req.destroy(); // guard against huge payloads
      });
      req.on('end', () => {
        let data;
        try {
          data = JSON.parse(body || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
        }
        const payload = {
          agent: typeof data.agent === 'string' ? data.agent : 'agent',
          status: VALID_STATUS.has(data.status) ? data.status : 'idle',
          message: typeof data.message === 'string' ? data.message : '',
          emoji: typeof data.emoji === 'string' ? data.emoji : '',
        };
        emitEvent(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.on('error', (err) => {
    // The pet keeps running even if the webhook can't bind — log tailing still works.
    console.error(`[pet] HTTP server error (webhook disabled): ${err.message}`);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[pet] webhook listening on http://127.0.0.1:${port}/event`);
  });
}

// ── Log tailing ───────────────────────────────────────────────────────────────
// For each configured log file, poll its size ~1/s and read only newly appended
// bytes. Each new line is tested against the file's ordered rules (first match wins).
function startLogTailing(logs) {
  const watchable = logs.filter((l) => !l._example && l.file && Array.isArray(l.rules));
  if (watchable.length === 0) return;

  const offsets = new Map(); // file -> last known byte size

  // Seed offsets to current end-of-file so we don't replay old history on launch.
  for (const l of watchable) {
    try {
      offsets.set(l.file, fs.statSync(l.file).size);
    } catch {
      offsets.set(l.file, 0); // file may not exist yet; we'll pick it up when it appears
    }
  }

  const compiled = watchable.map((l) => ({
    file: l.file,
    agent: l.agent || path.basename(l.file),
    rules: l.rules.map((r) => ({
      re: safeRegex(r.match),
      status: VALID_STATUS.has(r.status) ? r.status : 'idle',
    })),
  }));

  setInterval(() => {
    for (const l of compiled) {
      let size;
      try {
        size = fs.statSync(l.file).size;
      } catch {
        continue; // file missing — skip this tick, retry next time
      }
      const prev = offsets.get(l.file) ?? 0;
      if (size < prev) {
        // File was truncated/rotated — reset to start.
        offsets.set(l.file, 0);
        continue;
      }
      if (size === prev) continue;

      try {
        const fd = fs.openSync(l.file, 'r');
        const len = size - prev;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, prev);
        fs.closeSync(fd);
        offsets.set(l.file, size);

        const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          for (const rule of l.rules) {
            if (rule.re && rule.re.test(line)) {
              const msg = line.trim().slice(0, 140);
              console.log(`[pet] log match (${l.agent} → ${rule.status}): ${msg}`);
              emitEvent({ agent: l.agent, status: rule.status, message: msg, emoji: '' });
              break; // first matching rule wins
            }
          }
        }
      } catch (err) {
        console.warn(`[pet] log read failed for ${l.file}: ${err.message}`);
      }
    }
  }, 1000);

  console.log(`[pet] tailing ${compiled.length} log file(s)`);
}

function safeRegex(pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    console.warn(`[pet] invalid regex in config: ${pattern}`);
    return null;
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────────
// Generate a tiny purple-dot icon at runtime so we ship no binary asset.
function makeTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const cx = 7.5, cy = 7.5, r = 6.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      // RGBA (Electron buffers are RGBA on all platforms via nativeImage)
      buf[i] = 0x9b;       // R
      buf[i + 1] = 0x8f;   // G
      buf[i + 2] = 0xff;   // B
      buf[i + 3] = inside ? 0xff : 0x00; // A
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// Build (or rebuild) the tray context menu. Called again whenever the selected
// pet changes so the radio checkmark stays in sync.
function createTrayMenu() {
  const petItems = catalog.map((p) => ({
    label: p.name,
    type: 'radio',
    checked: p.id === selectedPetId,
    click: () => selectPet(p.id),
  }));

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => {
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
      },
    },
    { type: 'separator' },
    {
      label: 'Pet',
      submenu: petItems.length ? petItems : [{ label: '(no pets found)', enabled: false }],
    },
    {
      label: 'Add pets… (open folder)',
      click: () => {
        fs.mkdirSync(userPetsDir(), { recursive: true });
        shell.openPath(userPetsDir());
      },
    },
    {
      label: 'Reload pets',
      click: () => {
        catalog = loadCatalog();
        if (selectedPetId && !catalog.some((p) => p.id === selectedPetId)) {
          selectedPetId = catalog.length ? catalog[0].id : null;
        }
        if (selectedPetId) selectPet(selectedPetId); // re-push to renderer + tray
        else createTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Edit config (restart to apply)',
      click: () => shell.openPath(configPath()),
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      visible: app.isPackaged, // pointless for `npm start` dev runs
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Agent Pet');
  createTrayMenu();
  tray.on('click', () => {
    if (win) win.isVisible() ? win.hide() : win.show();
  });
}

// ── IPC from renderer ───────────────────────────────────────────────────────
ipcMain.on('pet-move', (_e, { dx, dy }) => {
  if (!win) return;
  lastDragTs = Date.now(); // cancels/blocks ambient wandering
  stopToss(); // grabbing the pet mid-flight catches it
  const [x, y] = win.getPosition();
  // Clamp the drag so the pet can't be pulled off the visible desktop. A small
  // peek margin keeps the drag feeling free while a grabbable sliver stays on.
  const { x: nx, y: ny } = clampToWorkArea(x + dx, y + dy, 48);
  win.setPosition(nx, ny);
  savePositionSoon();
});

ipcMain.on('pet-toss', (_e, { vx, vy }) => startToss(Number(vx) || 0, Number(vy) || 0));
ipcMain.on('pet-hop', () => { void hopWindow(); });

ipcMain.on('pet-interactive', (_e, on) => {
  if (!win) return;
  // forward:true lets move/hover events still reach the page while click-through.
  win.setIgnoreMouseEvents(!on, { forward: true });
});

// ── Pet catalog / selection IPC ───────────────────────────────────────────────
ipcMain.handle('pet-list', () => catalog);
ipcMain.handle('pet-selected', () => selectedPetId);
ipcMain.on('pet-selected-set', (_e, id) => selectPet(id));

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureUserFiles();
  config = loadConfig();
  catalog = loadCatalog();
  selectedPetId = loadSelectedPet(); // needs userData path, so resolve here
  createWindow();
  createTray();
  startServer(config.port);
  startLogTailing(config.logs);
  startWandering();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep running in the tray even when the window is hidden/closed.
app.on('window-all-closed', () => {
  // Intentionally do not quit; the tray keeps the pet alive. Use tray → Quit.
});

app.on('before-quit', () => {
  if (server) server.close();
});
