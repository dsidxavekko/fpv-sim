// node test/rates.test.mjs
import assert from 'node:assert/strict';
import { actualRate, rateFor } from '../src/physics.js';
import { PRESETS, LAYOUTS, DEFAULTS, applyPreset, MAX_RATE_LIMIT } from '../src/settings.js';

const pct = [0, 0.25, 0.5, 0.75, 1];
const row = (name, f) => `${name.padEnd(12)} ${pct.map((p) => f(p).toFixed(0).padStart(6)).join('')}`;

console.log('roll rate deg/s at stick   0%   25%   50%   75%  100%');
// what the sim used before: linear+cubic blend at 458 deg/s max
const old = (u) => (0.55 * u + 0.45 * u ** 3) * 458;
console.log(row('was', old));
for (const [k, p] of Object.entries(PRESETS)) console.log(row(k, (u) => actualRate(u, p.roll)));
console.log('');

// defaults must agree with the freestyle preset, in both modules
assert.deepEqual(DEFAULTS.rates.roll, PRESETS.freestyle.roll, 'default roll rates drifted from the freestyle preset');

// every preset: zero at centre, exactly max at full deflection, monotonic, no overshoot
for (const [k, p] of Object.entries(PRESETS)) {
  for (const ax of ['roll', 'pitch', 'yaw']) {
    const r = p[ax];
    assert.equal(actualRate(0, r), 0, `${k}.${ax} must be 0 at centre`);
    assert.ok(Math.abs(actualRate(1, r) - r[1]) < 1e-9, `${k}.${ax} must equal max rate at full stick`);
    assert.ok(Math.abs(actualRate(-1, r) + r[1]) < 1e-9, `${k}.${ax} must be symmetric`);
    let prev = 0;
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const v = actualRate(u, r);
      assert.ok(v >= prev - 1e-9, `${k}.${ax} not monotonic at u=${u.toFixed(2)}`);
      assert.ok(v <= r[1] + 1e-9, `${k}.${ax} exceeds max rate at u=${u.toFixed(2)}`);
      prev = v;
    }
  }
}

// Gamepad presets must stay far below radio numbers. A 5" freestyle quad runs
// 600-750 deg/s on a real transmitter; on a 20 mm stick throw that is violent.
for (const [k, p] of Object.entries(PRESETS)) {
  assert.ok(actualRate(1, p.roll) <= MAX_RATE_LIMIT,
    `${k} max rate ${actualRate(1, p.roll)} exceeds the gamepad limit of ${MAX_RATE_LIMIT}`);
}

// and every preset must be gentler than the old radio-derived curve everywhere
for (const [k, p] of Object.entries(PRESETS)) {
  for (const u of [0.25, 0.5, 0.75, 1.0]) {
    assert.ok(actualRate(u, p.roll) < old(u),
      `${k} is not gentler than before at ${u * 100}% stick (${actualRate(u, p.roll).toFixed(0)} vs ${old(u).toFixed(0)})`);
  }
}

// "the stick bites" is about degrees per 10% of throw in absolute terms, not the
// slope ratio: a curve can be steep in ratio terms and feel fine if the absolute
// step stays small. What has to hold is that no 10% of travel ever buys more
// rotation than a real freestyle quad gives at the same point.
const decile = (r) => (u) => actualRate(u, r) - actualRate(u - 0.1, r);
for (const [k, p] of Object.entries(PRESETS)) {
  const d = decile(p.roll);
  const row = [0.1, 0.5, 0.9, 1].map((u) => d(u).toFixed(0).padStart(4)).join(' ');
  console.log(`${k.padEnd(10)} deg/s per 10% throw  at 10/50/90/100%: ${row}`);
  assert.ok(d(0.1) < 12, `${k}: centre is too hot, ${d(0.1).toFixed(0)} deg/s in the first 10%`);
  assert.ok(d(1) < 130, `${k}: last 10% of stick adds ${d(1).toFixed(0)} deg/s, which bites`);
}

// sens scales every rate linearly
for (const k of Object.keys(PRESETS)) {
  for (const u of [0.3, 0.7, 1.0]) {
    assert.ok(Math.abs(rateFor(u, PRESETS[k].roll, 0.5) - rateFor(u, PRESETS[k].roll, 1) * 0.5) < 1e-9,
      `${k}: sens must scale linearly at u=${u}`);
  }
}
assert.equal(rateFor(1, PRESETS.freestyle.roll, 0.3), actualRate(1, PRESETS.freestyle.roll) * Math.PI / 180 * 0.3);

// yaw must stay calmer than roll on every preset, that is how real pilots fly
for (const [k, p] of Object.entries(PRESETS)) {
  assert.ok(actualRate(1, p.yaw) < actualRate(1, p.roll), `${k}: yaw max should be below roll max`);
}

