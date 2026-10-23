import * as THREE from 'three';
import { CFG, createDrone, resetDrone, step, startFlip, hoverThrottle, actualRate, attitude } from './physics.js';
import { createInput } from './input.js';
import { createWorld } from './world.js';
import { createGhost } from './ghost.js';
import { createAudio } from './audio.js';
import { createRecords } from './records.js';
import { TRACKS, TRACK_IDS } from './tracks.js';
import { LAYOUTS, PRESETS, loadSettings, saveSettings, applyPreset } from './settings.js';

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false, stencil: false, powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

let qScale = 1;                       // render resolution multiplier, dropped on slow machines
const applyQuality = () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * qScale);
  renderer.setSize(innerWidth, innerHeight, false);
};
applyQuality();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc6d8);
scene.fog = new THREE.Fog(0x9fc6d8, 45, 260);

const settings = loadSettings();
const camera = new THREE.PerspectiveCamera(100, innerWidth / innerHeight, 0.05, 600);
camera.rotation.x = settings.camTilt * Math.PI / 180;   // FPV cameras look up out of the airframe
const rig = new THREE.Object3D();
rig.add(camera);
scene.add(rig);

const world = createWorld(scene, settings.track);
const drone = createDrone();
const input = createInput(settings, hoverThrottle());   // the lever starts trimmed for hover

// ---------------------------------------------------------------- ghost
// Sampling, record keeping and playback live in ghost.js. What you see is always the
// lap you are trying to copy, and it switches to your new record the moment you set it.
const ghost = createGhost(localStorage, 20, settings.track);
const records = createRecords(localStorage, settings.track);
const _gp = {};

const ghostMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 0.10, 0.36),
  new THREE.MeshBasicMaterial({ color: 0x9dff5e, transparent: true, opacity: 0.4, depthWrite: false }),
);
ghostMesh.visible = false;
scene.add(ghostMesh);

const audio = createAudio();

// ---------------------------------------------------------------- race state
// The lap clock is accumulated from dt rather than read off performance.now(), so
// pausing simply stops it counting instead of charging you for the break.
let next = 0, lap = 1, lapMs = 0, crashes = 0, touching = false, paused = false;

function startRace() {
  next = 0;
  lap = 1;
  lapMs = 0;
  crashes = 0;
  for (const g of world.gates) g.sign = -1;
  world.highlight(next);
  place();
  ghost.startLap(drone.p.x, drone.p.y, drone.p.z);
}
// body forward is -Z, so yaw must point -Z along the track direction
function place() {
  const f = world.start.yaw;
  resetDrone(drone, world.start.pos, Math.atan2(-f.x, -f.z));
  message('');
}
const fmt = (ms) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};

// ---------------------------------------------------------------- HUD
const $ = (id) => document.getElementById(id);
const ui = {
  gate: $('gate'), gates: $('gates'), lap: $('lap'), kmh: $('kmh'), alt: $('alt'),
  thrFill: $('thrFill'), thrMark: $('thrMark'), hclip: $('hclip'), delta: $('delta'),
  msg: $('msg'), fps: $('fps'), batt: $('batt'), osd: $('osd'), battFill: $('battFill'), board: $('board'), start: $('start'), padName: $('padName'),
};
ui.gates.textContent = world.count;
ui.thrMark.style.bottom = `${(hoverThrottle() * 100).toFixed(0)}%`;   // hover throttle marker

const message = (t) => {
  ui.msg.textContent = t;
  ui.msg.style.display = t ? 'block' : 'none';
};

/** Live delta at the gate just crossed: negative means you are up on the ghost. */
const showDelta = (ms) => {
  ui.delta.textContent = ms == null ? '' : `${ms < 0 ? '−' : '+'}${Math.abs(ms / 1000).toFixed(2)}`;
  ui.delta.style.color = ms == null ? '' : (ms < 0 ? '#9dff5e' : '#ff7a2f');
  ui.delta.style.display = ms == null ? 'none' : 'inline';
};

