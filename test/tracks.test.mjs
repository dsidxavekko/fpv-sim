// node test/tracks.test.mjs
import assert from 'node:assert/strict';
import { TRACKS, TRACK_IDS } from '../src/tracks.js';
import { createRecords } from '../src/records.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

for (const id of TRACK_IDS) {
  const t = TRACKS[id];
  const gates = Array.from({ length: t.count }, (_, i) => t.path((i / t.count) * Math.PI * 2));
  let minGap = Infinity, maxGap = 0, minY = Infinity, maxY = 0;
  for (let i = 0; i < gates.length; i++) {
    minY = Math.min(minY, gates[i].y);
    maxY = Math.max(maxY, gates[i].y);
    maxGap = Math.max(maxGap, dist(gates[i], gates[(i + 1) % gates.length]));
    for (let j = i + 1; j < gates.length; j++) minGap = Math.min(minGap, dist(gates[i], gates[j]));
  }
  console.log(`${id}: ${t.count} gates, spacing ${minGap.toFixed(0)}-${maxGap.toFixed(0)} m, height ${minY.toFixed(1)}-${maxY.toFixed(1)} m`);
  assert.ok(minGap > 12, `${id}: two gates only ${minGap.toFixed(1)} m apart`);
  assert.ok(maxGap < 60, `${id}: a ${maxGap.toFixed(0)} m gap between gates is a slog`);
  assert.ok(minY >= 4.5 - 1e-9, `${id}: gate too low for its legs`);
}

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

// records: sorted, capped, ranked, persistent
{
  const st = mem();
  const r = createRecords(st, 'loop', 3);
  assert.equal(r.add(50000), 0);
  assert.equal(r.add(40000), 0);
  assert.equal(r.add(45000), 1);
  assert.equal(r.add(60000), -1, 'a lap slower than a full table is not recorded');
  assert.equal(r.add(30000), 0);
  assert.deepEqual(r.list(), [30000, 40000, 45000]);
  assert.deepEqual(createRecords(st, 'loop', 3).list(), [30000, 40000, 45000]);
  assert.deepEqual(createRecords(st, 'ridge', 3).list(), [], 'tracks keep separate tables');
}
// corrupt storage and failing storage both degrade quietly
{
  const bad = { getItem: () => '{nope', setItem() { throw new Error('quota'); } };
  const r = createRecords(bad, 'loop');
  assert.equal(r.add(1000), 0);
  assert.deepEqual(r.list(), [1000]);
}

console.log('all track and record checks passed');
