// preload.js — the only bridge between the sandboxed renderer and the main process.
// Exposes a tiny, explicit API on window.petAPI. No Node access leaks to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Subscribe to real agent events forwarded from the HTTP server / log tailer.
  // cb receives { agent, status, message, emoji }.
  onPetEvent: (cb) => {
    ipcRenderer.on('pet-event', (_e, payload) => cb(payload));
  },

  // Move the OS window by a delta (used while dragging the pet).
  moveBy: (dx, dy) => ipcRenderer.send('pet-move', { dx, dy }),

  // Toggle whether the window swallows mouse events. When `false`, clicks pass
  // through the transparent areas to whatever is behind the pet.
  setInteractive: (on) => ipcRenderer.send('pet-interactive', !!on),

  // ── Pet catalog / selection ──
  // The catalog of available pets (built-in SVG + sprite packs from pets/).
  listPets: () => ipcRenderer.invoke('pet-list'),
  // The currently selected pet id (persisted across runs).
  getSelectedPet: () => ipcRenderer.invoke('pet-selected'),
  // Ask the main process to switch the active pet (also updates the tray).
  selectPet: (id) => ipcRenderer.send('pet-selected-set', id),
  // Fired when the pet is switched from the tray (or another window).
  onSelectPet: (cb) => ipcRenderer.on('pet-select', (_e, id) => cb(id)),

  // Ambient wander: main moves the window and tells us which walk animation
  // to play ('running-left' | 'running-right' | 'idle' | 'jumping').
  onWalk: (cb) => ipcRenderer.on('pet-walk', (_e, state) => cb(state)),

  // Play: fling the pet — main runs gravity/bounce physics on the window.
  toss: (vx, vy) => ipcRenderer.send('pet-toss', { vx, vy }),

  // Attention: little double-bounce of the window (session needs input).
  hop: () => ipcRenderer.send('pet-hop'),
});