// ---------------------------------------------------------------- settings UI
const AXES = ['roll', 'pitch', 'yaw'];
const AX_NAME = { roll: 'roll', pitch: 'pitch', yaw: 'yaw' };
const CURVE_COLOUR = { roll: '#7fd4ff', pitch: '#9dff5e', yaw: '#ffb347' };
const $sliders = $('sliders');
const refreshPicks = [];   // extra refreshers for the start-screen buttons

/** Re-mark every control after a change, wherever it came from. */
function syncAll() {
  refreshLayouts();
  refreshPresets();
  refreshSliders();
  refreshSens();
  drawCurve();
  refreshPicks.forEach((f) => f());
}

/** A row of toggle buttons. Returns a refresh() that re-marks the active one. */
function buttonGroup(host, items, get, set) {
  const made = items.map((it) => {
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.title) b.title = it.title;
    b.onclick = () => { set(it.id); saveSettings(settings); refresh(); };
    host.appendChild(b);
    return { b, id: it.id };
  });
  const refresh = () => made.forEach(({ b, id }) => b.setAttribute('aria-pressed', String(get() === id)));
  refresh();
  return refresh;
}

// centre deg/s, max deg/s, expo %
const SLIDER_DEFS = [
  { key: 0, label: 'centre', min: 0, max: 300, step: 5, scale: 1, unit: '' },
  { key: 1, label: 'max', min: 100, max: 900, step: 10, scale: 1, unit: '' },
  { key: 2, label: 'expo', min: 0, max: 90, step: 5, scale: 100, unit: '%' },
];

for (const ax of AXES) {
  const head = document.createElement('div');
  head.className = 'axis';
  head.textContent = AX_NAME[ax];
  $sliders.appendChild(head);
  for (const def of SLIDER_DEFS) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    const range = document.createElement('input');
    const val = document.createElement('b');
    name.textContent = def.label;
    range.type = 'range';
    range.min = def.min; range.max = def.max; range.step = def.step;
    range.dataset.ax = ax; range.dataset.key = def.key;
    range.oninput = () => {
      settings.rates[ax][def.key] = +range.value / def.scale;
      settings.preset = '';                       // no longer matches a named preset
      saveSettings(settings);
      val.textContent = Math.round(+range.value) + def.unit;
      syncAll();
    };
    label.append(name, range, val);
    $sliders.appendChild(label);
  }
}

const refreshLayouts = buttonGroup($('layouts'),
  LAYOUTS.map((l) => ({ id: l.id, label: l.name, title: l.title })),
  () => settings.layout, (id) => { settings.layout = id; });

const refreshPresets = buttonGroup($('presets'),
  Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.name })),
  () => settings.preset, (id) => { applyPreset(settings, id); syncAll(); });

function refreshSliders() {
  for (const range of $sliders.querySelectorAll('input[type=range]')) {
    const def = SLIDER_DEFS[+range.dataset.key];
    const v = settings.rates[range.dataset.ax][def.key] * def.scale;
    range.value = v;
    range.nextElementSibling.textContent = Math.round(v) + def.unit;
  }
}

