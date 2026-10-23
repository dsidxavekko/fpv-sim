// node test/physics.test.mjs
import assert from 'node:assert/strict';
import { CFG, createDrone, resetDrone, run, step, hoverThrottle, startFlip, rateFor, mixer, attitude, batteryScale, windAt } from '../src/physics.js';
import { DEFAULTS } from '../src/settings.js';

const hover = hoverThrottle();
console.log(`hover throttle = ${hover.toFixed(3)}  (want ~0.45-0.55)`);

// 1. hover: constant throttle, altitude must not drift away.
{
  const d = createDrone();
  resetDrone(d, { x: 0, y: 0, z: 0 });
  run(d, { throttle: hover, pitch: 0, roll: 0, yaw: 0 }, 4);
  console.log(`hover drift 4s = ${d.p.y.toFixed(3)} m, |v| = ${Math.hypot(d.v.x, d.v.y, d.v.z).toFixed(3)}`);
  assert.ok(Math.abs(d.p.y) < 0.5, `hover drifted to ${d.p.y.toFixed(2)} m`);
}

// 2. free fall must accelerate at g (measured as a difference, drag is tiny here).
{
  const d = createDrone();
  resetDrone(d, { x: 0, y: 0, z: 0 });
  run(d, { throttle: 0, pitch: 0, roll: 0, yaw: 0 }, 0.4); // let motors spool down
  const v0 = d.v.y;
  run(d, { throttle: 0, pitch: 0, roll: 0, yaw: 0 }, 0.1);
  const g = (d.v.y - v0) / -0.1;
  console.log(`free fall g = ${g.toFixed(2)} m/s^2`);
  assert.ok(Math.abs(g - 9.81) < 0.4, `expected ~9.81, got ${g.toFixed(2)}`);
}

// 3. rate step response: how fast does the drone reach the commanded roll rate?
{
  const rates = DEFAULTS.rates;
  const target = rateFor(1, rates.roll);   // already rad/s
  const d = createDrone();
  resetDrone(d, { x: 0, y: 0, z: 0 });
  run(d, { throttle: hover, pitch: 0, roll: 0, yaw: 0 }, 1, rates); // settle at hover

  let t = 0, rise = null, peak = 0;
  const n = Math.round(1.5 / CFG.dt);
  for (let i = 0; i < n; i++) {
    step(d, { throttle: hover, pitch: 0, roll: 1, yaw: 0 }, CFG.dt, rates);
    t += CFG.dt;
    peak = Math.min(peak, d.w.z); // bank right = negative body-Z rate
    if (rise === null && -d.w.z >= target * 0.9) rise = t;
  }
  const over = ((-peak - target) / target) * 100;
  console.log(`roll: target ${(target * 180 / Math.PI).toFixed(0)} deg/s, rise(90%) = ${rise === null ? 'never' : (rise * 1000).toFixed(0) + ' ms'}, peak = ${(-peak * 180 / Math.PI).toFixed(0)} deg/s, overshoot = ${over.toFixed(1)}%`);
  assert.ok(rise !== null, 'roll never reached 90% of commanded rate');
  assert.ok(rise < 0.3, `rise time ${rise === null ? 'n/a' : (rise * 1000).toFixed(0)} ms is too slow`);
  assert.ok(over < 40, `overshoot ${over.toFixed(0)}% is too high`);
  assert.ok(Math.abs(-d.w.z - target) < target * 0.08, `settled at ${(-d.w.z * 180 / Math.PI).toFixed(0)} deg/s, want ${(target * 180 / Math.PI).toFixed(0)}`);
}

// 4. rotation direction: stick right must bank right (negative body-Z rate)
//    and stick forward must pitch nose-up (positive body-X rate).
{
  const mk = (input) => {
    const d = createDrone();
    resetDrone(d, { x: 0, y: 0, z: 0 });
    run(d, { throttle: hover, ...input }, 0.3);
    return d;
  };
  const right = mk({ throttle: hover, pitch: 0, roll: 1, yaw: 0 });
  assert.ok(right.w.z < -1, 'roll stick right should give negative body-Z rate');
  const fwd = mk({ throttle: hover, pitch: -1, roll: 0, yaw: 0 }); // stick forward = nose down
  assert.ok(fwd.w.x < -1, 'stick forward should give negative body-X rate (nose down)');
  const yawR = mk({ throttle: hover, pitch: 0, roll: 0, yaw: 1 });
  assert.ok(yawR.w.y > 1, 'yaw right should give positive body-Y rate');
}

// 5. flip recovers to level flight.
{
  const d = createDrone();
  resetDrone(d, { x: 0, y: 0, z: 0 });
  run(d, { throttle: hover, pitch: 0, roll: 0, yaw: 0 }, 1);
  startFlip(d, 1);
  run(d, { throttle: hover, pitch: 0, roll: 0, yaw: 0 }, 1.5);
  const up = 1 - 2 * (d.q.x * d.q.x + d.q.z * d.q.z); // cos(roll angle)
  console.log(`flip: ended roll = ${((Math.acos(clamp1(up)) * 180) / Math.PI).toFixed(0)} deg`);
  assert.ok(Math.abs(up - 1) < 0.05, 'flip should end roughly level');
}
function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

