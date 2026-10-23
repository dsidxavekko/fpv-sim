// Motor sound from Web Audio: two detuned saw oscillators whose pitch follows the
// average motor command, plus a short noise burst on a crash. No sample files.
// The context can only start after a user gesture, so everything is lazy.

export function createAudio() {
  let ctx = null, osc = [], gain = null, enabled = true;

  const start = () => {
    if (ctx) { ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    gain = ctx.createGain();
    gain.gain.value = 0;
    lp.connect(gain).connect(ctx.destination);
    osc = [0, 7].map((detune) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.connect(lp);
      o.start();
      return o;
    });
  };

  return {
    /** Call from a user gesture (key press, click, pad connect). */
    resume: start,
    setEnabled(on) { enabled = on; },

    /** `motor` is the mean motor command 0..1; `paused` mutes the engine. */
    update(motor, paused = false) {
      if (!ctx) return;
      const on = enabled && !paused;
      const t = ctx.currentTime;
      const hz = 90 + 520 * Math.sqrt(Math.max(0, Math.min(1, motor)));
      for (const o of osc) o.frequency.setTargetAtTime(hz, t, 0.03);
      gain.gain.setTargetAtTime(on ? 0.05 + 0.07 * motor : 0, t, 0.05);
    },

    crash(strength = 1) {
      if (!ctx || !enabled) return;
      const len = Math.floor(ctx.sampleRate * 0.25);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = Math.min(0.5, 0.15 * strength);
      src.buffer = buf;
      src.connect(g).connect(ctx.destination);
      src.start();
    },
  };
}
