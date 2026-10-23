// Track definitions: pure maths, no three, so node can test them. A track is a closed
// curve sampled at `count` gates; `path(a)` takes an angle 0..2pi and returns a point.
// Gates sit on the curve and face along its tangent (see world.js).

const wave = (a, k, p = 0) => Math.sin(k * a + p);

export const TRACKS = {
  loop: {
    name: 'Loop',
    count: 20,
    path(a) {
      const r = 55 + 18 * wave(a, 3, 0.7);
      return { x: r * Math.cos(a), y: Math.max(4.5, 7 + 5 * wave(a, 2) + 3 * wave(a, 5)), z: r * Math.sin(a) };
    },
  },
  sprint: {
    name: 'Sprint',
    count: 14,
    path(a) {
      // a long low oval: fast, few turns, little height change
      return { x: 95 * Math.cos(a), y: Math.max(4.5, 6 + 1.5 * wave(a, 2)), z: 45 * Math.sin(a) };
    },
  },
  ridge: {
    name: 'Ridge',
    count: 22,
    path(a) {
      // tight circle with big climbs and dives
      const r = 64 + 8 * wave(a, 4);
      return { x: r * Math.cos(a), y: Math.max(4.5, 13 + 8 * wave(a, 3) + 3 * wave(a, 7)), z: r * Math.sin(a) };
    },
  },
  flower: {
    name: 'Flower',
    count: 25,
    path(a) {
      // five petals: the radius swings hard, so you cut in and out of the middle
      const r = 62 + 24 * wave(a, 5);
      return { x: r * Math.cos(a), y: Math.max(4.5, 8 + 3 * wave(a, 5, 1.2)), z: r * Math.sin(a) };
    },
  },
  tower: {
    name: 'Tower',
    count: 16,
    path(a) {
      // a small tight circle that climbs and drops twice: long dives, hard pull-ups
      const r = 42 + 5 * wave(a, 2);
      return { x: r * Math.cos(a), y: Math.max(4.5, 18 + 14 * wave(a, 2, 0.4)), z: r * Math.sin(a) };
    },
  },
};

export const TRACK_IDS = Object.keys(TRACKS);
