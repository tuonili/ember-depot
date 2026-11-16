// Sound, made with the Web Audio API from oscillators and noise, so the game ships no audio files
// and every sound is its own. One context, a small set of voices, and a master gain the pause menu
// turns down. Nothing here reads the game state: main.js calls a name.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.6);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last;
    }
    return ctx;
  }

  function noise(duration, gain, filterType, frequency, q = 1) {
    if (!ensure() || muted) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const env = ctx.createGain();
    const now = ctx.currentTime;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(env).connect(master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  function tone(type, from, to, duration, gain) {
    if (!ensure() || muted) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  return {
    resume() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() {
      return muted;
    },
    // Every gun has its own voice: a rifle cracks, the shotgun booms, the sniper slaps.
    shot(id, distance = 0) {
      const near = Math.max(0.12, 1 - distance / 55);
      if (id === 'hound') {
        noise(0.26, 0.5 * near, 'lowpass', 1100, 0.7);
        tone('square', 150, 40, 0.16, 0.16 * near);
      } else if (id === 'warden') {
        noise(0.4, 0.62 * near, 'lowpass', 760, 0.6);
        tone('sawtooth', 110, 28, 0.3, 0.2 * near);
      } else if (id === 'kestrel') {
        noise(0.15, 0.34 * near, 'highpass', 1700, 1.2);
        tone('square', 260, 90, 0.1, 0.1 * near);
      } else if (id === 'sidearm') {
        noise(0.12, 0.3 * near, 'bandpass', 1900, 0.9);
        tone('square', 320, 120, 0.08, 0.09 * near);
      } else {
        noise(0.18, 0.42 * near, 'bandpass', 1500, 0.8);
        tone('square', 210, 60, 0.12, 0.12 * near);
      }
    },
    dryFire() {
      noise(0.05, 0.22, 'highpass', 2600, 2);
    },
    reload() {
      noise(0.07, 0.2, 'bandpass', 1200, 1.4);
      setTimeout(() => noise(0.09, 0.24, 'bandpass', 900, 1.2), 220);
    },
    impact() {
      noise(0.05, 0.16, 'highpass', 3200, 1.5);
    },
    hit(head = false) {
      tone('square', head ? 1400 : 900, head ? 700 : 500, 0.07, head ? 0.16 : 0.1);
    },
    hurt() {
      tone('sawtooth', 220, 90, 0.28, 0.2);
      noise(0.2, 0.24, 'lowpass', 500, 0.8);
    },
    death() {
      tone('sawtooth', 180, 40, 0.7, 0.24);
    },
    step(running) {
      noise(0.06, running ? 0.1 : 0.045, 'lowpass', running ? 700 : 420, 0.9);
    },
    whistle(kind) {
      if (kind === 'freeze') tone('sine', 720, 720, 0.18, 0.12);
      else if (kind === 'live') { tone('sine', 900, 900, 0.12, 0.14); setTimeout(() => tone('sine', 1200, 1200, 0.16, 0.14), 140); }
      else if (kind === 'raid') { tone('sine', 520, 780, 0.5, 0.16); }
      else { tone('sine', 780, 460, 0.5, 0.16); }
    },
    plant() {
      tone('square', 420, 420, 0.1, 0.14);
      setTimeout(() => tone('square', 620, 620, 0.12, 0.14), 200);
    },
    beep(urgent) {
      tone('square', urgent ? 1500 : 1050, urgent ? 1500 : 1050, 0.07, urgent ? 0.16 : 0.1);
    },
    explosion() {
      noise(0.85, 0.75, 'lowpass', 620, 0.5);
      tone('sawtooth', 130, 26, 0.8, 0.3);
    },
    defuse() {
      tone('sine', 300, 620, 0.35, 0.14);
    },
    buy() {
      tone('sine', 1200, 1600, 0.07, 0.1);
    },
    deny() {
      tone('square', 300, 180, 0.12, 0.12);
    },
  };
}
