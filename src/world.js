// Procedural race track: a wiggly loop of gates built from boxes, drawn in a
// single InstancedMesh (one draw call). No textures, no shadows, no assets.

import * as THREE from 'three';
import { TRACKS } from './tracks.js';

const OPENING = 3.0;   // m, clear opening of a gate
const BAR = 0.25;       // m, frame thickness
const DEPTH = 0.35;     // m, frame depth
const DRONE_R = 0.22;  // m, collision radius
const GROUND_Y = 0;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _iq = new THREE.Quaternion();
const _col = new THREE.Color();
const _dummy = new THREE.Object3D();

const box = (cx, cy, cz, hx, hy, hz) => ({
  c: new THREE.Vector3(cx, cy, cz),
  h: new THREE.Vector3(hx, hy, hz),
});

/** Gate pose for index i: position plus the tangent pointing through the gate. */
function gatePose(track, i) {
  const at = (a) => { const p = track.path(a); return new THREE.Vector3(p.x, p.y, p.z); };
  const a = (i / track.count) * Math.PI * 2;
  const pos = at(a);

  // tangent by central difference: stays correct even where the height is clamped
  const e = 0.01;
  const fwd = at(a + e).sub(at(a - e)).normalize();

  // local -Z looks through the gate, so map (0,0,-1) -> fwd
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);
  return { pos, quat, fwd };
}

