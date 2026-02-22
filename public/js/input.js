const inputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
};

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
        inputState.throttle = true;
        e.preventDefault();
        break;
      case 'ArrowDown':
      case 'KeyS':
        inputState.brake = true;
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        inputState.left = true;
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        inputState.right = true;
        e.preventDefault();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        inputState.throttle = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        inputState.brake = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        inputState.left = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        inputState.right = false;
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

export function getInput() {
  return { ...inputState };
}
