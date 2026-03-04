const inputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
};

// Keys held before race start must be released and re-pressed
const staleInputs = new Set();

let debugToggleCallback = null;
let autopilotToggleCallback = null;
let pauseToggleCallback = null;
let soundToggleCallback = null;
let hornCallback = null;

// Default key bindings
const DEFAULT_KEYBINDS = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  horn: ['Space'],
  pause: ['Escape'],
  soundToggle: ['Digit0'],
};

let keybinds = {};

function deepCopyBinds(src) {
  const out = {};
  for (const k of Object.keys(src)) out[k] = [...src[k]];
  return out;
}

function loadKeybinds() {
  keybinds = deepCopyBinds(DEFAULT_KEYBINDS);
  try {
    const stored = localStorage.getItem('multirally-keybinds');
    if (stored) {
      const parsed = JSON.parse(stored);
      for (const action of Object.keys(DEFAULT_KEYBINDS)) {
        if (Array.isArray(parsed[action])) keybinds[action] = parsed[action];
      }
    }
  } catch (e) { /* ignore */ }
}

function saveKeybinds() {
  try {
    localStorage.setItem('multirally-keybinds', JSON.stringify(keybinds));
  } catch (e) { /* ignore */ }
}

export function getKeybinds() { return deepCopyBinds(keybinds); }
export function getDefaultKeybinds() { return deepCopyBinds(DEFAULT_KEYBINDS); }

export function setKeybind(action, codes) {
  keybinds[action] = codes;
  saveKeybinds();
}

export function resetKeybinds() {
  keybinds = deepCopyBinds(DEFAULT_KEYBINDS);
  saveKeybinds();
}

export function onDebugToggle(callback) {
  debugToggleCallback = callback;
}

export function onAutopilotToggle(callback) {
  autopilotToggleCallback = callback;
}

export function onPauseToggle(callback) {
  pauseToggleCallback = callback;
}

export function onSoundToggle(callback) {
  soundToggleCallback = callback;
}

export function onHorn(callback) {
  hornCallback = callback;
}

function getAction(code) {
  for (const [action, codes] of Object.entries(keybinds)) {
    if (codes.includes(code)) return action;
  }
  return null;
}

export function initInput() {
  loadKeybinds();

  window.addEventListener('keydown', (e) => {
    // Don't capture game keys when typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Debug and autopilot stay hardcoded (dev features)
    if (e.code === 'F3') {
      e.preventDefault();
      if (debugToggleCallback) debugToggleCallback();
      return;
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      if (autopilotToggleCallback) autopilotToggleCallback();
      return;
    }

    const action = getAction(e.code);
    if (!action) return;

    e.preventDefault();

    switch (action) {
      case 'pause':
        if (pauseToggleCallback) pauseToggleCallback();
        break;
      case 'soundToggle':
        if (soundToggleCallback) soundToggleCallback();
        break;
      case 'horn':
        if (hornCallback) hornCallback();
        break;
      case 'throttle':
        if (!staleInputs.has('throttle')) inputState.throttle = true;
        break;
      case 'brake':
        if (!staleInputs.has('brake')) inputState.brake = true;
        break;
      case 'left':
        if (!staleInputs.has('left')) inputState.left = true;
        break;
      case 'right':
        if (!staleInputs.has('right')) inputState.right = true;
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    const action = getAction(e.code);
    if (!action) return;

    switch (action) {
      case 'throttle':
        inputState.throttle = false;
        staleInputs.delete('throttle');
        break;
      case 'brake':
        inputState.brake = false;
        staleInputs.delete('brake');
        break;
      case 'left':
        inputState.left = false;
        staleInputs.delete('left');
        break;
      case 'right':
        inputState.right = false;
        staleInputs.delete('right');
        break;
    }
  });

  // Reset on blur (prevent stuck keys)
  window.addEventListener('blur', () => {
    inputState.throttle = false;
    inputState.brake = false;
    inputState.left = false;
    inputState.right = false;
  });
}

export function resetInputForRaceStart() {
  // Mark any currently held keys as stale — player must release and re-press
  if (inputState.throttle) staleInputs.add('throttle');
  if (inputState.brake) staleInputs.add('brake');
  if (inputState.left) staleInputs.add('left');
  if (inputState.right) staleInputs.add('right');
  inputState.throttle = false;
  inputState.brake = false;
  inputState.left = false;
  inputState.right = false;
}

export function getInput() {
  return { ...inputState };
}
