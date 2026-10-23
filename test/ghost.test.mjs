// node test/ghost.test.mjs
import assert from 'node:assert/strict';
import { createGhost } from '../src/ghost.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

// drive a lap that moves 1 m per sample along x
const fly = (g, ms, gates = 3) => {
  g.startLap(0, 5, 0);
  const deltas = [];
  for (let i = 1; i <= ms / 50; i++) {
    g.sample(0.05, i, 5, 0);
    if (i % Math.floor(ms / 50 / gates) === 0 && deltas.length < gates) deltas.push(g.split(deltas.length, i * 50));
  }
  return { deltas, record: g.finishLap(ms) };
};

// 1. the first lap becomes the ghost immediately, without a reload
{
  const g = createGhost(mem());
  assert.equal(g.hasGhost, false);
  assert.equal(fly(g, 3000).record, true);
  assert.equal(g.hasGhost, true);
  assert.equal(g.best, 3000);
}

// 2. a slower lap does not replace it, a faster one does
{
  const g = createGhost(mem());
  fly(g, 3000);
  const slow = fly(g, 4000);
  assert.equal(slow.record, false);
  assert.equal(g.best, 3000);
  assert.ok(slow.deltas.every((d) => d > 0), 'slower lap is behind the ghost at every gate');
  const fast = fly(g, 2000);
  assert.equal(fast.record, true);
  assert.equal(g.best, 2000);
  assert.ok(fast.deltas.every((d) => d < 0), 'faster lap is ahead of the ghost');
}

// 3. playback is aligned: sample i sits at i / hz, and it ends
{
  const g = createGhost(mem());
  fly(g, 3000);
  const p = {};
  assert.ok(g.positionAt(0, p));
  assert.equal(p.x, 0);
  assert.ok(g.positionAt(1000, p));
  assert.ok(Math.abs(p.x - 20) < 1e-6, `1 s in should be 20 m, got ${p.x}`);
  assert.equal(g.positionAt(60000, p), false);
}

// 4. the record and ghost survive a reload
{
  const st = mem();
  fly(createGhost(st), 3000);
  const g = createGhost(st);
  assert.equal(g.best, 3000);
  assert.equal(g.hasGhost, true);
}

// 5. a full storage must not lose the lap for this session
{
  const st = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const g = createGhost(st);
  assert.equal(fly(g, 3000).record, true);
  assert.equal(g.hasGhost, true);
}

// 5b. each track has its own ghost, and the first keeps the legacy keys
{
  const st = mem();
  fly(createGhost(st, 20, 'loop'), 3000);
  assert.ok(st.getItem('fpvsim.best'), 'loop keeps the original key');
  assert.equal(createGhost(st, 20, 'ridge').hasGhost, false);
  fly(createGhost(st, 20, 'ridge'), 2500);
  assert.equal(createGhost(st, 20, 'loop').best, 3000);
  assert.equal(createGhost(st, 20, 'ridge').best, 2500);
}

// 6. corrupt stored data is ignored
{
  const st = mem();
  st.setItem('fpvsim.ghost', '{"splits":[1],"s":[1,2]}');
  assert.equal(createGhost(st).hasGhost, false);
}

console.log('all ghost checks passed');