// expo must flatten the centre without touching either endpoint
for (const expo of [0, 0.4, 0.7]) {
  const r = [70, 670, expo];
  assert.equal(actualRate(0, r), 0);
  assert.ok(Math.abs(actualRate(1, r) - 670) < 1e-9, 'expo must not change max rate');
  assert.ok(actualRate(0.25, [70, 670, 0.7]) < actualRate(0.25, [70, 670, 0]), 'expo must soften the centre');
}

// ---- layouts ----
// Mode 2 must be the layout the sim shipped with: left = gas + yaw, right = roll + pitch
const m = LAYOUTS.find((l) => l.id === 2);
assert.deepEqual(m.map, { roll: 'rx', pitch: 'ry', throttle: 'ly', yaw: 'lx' });

// every layout must use each of the four axes exactly once
const ALL_AXES = ['lx', 'ly', 'rx', 'ry'].sort().join('');
for (const l of LAYOUTS) {
  const used = Object.values(l.map).sort().join('');
  assert.equal(used, ALL_AXES, `layout ${l.id} is not a permutation of the four axes`);
}

// modes 1 and 3 put throttle on the right stick, 2 and 4 on the left
assert.equal(LAYOUTS.find((l) => l.id === 1).map.throttle, 'ry');
assert.equal(LAYOUTS.find((l) => l.id === 2).map.throttle, 'ly');
assert.equal(LAYOUTS.find((l) => l.id === 3).map.throttle, 'ry');
assert.equal(LAYOUTS.find((l) => l.id === 4).map.throttle, 'ly');

// all four must be distinct, and each must pair its sticks the way the RC standard says
const sig = LAYOUTS.map((l) => JSON.stringify(l.map)).join('|');
assert.equal(new Set(sig.split('|')).size, 4, 'layouts are duplicates of each other');
assert.deepEqual(LAYOUTS.find((l) => l.id === 3).map, { roll: 'rx', pitch: 'ly', throttle: 'ry', yaw: 'lx' });
assert.deepEqual(LAYOUTS.find((l) => l.id === 4).map, { roll: 'lx', pitch: 'ry', throttle: 'ly', yaw: 'rx' });

// applyPreset must overwrite all three axes
const s = { ...DEFAULTS, rates: { roll: [1, 1, 0], pitch: [1, 1, 0], yaw: [1, 1, 0] } };
applyPreset(s, 'cinematic');
assert.deepEqual(s.rates.roll, PRESETS.cinematic.roll);
assert.deepEqual(s.rates.yaw, PRESETS.cinematic.yaw);

// ---- the layout actually routes the stick axes ----
// input.js talks to the DOM and the Gamepad API, so stub just enough of both.
let padAxes = [0, 0, 0, 0];
let padButtons = [];
globalThis.addEventListener = () => {};
// node's navigator is a read-only getter, so shadow it on globalThis's prototype chain
Object.defineProperty(globalThis, 'navigator', {
  value: { getGamepads: () => [{ connected: true, id: 'stub', axes: padAxes, buttons: padButtons }] },
  configurable: true,
});

const { createInput } = await import('../src/input.js');
const AXIS_INDEX = { lx: 0, ly: 1, rx: 2, ry: 3 };

// run the layout matrix twice, once per throttle mode, since the resting value differs
let springThrottle = false;
function readWith(layout, axes) {
  padAxes = axes;
  padButtons = [];
  const s = createInput({ layout, throttleOnTrigger: false, invertThrottle: false, springThrottle });
  s.update(0.016);
  return s;
}

// With the stick centred, every control sits at rest. For throttle "rest" is idle
// on a spring and half gas on a lever; the attitude axes always rest at 0.
for (const l of LAYOUTS) {
  for (const [axis, idx] of Object.entries(AXIS_INDEX)) {
    for (springThrottle of [false, true]) {
      // ly is -1 when pushed forward (more gas); the others use +1
      for (const dir of [-1, 1]) {
        const pushed = [0, 0, 0, 0];
        pushed[idx] = dir;
        const out = readWith(l.id, pushed);
        for (const [ctrl, mapped] of Object.entries(l.map)) {
          if (mapped !== axis) {
            // an axis the layout does not own must not disturb that control
            const rest = ctrl === 'throttle' && !springThrottle ? 0.5 : 0;
            assert.ok(Math.abs(out[ctrl] - rest) < 0.05,
              `layout ${l.id} spring=${springThrottle}: ${axis}=${dir} wrongly moved ${ctrl} to ${out[ctrl].toFixed(2)}`);
          } else if (ctrl === 'throttle') {
            if (springThrottle) {
              // one sided: forward (-1) is full gas, centre and back are idle
              assert.ok(dir === -1 ? out[ctrl] > 0.9 : out[ctrl] < 0.05,
                `layout ${l.id}: spring throttle ${axis}=${dir} gave ${out[ctrl].toFixed(2)}`);
            } else {
              // lever: full travel maps 0..1
              assert.ok(dir === -1 ? out[ctrl] > 0.9 : out[ctrl] < 0.1,
                `layout ${l.id}: lever throttle ${axis}=${dir} gave ${out[ctrl].toFixed(2)}`);
            }
          } else {
            assert.ok(Math.abs(out[ctrl]) > 0.5,
              `layout ${l.id} spring=${springThrottle}: ${axis}=${dir} should drive ${ctrl} but gave ${out[ctrl].toFixed(2)}`);
          }
        }
      }
      // centred stick = nothing commanded
      const centred = readWith(l.id, [0, 0, 0, 0]);
      for (const ctrl of Object.keys(l.map)) {
        const rest = ctrl === 'throttle' && !springThrottle ? 0.5 : 0;
        assert.ok(Math.abs(centred[ctrl] - rest) < 0.05,
          `layout ${l.id} spring=${springThrottle}: centred stick left ${ctrl} at ${centred[ctrl].toFixed(2)}`);
      }
    }
  }
}