// 6. no NaN / no blowup under 60 s of violent random input.
{
  const d = createDrone();
  resetDrone(d, { x: 0, y: 0, z: 0 });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  run(d, { throttle: hover, pitch: 0, roll: 0, yaw: 0 }, 1);
  for (let i = 0; i < Math.round(60 / CFG.dt); i++) {
    step(d, { throttle: (rnd() + 1) / 2, pitch: rnd(), roll: rnd(), yaw: rnd() });
  }
  const bad = !isFinite(d.p.x + d.p.y + d.p.z + d.v.x + d.v.y + d.v.z + d.q.w);
  console.log(`60s random: pos ${d.p.x.toFixed(0)},${d.p.y.toFixed(0)},${d.p.z.toFixed(0)}`);
  assert.ok(!bad, 'state went non-finite');
  assert.ok(Math.hypot(d.v.x, d.v.y, d.v.z) < 200, 'velocity exploded');
}

// 7. airmode: when a channel saturates the total thrust must survive
{
  // low throttle + a big roll demand: two motors want to go negative
  const cmds = mixer({ x: 0, y: 0, z: 0.35 }, 0.2);
  const sum = cmds.reduce((a, c) => a + c, 0);
  console.log(`airmode: mixer at 0.2 throttle -> [${cmds.map((c) => c.toFixed(3)).join(', ')}], sum ${sum.toFixed(3)} (want 0.800)`);
  assert.ok(Math.abs(sum - 0.8) < 1e-3, `total motor command drifted to ${sum.toFixed(3)}`);
  assert.ok(cmds.every((c) => c >= 0 && c <= 1), 'commands left the 0..1 range');
  // without airmode this case would silently double the requested thrust
  const naive = [0.2 - 0.6, 0.2 + 0.6, 0.2 - 0.6, 0.2 + 0.6].map((c) => Math.min(1, Math.max(0, c)));
  assert.ok(naive.reduce((a, c) => a + c, 0) > sum + 0.5, 'test is meaningless: naive mix does not overshoot');

  // a demand the motors genuinely cannot meet must clamp, not exceed, the range
  const hard = mixer({ x: 0, y: 0, z: 9 }, 0.2);
  assert.ok(hard.every((c) => c >= 0 && c <= 1), 'commands left the 0..1 range');
}

// 8. tilt compensation: holding a bank must not cost altitude when it is on.
// Acro keeps whatever attitude you leave it in, so pin a 45 deg bank and hold it.
// Compare altitude drift: with the higher forward drag the compensated case now
// climbs slightly (real aerodynamics, the body-axis drag tilts with the craft),
// so the check is "materially better than uncompensated", not "exactly zero".
{
  const rates = DEFAULTS.rates;
  const held = (opts) => {
    const d = createDrone();
    resetDrone(d, { x: 0, y: 0, z: 0 });
    const phi = Math.PI / 4;
    d.q = { x: 0, y: 0, z: Math.sin(phi / 2), w: Math.cos(phi / 2) };
    run(d, { throttle: hover, pitch: 0, roll: 0, yaw: 0 }, 2, rates, opts);
    return d.p.y;
  };
  const off = held({ tiltComp: false });
  const on = held({ tiltComp: true });
  console.log(`tilt compensation: 2s holding a 45 deg bank  off=${off.toFixed(2)}m  on=${on.toFixed(2)}m`);
  assert.ok(off < -2, `a 45 deg bank should cost altitude with compensation off, got ${off.toFixed(2)} m`);
  assert.ok(Math.abs(on) < 1.5, `compensation should roughly hold altitude, drifted to ${on.toFixed(2)} m`);
  assert.ok(on > off + 1.5, 'compensation made no meaningful difference');
}

// 9. top speed must look like a real 5" quad. This is the check that failed
//    when drag was 7x too low and the sim hit 190 km/h in a shallow dive.
{
  // Horizontal speed is what the pilot feels; vertical is a by-product of the bank.
  const speed = (bankDeg, throttle) => {
    const d = createDrone();
    resetDrone(d, { x: 0, y: 50000, z: 0 });
    const phi = (bankDeg * Math.PI) / 180;
    d.q = { x: 0, y: 0, z: Math.sin(phi / 2), w: Math.cos(phi / 2) };
    for (let i = 0; i < Math.round(15 / CFG.dt); i++) {
      step(d, { throttle, pitch: 0, roll: 0, yaw: 0 }, CFG.dt, DEFAULTS.rates, { tiltComp: false });
    }
    return Math.hypot(d.v.x, d.v.z) * 3.6;
  };
  const full = speed(45, 1.0);
  const cruise = speed(30, 0.7);
  console.log(`top speed: full throttle 45deg bank = ${full.toFixed(0)} km/h, 70% throttle 30deg bank = ${cruise.toFixed(0)} km/h`);
  assert.ok(full > 120 && full < 160, `top speed ${full.toFixed(0)} km/h is outside the real 5" quad range of 120-160`);
  assert.ok(cruise < full, 'cruising must be slower than full throttle');
  assert.ok(cruise > 60, `cruise speed ${cruise.toFixed(0)} km/h is too slow to race`);
}

