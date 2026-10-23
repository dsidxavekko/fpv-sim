// Gamepad (standard mapping) with a keyboard fallback, so the sim is testable
// without a controller. Stick axes are routed through the chosen RC layout;
// throttle is a lever, so it keeps its value between frames.

import { layoutById } from './settings.js';

const DEAD = 0.08;

const dz = (v, d = DEAD) => {
  const a = Math.abs(v ?? 0);
  return a < d ? 0 : Math.sign(v) * ((a - d) / (1 - d));
};

const KEY_THROTTLE = { KeyW: 1, KeyS: -1 };
const KEY_YAW = { KeyD: 1, KeyA: -1 };
const KEY_PITCH = { ArrowDown: 1, ArrowUp: -1 };
const KEY_ROLL = { ArrowRight: 1, ArrowLeft: -1 };

const sum = (keys, map) =>
  Object.entries(map).reduce((n, [code, dir]) => n + (keys.has(code) ? dir : 0), 0);

/**
 * Throttle lever. `active` means the control is off its dead zone right now. A
 * spring throttle always follows the stick; a lever only takes a new value while
 * the pilot is moving it, and a centred or drifting stick leaves it where it was.
 */
export function nextLever(lever, value, active, spring) {
  return spring || active ? value : lever;
}

/**
 * Stick layouts: pitch, roll, yaw come straight from the pad every frame. Throttle is
 * a lever, so it keeps its value between frames. `initialThrottle` seeds that lever,
 * which is what lets the sim start trimmed for hover.
 */
export function createInput(settings, initialThrottle = 0.5) {
  const keys = new Set();
  const prev = new Map();   // button index -> was pressed last frame
  let lever = initialThrottle;   // throttle 0..1, before any inversion

  const s = {
    throttle: 0.5,
    pitch: 0,   // + nose up
    roll: 0,    // + bank right
    yaw: 0,     // + right
    padName: '',
    connected: false,
    _hits: new Set(),
  };

  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyR') s._hits.add('reset');
    if (e.code === 'KeyF') s._hits.add('flip');
    if (e.code === 'Escape') s._hits.add('pause');
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  /** Edge-triggered: true once per press. */
  s.consume = (name) => {
    if (!s._hits.has(name)) return false;
    s._hits.delete(name);
    return true;
  };

  s.update = (dt) => {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    s.connected = !!pad;
    if (pad) {
      s.padName = pad.id;
    }

    let throttle = null;
    let active = false;
    let pitch = 0, roll = 0, yaw = 0;

    // every RC layout is just a permutation of the four stick axes
    const l = layoutById(settings.layout);
    const m = l.map;
    const sign = (ax) => (l.invert.includes(ax) ? -1 : 1);

    if (pad) {
      const raw = { lx: dz(pad.axes[0]), ly: dz(pad.axes[1]), rx: dz(pad.axes[2]), ry: dz(pad.axes[3]) };
      pitch = raw[m.pitch] * sign(m.pitch);
      roll = raw[m.roll] * sign(m.roll);
      yaw = raw[m.yaw] * sign(m.yaw);
      // stick forward (axis -1) = more gas. Spring loaded means the stick acts like a
      // spring: centred is idle, pushing forward adds gas, pulling back does nothing.
      // The lever maps the whole travel so centre sits at half gas.
      const axis = raw[m.throttle] * sign(m.throttle);
      if (settings.throttleOnTrigger) {
        throttle = dz(pad.buttons[7]?.value ?? 0, 0.02);
        active = throttle !== 0;
      } else {
        throttle = settings.springThrottle ? Math.max(0, -axis) : (1 - axis) / 2;
        // judged on the same dead zone that shaped the value, otherwise a drifting
        // stick reads as "moved" while the value says "centred" and resets gas to 50 %
        active = raw[m.throttle] !== 0;
      }
    }

    if (throttle !== null) lever = nextLever(lever, throttle, active, settings.springThrottle);
    else lever += sum(keys, KEY_THROTTLE) * dt * 0.7; // keyboard nudge
    lever = Math.min(1, Math.max(0, lever));
    s.throttle = settings.invertThrottle ? 1 - lever : lever;

    // ---- attitude: keyboard adds on top of whatever the pad asked for ----
    pitch += sum(keys, KEY_PITCH);
    roll += sum(keys, KEY_ROLL);
    yaw += sum(keys, KEY_YAW);
    s.pitch = Math.max(-1, Math.min(1, pitch));
    s.roll = Math.max(-1, Math.min(1, roll));
    s.yaw = Math.max(-1, Math.min(1, yaw));

    // ---- buttons (edge triggered) ----
    if (pad) {
      const hit = (i, name) => {
        const now = pad.buttons[i]?.pressed ?? false;
        const was = prev.get(i) ?? false;
        prev.set(i, now);
        if (now && !was) s._hits.add(name);
      };
      hit(0, 'reset');   // A
      hit(3, 'flip');    // Y
      hit(9, 'pause');   // Start
    }
  };

  return s;
}