export function createWorld(scene, trackId = 'loop') {
  const track = TRACKS[trackId] ?? TRACKS.loop;
  const COUNT = track.count;
  const gates = [];

  for (let i = 0; i < COUNT; i++) {
    const { pos, quat, fwd } = gatePose(track, i);
    const h = OPENING / 2;                    // half of the clear opening
    const o = h + BAR / 2;                    // bar centre line
    const outer = h + BAR;                    // outer half-size of the frame
    const legH = Math.max(0, pos.y - outer - GROUND_Y);

    // closed square frame: the four bars meet at the corners, no gaps
    const boxes = [
      box(-o, 0, 0, BAR / 2, outer, DEPTH / 2),
      box(o, 0, 0, BAR / 2, outer, DEPTH / 2),
      box(0, o, 0, outer, BAR / 2, DEPTH / 2),
      box(0, -o, 0, outer, BAR / 2, DEPTH / 2),
    ];
    if (legH > 0.2) boxes.push(box(0, -outer - legH / 2, 0, BAR, legH / 2, BAR));

    gates.push({ pos, quat, fwd, boxes, sign: -1, frameStart: 0, index: i });
  }

  // ---- one InstancedMesh holds every bar in the whole track ----
  const parts = [];
  for (const g of gates) {
    g.frameStart = parts.length;
    const frames = g.boxes.slice(0, 4);
    for (const b of frames) parts.push({ g, b, isFrame: true });
    for (const b of g.boxes.slice(4)) parts.push({ g, b, isFrame: false });
  }

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial(),
    parts.length,
  );

  const frameColour = (i) => (i % 2 ? 0x2f9bff : 0xff7a2f);
  parts.forEach((p, idx) => {
    _dummy.position.copy(p.b.c).applyQuaternion(p.g.quat).add(p.g.pos);
    _dummy.quaternion.copy(p.g.quat);
    _dummy.scale.set(p.b.h.x * 2, p.b.h.y * 2, p.b.h.z * 2);
    _dummy.updateMatrix();
    mesh.setMatrixAt(idx, _dummy.matrix);
    paint(mesh, idx, p.isFrame ? frameColour(p.g.index) : 0x9aa7ad);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false; // the track is one draw call anyway
  scene.add(mesh);

  // ---- ground + a grid for judging speed ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshLambertMaterial({ color: 0x3d5c3a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 80, 0x8aa87f, 0x4d6b4a);
  grid.position.y = GROUND_Y + 0.02;
  scene.add(grid);

  scene.add(new THREE.AmbientLight(0xbfd4e0, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.1);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);

  function paint(m, idx, hex) { m.setColorAt(idx, _col.setHex(hex)); }

  return {
    gates,
    droneRadius: DRONE_R,
    count: COUNT,
    // spawn level with the first gate: 8 m back along its axis, same height
    start: {
      pos: gates[0].pos.clone().addScaledVector(gates[0].fwd, -8).setY(gates[0].pos.y),
      yaw: gates[0].fwd,
    },

    /** Tint the gate the pilot has to fly next. */
    highlight(next) {
      for (const g of gates) {
        for (let k = 0; k < 4; k++) {
          paint(mesh, g.frameStart + k, g.index === next ? 0x9dff5e : frameColour(g.index));
        }
      }
      mesh.instanceColor.needsUpdate = true;
    },

    /** Index of a gate the drone just flew through, or -1. */
    checkPass(p) {
      for (const g of gates) {
        _v.copy(p).sub(g.pos);
        const d = _v.dot(g.fwd);
        if (g.sign < 0 && d >= 0) {
          g.sign = 1;
          _v.addScaledVector(g.fwd, -d); // radial offset from the gate centre
          if (_v.length() < OPENING / 2) return g.index;
        } else if (g.sign > 0 && d < 0) {
          g.sign = -1;
        }
      }
      return -1;
    },

    /** Resolve a sphere against the ground and the gate frames. Returns true on contact. */
    collide(p, v) {
      const r = DRONE_R;
      let hit = false;

      if (p.y < GROUND_Y + r) {
        p.y = GROUND_Y + r;
        if (v.y < 0) v.y *= -0.15;
        hit = true;
      }

      for (const g of gates) {
        if (Math.abs(p.x - g.pos.x) > 6 || Math.abs(p.y - g.pos.y) > 6 || Math.abs(p.z - g.pos.z) > 6) continue;
        _iq.copy(g.quat).invert();

        for (const b of g.boxes) {
          // re-project every box: p was already moved by the previous one, and _v is
          // left in world space by the write-back at the bottom of the loop
          _v.copy(p).sub(g.pos).applyQuaternion(_iq);
          const dx = _v.x - b.c.x, dy = _v.y - b.c.y, dz = _v.z - b.c.z;
          let nx = dx - clamp(dx, -b.h.x, b.h.x);
          let ny = dy - clamp(dy, -b.h.y, b.h.y);
          let nz = dz - clamp(dz, -b.h.z, b.h.z);
          const d2 = nx * nx + ny * ny + nz * nz;
          if (d2 > r * r) continue;

          hit = true;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            _v.x += (nx = nx / d) * (r - d);
            _v.y += (ny = ny / d) * (r - d);
            _v.z += (nz = nz / d) * (r - d);
          } else {
            // sphere centre inside the box: leave through the nearest face. That is the
            // most negative (|d| - h), not the smallest (h - |d|) — for a bar that is
            // metres long, h - |d| goes negative and picks the far end.
            const px = Math.abs(dx) - b.h.x, py = Math.abs(dy) - b.h.y, pz = Math.abs(dz) - b.h.z;
            nx = ny = nz = 0;
            if (px >= py && px >= pz) nx = dx < 0 ? -1 : 1;
            else if (py >= pz) ny = dy < 0 ? -1 : 1;
            else nz = dz < 0 ? -1 : 1;
            // only the exit axis moves: the other two are the point's own position,
            // so flying past a bar does not snap the drone onto the gate's axis
            if (nx) _v.x = b.c.x + nx * (b.h.x + r);
            if (ny) _v.y = b.c.y + ny * (b.h.y + r);
            if (nz) _v.z = b.c.z + nz * (b.h.z + r);
          }

          _n.set(nx, ny, nz).applyQuaternion(g.quat);      // contact normal, world space
          p.copy(g.pos).add(_v.applyQuaternion(g.quat));
          const vn = v.dot(_n);
          if (vn < 0) v.addScaledVector(_n, -vn * 1.15);
        }
      }
      return hit;
    },
  };
}