function drawCurve() {
  const N = 60;
  // scale to whatever is actually set, so the curve stays readable at any sens
  const top = Math.max(200, ...AXES.map((ax) => actualRate(1, settings.rates[ax]) * settings.sens)) * 1.1;
  const path = (rates, colour) => {
    let d = '';
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = 38 - (actualRate(u, rates) * settings.sens / top) * 36;
      d += `${i ? 'L' : 'M'}${(u * 100).toFixed(1)} ${y.toFixed(1)}`;
    }
    return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="1.4"/>`;
  };
  $('curve').innerHTML =
    '<line x1="0" y1="38" x2="100" y2="38" stroke="#ffffff30"/>' +
    AXES.map((ax) => path(settings.rates[ax], CURVE_COLOUR[ax])).join('') +
    `<text x="2" y="8" fill="#6f8a94" font-size="5">${Math.round(top)}°/s</text>`;
}

// global sensitivity: one knob on top of any preset
const sensRange = $('sens');
const sensVal = $('sensVal');
sensRange.oninput = () => {
  settings.sens = +sensRange.value;
  sensVal.textContent = settings.sens.toFixed(2);
  saveSettings(settings);
  drawCurve();
};
$('sensReset').onclick = () => { sensRange.value = 1; sensRange.oninput(); };
const refreshSens = () => {
  sensRange.value = settings.sens;
  sensVal.textContent = settings.sens.toFixed(2);
};

// FPV cameras ship at a handful of fixed angles; this is the one you feel most
const camRange = $('camTilt'), camVal = $('camTiltVal');
const refreshCam = () => {
  camRange.value = settings.camTilt;
  camVal.textContent = `${settings.camTilt}°`;
  camera.rotation.x = settings.camTilt * Math.PI / 180;
};
camRange.oninput = () => { settings.camTilt = +camRange.value; refreshCam(); saveSettings(settings); };
refreshCam();

/** Top laps for the current track; `mark` is the rank to highlight after a lap. */
function drawBoard(mark = -1) {
  const rows = records.list();
  ui.board.innerHTML = rows.length
    ? rows.map((t, i) => `<div${i === mark ? ' class="new"' : ''}><span>${i + 1}</span><b>${fmt(t)}</b></div>`).join('')
    : '<div class="none">no laps yet</div>';
}
drawBoard();

// switching the track rebuilds the world, which is simplest done by reloading
buttonGroup($('tracks'),
  TRACK_IDS.map((id) => ({ id, label: TRACKS[id].name, title: `${TRACKS[id].count} gates` })),
  () => settings.track, (id) => { if (id !== settings.track) { settings.track = id; saveSettings(settings); location.reload(); } });

$('cBatt').checked = settings.battery;
$('cBatt').onchange = (e) => {
  settings.battery = e.target.checked;
  saveSettings(settings);
  ui.batt.style.display = settings.battery ? 'block' : 'none';
};
ui.batt.style.display = settings.battery ? 'block' : 'none';

const windRange = $('wind'), windVal = $('windVal');
const refreshWind = () => {
  windRange.value = settings.wind;
  windVal.textContent = settings.wind ? `${(settings.wind * CFG.windMax).toFixed(0)} m/s` : 'calm';
};
windRange.oninput = () => { settings.wind = +windRange.value; refreshWind(); saveSettings(settings); };
refreshWind();

// HUD: everything / one line at the bottom like a real OSD / nothing but the crosshair
const OSD_MODES = ['full', 'osd', 'off'];
const applyOsd = () => { $('hud').dataset.osd = settings.osd; };
const refreshOsd = buttonGroup($('osdModes'),
  [{ id: 'full', label: 'full' }, { id: 'osd', label: 'OSD line' }, { id: 'off', label: 'off' }],
  () => settings.osd, (id) => { settings.osd = id; applyOsd(); });
applyOsd();

const refreshMode = buttonGroup($('modes'), [
  { id: 'acro', label: 'Acro', title: 'sticks command rotation rate, no self-levelling' },
  { id: 'angle', label: 'Angle', title: 'sticks command tilt, the quad levels itself when you let go' },
], () => settings.mode, (id) => { settings.mode = id; });
refreshPicks.push(refreshMode);

$('cSound').checked = settings.sound;
audio.setEnabled(settings.sound);
$('cSound').onchange = (e) => { settings.sound = e.target.checked; audio.setEnabled(settings.sound); saveSettings(settings); };

$('cTrig').checked = settings.throttleOnTrigger;
$('cInvTh').checked = settings.invertThrottle;
$('cSpring').checked = settings.springThrottle;
$('cTilt').checked = settings.tiltComp;
for (const [id, key] of [
  ['cTrig', 'throttleOnTrigger'], ['cInvTh', 'invertThrottle'],
  ['cSpring', 'springThrottle'], ['cTilt', 'tiltComp'],
]) {
  $(id).onchange = (e) => { settings[key] = e.target.checked; saveSettings(settings); };
}

// the same two picks on the start screen, before you fly
for (const [legend, src] of [
  ['LAYOUT', LAYOUTS.map((l) => ({ id: l.id, name: l.name, title: l.title }))],
  ['RATES', Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name }))],
]) {
  const fs = document.createElement('fieldset');
  fs.append(Object.assign(document.createElement('legend'), { textContent: legend }));
  for (const it of src) {
    const b = document.createElement('button');
    b.textContent = it.name;
    if (it.title) b.title = it.title;
    b.onclick = () => {
      if (legend === 'LAYOUT') settings.layout = it.id;
      else applyPreset(settings, it.id);
      saveSettings(settings);
      syncAll();
    };
    fs.appendChild(b);
    refreshPicks.push(() => b.setAttribute('aria-pressed', String(
      legend === 'LAYOUT' ? settings.layout === it.id : settings.preset === it.id)));
  }
  $('pick').appendChild(fs);
}

syncAll();

// ---------------------------------------------------------------- loop
const _vp = new THREE.Vector3();
const _vv = new THREE.Vector3();
let acc = 0, last = performance.now();
let fpsAcc = 0, fpsN = 0, padShown = '';

function frame(now) {
  requestAnimationFrame(frame);
  // 50 ms caps a frame at 24 physics steps, so a slow frame cannot snowball
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update(dt);

  if (input.consume('pause')) togglePause();
  if (input.consume('reset')) { startRace(); return; }
  if (input.consume('flip') && !paused) {
    startFlip(drone, input.roll !== 0 ? Math.sign(input.roll) : 1);
  }

  if (!paused) {
    acc += dt;
    lapMs += dt * 1000;                            // ms; paused frames never reach here
    const cmd = { throttle: input.throttle, pitch: input.pitch, roll: input.roll, yaw: input.yaw };
    while (acc >= CFG.dt) {
      acc -= CFG.dt;
      const impact = Math.hypot(drone.v.x, drone.v.y, drone.v.z);
      step(drone, cmd, CFG.dt, settings.rates, settings);

      // collide() works on THREE vectors, then we copy the resolution back
      _vp.set(drone.p.x, drone.p.y, drone.p.z);
      _vv.set(drone.v.x, drone.v.y, drone.v.z);
      const contact = world.collide(_vp, _vv);
      if (contact && !touching && impact > 5) {     // a landing is not a crash
        crashes++;
        audio.crash(impact / 10);
      }
      touching = contact;
      if (contact) {
        drone.crashed = true;
        drone.p.x = _vp.x; drone.p.y = _vp.y; drone.p.z = _vp.z;
        drone.v.x = _vv.x; drone.v.y = _vv.y; drone.v.z = _vv.z;
      }

      const hit = world.checkPass(drone.p);
      if (hit === next) {
        const d = ghost.split(next, lapMs);
        next++;
        if (next >= world.count) {
          const t = lapMs;
          const record = ghost.finishLap(t);        // keeps the ghost only when it wins
          const rank = records.add(t);
          drawBoard(rank);
          next = 0;
          lap++;
          lapMs = 0;
          crashes = 0;
          ghost.startLap(drone.p.x, drone.p.y, drone.p.z);
          message(`Lap ${lap - 1}: ${fmt(t)}${record ? '  •  NEW RECORD' : rank >= 0 ? `  •  #${rank + 1} best` : `  •  best ${fmt(ghost.best)}`}`);
          setTimeout(() => message(''), 2500);
        }
        world.highlight(next);
        showDelta(d);
      }
    }
    ghost.sample(dt, drone.p.x, drone.p.y, drone.p.z);
    if (ghost.positionAt(lapMs, _gp)) {
      ghostMesh.position.set(_gp.x, _gp.y, _gp.z);
      ghostMesh.visible = true;
    } else {
      ghostMesh.visible = false;
    }
  }
  audio.update((drone.m[0] + drone.m[1] + drone.m[2] + drone.m[3]) / 4, paused);

  // ---- camera + HUD ----
  rig.position.set(drone.p.x, drone.p.y, drone.p.z);
  rig.quaternion.set(drone.q.x, drone.q.y, drone.q.z, drone.q.w);

  const speed = Math.hypot(drone.v.x, drone.v.y, drone.v.z);
  ui.gate.textContent = next + 1;
  ui.lap.textContent = `Lap ${lap} · ${fmt(lapMs)}${ghost.best < Infinity ? ` · best ${fmt(ghost.best)}` : ''}${crashes ? ` · ✖${crashes}` : ''}`;
  ui.kmh.textContent = Math.round(speed * 3.6);
  ui.alt.textContent = drone.p.y.toFixed(1);
  if (settings.battery) {
    const c = drone.charge;
    ui.battFill.style.width = `${(c * 100).toFixed(0)}%`;
    ui.battFill.style.background = c > 0.25 ? '#9dff5e' : c > 0.1 ? '#ffb347' : '#ff6b5e';
    ui.batt.firstElementChild.textContent = `${(c * 100).toFixed(0)}%`;
    if (c <= 0 && !paused) message('Battery empty — press A to reset');
  }
  if (settings.osd === 'osd') {
    ui.osd.textContent = [
      settings.mode === 'angle' ? 'ANGLE' : 'ACRO',
      `THR ${(input.throttle * 100).toFixed(0)}%`,
      `${Math.round(speed * 3.6)} km/h`,
      `${drone.p.y.toFixed(0)} m`,
      fmt(lapMs),
      `G ${next + 1}/${world.count}`,
      ...(settings.battery ? [`BAT ${(drone.charge * 100).toFixed(0)}%`] : []),
    ].join('   ');
  }
  ui.thrFill.style.height = `${(input.throttle * 100).toFixed(0)}%`;

  const { pitch, roll } = attitude(drone.q);
  ui.hclip.style.transform =
    `rotate(${(-roll * 180 / Math.PI).toFixed(1)}deg) translateY(${(pitch * 240).toFixed(1)}px)`;

  if (drone.crashed && speed < 4 && input.throttle > 0.4) message('Crash — press A to reset');

  renderer.render(scene, camera);
  if (input.padName !== padShown) { padShown = input.padName; ui.padName.textContent = input.connected ? `controller: ${padShown}` : 'no controller found — keyboard works too'; }

  // ---- fps + auto quality ----
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) {
    const fps = fpsN / fpsAcc;
    ui.fps.textContent = `${fps.toFixed(0)} fps · ${qScale.toFixed(2)}x`;
    if (fps < 45 && qScale > 0.5) { qScale = Math.max(0.5, qScale - 0.15); applyQuality(); }
    fpsAcc = 0; fpsN = 0;
  }
}

function togglePause() {
  paused = !paused;
  message(paused ? 'Paused — Esc' : '');
}

const dismissStart = () => { ui.start.style.display = 'none'; audio.resume(); };
$('go').addEventListener('click', dismissStart);
addEventListener('keydown', dismissStart);
addEventListener('gamepadconnected', dismissStart);

// settings panel, toggleable during flight
$('tabs').onclick = () => { $('cfg').hidden = !$('cfg').hidden; };
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); $('cfg').hidden = !$('cfg').hidden; }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyQuality();
});

// M switches Acro / Angle, N mutes the engine
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyM') {
    settings.mode = settings.mode === 'acro' ? 'angle' : 'acro';
    saveSettings(settings);
    refreshMode();
    message(`${settings.mode === 'angle' ? 'Angle' : 'Acro'} mode`);
    setTimeout(() => { if (!paused) message(''); }, 1200);
  }
  if (e.code === 'KeyN') {
    settings.sound = !settings.sound;
    audio.setEnabled(settings.sound);
    $('cSound').checked = settings.sound;
    saveSettings(settings);
  }
});

// O cycles the HUD
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyO' || e.repeat) return;
  settings.osd = OSD_MODES[(OSD_MODES.indexOf(settings.osd) + 1) % OSD_MODES.length];
  applyOsd();
  refreshOsd();
  saveSettings(settings);
});

// Q cycles the render scale manually when auto-quality is not enough
addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ' && !e.repeat) {
    qScale = qScale >= 1 ? 0.5 : Math.min(1, qScale + 0.15);
    applyQuality();
  }
});

startRace();
requestAnimationFrame(frame);