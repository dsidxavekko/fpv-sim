// Quadcopter flight model. Only dependency is the pure-data settings module, so it
// still runs in node for tests.
// Body axes: X = right, Y = up, Z = back (forward = -Z), same as three.js.
// Motor order: [FL, FR, RL, RR].
// Props: FL/RR spin CW seen from above, FR/RL spin CCW, so FL/RR yaw right.

import { DEFAULTS } from './settings.js';

export const CFG = {
  // mass & geometry
  mass: 0.65,                              // kg
  arm: 0.115,                              // m, motor distance from CG
  inertia: { x: 0.0045, y: 0.0080, z: 0.0045 }, // kg*m^2
  gravity: 9.81,

  // motors
  thrustMax: 6.1,                          // N per motor at 100% (5" quad on 6S)
  thrustExp: 2,                            // T = thrustMax * cmd^exp (2 = physical RPM^2)
  yawArm: 0.016,                           // m, effective yaw moment arm of one prop
  motorTau: 0.025,                         // s, ESC + motor spool lag
  authority: 0.6,                          // max control thrust differential
  tiltComp: 1.8,                           // max thrust boost when holding altitude through a bank

  // aero. Coefficients are accelerations: a = k * v * |v|, already divided by mass.
  // The forward drag was originally 0.005, which let the quad hit 190 km/h in a
  // dive; a real 5" peaks around 140. Cd*A ~ 0.015 m^2 with the props in the flow.
  drag: { x: 0.045, y: 0.010, z: 0.045 },   // body frame, Y is through the rotor disc
  angDamp: 0.0006,                         // quadratic roll/pitch damping
  angDampYaw: 0.0025,                      // yaw is damped hard by the props
  linAngDamp: 0.0008,                      // linear term, keeps the integrator calm

  // rate controller (acro, like Betaflight RATE mode)
  kp: 0.05, ki: 0.15, kd: 0.002,
  iLimit: 0.10,                            // N*m integral windup clamp
  flipBoost: 2,                            // a 360 deg roll needs more than stick rates give

  // angle (self-level) mode: the stick commands a tilt, an outer P loop turns the tilt
  // error into the rate setpoint the same PID already tracks
  angleMax: 55,                            // deg of tilt at full stick
  angleGain: 6,                            // 1/s, rate setpoint per rad of tilt error
  angleRateMax: 400,                       // deg/s, so a big error cannot ask for a flip

  // battery (opt-in). Charge 0..1 drains with motor load (command^1.5); below `sagBelow`
  // the thrust ceiling falls with the voltage, until the quad cannot hover any more.
  battery: {
    drain: 0.0119,                         // charge/s at m^1.5 = 1, ~4 min of hover
    sagBelow: 0.25,                        // charge where the voltage sag starts
    floor: 0.2,                            // thrust scale at 0 charge, too low to hover
  },

  // wind (opt-in): `strength` 0..1 scales this peak mean speed
  windMax: 8,                              // m/s of steady wind at strength 1
  windDir: 0.6,                            // rad, the way the air moves in the x-z plane

  // integration
  dt: 1 / 480,
  wMax: 45,                                // rad/s clamp (flips)
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const DEG = Math.PI / 180;
const DEFAULT_RATES = DEFAULTS.rates;

/**
 * Betaflight "Actual" rates, straight from the firmware (PR #9495).
 * Turns a stick position into an angular rate in deg/s.
 *   rate(0) = 0, rate(1) = max, and expo moves the kink point between them.
 */
export function actualRate(u, [centre, max, expo]) {
  const a = Math.abs(u);
  const shaped = a * (u ** 5 * expo + u * (1 - expo));
  return u * centre + Math.max(0, max - centre) * shaped;
}

/** Same curve in rad/s, which is what the PID controller wants. */
export const rateFor = (u, rates, sens = 1) => actualRate(u, rates) * DEG * sens;

export function rotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}
export const toWorld = (q, v) => rotate(q, v);
export const toBody = (q, v) => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function yawToQuat(yawRad) {
  return { x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) };
}

