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
  const U = { uTime: { value: 0 } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------- the dark: black, with the faintest haze where the liquid meets it
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: U,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; varying vec3 vD; void main(){ vec3 d = normalize(vD);
      float haze = exp(-pow(d.y / 0.035, 2.0)) * (0.92 + 0.08 * sin(uTime * 0.2));
      vec3 c = vec3(0.0035, 0.0036, 0.0042) + vec3(0.020, 0.021, 0.024) * haze;
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
  const NDROP = 28;
  const waterU = {
    uTime: U.uTime, uRefl: { value: rt.texture }, uTexMat: { value: texMat }, uPulse: { value: 0 },
    uDrops: { value: Array.from({ length: NDROP }, () => new THREE.Vector4(0, 0, -99, 0)) },
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1), new THREE.ShaderMaterial({
    uniforms: waterU,
    vertexShader: `uniform mat4 uTexMat; varying vec3 vW; varying vec4 vRP;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vRP = uTexMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform sampler2D uRefl; uniform float uPulse; uniform vec4 uDrops[${NDROP}];
      varying vec3 vW; varying vec4 vRP;
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
        col = mix(col, vec3(0.006, 0.006, 0.007), smoothstep(260.0, 700.0, dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  water.rotation.x = -Math.PI / 2; scene.add(water);

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
  const CAMS = {
    hero:  { p: [0.0, 1.05, 6.0],  t: [0.0, 0.85, -60],  fov: 46 },
    how:   { p: [2.4, 2.6, 5.0],   t: [-0.6, 0.0, -8.0], fov: 46 },
    book:  { p: [0.0, 9.5, 4.0],   t: [0.0, 0.0, -6.0],  fov: 52 },
    trade: { p: [-2.2, 2.6, 4.4],  t: [0.8, -1.6, -9.0], fov: 46 },
    you:   { p: [1.2, 1.9, 3.2],   t: [-0.4, -1.6, -6.0], fov: 44 },
    tech:  { p: [0.0, 5.2, 7.5],   t: [0.0, 0.0, -10.0], fov: 46 },
    risk:  { p: [-1.6, 1.2, 1.0],  t: [0.6, 0.5, -30],   fov: 46 },
    end:   { p: [0.0, 0.9, 4.0],   t: [0.0, 9.0, -200],  fov: 48 },
  };
  const cur = { p: new THREE.Vector3(...CAMS.hero.p), t: new THREE.Vector3(...CAMS.hero.t), fov: CAMS.hero.fov };
  const goal = { p: cur.p.clone(), t: cur.t.clone(), fov: cur.fov };
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  function go(a, b, f) {
    const ca = CAMS[a] || CAMS.hero, cb = CAMS[b] || ca;
    const e = f * f * (3 - 2 * f);
    goal.p.copy(A.fromArray(ca.p)).lerp(B.fromArray(cb.p), e);
    goal.t.copy(A.fromArray(ca.t)).lerp(B.fromArray(cb.t), e);
    goal.fov = ca.fov + (cb.fov - ca.fov) * e;
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

  let nextDrop = 0, dropI = 0;
  function addDrop(x, z, amp) { waterU.uDrops.value[dropI++ % NDROP].set(x, z, U.uTime.value, amp); }
  // somewhere out there an order lands: a ring, no name, no size
  function randomDrop() {
    const fx = camera.position.x, fz = camera.position.z;
    const d = 6 + Math.random() * 34, a = (Math.random() - 0.5) * 1.3;
    addDrop(fx + Math.sin(a) * d, fz - Math.cos(a) * d, 0.55 + Math.random() * 0.6);
  }
  function step(dt) {
    const t = clock.elapsedTime;
    if (!reduce && t > nextDrop) { randomDrop(); nextDrop = t + 0.5 + Math.random() * 1.3; }
    U.uTime.value = t;
    const k = 1 - Math.pow(0.0016, dt);
    cur.p.lerp(goal.p, k); cur.t.lerp(goal.t, k); cur.fov += (goal.fov - cur.fov) * k;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3); pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3);
    camera.position.copy(cur.p);
    camera.position.x += pointer.sx * 0.35 + (reduce ? 0 : Math.sin(t * 0.29) * 0.06);
    camera.position.y += -pointer.sy * 0.16 + (reduce ? 0 : Math.sin(t * 0.43) * 0.03);
    camera.fov = cur.fov + (portrait ? 16 : 0); camera.updateProjectionMatrix();
    camera.lookAt(cur.t);
    sky.position.copy(camera.position);
    for (const [m, kk] of stripMats) { const b = (0.94 + 0.06 * Math.sin(t * 0.37 + kk * 9)) * kk; m.color.setRGB(1.7 * b, 1.72 * b, 1.8 * b); }
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
    settle() { cur.p.copy(goal.p); cur.t.copy(goal.t); cur.fov = goal.fov; },
    advance(sec = 1, n = 30) { for (let i = 0; i < n; i++) { clock.elapsedTime += sec / n; step(sec / n); } render(); },
    get frames() { return frames; },
    get time() { return clock.elapsedTime; },
  };
}
