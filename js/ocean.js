// Deep water in the dark, generated live with Web Audio: slow, low swells of filtered noise, a little hiss on each crest,
// a low hum under it all, and the odd drip. No audio files.
export function createOcean(makeCtx) {
  let ctx = null, master = null, on = false, built = false;
  const timers = [];
  function noise(seconds, kind) {
    const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      }
      const f = Math.floor(ctx.sampleRate * 0.6);           // hide the loop seam
      for (let i = 0; i < f; i++) { const a = i / f; d[n - f + i] = d[n - f + i] * (1 - a) + d[i] * a; }
    }
    return buf;
  }
  let pink, swell, lp, foam, pan;
  function build() {
    ctx = makeCtx ? makeCtx() : new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    pink = noise(9, 'pink'); const brown = noise(9, 'brown');
    // swell: pink noise through a moving low-pass, rising and falling like waves
    const s1 = ctx.createBufferSource(); s1.buffer = pink; s1.loop = true;
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.3;
    swell = ctx.createGain(); swell.gain.value = 0.18;
    s1.connect(lp).connect(swell).connect(master);
    // foam: a thin band of hiss on each crest, drifting left and right
    const s2 = ctx.createBufferSource(); s2.buffer = pink; s2.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.55;
    foam = ctx.createGain(); foam.gain.value = 0;
    pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) s2.connect(bp).connect(foam).connect(pan).connect(master); else s2.connect(bp).connect(foam).connect(master);
    // hum: brown noise, very low, always there
    const s3 = ctx.createBufferSource(); s3.buffer = brown; s3.loop = true;
    const lp3 = ctx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 170;
    const hum = ctx.createGain(); hum.gain.value = 0.34;
    s3.connect(lp3).connect(hum).connect(master);
    s1.start(0, 0); s2.start(0, 3.1); s3.start(0, 5.7);
    let t = ctx.currentTime + 0.2;
    const wave = () => {
      const dur = 6.5 + Math.random() * 5, peak = 0.32 + Math.random() * 0.26;
      swell.gain.setTargetAtTime(peak, t, dur * 0.17); swell.gain.setTargetAtTime(0.11, t + dur * 0.55, dur * 0.2);
      lp.frequency.setTargetAtTime(560 + Math.random() * 320, t, dur * 0.2); lp.frequency.setTargetAtTime(300, t + dur * 0.55, dur * 0.25);
      foam.gain.setTargetAtTime(0.045 + Math.random() * 0.035, t + dur * 0.32, 0.5); foam.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.14);
      if (pan) pan.pan.setTargetAtTime((Math.random() * 2 - 1) * 0.55, t, dur * 0.3);
      t += dur;
      timers.push(setTimeout(wave, Math.max(400, (t - ctx.currentTime - 1.5) * 1000)));
    };
    wave();
    const lapLoop = () => { if (on) lap(0.035 + Math.random() * 0.03); timers.push(setTimeout(lapLoop, 2600 + Math.random() * 4200)); };
    timers.push(setTimeout(lapLoop, 3000));
    built = true;
  }
  function lap(level = 0.05, freq) {
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    const s = ctx.createBufferSource(); s.buffer = pink;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || (480 + Math.random() * 650); f.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(level, t0 + 0.045); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45 + Math.random() * 0.35);
    s.connect(f).connect(g).connect(master); s.start(t0, Math.random() * 7, 1.1);
  }
  return {
    // Returns a promise that settles once the browser lets the sound run (right away if it's allowed,
    // otherwise when a click or tap resumes it). Calling it again inside a gesture unlocks it.
    start() {
      if (!built) build();
      on = true;
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0.5, ctx.currentTime, 1.6);
      if (ctx.state === 'running') return Promise.resolve();
      try { return Promise.resolve(ctx.resume()).catch(() => { }); } catch (e) { return Promise.resolve(); }
    },
    stop() {
      if (!ctx) return;
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      on = false; setTimeout(() => { if (!on && ctx.state === 'running') ctx.suspend(); }, 1600);
    },
    plip() { if (on) lap(0.07, 900 + Math.random() * 500); },
    pause() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && on && ctx.state !== 'running') ctx.resume(); },
    get on() { return on; },
    get playing() { return on && !!ctx && ctx.state === 'running'; },
    get ctx() { return ctx; },
  };
}