/** Pitch (nose up +) and roll (bank right +) of a body quaternion, in radians. */
export function attitude(q) {
  const f = toWorld(q, { x: 0, y: 0, z: -1 });
  const r = toWorld(q, { x: 1, y: 0, z: 0 });
  const u = toWorld(q, { x: 0, y: 1, z: 0 });
  return {
    pitch: Math.asin(clamp(f.y, -1, 1)),
    roll: -Math.atan2(r.y, u.y),
  };
}

export function createDrone() {
  return {
    p: { x: 0, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 0 },
    q: { x: 0, y: 0, z: 0, w: 1 },
    w: { x: 0, y: 0, z: 0 },      // body-frame angular velocity
    m: [0, 0, 0, 0],              // lagged motor commands
    integ: { x: 0, y: 0, z: 0 },
    wPrev: { x: 0, y: 0, z: 0 },
    flip: null,                    // { dir, t } while a roll flip is running
    crashed: false,
    charge: 1,                     // battery 0..1, only used when opts.battery
    t: 0,                          // sim seconds, drives the wind gusts
  };
}

export function resetDrone(d, pos, yaw = 0, throttle = hoverThrottle()) {
  d.p = { ...pos };
  d.v = { x: 0, y: 0, z: 0 };
  d.q = yawToQuat(yaw);
  d.w = { x: 0, y: 0, z: 0 };
  d.m = [throttle, throttle, throttle, throttle]; // armed and already spinning
  d.integ = { x: 0, y: 0, z: 0 };
  d.wPrev = { x: 0, y: 0, z: 0 };
  d.flip = null;
  d.crashed = false;
  d.charge = 1;
  d.t = 0;
}

/**
 * Air velocity (m/s, world frame) at sim time t. A steady wind with slow gusts layered
 * from incommensurate sines, so it never repeats audibly yet stays deterministic for
 * tests. Vertical turbulence is a fraction of the horizontal gust.
 */
export function windAt(t, strength) {
  if (!strength) return { x: 0, y: 0, z: 0 };
  const gust = 0.75 + 0.2 * Math.sin(0.31 * t) + 0.15 * Math.sin(1.7 * t + 1);
  const speed = CFG.windMax * strength * gust;
  const swing = CFG.windDir + 0.25 * Math.sin(0.13 * t + 2);
  return {
    x: speed * Math.cos(swing),
    y: 0.25 * speed * Math.sin(2.3 * t + 0.5),
    z: speed * Math.sin(swing),
  };
}

/** Multiplier on thrust for a given charge: 1 while the pack is healthy, then sagging. */
export const batteryScale = (charge) => {
  const { sagBelow, floor } = CFG.battery;
  return floor + (1 - floor) * clamp(charge / sagBelow, 0, 1);
};

/** Throttle (0..1) that holds altitude at rest. Handy for tests and the HUD. */
export const hoverThrottle = () => Math.pow((CFG.mass * CFG.gravity) / (4 * CFG.thrustMax), 1 / CFG.thrustExp);

/**
 * Airmode, on by default in Betaflight. When one channel saturates, all four are
 * shifted together so total thrust stays what the pilot asked for. Without it a
 * hard roll at low throttle silently costs thrust.
 * `want` is the sum the mixer asked for; the offsets cancel so it is 4 * throttle.
 */
function airmode(cmds, want) {
  const sumAt = (s) => {
    let n = 0;
    for (const c of cmds) n += clamp(c + s, 0, 1);
    return n;
  };
  if (Math.abs(sumAt(0) - want) < 1e-6) return cmds.map((c) => clamp(c, 0, 1));

  // sumAt is monotonic in s, so bisect for the shift that hits `want` as closely
  // as the motor range allows. When it cannot be reached we land on the limit.
  let lo = -1, hi = 1;
  if (sumAt(hi) < want) return cmds.map((c) => clamp(c + hi, 0, 1));
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) < want) lo = mid; else hi = mid;
  }
  return cmds.map((c) => clamp(c + (lo + hi) / 2, 0, 1));
}