// angle mode: released sticks level the quad, full stick holds angleMax
{
  const opts = { tiltComp: true, mode: 'angle' };
  const idle = { throttle: hover, pitch: 0, roll: 0, yaw: 0 };
  const d = createDrone();
  resetDrone(d, { x: 0, y: 20, z: 0 });
  // start tipped 40 deg over and tumbling
  const phi = 40 * Math.PI / 180;
  d.q = { x: 0, y: 0, z: Math.sin(phi / 2), w: Math.cos(phi / 2) };
  run(d, idle, 2, DEFAULTS.rates, opts);
  const level = attitude(d.q);
  console.log(`angle mode: 40 deg tipped, 2 s later roll = ${(level.roll * 180 / Math.PI).toFixed(1)} pitch = ${(level.pitch * 180 / Math.PI).toFixed(1)}`);
  assert.ok(Math.abs(level.roll) < 0.05 && Math.abs(level.pitch) < 0.05, 'angle mode did not level the quad');

  run(d, { ...idle, roll: 1 }, 2, DEFAULTS.rates, opts);
  const held = attitude(d.q).roll * 180 / Math.PI;
  console.log(`angle mode: full right stick holds ${held.toFixed(1)} deg (limit ${CFG.angleMax})`);
  assert.ok(Math.abs(held - CFG.angleMax) < 4, `held ${held.toFixed(1)} deg, wanted ${CFG.angleMax}`);

  run(d, { ...idle, pitch: -1 }, 1.5, DEFAULTS.rates, opts);
  assert.ok(attitude(d.q).pitch < -0.5, 'nose-down stick did not pitch the nose down');

  // a flip still works in angle mode
  resetDrone(d, { x: 0, y: 30, z: 0 });
  startFlip(d, 1);
  run(d, idle, 1.5, DEFAULTS.rates, opts);
  assert.ok(d.flip.done, 'flip never finished in angle mode');
}

// battery: hover lasts minutes, then the pack sags until the quad can no longer hold up
{
  const opts = { tiltComp: true, battery: true };
  const idle = { throttle: hover, pitch: 0, roll: 0, yaw: 0 };
  const d = createDrone();
  resetDrone(d, { x: 0, y: 500, z: 0 });
  run(d, idle, 60, DEFAULTS.rates, opts);
  console.log(`battery: ${(d.charge * 100).toFixed(0)}% after 60 s of hover`);
  assert.ok(d.charge < 0.95 && d.charge > 0.7, `hover should use ~25% a minute, left ${d.charge}`);
  assert.ok(batteryScale(1) === 1 && batteryScale(0) < 0.3, 'sag curve endpoints');

  // flat pack, throttle held at the hover point it used to have: it must sink
  d.charge = 0;
  const y0 = d.p.y;
  run(d, idle, 3, DEFAULTS.rates, opts);
  assert.ok(d.p.y < y0 - 5, 'an empty pack should not hold altitude');

  // default (battery off) never drains
  const e = createDrone();
  resetDrone(e, { x: 0, y: 500, z: 0 });
  run(e, idle, 30, DEFAULTS.rates, {});
  assert.equal(e.charge, 1);
}

// wind: zero is exactly calm, deterministic, bounded; a hovering quad drifts downwind
{
  assert.deepEqual(windAt(5, 0), { x: 0, y: 0, z: 0 });
  assert.deepEqual(windAt(12.3, 0.5), windAt(12.3, 0.5));
  for (let t = 0; t < 300; t += 0.37) {
    const w = windAt(t, 1);
    assert.ok(Math.hypot(w.x, w.z) < CFG.windMax * 1.2 + 1e-9, 'gust above the cap');
  }
  const idle = { throttle: hover, pitch: 0, roll: 0, yaw: 0 };
  const calm = createDrone(), windy = createDrone();
  resetDrone(calm, { x: 0, y: 100, z: 0 });
  resetDrone(windy, { x: 0, y: 100, z: 0 });
  run(calm, idle, 10, DEFAULTS.rates, {});
  run(windy, idle, 10, DEFAULTS.rates, { wind: 1 });
  const drift = Math.hypot(windy.p.x, windy.p.z);
  console.log(`wind: 10 s hover drifted ${drift.toFixed(1)} m (calm: ${Math.hypot(calm.p.x, calm.p.z).toFixed(2)} m)`);
  assert.ok(Math.hypot(calm.p.x, calm.p.z) < 0.01, 'calm air must not move a hovering quad');
  assert.ok(drift > 2, 'wind should carry a hovering quad');
}

console.log('\nall physics checks passed');