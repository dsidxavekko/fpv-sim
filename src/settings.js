// Stick layouts and rate presets, saved to localStorage.
// Rates use the Betaflight "Actual" model: [centre deg/s, max deg/s, expo 0..1].

import { TRACK_IDS } from './tracks.js';

const KEY = 'fpvsim.settings';

/**
 * Standard RC transmitter modes. Each control is just a permutation of the four
 * stick axes, so one uniform formula covers all of them:
 *   throttle = (1 - axis) / 2      (stick forward = more gas)
 *   yaw      = axis               (stick right  = yaw right)
 *   pitch    = axis               (stick back   = nose up)
 *   roll     = axis               (stick right  = bank right)
 * lx/ly = left stick, rx/ry = right stick.
 * `invert` lists axes whose sign is flipped, which is how a pilot who thinks
 * "stick right leans right" gets yaw the same way as roll.
 */
export const LAYOUTS = [
  { id: 1, name: 'Mode 1', map: { roll: 'lx', pitch: 'ly', throttle: 'ry', yaw: 'rx' }, invert: [] },
  { id: 2, name: 'Mode 2 ⟲', title: 'left stick: throttle + inverted yaw',
    map: { roll: 'rx', pitch: 'ry', throttle: 'ly', yaw: 'lx' }, invert: ['lx'] },
  { id: 3, name: 'Mode 3', map: { roll: 'rx', pitch: 'ly', throttle: 'ry', yaw: 'lx' }, invert: [] },
  { id: 4, name: 'Mode 4', map: { roll: 'lx', pitch: 'ry', throttle: 'ly', yaw: 'rx' }, invert: [] },
];

/**
 * Rates in deg/s, per axis: [centre, max, expo].
 *
 * These run low compared with the numbers you would enter on a real Betaflight
 * board, and that is deliberate. Radio presets assume ~55 mm of stick throw plus
 * an expo dial; a gamepad has ~20 mm and no dial, so the same figures feel two or
 * three times hotter on a pad. Everything here is tuned for a gamepad.
 *
 * Yaw is always calmer than roll/pitch, which is how real pilots fly.
 */
export const PRESETS = {
  training: { name: 'Training', roll: [20, 200, 0.55], pitch: [20, 200, 0.55], yaw: [15, 120, 0.60] },
  cinematic: { name: 'Smooth / cinematic', roll: [15, 270, 0.75], pitch: [15, 270, 0.75], yaw: [18, 180, 0.75] },
  beginner: { name: 'Beginner', roll: [18, 240, 0.70], pitch: [18, 240, 0.70], yaw: [24, 192, 0.70] },
  freestyle: { name: 'Freestyle 5"', roll: [42, 402, 0.50], pitch: [42, 402, 0.50], yaw: [30, 240, 0.55] },
  race: { name: 'Race', roll: [72, 450, 0.42], pitch: [72, 450, 0.42], yaw: [42, 270, 0.45] },
};

/** Ceiling for any preset's max rate. Radio numbers would be ~750 and feel violent. */
export const MAX_RATE_LIMIT = 450;

export const DEFAULTS = {
  preset: 'freestyle',
  layout: 2,
  rates: {
    roll: [...PRESETS.freestyle.roll],
    pitch: [...PRESETS.freestyle.pitch],
    yaw: [...PRESETS.freestyle.yaw],
  },
  sens: 1.0,          // global multiplier on every rate, 0.3 .. 1.5
  throttleOnTrigger: false,
  invertThrottle: false,
  springThrottle: false,  // stick centred = half gas, like a transmitter lever; on gives
                          // stick centred = idle, which is how a gamepad feels naturally
  tiltComp: true,
  mode: 'acro',           // 'angle' levels the quad when the sticks are centred
  sound: true,
  track: 'loop',
  wind: 0,                // 0..1, steady wind plus gusts
  osd: 'full',            // 'full' | 'osd' (one line) | 'off'
  battery: false,         // a pack that drains and sags; off by default so laps stay comparable
  camTilt: 25,            // deg, FPV camera looking up out of the airframe
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sanitize = (r) => [clamp(+r?.[0] || 0, 0, 3000), clamp(+r?.[1] || 0, 0, 3000), clamp(+r?.[2] || 0, 0, 0.95)];

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw) return structuredClone(DEFAULTS);
    const s = structuredClone(DEFAULTS);
    if (PRESETS[raw.preset]) s.preset = raw.preset;
    if (LAYOUTS.some((l) => l.id === raw.layout)) s.layout = raw.layout;
    for (const ax of ['roll', 'pitch', 'yaw']) s.rates[ax] = sanitize(raw.rates?.[ax] ?? s.rates[ax]);
    s.sens = clamp(+raw.sens || 1, 0.3, 1.5);
    s.throttleOnTrigger = !!raw.throttleOnTrigger;
    s.invertThrottle = !!raw.invertThrottle;
    s.springThrottle = raw.springThrottle ?? s.springThrottle;
    s.tiltComp = raw.tiltComp ?? s.tiltComp;
    if (raw.mode === 'acro' || raw.mode === 'angle') s.mode = raw.mode;
    s.sound = raw.sound ?? s.sound;
    if (TRACK_IDS.includes(raw.track)) s.track = raw.track;
    s.battery = !!raw.battery;
    s.wind = clamp(+raw.wind || 0, 0, 1);
    if (['full', 'osd', 'off'].includes(raw.osd)) s.osd = raw.osd;
    s.camTilt = clamp(+raw.camTilt || s.camTilt, 0, 60);
    return s;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode, ignore */ }
}

export function applyPreset(s, name) {
  s.preset = name;
  for (const ax of ['roll', 'pitch', 'yaw']) s.rates[ax] = [...PRESETS[name][ax]];
}

export const layoutById = (id) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[1];