/**
 * Four motor commands from the three torque demands. Each unit of offset produces
 * exactly the torque the comment names; yaw comes from diagonal pairs.
 */
export function mixer(tau, throttle) {
  const lim = (t, a) => clamp(t / (4 * a), -CFG.authority, CFG.authority);
  const offP = lim(tau.x, CFG.arm);
  const offR = lim(tau.z, CFG.arm);
  const offY = lim(tau.y, CFG.yawArm);
  // the offsets cancel out, so the requested total is always 4 * throttle
  return airmode([
    throttle + offP - offR + offY,   // FL
    throttle + offP + offR - offY,   // FR
    throttle - offP - offR - offY,   // RL
    throttle - offP + offR + offY,   // RR
  ], throttle * 4);
}

export function startFlip(d, dir) {
  d.flip = { dir, acc: 0, done: false };
}

/**
 * Advance one fixed step.
 * input: { throttle 0..1, pitch -1..1 (nose up +), roll -1..1 (bank right +), yaw -1..1 (right +) }
 * rates: { roll, pitch, yaw } each [centre deg/s, max deg/s, expo]
 * opts:  { tiltComp: bool, sens: number, mode: 'acro' | 'angle', battery: bool, wind: 0..1 }
 */
export function step(d, input, dt = CFG.dt, rates = DEFAULT_RATES, opts = {}) {
  const { mass, arm, inertia: I, gravity } = CFG;
  const sens = opts.sens ?? 1;

  // ---- flip: hold full roll authority until a full 2pi of roll has accumulated ----
  let rollCmd = input.roll;
  let boost = 1;
  if (d.flip && !d.flip.done) {
    rollCmd = d.flip.dir;
    // taper the boost near the end, otherwise the drone carries a huge rate out of
    // the flip and coasts well past 360 deg
    const left = (Math.PI * 2 - d.flip.acc) / (Math.PI * 2);
    boost = 1 + (CFG.flipBoost - 1) * clamp(left / 0.85, 0, 1);
    d.flip.acc += d.flip.dir * -d.w.z * dt;
    if (d.flip.acc >= Math.PI * 2) d.flip.done = true;
  }

  // ---- rate setpoints (body axes) ----
  // A flip is a full-power manoeuvre by definition, so it ignores the sens slider
  const tgt = {
    x: rateFor(input.pitch, rates.pitch, sens),                        // nose up
    z: -rateFor(rollCmd, rates.roll, boost > 1 ? 1 : sens) * boost,    // bank right = -Z rotation
    y: rateFor(input.yaw, rates.yaw, sens),                            // yaw right
  };
  // Angle mode replaces roll and pitch rates with a self-levelling loop. A flip is
  // still a rate manoeuvre, so it keeps the acro setpoints until it is done.
  if (opts.mode === 'angle' && !(d.flip && !d.flip.done)) {
    const lim = CFG.angleRateMax * DEG;
    const max = CFG.angleMax * DEG;
    const att = attitude(d.q);
    tgt.x = clamp(CFG.angleGain * (input.pitch * max - att.pitch), -lim, lim);
    tgt.z = -clamp(CFG.angleGain * (input.roll * max - att.roll), -lim, lim);
  }

  // ---- PID on each rate axis ----
  const tau = {};
  for (const ax of ['x', 'y', 'z']) {
    const e = tgt[ax] - d.w[ax];
    d.integ[ax] += e * dt;
    const iMax = CFG.iLimit / CFG.ki;
    d.integ[ax] = clamp(d.integ[ax], -iMax, iMax);
    const dTerm = -(d.w[ax] - d.wPrev[ax]) / dt;
    tau[ax] = CFG.kp * e + CFG.ki * d.integ[ax] + CFG.kd * dTerm;
  }
  d.wPrev = { ...d.w };

  // ---- mixer ----
  const cmds = mixer(tau, input.throttle);

  // ---- motor spool lag (exact exponential) ----
  const k = 1 - Math.exp(-dt / CFG.motorTau);
  let scale = 1;
  if (opts.battery) {
    scale = batteryScale(d.charge);
    const load = d.m.reduce((n, m) => n + Math.pow(Math.max(0, m), 1.5), 0) / 4;
    d.charge = Math.max(0, d.charge - CFG.battery.drain * load * dt);
  }
  const T = cmds.map((c, i) => {
    d.m[i] += (c - d.m[i]) * k;
    return CFG.thrustMax * Math.pow(d.m[i], CFG.thrustExp) * scale;
  });
  let total = T[0] + T[1] + T[2] + T[3];

  // ---- thrust compensation ----
  // A real quad loses height when it banks, because the thrust vector tips away
  // from vertical. That is honest but it means the right stick also moves your
  // altitude. When this is on we scale thrust by 1/cos(tilt) so the vertical
  // component stays put and roll/pitch are pure rotation inputs.
  if (opts.tiltComp) {
    const cosTilt = toWorld(d.q, { x: 0, y: 1, z: 0 }).y;
    if (cosTilt < 0.999) total = Math.min(total / Math.max(0.05, cosTilt), total * CFG.tiltComp);
  }

  // ---- forces ----
  // drag acts on the velocity relative to the air, so wind pushes the quad around
  const air = windAt(d.t, opts.wind);
  d.t += dt;
  const vb = toBody(d.q, { x: d.v.x - air.x, y: d.v.y - air.y, z: d.v.z - air.z });
  const dragB = {
    x: -CFG.drag.x * vb.x * Math.abs(vb.x),
    y: -CFG.drag.y * vb.y * Math.abs(vb.y),
    z: -CFG.drag.z * vb.z * Math.abs(vb.z),
  };
  const fThrust = toWorld(d.q, { x: 0, y: total, z: 0 });
  const fDrag = toWorld(d.q, dragB);

  d.v.x += ((fThrust.x + fDrag.x) / mass) * dt;
  d.v.y += ((fThrust.y + fDrag.y) / mass - gravity) * dt;
  d.v.z += ((fThrust.z + fDrag.z) / mass) * dt;
  d.p.x += d.v.x * dt;
  d.p.y += d.v.y * dt;
  d.p.z += d.v.z * dt;

  // ---- torques from the actual (post-saturation) motor thrusts ----
  const tx = arm * (T[0] + T[1] - T[2] - T[3]);
  const ty = CFG.yawArm * (T[0] + T[3] - T[1] - T[2]);
  const tz = arm * (T[1] + T[3] - T[0] - T[2]);

  // gyroscopic coupling + drag damping
  const gyro = cross(d.w, { x: I.x * d.w.x, y: I.y * d.w.y, z: I.z * d.w.z });
  const damp = (w, k) => -k * w * Math.abs(w) - CFG.linAngDamp * w;

  const alpha = {
    x: (tx - gyro.x + damp(d.w.x, CFG.angDamp)) / I.x,
    y: (ty - gyro.y + damp(d.w.y, CFG.angDampYaw)) / I.y,
    z: (tz - gyro.z + damp(d.w.z, CFG.angDamp)) / I.z,
  };
  for (const ax of ['x', 'y', 'z']) {
    d.w[ax] = clamp(d.w[ax] + alpha[ax] * dt, -CFG.wMax, CFG.wMax);
  }

  // ---- quaternion integration (body-frame omega) ----
  const hx = d.w.x * dt * 0.5, hy = d.w.y * dt * 0.5, hz = d.w.z * dt * 0.5;
  const { x, y, z, w } = d.q;
  let nx = x + (w * hx + y * hz - z * hy);
  let ny = y + (w * hy + z * hx - x * hz);
  let nz = z + (w * hz + x * hy - y * hx);
  let nw = w - (x * hx + y * hy + z * hz);
  const inv = 1 / Math.hypot(nx, ny, nz, nw);
  d.q = { x: nx * inv, y: ny * inv, z: nz * inv, w: nw * inv };
}

/** Convenience for tests/sim: run n steps at CFG.dt with a fixed input. */
export function run(d, input, seconds, rates, opts) {
  const n = Math.round(seconds / CFG.dt);
  for (let i = 0; i < n; i++) step(d, input, CFG.dt, rates, opts);
  return d;
}