// throttle specifically: modes 1 and 3 read the right stick, 2 and 4 the left
assert.ok(readWith(1, [0, 0, 0, -1]).throttle > 0.9, 'Mode 1 gas should follow the right stick');
assert.ok(readWith(3, [0, 0, 0, -1]).throttle > 0.9, 'Mode 3 gas should follow the right stick');
assert.ok(readWith(2, [0, -1, 0, 0]).throttle > 0.9, 'Mode 2 gas should follow the left stick');
assert.ok(readWith(4, [0, -1, 0, 0]).throttle > 0.9, 'Mode 4 gas should follow the left stick');
// centring the stick must leave gas idle. This is spring mode specifically, so name it:
// the lever mode above leaves springThrottle at whatever the layout loop ended on.
springThrottle = true;
assert.ok(readWith(2, [0, 0, 0, 0]).throttle < 0.05, 'Mode 2 gas must be idle at centre');
assert.ok(readWith(2, [0, 0, 0, -1]).throttle < 0.05, 'Mode 2 gas must ignore the right stick');

// push the axis that drives yaw, stick to the right
const yawRight = (id) => {
  const axes = [0, 0, 0, 0];
  axes[AXIS_INDEX[LAYOUTS.find((l) => l.id === id).map.yaw]] = 1;
  return readWith(id, axes).yaw;
};

// Mode 2 flips that axis, so yaw runs the other way there and only there
assert.ok(yawRight(2) < -0.5, 'Mode 2: yaw stick right must yaw left');
assert.ok(yawRight(1) > 0.5, 'Mode 1: yaw must not be inverted');
assert.ok(yawRight(3) > 0.5, 'Mode 3: yaw must not be inverted');
assert.ok(yawRight(4) > 0.5, 'Mode 4: yaw must not be inverted');
// ...and in Mode 2 the other three controls keep their signs
assert.ok(readWith(2, [1, -1, 0, 0]).throttle > 0.9, 'Mode 2: gas must not be inverted');
assert.ok(readWith(2, [0, 0, 1, 0]).roll > 0.5, 'Mode 2: roll must not be inverted');
assert.ok(readWith(2, [0, 0, 0, 1]).pitch > 0.5, 'Mode 2: pitch must not be inverted');

// ---- throttle behaves as a spring or as a lever ----
// Mode 2 has the throttle on the left stick's Y axis: -1 is full forward.
const withPad = (opts, axes, trim) => {
  padAxes = axes;
  padButtons = [];
  const s = createInput({ layout: 2, throttleOnTrigger: false, invertThrottle: false, ...opts }, trim);
  s.update(0.016);
  return s;
};
const PUSHED = [0, -1, 0, 0];    // left stick fully forward = full gas
const RELEASED = [0, 0, 0, 0];   // stick back to centre

// spring: gas follows the stick, so releasing it cuts power
{
  const held = withPad({ springThrottle: true }, PUSHED).throttle;
  const after = withPad({ springThrottle: true }, RELEASED).throttle;
  assert.ok(held > 0.95, `spring throttle should be full gas when pushed, got ${held}`);
  assert.ok(after < 0.05, `spring throttle should drop to idle when released, got ${after}`);
}
// lever: gas stays where it was put, the way a real transmitter works
{
  const s = withPad({ springThrottle: false }, PUSHED);
  assert.ok(s.throttle > 0.95, 'lever should read full gas when pushed');
  padAxes = RELEASED;
  s.update(0.016);
  assert.ok(s.throttle > 0.95, `lever must hold its value on release, dropped to ${s.throttle}`);
}

// the sim arms the drone already trimmed for hover, so a centred lever must start
// there and hold it rather than snapping to half travel
assert.equal(DEFAULTS.springThrottle, false, 'the transmitter lever is the default');
{
  const trim = 0.51;
  const s = withPad({ springThrottle: false }, RELEASED, trim);
  assert.ok(Math.abs(s.throttle - trim) < 0.01, `lever should start at the hover trim, got ${s.throttle}`);
  s.update(0.016);
  assert.ok(Math.abs(s.throttle - trim) < 0.01, `centred stick must hold the trim, got ${s.throttle}`);
}

console.log('all rate and layout checks passed');