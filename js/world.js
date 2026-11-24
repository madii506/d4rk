// D4RK world: a black liquid pool that runs off into the dark. The only light is three long strips far away;
// the surface mirrors them, and every ring that runs across it (an order landing, your cursor, a click) breaks them up.
// Real-time three.js: a planar mirror (the strips live on a layer only the mirror sees), ring waves, a slow swell.
// Scroll picks the camera shot; the loop eases toward it.
import * as THREE from '/vendor/three.module.min.js';

export function createWorld(canvas, opt = {}) {
  const mobile = !!opt.mobile;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' }); } catch (e) { return null; }
  const DPR = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 6000);
  const clock = new THREE.Clock();
  // uPow: the power in the strips. The mark's flicker drives it, so the light, its reflection and the mist all stutter together.
  const U = { uTime: { value: 0 }, uPow: { value: 1 } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const NOISE = `float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;

  // ---------------- the dark: black, a faint haze where the liquid meets it, and mist drifting across the horizon
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: U,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uPow; varying vec3 vD; ${NOISE}
      void main(){ vec3 d = normalize(vD);
      float az = atan(d.x, -d.z);
      float haze = exp(-pow(d.y / 0.035, 2.0)) * (0.92 + 0.08 * sin(uTime * 0.2));
      float m = fbm(vec2(az * 4.2 + uTime * 0.016, d.y * 22.0 - uTime * 0.028));
      float mist = exp(-pow((d.y - 0.035) / 0.13, 2.0)) * smoothstep(0.36, 0.84, m);
      vec3 c = vec3(0.0035, 0.0036, 0.0042) + vec3(0.020, 0.021, 0.024) * haze * (0.55 + 0.45 * uPow)
             + vec3(0.021, 0.022, 0.026) * mist * (0.35 + 0.65 * uPow);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  // ---------------- the light: three strips far away; only the mirror sees them (layer 1)
  const STRIPS = [[-420, 9, 9, 0.72], [-420, 26, 5, 0.38], [-420, 46, 3, 0.2]];
  const stripMats = [];
  for (const [z, y, h, k] of STRIPS) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7 * k, 1.72 * k, 1.8 * k), toneMapped: false });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1400, h), m);
    s.position.set(0, y, z); s.layers.set(1); scene.add(s); stripMats.push([m, k]);
  }

  // ---------------- the liquid: mirror + rings + a long slow swell
  const RT_SCALE = mobile ? 0.4 : 0.55;
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  const texMat = new THREE.Matrix4();
  const NDROP = mobile ? 24 : 36;
  const waterU = {
    uTime: U.uTime, uPow: U.uPow, uRefl: { value: rt.texture }, uTexMat: { value: texMat }, uPulse: { value: 0 },
    uDrops: { value: Array.from({ length: NDROP }, () => new THREE.Vector4(0, 0, -99, 0)) },
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1), new THREE.ShaderMaterial({
    uniforms: waterU,
    vertexShader: `uniform mat4 uTexMat; varying vec3 vW; varying vec4 vRP;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vRP = uTexMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform float uPow; uniform sampler2D uRefl; uniform float uPulse; uniform vec4 uDrops[${NDROP}];
      varying vec3 vW; varying vec4 vRP; ${NOISE}
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(vW - cameraPosition);
        vec2 g = vec2(0.0);
        float rings = 0.0;
        for (int i = 0; i < ${NDROP}; i++) {
          vec4 d = uDrops[i];
          float age = uTime - d.z;
          if (age < 0.0 || age > 7.0 || d.w <= 0.0) continue;
          vec2 dq = vW.xz - d.xy; float dr = length(dq) + 1e-4;
          float x = dr - (0.85 * age + 0.05);
          float w = 0.14 + 0.09 * age;
          float a = d.w * exp(-age * 0.55) * exp(-x * x / (2.0 * w * w));
          float kk = 6.2831 / 0.34;
          g += dq / dr * cos(kk * x) * kk * a * 0.0095;
          rings += a * max(cos(kk * x), 0.0);
        }
        // the liquid is never still: a long swell and a few small waves, calmer far away
        vec2 p = vW.xz;
        float near = smoothstep(140.0, 6.0, dist);
        g += vec2(0.15, 1.0) * cos(dot(p, vec2(0.15, 1.0)) * 0.55 + uTime * 0.7) * 0.012;
        g += vec2(-0.55, 0.83) * cos(dot(p, vec2(-0.55, 0.83)) * 0.9 + uTime * 0.9 + 1.7) * 0.008;
        g += vec2(-0.7, 0.7) * cos(dot(p, vec2(-0.7, 0.7)) * 1.3 + uTime * 1.1) * 0.012 * near;
        g += vec2(0.9, 0.4) * cos(dot(p, vec2(0.9, 0.4)) * 2.9 + uTime * 1.7) * 0.007 * near;
        g += vec2(-0.3, -0.95) * cos(dot(p, vec2(-0.3, -0.95)) * 5.3 + uTime * 2.3) * 0.004 * near;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec4 rp = vRP; rp.xy += N.xz * 0.5 * rp.w;
        vec3 refl = texture2DProj(uRefl, rp).rgb;
        float F = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 deep = vec3(0.0016, 0.0017, 0.0021);
        vec3 col = mix(deep, refl, clamp(F * 1.15, 0.0, 1.0));
        // a soft light high above that only the liquid sees: the near surface reads as glossy black, and its ripples show
        vec3 Rr = reflect(-V, N);
        col += vec3(0.55, 0.57, 0.64) * (0.016 + 0.05 * F) * smoothstep(0.02, 0.42, Rr.y);
        col += vec3(0.55, 0.58, 0.66) * rings * 0.11 * (0.5 + uPulse);
        // low mist sliding over the surface in the middle distance
        float mm = fbm(vW.xz * 0.042 + vec2(uTime * 0.034, -uTime * 0.019));
        col += vec3(0.012, 0.0125, 0.0145) * smoothstep(0.46, 0.9, mm) * smoothstep(9.0, 32.0, dist) * (1.0 - smoothstep(110.0, 300.0, dist)) * (0.4 + 0.6 * uPow);
        col = mix(col, vec3(0.006, 0.006, 0.007), smoothstep(260.0, 700.0, dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  water.rotation.x = -Math.PI / 2; scene.add(water);

  // ---------------- dust: specks hanging in the dark, catching what little light there is
  const NDUST = mobile ? 150 : 340;
  const dg = new THREE.BufferGeometry();
  const dpos = new Float32Array(NDUST * 3), dseed = new Float32Array(NDUST);
  for (let i = 0; i < NDUST; i++) { dpos[i * 3] = (Math.random() - 0.5) * 34; dpos[i * 3 + 1] = 0.2 + Math.pow(Math.random(), 1.5) * 9; dpos[i * 3 + 2] = 5 - Math.random() * 46; dseed[i] = Math.random(); }
  dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3)); dg.setAttribute('seed', new THREE.BufferAttribute(dseed, 1));
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPow: U.uPow, uDpr: { value: DPR } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uDpr; attribute float seed; varying float vA;
      void main(){ vec3 p = position; float s = seed * 61.0;
        p.x += sin(uTime * (0.05 + 0.08 * seed) + s) * 0.9;
        p.y += sin(uTime * (0.04 + 0.06 * seed) + s * 1.7) * 0.45;
        p.z += cos(uTime * (0.05 + 0.07 * seed) + s * 2.3) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float z = -mv.z;
        gl_PointSize = uDpr * (1.0 + 1.4 * seed) * clamp(8.0 / z, 0.7, 2.0);
        float tw = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * (0.45 + 1.2 * seed) + s * 3.1), 4.0);
        vA = tw * smoothstep(44.0, 7.0, z) * smoothstep(0.4, 1.6, z); }`,
    fragmentShader: `uniform float uPow; varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; if (dot(q, q) > 0.25) discard;
      gl_FragColor = vec4(vec3(0.46, 0.475, 0.52) * vA * (0.5 + 0.5 * uPow), 1.0); }`,
  }));
  dust.frustumCulled = false; scene.add(dust);

  // ---------------- drops: now and then one falls out of the dark; the ring it leaves is all anyone sees of it
  const fallGeo = new THREE.PlaneGeometry(0.028, 0.9); fallGeo.translate(0, 0.45, 0);
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.2) * (1.0 - pow(abs(vUv.x - 0.5) * 2.0, 2.0)); gl_FragColor = vec4(vec3(0.7, 0.72, 0.78) * a, 1.0); }`,
  });
  const FALLS = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(fallGeo, fallMat); m.visible = false; m.frustumCulled = false; scene.add(m); return { m, on: false, x: 0, y: 0, z: 0, v: 0 }; });
  const NSPL = 72;
  const sg = new THREE.BufferGeometry(), spos = new Float32Array(NSPL * 3).fill(-999), salpha = new Float32Array(NSPL);
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3)); sg.setAttribute('alpha', new THREE.BufferAttribute(salpha, 1));
  const SPL = Array.from({ length: NSPL }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
  const splashPts = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: DPR } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uDpr; attribute float alpha; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uDpr * clamp(24.0 / -mv.z, 1.0, 3.0); vA = alpha; }`,
    fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; if (dot(q, q) > 0.25) discard; gl_FragColor = vec4(vec3(0.72, 0.74, 0.8) * vA, 1.0); }`,
  }));
  splashPts.frustumCulled = false; scene.add(splashPts);
  let splI = 0;
  function splashAt(x, z) {
    for (let i = 0; i < 10; i++) {
      const s = SPL[splI++ % NSPL], a = Math.random() * 6.283, r = i === 0 ? 0 : 0.3 + Math.random() * 0.7;
      s.x = x; s.y = 0.02; s.z = z; s.vx = Math.cos(a) * r; s.vz = Math.sin(a) * r; s.vy = i === 0 ? 2.6 : 1.1 + Math.random() * 1.5; s.life = 1;
    }
  }

  // ---------------- planar reflection (after three.js Reflector); the mirror camera also sees layer 1
  const vCam = new THREE.PerspectiveCamera(); vCam.layers.enable(1);
  const plane = new THREE.Plane(), nrm = new THREE.Vector3(0, 1, 0), camPos = new THREE.Vector3(), rot = new THREE.Matrix4();
  const look = new THREE.Vector3(), view = new THREE.Vector3(), tgt = new THREE.Vector3(), clip = new THREE.Vector4(), qv = new THREE.Vector4();
  function reflect() {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.001) return;
    view.set(camPos.x, -camPos.y, camPos.z);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.set(look.x, -look.y, look.z);
    vCam.position.copy(view);
    vCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(nrm);
    vCam.lookAt(tgt);
    vCam.far = camera.far; vCam.updateMatrixWorld();
    vCam.projectionMatrix.copy(camera.projectionMatrix);
    texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    texMat.multiply(vCam.projectionMatrix); texMat.multiply(vCam.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(nrm, new THREE.Vector3(0, 0, 0)); plane.applyMatrix4(vCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vCam.projectionMatrix.elements;
    qv.x = (Math.sign(clip.x) + pm[8]) / pm[0]; qv.y = (Math.sign(clip.y) + pm[9]) / pm[5]; qv.z = -1.0; qv.w = (1.0 + pm[10]) / pm[14];
    clip.multiplyScalar(2.0 / clip.dot(qv));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1.0 - 0.003; pm[14] = clip.w;
    water.visible = false;
    const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, vCam); renderer.setRenderTarget(null);
    renderer.toneMapping = tm;
    water.visible = true;
  }

  // ---------------- camera shots
  // l: how bright the strips burn in that shot (full on the hero and the end, lower behind reading sections)
  const CAMS = {
    hero:  { p: [0.0, 1.05, 6.0],  t: [0.0, 0.85, -60],  fov: 46, l: 1 },
    how:   { p: [2.4, 2.6, 5.0],   t: [-0.6, 0.0, -8.0], fov: 46, l: 0.45 },
    book:  { p: [0.0, 9.5, 4.0],   t: [0.0, 0.0, -6.0],  fov: 52, l: 0.6 },
    trade: { p: [-2.2, 2.6, 4.4],  t: [0.8, -1.6, -9.0], fov: 46, l: 0.5 },
    you:   { p: [1.2, 1.9, 3.2],   t: [-0.4, -1.6, -6.0], fov: 44, l: 0.5 },
    tech:  { p: [0.0, 5.2, 7.5],   t: [0.0, 0.0, -10.0], fov: 46, l: 0.42 },
    risk:  { p: [-1.6, 1.2, 1.0],  t: [0.6, 0.5, -30],   fov: 46, l: 0.7 },
    end:   { p: [0.0, 0.9, 4.0],   t: [0.0, 9.0, -200],  fov: 48, l: 1 },
  };
  const cur = { p: new THREE.Vector3(...CAMS.hero.p), t: new THREE.Vector3(...CAMS.hero.t), fov: CAMS.hero.fov, l: 1 };
  const goal = { p: cur.p.clone(), t: cur.t.clone(), fov: cur.fov, l: 1 };
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  function go(a, b, f) {
    const ca = CAMS[a] || CAMS.hero, cb = CAMS[b] || ca;
    const e = f * f * (3 - 2 * f);
    goal.p.copy(A.fromArray(ca.p)).lerp(B.fromArray(cb.p), e);
    goal.t.copy(A.fromArray(ca.t)).lerp(B.fromArray(cb.t), e);
    goal.fov = ca.fov + (cb.fov - ca.fov) * e;
    goal.l = ca.l + (cb.l - ca.l) * e;
  }
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', e => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; }, { passive: true });

  // ---------------- sizing + loop
  let W = 0, H = 0, portrait = false;
  function resize() {
    W = innerWidth; H = innerHeight; portrait = W / H < 0.9;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    rt.setSize(Math.max(64, Math.round(W * DPR * RT_SCALE)), Math.max(64, Math.round(H * DPR * RT_SCALE)));
  }
  resize(); addEventListener('resize', resize);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = true, pulse = 0, raf = 0, frames = 0;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) loop(); });

  let nextDrop = 0, dropI = 0, nextFall = 1.6, pw = 1, pwGoal = 1;
  function addDrop(x, z, amp) { waterU.uDrops.value[dropI++ % NDROP].set(x, z, U.uTime.value, amp); }
  const fw = new THREE.Vector3();
  function ahead(dmin, dmax, spread) {
    camera.getWorldDirection(fw); fw.y = 0; if (fw.lengthSq() < 1e-4) fw.set(0, 0, -1); fw.normalize();
    const d = dmin + Math.random() * (dmax - dmin), a = (Math.random() - 0.5) * spread, c = Math.cos(a), s = Math.sin(a);
    return { x: camera.position.x + (fw.x * c - fw.z * s) * d, z: camera.position.z + (fw.z * c + fw.x * s) * d };
  }
  // somewhere out there an order lands: a ring, no name, no size
  function randomDrop() { const q = ahead(6, 40, 1.3); addDrop(q.x, q.z, 0.55 + Math.random() * 0.6); }
  function spawnFall() {
    const f = FALLS.find(f => !f.on); if (!f) return;
    const q = ahead(7, 30, portrait ? 0.75 : 1.15);
    f.x = q.x; f.z = q.z; f.y = 8 + Math.random() * 8; f.v = 1.5 + Math.random() * 2.5; f.on = true; f.m.visible = true;
  }
  // every hidden order in the real book is a slow double ring at its own spot: you can count them, you can't read them
  let beacons = [];
  function setOrders(n) {
    n = clamp(n | 0, 0, 24); if (n === beacons.length) return;
    beacons = Array.from({ length: n }, (_, i) => {
      const a = (((i * 0.618034) % 1) - 0.5) * 1.5, d = 9 + ((i * 0.754878) % 1) * 30;
      return { x: Math.sin(a) * d, z: 4 - Math.cos(a) * d, p: 5.5 + ((i * 0.414214) % 1) * 4, next: U.uTime.value + 0.6 + Math.random() * 4, echo: 0 };
    });
  }
  function step(dt) {
    const t = clock.elapsedTime;
    if (!reduce && t > nextDrop) { randomDrop(); nextDrop = t + 0.5 + Math.random() * 1.3; }
    if (!reduce && t > nextFall) { spawnFall(); nextFall = t + 1.1 + Math.random() * 2.4; }
    if (!reduce) for (const b of beacons) {
      if (t > b.next) { addDrop(b.x, b.z, 0.8); b.echo = t + 0.34; b.next = t + b.p; }
      if (b.echo && t > b.echo) { addDrop(b.x, b.z, 0.45); b.echo = 0; }
    }
    for (const f of FALLS) {
      if (!f.on) continue;
      f.v += 15 * dt; f.y -= f.v * dt;
      if (f.y <= 0) { f.on = false; f.m.visible = false; addDrop(f.x, f.z, 1.0 + Math.random() * 0.4); splashAt(f.x, f.z); continue; }
      f.m.position.set(f.x, f.y, f.z);
      f.m.rotation.set(0, Math.atan2(camera.position.x - f.x, camera.position.z - f.z), 0);
      f.m.scale.set(1, 0.3 + f.v * 0.045, 1);
    }
    let live = false;
    for (let i = 0; i < NSPL; i++) {
      const s = SPL[i];
      if (s.life > 0) {
        s.vy -= 9.5 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.life -= dt * 1.5;
        if (s.y < 0) s.life = 0;
        live = true;
      }
      const on = s.life > 0;
      spos[i * 3] = on ? s.x : 0; spos[i * 3 + 1] = on ? s.y : -999; spos[i * 3 + 2] = on ? s.z : 0; salpha[i] = on ? s.life : 0;
    }
    if (live || splashPts.userData.live) { sg.attributes.position.needsUpdate = true; sg.attributes.alpha.needsUpdate = true; }
    splashPts.userData.live = live;
    U.uTime.value = t;
    pw += (pwGoal - pw) * Math.min(1, dt * 28); U.uPow.value = pw;
    const k = 1 - Math.pow(0.0016, dt);
    cur.p.lerp(goal.p, k); cur.t.lerp(goal.t, k); cur.fov += (goal.fov - cur.fov) * k; cur.l += (goal.l - cur.l) * k;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3); pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3);
    camera.position.copy(cur.p);
    camera.position.x += pointer.sx * 0.35 + (reduce ? 0 : Math.sin(t * 0.29) * 0.06);
    camera.position.y += -pointer.sy * 0.16 + (reduce ? 0 : Math.sin(t * 0.43) * 0.03);
    camera.fov = cur.fov + (portrait ? 16 : 0); camera.updateProjectionMatrix();
    camera.lookAt(cur.t);
    sky.position.copy(camera.position);
    for (const [m, kk] of stripMats) { const b = (0.94 + 0.06 * Math.sin(t * 0.37 + kk * 9)) * kk * cur.l * pw; m.color.setRGB(1.7 * b, 1.72 * b, 1.8 * b); }
    pulse *= Math.pow(0.3, dt); waterU.uPulse.value = pulse;
  }
  function render() { reflect(); renderer.render(scene, camera); frames++; }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => { if (!running) return; const dt = Math.min(0.05, clock.getDelta()); step(dt); render(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  loop();
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hit(cx, cy) { ndc.set(cx / W * 2 - 1, -(cy / H) * 2 + 1); ray.setFromCamera(ndc, camera); const h = ray.intersectObject(water, false)[0]; return h && h.distance < 260 ? h.point : null; }
  let lastWake = null;
  return {
    go, camera, CAMS,
    dropAt(cx, cy) { const p = hit(cx, cy); if (!p) return false; addDrop(p.x, p.z, 1.4); pulse = Math.min(1.5, pulse + 0.4); return true; },
    wakeAt(cx, cy) { const p = hit(cx, cy); if (!p) { lastWake = null; return false; } if (lastWake && Math.hypot(p.x - lastWake.x, p.z - lastWake.z) < 0.6) return false; lastWake = { x: p.x, z: p.z }; addDrop(p.x, p.z, 0.7); return true; },
    pulse(v = 1) { pulse = Math.min(1.5, pulse + v); for (let i = 0; i < Math.max(1, Math.round(v * 3)); i++) randomDrop(); },
    drop(x, z, amp = 1) { addDrop(x, z, amp); },
    power(v) { pwGoal = clamp(v, 0, 1.2); },
    orders(n) { setOrders(n); },
    fall() { spawnFall(); },
    settle() { cur.p.copy(goal.p); cur.t.copy(goal.t); cur.fov = goal.fov; cur.l = goal.l; pw = pwGoal; },
    advance(sec = 1, n = 30) { for (let i = 0; i < n; i++) { clock.elapsedTime += sec / n; step(sec / n); } render(); },
    get frames() { return frames; },
    get time() { return clock.elapsedTime; },
  };
}
