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

export function initInput() {
  window.addEventListener('keydown', (e) => {
    // Don't capture game keys when typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
      case 'Escape':
        e.preventDefault();
        if (pauseToggleCallback) pauseToggleCallback();
        break;
      case 'F3':
        e.preventDefault();
        if (debugToggleCallback) debugToggleCallback();
        break;
      case 'KeyP':
        e.preventDefault();
        if (autopilotToggleCallback) autopilotToggleCallback();
        break;
      case 'Digit0':
        e.preventDefault();
        if (soundToggleCallback) soundToggleCallback();
        break;
      case 'ArrowUp':
      case 'KeyW':
        if (!staleInputs.has('throttle')) inputState.throttle = true;
        e.preventDefault();
        break;
      case 'ArrowDown':
      case 'KeyS':
        if (!staleInputs.has('brake')) inputState.brake = true;
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        if (!staleInputs.has('left')) inputState.left = true;
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        if (!staleInputs.has('right')) inputState.right = true;
        e.preventDefault();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        inputState.throttle = false;
        staleInputs.delete('throttle');
        break;
      case 'ArrowDown':
      case 'KeyS':
        inputState.brake = false;
        staleInputs.delete('brake');
        break;
      case 'ArrowLeft':
      case 'KeyA':
        inputState.left = false;
        staleInputs.delete('left');
        break;
      case 'ArrowRight':
      case 'KeyD':
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
