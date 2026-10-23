// Best-lap ghost: samples the lap in progress, keeps it only when it beats the record,
// and plays it back. Pure logic over a localStorage-like object so it runs in node.

// The first track keeps the original keys, so existing records survive the upgrade.
const keys = (track) => {
  const sfx = track && track !== 'loop' ? `.${track}` : '';
  return { best: `fpvsim.best${sfx}`, ghost: `fpvsim.ghost${sfx}` };
};

function load(storage, key) {
  try {
    const r = JSON.parse(storage.getItem(key));
    const ok = r && Array.isArray(r.splits) && Array.isArray(r.s) && r.s.length > 5 && r.s.length % 3 === 0;
    return ok ? r : null;
  } catch { return null; }
}

export function createGhost(storage, hz = 20, track = 'loop') {
  const key = keys(track);
  let ref = load(storage, key.ghost);                     // the lap being chased
  let samples = [];                            // x,y,z triples of the lap in progress
  let splits = [];                             // ms at each gate of the lap in progress
  let acc = 0;
  let best = Number(storage.getItem(key.best)) || Infinity;

  const api = {
    get best() { return best; },
    get hasGhost() { return ref !== null; },

    /** Begin a fresh lap; the start position is sample 0, so sample i is at i / hz. */
    startLap(x, y, z) {
      samples = [x, y, z];
      splits = [];
      acc = 0;
    },

    sample(dt, x, y, z) {
      acc += dt;
      if (acc >= 1 / hz) {
        acc -= 1 / hz;
        samples.push(x, y, z);
      }
    },

    /** Record a gate time; returns the delta against the ghost in ms, or null. */
    split(gate, ms) {
      splits[gate] = ms;
      return ref && ref.splits[gate] != null ? ms - ref.splits[gate] : null;
    },

    /** Lap done. Returns true when it is the new record (and becomes the ghost). */
    finishLap(ms) {
      if (!(ms < best)) return false;
      best = ms;
      // 1 cm is well inside the drone radius and keeps the stored lap small
      ref = { t: ms, splits: [...splits], s: samples.map((n) => Math.round(n * 100) / 100) };
      try {
        storage.setItem(key.best, String(best));
        storage.setItem(key.ghost, JSON.stringify(ref));
      } catch { /* out of quota: the ghost lives on in memory for this session */ }
      return true;
    },

    /** Ghost position at elapsed `ms` written into `out`; false once it has finished. */
    positionAt(ms, out) {
      if (!ref) return false;
      const n = ref.s.length / 3;
      const f = (ms / 1000) * hz;
      const i = Math.floor(f);
      if (i >= n - 1) return false;
      const a = i * 3, b = a + 3, u = f - i;
      out.x = ref.s[a] + (ref.s[b] - ref.s[a]) * u;
      out.y = ref.s[a + 1] + (ref.s[b + 1] - ref.s[a + 1]) * u;
      out.z = ref.s[a + 2] + (ref.s[b + 2] - ref.s[a + 2]) * u;
      return true;
    },
  };
  return api;
}
