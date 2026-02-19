const inputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
};

export function initInput() {
  window.addEventListener('keydown', (e) => {
    // Don't capture game keys when typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
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
