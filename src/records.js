// Top lap times per track, kept in a localStorage-like object.

export function createRecords(storage, track, keep = 5) {
  const key = `fpvsim.laps.${track}`;
  let times = [];
  try {
    const r = JSON.parse(storage.getItem(key));
    if (Array.isArray(r)) times = r.filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b).slice(0, keep);
  } catch { /* corrupt or unavailable: start empty */ }

  return {
    list: () => [...times],

    /** Add a lap. Returns its 0-based rank in the table, or -1 if it did not make it. */
    add(ms) {
      const rank = times.findIndex((t) => ms < t);
      const at = rank === -1 ? times.length : rank;
      if (at >= keep) return -1;
      times.splice(at, 0, ms);
      times.length = Math.min(times.length, keep);
      try { storage.setItem(key, JSON.stringify(times)); } catch { /* quota: table lives on in memory */ }
      return at;
    },
  };
}
