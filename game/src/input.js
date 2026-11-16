// Keyboard, mouse and pointer lock, plus the one-shot key presses the game treats as events
// (reload, buy, plant, weapon slots). Movement keys are polled; the rest are queued and drained,
// so a key pressed between two frames is never lost and never fires twice.
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ControlLeft', 'Space']);

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0, queue: [] };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (MOVE_KEYS.has(event.code)) keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
    state.queue.push(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Drain the key queue: every press since the last frame, in order.
    takeKeys() {
      if (!state.queue.length) return [];
      const out = state.queue.slice();
      state.queue.length = 0;
      return out;
    },
    intent() {
      return {
        forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
        strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
        jump: keys.has('Space'),
        crouch: keys.has('ControlLeft') || keys.has('ControlRight'),
        walk: keys.has('ShiftLeft'),
      };
    },
  };
}
