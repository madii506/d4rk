/* D4RK front end. No framework, no keys: orders are messages your wallet signs; trades are one transaction both wallets sign. */
import { createWorld } from '/js/world.js?v=3';
import { createOcean } from '/js/ocean.js?v=1';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, del(k) { try { localStorage.removeItem(k); } catch (e) { } } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 760px)').matches || /iphone|ipad|android/i.test(navigator.userAgent);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const isAddr = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
function compact(n) { n = Number(n); if (!isFinite(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K'; if (a >= 100) return n.toFixed(0); if (a >= 1) return n.toFixed(2); if (a === 0) return '0'; return n.toPrecision(3); }
const fsol = n => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1000 ? compact(n) : a >= 1 ? n.toFixed(2) : a >= 0.01 ? n.toFixed(3) : a > 0 ? n.toFixed(5) : '0'; };
const px = n => { n = Number(n); if (!(n > 0)) return '—'; if (n >= 0.01) return n.toFixed(4); const e = Math.floor(Math.log10(n)); return n.toFixed(Math.min(14, -e + 3)); };
const ago = ms => { const s = Math.max(1, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
  const r = await fetch('/api/' + path, opt); let j = null; try { j = await r.json(); } catch (e) { }
  if (!r.ok || !j || j.ok === false) { const e = new Error((j && j.error) || ('Request failed (' + r.status + ')')); e.data = j; throw e; }
  return j;
}
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
function tokImg(c, cls = 'tok') { const l = esc(((c.symbol || c.name || '?')[0] || '?').toUpperCase()); const img = c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('ok')" onerror="this.remove()">` : ''; return `<span class="${cls}"><span class="ph">${l}</span>${img}</span>`; }

const S = { cfg: {}, coins: [], coin: null, side: 'buy', band: 3, ttl: 6, mine: null, busy: false };

/* ---------- the world ---------- */
let world = null;
try { world = createWorld($('#world'), { mobile }); } catch (e) { console.warn('world', e); }
if (!world) document.body.classList.add('nogl');
window.__d4rk = { world };

/* ---------- scroll engine: sections drive the camera ---------- */
const secs = $$('main > section[data-cam]');
const mk = $('.mk'), heroIn = $('.hero-in');
let heroK = 1, wordK = 1;
function layout() { secs.forEach(s => { s._top = s.offsetTop; s._h = s.offsetHeight; }); }
function onScroll() {
  const y = scrollY, vh = innerHeight, mid = y + vh * 0.5;
  let i = secs.findIndex(s => mid >= s._top && mid < s._top + s._h);
  if (i < 0) i = mid < (secs[0]._top || 0) ? 0 : secs.length - 1;
  const s = secs[i], f = clamp((mid - s._top) / Math.max(1, s._h), 0, 1);
  if (world) { const nx = secs[i + 1]; world.go(s.dataset.cam, nx ? nx.dataset.cam : s.dataset.cam, clamp((f - 0.62) / 0.38, 0, 1)); }
  if (mk) { const k = clamp(y / vh, 0, 1); mk.style.setProperty('--hy', (k * -70).toFixed(1) + 'px'); heroK = clamp(1 - k * 1.35, 0, 1); wordK = clamp(1 - y / (vh * 0.12), 0, 1); heroIn.style.opacity = heroK.toFixed(3); }
  const sh = s.id === 'top' ? 0.06 + 0.46 * clamp(y / vh, 0, 1) : s.id === 'end' ? 0.12 : mobile ? 0.7 : 0.56;
  document.documentElement.style.setProperty('--sh', sh.toFixed(3));
  $('#nav').classList.toggle('top', y < vh * 0.55);
  let cur = null, best = -1e9; for (const a of $$('#links a')) { const el = document.getElementById(a.getAttribute('href').slice(1)); if (!el) continue; const t = el.getBoundingClientRect().top; if (t < vh * 0.4 && t > best) { best = t; cur = a; } }
  $$('#links a').forEach(a => a.classList.toggle('on', a === cur));
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => { layout(); onScroll(); });
try { new ResizeObserver(() => { layout(); onScroll(); }).observe(document.body); } catch (e) { }

/* ---------- reveal, words, eyebrows ---------- */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
$$('.rv').forEach(el => io.observe(el));
$$('h2:not(.endmark)').forEach(h => {
  let i = 0;
  const walk = n => [...n.childNodes].forEach(c => {
    if (c.nodeType === 3) { const frag = document.createDocumentFragment(); c.textContent.split(/(\s+)/).forEach(t => { if (!t) return; if (/^\s+$/.test(t)) frag.appendChild(document.createTextNode(t)); else { const w = document.createElement('span'); w.className = 'w'; w.style.setProperty('--i', i++); w.textContent = t; frag.appendChild(w); } }); c.replaceWith(frag); }
    else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
  });
  walk(h); io.observe(h);
});
$$('.risks li').forEach((li, i) => li.style.setProperty('--i', i));
$$('.endmark span').forEach((sp, i) => sp.style.setProperty('--i', i));
const GLY = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
function decode(el) {
  const fin = el.textContent, n = fin.length, t0 = performance.now();
  const tick = now => { const k = (now - t0) / 24; let out = ''; for (let i = 0; i < n; i++) { const c = fin[i]; out += (i < k - 7 || c === ' ' || c === '—') ? c : i < k ? GLY[(Math.random() * GLY.length) | 0] : ' '; } el.textContent = out; if (k < n + 8) requestAnimationFrame(tick); else el.textContent = fin; };
  requestAnimationFrame(tick);
}
if (!reduce) { const ioE = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { ioE.unobserve(e.target); decode(e.target); } }), { threshold: 0.6 }); $$('.eyebrow').forEach(el => ioE.observe(el)); }
addEventListener('pointermove', e => { if (!mk || scrollY > innerHeight) return; const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5; mk.style.setProperty('--rx', (-y * 9).toFixed(2) + 'deg'); mk.style.setProperty('--ry', (x * 12).toFixed(2) + 'deg'); }, { passive: true });
/* ---------- the mark: four tubes in the dark. They struggle on, then never quite hold.
   A letter that drops out leaves its outline behind: still there, just hidden. The strips out on the water share the same power. */
const tubes = $$('.mk span').map(el => ({ el, v: 1, seq: null, i: 0, next: 0, step: 60 }));
const endTubes = $$('.endmark span').map(el => ({ el, v: 1, seq: null, i: 0, next: 0, step: 60 }));
const allTubes = tubes.concat(endTubes);
allTubes.forEach(t => { t.el.dataset.l = t.el.textContent; });
const SEQ = {
  ign: [0.3, 0, 0, 0.6, 0.06, 1],
  ign4: [0.35, 0, 0, 0.7, 0, 0, 0, 0.4, 0.05, 0.9, 0.2, 1],
  tick: [0.12, 1],
  stut: [0.08, 1, 0.04, 0.85, 1],
  sput: [0.05, 0.6, 0.08, 0.92, 0.15, 1],
  dark: [0.04, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0.78, 0.1, 1],
  dip: [0.5, 0.88, 0.3, 0.96, 0.62, 1],
};
let fRaf = 0;
function setF(t, v) { if (t.v === v) return; t.v = v; t.el.style.setProperty('--f', v); }
function play(t, name, step, delay = 0) { if (!t) return; t.seq = SEQ[name]; t.i = 0; t.step = step; t.next = performance.now() + delay; if (!fRaf) fRaf = requestAnimationFrame(fTick); }
function fTick(now) {
  fRaf = 0; let busy = false;
  for (const t of allTubes) {
    if (!t.seq) continue;
    busy = true;
    if (now < t.next) continue;
    setF(t, t.seq[t.i++]); t.next = now + t.step * (0.6 + Math.random() * 0.8);
    if (t.i >= t.seq.length) t.seq = null;
  }
  if (world && tubes.length) { let s = 0; for (const t of tubes) s += t.v; world.power(0.12 + 0.88 * s / tubes.length); }
  if (busy) fRaf = requestAnimationFrame(fTick);
}
if (!reduce && tubes.length) {
  tubes.forEach(t => setF(t, 0));
  if (world) { world.power(0.12); world.settle(); }
  setTimeout(() => tubes.forEach((t, j) => play(t, j === 1 ? 'ign4' : 'ign', 55, j * 240 + (j === 1 ? 160 : 0))), 700);
  let n = 0;
  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const flick = () => setTimeout(() => {
    if (!document.hidden) {
      if (scrollY < innerHeight * 0.85) {
        n++;
        if (n % 6 === 0) tubes.forEach((t, j) => play(t, 'dip', 48, j * 14));
        else {
          const k = Math.random() < 0.38 ? 1 : (Math.random() * tubes.length) | 0, r = Math.random();
          play(tubes[k], r < 0.46 ? 'stut' : r < 0.76 ? 'sput' : r < 0.88 ? 'tick' : 'dark', r < 0.46 ? 45 : 60);
          if (Math.random() < 0.2) play(tubes[(k + 1 + ((Math.random() * 3) | 0)) % tubes.length], 'tick', 45, 110);
        }
      }
      const end = $('#end');
      if (end && endTubes.length && inView(end) && Math.random() < 0.75) play(endTubes[(Math.random() * endTubes.length) | 0], Math.random() < 0.7 ? 'stut' : 'sput', 50);
    }
    flick();
  }, 900 + Math.random() * 2600);
  setTimeout(flick, 2900);
}
/* ---------- the word's reflection: the world gets one canvas per letter, then reads where each letter sits and how lit it is ---------- */
async function wordToWorld() {
  if (!world || !world.word || !tubes.length) return;
  try { await document.fonts.load('400 100px Ops'); } catch (e) { }
  const rectsNow = () => tubes.map(t => { const r = t.el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const draw = () => {
    const fsz = parseFloat(getComputedStyle(tubes[0].el).fontSize) || 120;
    const cv = tubes.map(t => {
      const r = t.el.getBoundingClientRect(), s = 2, ch = t.el.dataset.l || t.el.textContent;
      const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(r.width * s)); c.height = Math.max(2, Math.ceil(r.height * s));
      const g = c.getContext('2d'); g.scale(s, s); g.font = `400 ${fsz}px Ops`; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
      const m = g.measureText(ch), A = m.fontBoundingBoxAscent || fsz * 0.86, Dd = m.fontBoundingBoxDescent || fsz * 0.22;
      const base = (r.height - (A + Dd)) / 2 + A;
      // the reflection fades the further it reaches from the waterline: strong at the letter's foot, faint at its head
      const gr = g.createLinearGradient(0, base - fsz * 0.72, 0, base);
      gr.addColorStop(0, 'rgba(255,255,255,.16)'); gr.addColorStop(0.55, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillText(ch, 0, base);
      return c;
    });
    world.word(cv, () => wordK > 0.003 ? { k: wordK, fs: tubes.map(t => t.v), rects: rectsNow() } : null);
  };
  draw();
  let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(draw, 220); });
}
wordToWorld();
let flowI = 0; setInterval(() => { if (document.hidden) return; const fs = $$('#flow .fs'); fs.forEach((el, i) => el.classList.toggle('on', i === flowI)); flowI = (flowI + 1) % fs.length; }, 1500);

/* ---------- sound: deep water, all the time (browsers need one tap first) ---------- */
const ocean = createOcean();
const sndBtn = $('#snd');
const tabMute = (() => { const q = /[?&]mute\b/.test(location.search); try { if (q) sessionStorage.setItem('d4rk:mute', '1'); return q || sessionStorage.getItem('d4rk:mute') === '1'; } catch (e) { return q; } })();
function setSnd(on) { sndBtn.classList.toggle('on', on); sndBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); sndBtn.title = on ? 'Sound off' : 'Sound on'; }
let armed = !tabMute && store.get('d4rk:sound') !== 'off';
function tryStart() { let p; try { p = ocean.start(); } catch (e) { return; } Promise.resolve(p).then(() => { if (armed && ocean.playing) { armed = false; setSnd(true); } }); }
if (armed) setTimeout(() => { if (armed) tryStart(); }, 350);
const kick = e => { if (!armed || (e && e.target && e.target.closest && e.target.closest('#snd'))) return; tryStart(); };
['pointerdown', 'pointerup', 'mousedown', 'click', 'touchend', 'keydown'].forEach(ev => addEventListener(ev, kick, { passive: true, capture: true }));
sndBtn.addEventListener('click', e => { e.stopPropagation(); armed = false; if (ocean.playing) { ocean.stop(); setSnd(false); store.set('d4rk:sound', 'off'); } else { store.set('d4rk:sound', 'on'); setSnd(true); Promise.resolve(ocean.start()).then(() => setSnd(ocean.playing)); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) ocean.pause(); else ocean.resume(); });
const QUIET = 'a,button,input,label,.ticket,.stats,.prints,.step,.fs,.facts,.risks,.list,.connect-card,.modal,#nav,.hidden-list,.ca';
addEventListener('pointerdown', e => { if (!world || e.button > 0 || e.target.closest(QUIET)) return; if (world.dropAt(e.clientX, e.clientY)) ocean.plip(); }, { passive: true });
let wakeT = 0;
addEventListener('pointermove', e => { if (!world || reduce) return; const now = performance.now(); if (now - wakeT < 50) return; wakeT = now; world.lampAt(e.clientX, e.clientY); if (e.target.closest && e.target.closest(QUIET)) return; world.wakeAt(e.clientX, e.clientY); }, { passive: true });
window.__d4rk.ocean = ocean;

/* ---------- wallet (Wallet Standard) ---------- */
const W = { list: [], w: null, acct: null };
const chain = 'solana:mainnet';
function addWallet(w) {
  try {
    if (!w || !w.features || !w.name) return;
    const sol = (w.chains || []).some(c => String(c).startsWith('solana:'));
    if (!sol || !w.features['standard:connect'] || !w.features['solana:signMessage'] || !w.features['solana:signTransaction'] || W.list.some(x => x.name === w.name)) return;
    W.list.push(w);
    if (!W.w && store.get('d4rk:wallet') === w.name && w.accounts && w.accounts.length) use(w, w.accounts[0]);
    if (!$('#wModal').hidden) renderWallets();
  } catch (e) { }
}
const walletApi = Object.freeze({ register: (...ws) => { ws.forEach(addWallet); return () => { }; } });
addEventListener('wallet-standard:register-wallet', e => { try { e.detail(walletApi); } catch (_) { } });
try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: walletApi })); } catch (_) { }
function use(w, acct) {
  W.w = w; W.acct = acct; store.set('d4rk:wallet', w.name);
  $('#walletBtn').classList.add('on'); $('#walletLabel').textContent = short(acct.address);
  try { w.features['standard:events'] && w.features['standard:events'].on('change', ({ accounts }) => { if (accounts && W.w === w) { if (accounts.length) use(w, accounts[0]); else disconnect(); } }); } catch (e) { }
  loadMine(); renderForm();
}
function disconnect() {
  try { W.w && W.w.features['standard:disconnect'] && W.w.features['standard:disconnect'].disconnect(); } catch (e) { }
  W.w = null; W.acct = null; store.set('d4rk:wallet', '');
  $('#walletBtn').classList.remove('on'); $('#walletLabel').textContent = 'Connect'; S.mine = null; renderMine(); renderForm();
}
function renderWallets() {
  const box = $('#wList'); $('#wTitle').textContent = W.w ? 'Your wallet' : 'Connect a wallet';
  if (W.w) { box.innerHTML = `<p>${esc(W.w.name)}<br><code>${esc(W.acct.address)}</code></p><button class="wopt" type="button" id="wOut">Disconnect</button>`; $('#wOut').onclick = () => { disconnect(); $('#wModal').hidden = true; toast('Disconnected'); }; return; }
  if (!W.list.length) {
    const here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);
    box.innerHTML = mobile ? `<p>Open D4RK inside your wallet app's browser:</p><a class="wopt" href="https://phantom.app/ul/browse/${here}?ref=${ref}">Open in Phantom</a><a class="wopt" href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Open in Solflare</a>`
      : `<p>No Solana wallet found in this browser. Install one, then reload:</p><a class="wopt" href="https://phantom.com/download" target="_blank" rel="noopener">Phantom</a><a class="wopt" href="https://solflare.com/download" target="_blank" rel="noopener">Solflare</a><a class="wopt" href="https://backpack.app/download" target="_blank" rel="noopener">Backpack</a>`;
    return;
  }
  box.innerHTML = W.list.map((w, i) => `<button class="wopt" data-i="${i}" type="button">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name)}<small>Detected</small></button>`).join('');
}
function connect() { renderWallets(); $('#wModal').hidden = false; }
$('#wList').addEventListener('click', async e => {
  const b = e.target.closest('button.wopt[data-i]'); if (!b) return; const w = W.list[+b.dataset.i];
  try { b.disabled = true; const r = await w.features['standard:connect'].connect(); const acct = (r && r.accounts && r.accounts[0]) || (w.accounts && w.accounts[0]); if (!acct) throw new Error('No account shared'); $('#wModal').hidden = true; use(w, acct); toast('Connected ' + short(acct.address)); }
  catch (err) { toast(err && err.message ? err.message : 'Connection cancelled'); } finally { b.disabled = false; }
});
$('#walletBtn').addEventListener('click', connect);
$('#wClose').addEventListener('click', () => { $('#wModal').hidden = true; });
$('#wModal').addEventListener('click', e => { if (e.target.id === 'wModal') $('#wModal').hidden = true; });
async function signMsg(text) {
  const [r] = await W.w.features['solana:signMessage'].signMessage({ account: W.acct, message: new TextEncoder().encode(text) });
  return toB64(r.signature);
}
async function signTx(b64) { const [r] = await W.w.features['solana:signTransaction'].signTransaction({ account: W.acct, chain, transaction: fromB64(b64) }); return toB64(r.signedTransaction); }
async function sendTxs(list) { const signed = []; for (const t of list) signed.push(await signTx(t)); const r = await api('send', { txs: signed }); for (const s of r.sigs) await waitFor(s); return r.sigs; }
async function waitFor(sig) { const t0 = Date.now(); while (Date.now() - t0 < 90000) { await new Promise(r => setTimeout(r, 1400)); try { const s = await api('status?sig=' + sig); if (s.err) throw Object.assign(new Error('The transaction failed on-chain.'), { chain: true }); if (/confirmed|finalized/.test(s.status || '')) return true; } catch (e) { if (e.chain) throw e; } } throw new Error('Not confirmed after 90 seconds.'); }

/* ---------- session: one signed message proves the wallet, so only it can read its orders ---------- */
const sessKey = () => 'd4rk:s:' + (W.acct ? W.acct.address : '');
function session() { try { const s = JSON.parse(store.get(sessKey()) || 'null'); return s && s.exp > Date.now() + 60000 ? s.token : null; } catch (e) { return null; } }
async function ensureSession() {
  const t = session(); if (t) return t;
  const { message } = await api('challenge?wallet=' + W.acct.address);
  const sig = await signMsg(message);
  const r = await api('session', { wallet: W.acct.address, message, sig });
  store.set(sessKey(), JSON.stringify({ token: r.token, exp: r.exp })); return r.token;
}

/* ---------- the book: counts only ---------- */
function tween(el, to, fmt, ms = 900) { const from = Number(el._v) || 0; el._v = to; const t0 = performance.now(); const tick = now => { const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3); el.innerHTML = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
async function loadBook() {
  try {
    const [s, p] = await Promise.all([api('stats'), api('prints')]);
    const el = k => $(`#stats b[data-k="${k}"]`), sol = v => fsol(v) + '<small>SOL</small>';
    tween(el('open'), s.open, v => Math.round(v).toLocaleString('en-US')); tween(el('openSol'), s.openSol, sol); tween(el('matched'), s.matched, v => Math.round(v).toLocaleString('en-US')); tween(el('volSol'), s.volSol, sol);
    const u = $('#updated'); u.classList.add('ok'); u.querySelector('span').textContent = s.open ? `${s.open} waiting in the dark` : 'Live · the book is empty';
    $('#prints').innerHTML = p.prints.length ? p.prints.map(x => `<div class="print"><span class="coin">${tokImg(x)}<span><b>${esc(x.symbol)}</b><small> ${esc(compact(x.tokensUi))}</small></span></span><span class="mono">${fsol(x.sol)} SOL</span><span class="mono hide-m">${px(x.px)} SOL</span><a href="https://solscan.io/tx/${esc(x.sig)}" target="_blank" rel="noopener">${ago(x.ts)} ↗</a></div>`).join('')
      : `<div class="empty"><b>No prints yet.</b>The first trade in the dark lands here.</div>`;
    if (world && s.open > (S._lastOpen || 0)) world.pulse(0.4); S._lastOpen = s.open;
    if (world) world.orders(s.open);
  } catch (e) { const u = $('#updated'); u.classList.remove('ok'); u.querySelector('span').textContent = 'Book offline · retrying'; }
}

/* ---------- the order form ---------- */
async function loadCoins() { try { const r = await api('coins'); S.coins = r.coins || []; renderList(''); if (!S.coin && S.coins[0]) pickCoin(S.coins[0]); } catch (e) { $('#cRows').innerHTML = '<div class="empty">Could not load coins. Paste an address.</div>'; } }
function renderList(q) {
  q = (q || '').toLowerCase().trim();
  const L = S.coins.filter(c => !q || (c.symbol + ' ' + c.name + ' ' + c.mint).toLowerCase().includes(q)).slice(0, 40);
  $('#cRows').innerHTML = L.length ? L.map(c => `<button type="button" data-m="${esc(c.mint)}" class="${S.coin && S.coin.mint === c.mint ? 'on' : ''}">${tokImg(c)}<b>${esc(c.name || c.symbol)} <small style="color:var(--mut)">$${esc(c.symbol)}</small></b><em>${c.mcapSol ? compact(c.mcapSol) + ' SOL mcap' : ''}</em></button>`).join('') : `<div class="empty">${isAddr(q) ? 'Press enter to load this address.' : 'No match. Paste any pump.fun address.'}</div>`;
}
function pickCoin(c) { S.coin = c; $('#cCur').innerHTML = `${tokImg(c)}<span class="t">${esc(c.name || c.symbol)}<small>$${esc(c.symbol)} · ${c.priceSol ? px(c.priceSol) + ' SOL' : 'no price yet'}</small></span>`; $('#cPick').classList.remove('open'); $('#cList').hidden = true; renderForm(); }
$('#cPickBtn').addEventListener('click', () => { const open = $('#cList').hidden; $('#cList').hidden = !open; $('#cPick').classList.toggle('open', open); if (open) setTimeout(() => $('#cFindIn').focus(), 30); });
$('#cFindIn').addEventListener('input', e => renderList(e.target.value));
$('#cFind').addEventListener('submit', async e => { e.preventDefault(); const q = $('#cFindIn').value.trim(); if (!isAddr(q)) return; try { const r = await api('coin?mint=' + q); pickCoin(r.coin); } catch (err) { toast(err.message); } });
$('#cRows').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (!b) return; const c = S.coins.find(x => x.mint === b.dataset.m); if (c) pickCoin(c); });
document.addEventListener('click', e => { if (!e.target.closest('#cPick')) { $('#cList').hidden = true; $('#cPick').classList.remove('open'); } });
$('#side').addEventListener('click', e => { const b = e.target.closest('button[data-s]'); if (!b) return; S.side = b.dataset.s; $$('#side button').forEach(x => x.classList.toggle('on', x === b)); $('#amt').value = ''; renderForm(); });
for (const id of ['band', 'ttl']) $('#' + id).addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S[id] = +b.dataset.v; $$('#' + id + ' .chip').forEach(x => x.classList.toggle('on', x === b)); renderForm(); });
$('#amt').addEventListener('input', renderForm);
$('#amtMax').addEventListener('click', () => { if (S.bal != null) { $('#amt').value = S.side === 'buy' ? Math.max(0, S.bal - 0.01).toFixed(4) : String(S.bal); renderForm(); } });
async function loadBal() { S.bal = null; if (!W.acct || !S.coin) return; try { const r = await api(`balance?wallet=${W.acct.address}&mint=${S.side === 'buy' ? 'SOL' : S.coin.mint}`); S.bal = r.ui; $('#amtMax').hidden = false; $('#amtLbl').textContent = (S.side === 'buy' ? 'You pay · ' : 'You sell · ') + fsol(r.ui) + ' ' + (S.side === 'buy' ? 'SOL' : '$' + S.coin.symbol) + ' in wallet'; } catch (e) { } }
function renderForm() {
  const c = S.coin, a = Number($('#amt').value) || 0, buy = S.side === 'buy';
  $('#amtUnit').textContent = buy ? 'SOL' : (c ? '$' + c.symbol : 'coins'); if (!W.acct) { $('#amtLbl').textContent = buy ? 'You pay' : 'You sell'; $('#amtMax').hidden = true; }
  const rows = [];
  if (c && c.priceSol) {
    rows.push(['Price now', px(c.priceSol) + ' SOL']);
    if (a > 0) rows.push(buy ? ['You get about', compact(a / c.priceSol) + ' $' + c.symbol] : ['You get about', fsol(a * c.priceSol) + ' SOL']);
    rows.push(['Fills between', px(c.priceSol * (1 - S.band / 100)) + ' – ' + px(c.priceSol * (1 + S.band / 100))]);
  }
  rows.push(['Hidden for', S.ttl + (S.ttl === 1 ? ' hour' : ' hours')]);
  $('#prev').innerHTML = rows.map(r => `<div><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('');
  const btn = $('#place');
  btn.disabled = S.busy || (W.acct && (!c || !(a > 0)));
  btn.textContent = !W.acct ? 'Connect a wallet' : S.busy ? 'Working…' : buy ? 'Sign & hide buy order' : 'Sign & hide sell order';
  if (W.acct && c && S._balFor !== c.mint + S.side + W.acct.address) { S._balFor = c.mint + S.side + W.acct.address; loadBal(); }
}
function status(html, cls = '') { const s = $('#status'); s.className = 'status show ' + cls; s.innerHTML = html; }
$('#place').addEventListener('click', async () => {
  if (!W.acct) return connect();
  const c = S.coin, amount = $('#amt').value.trim(); if (!c || !(Number(amount) > 0)) return;
  S.busy = true; renderForm();
  try {
    status('<span class="loader"></span>Sign in once so only your wallet can read your orders…');
    const token = await ensureSession();
    status('<span class="loader"></span>Sign the order. It is a message, not a transaction.');
    const prep = await api('prepare', { token, mint: c.mint, side: S.side, amount, band: S.band, ttl: S.ttl });
    const sig = await signMsg(prep.message);
    status('<span class="loader"></span>Hiding the order…');
    const r = await api('order', { token, draft: prep.draft, sig });
    if (world) world.pulse(1);
    if (r.ticket) { await startTicket(token, r.ticket); }
    else status(`<b>Hidden.</b> Your ${S.side} order is waiting in the dark. Nobody can see it. It fills when another wallet takes the other side, or expires in ${S.ttl}h.`, 'ok');
    $('#amt').value = ''; loadMine(); loadBook();
  } catch (e) { status(esc(e.message || 'Cancelled'), 'err'); }
  finally { S.busy = false; renderForm(); }
});
// a match came back: this wallet signs first (its durable nonce keeps the trade valid until the other side signs)
async function startTicket(token, t) {
  let b = await api('build', { token, id: t.id });
  if (b.needsNonce) {
    status(`<span class="loader"></span>Matched. One-time setup first: your wallet opens a small nonce account (${b.rentSol.toFixed(4)} SOL, refundable) so the trade stays valid until the other side signs.`);
    await sendTxs(b.txs); b = await api('build', { token, id: t.id });
  }
  status(`<span class="loader"></span>Matched at ${px(b.px)} SOL. Sign the trade: ${b.give} for ${b.get}. Simulated on mainnet: ${b.sim && b.sim.ok ? 'it settles' : 'check below'}.`);
  const signed = await signTx(b.tx);
  await api('ticket', { token, id: t.id, tx: signed });
  status(`<b>Matched and signed.</b> ${esc(b.give)} for ${esc(b.get)} at ${px(b.px)} SOL. It settles the moment the other wallet signs. Nothing has moved yet.`, 'ok');
}

/* ---------- your orders and trades ---------- */
async function loadMine() {
  if (!W.acct) { S.mine = null; return renderMine(); }
  const token = session(); if (!token) { S.mine = { locked: true }; return renderMine(); }
  try { S.mine = await api('mine?token=' + encodeURIComponent(token)); } catch (e) { if (/session/i.test(e.message)) store.del(sessKey()); S.mine = { locked: true }; }
  renderMine();
}
function renderMine() {
  const box = $('#mine'); $('#refresh').hidden = !(S.mine && !S.mine.locked);
  if (!W.acct) { box.innerHTML = `<div class="connect-card"><div class="ico">D</div><div><h3>Connect to see your orders</h3><p>Your hidden orders and the trades waiting for your signature show up here. Nobody else can read them.</p></div><button class="btn primary" type="button" id="pcConnect">Connect a wallet</button></div>`; $('#pcConnect').onclick = connect; return; }
  if (!S.mine || S.mine.locked) { box.innerHTML = `<div class="connect-card"><div class="ico">D</div><div><h3>Sign in to read them</h3><p>One signed message proves the wallet is yours. It costs nothing and moves nothing.</p></div><button class="btn primary" type="button" id="pcSign">Sign in</button></div>`; $('#pcSign').onclick = async () => { try { await ensureSession(); loadMine(); } catch (e) { toast(e.message); } }; return; }
  const O = S.mine.orders || [], T = S.mine.tickets || [];
  const orders = O.length ? O.map(o => `<div class="item"><div><span class="pill ${o.side}">${o.side}</span> <b>${esc(o.amountUi)} ${o.side === 'buy' ? 'SOL of' : ''} $${esc(o.symbol)}</b><div class="meta">${o.status === 'open' ? `<span class="pill live"><i></i>hidden</span> ${esc(o.remainingUi)} left · ±${o.band}% · expires in ${ago(Date.now() * 2 - o.expires)}` : esc(o.status)}</div></div>${o.status === 'open' ? `<button class="btn ghost xs" data-cancel="${esc(o.id)}" type="button">Cancel</button>` : ''}</div>`).join('') : `<div class="empty">No orders yet.</div>`;
  const tickets = T.length ? T.map(t => `<div class="item"><div><b>${esc(t.give)} → ${esc(t.get)}</b><div class="meta">at ${px(t.px)} SOL · ${t.status === 'awaiting_b' && t.role === 'b' ? '<span class="pill wait">your signature</span>' : t.status === 'awaiting_b' ? 'waiting for the other wallet' : t.status === 'awaiting_a' && t.role === 'a' ? '<span class="pill wait">your signature</span>' : esc(t.status)}${t.sig && t.status === 'settled' ? ` · <a href="https://solscan.io/tx/${esc(t.sig)}" target="_blank" rel="noopener">view ↗</a>` : ''}</div></div>${(t.status === 'awaiting_b' && t.role === 'b') || (t.status === 'awaiting_a' && t.role === 'a') ? `<button class="btn primary xs" data-sign="${esc(t.id)}" data-role="${t.role}" type="button">Review &amp; sign</button>` : t.status === 'awaiting_b' && t.role === 'a' ? `<button class="btn ghost xs" data-void="${esc(t.id)}" type="button">Void</button>` : ''}</div>`).join('') : `<div class="empty">No matches yet.</div>`;
  box.innerHTML = `<div class="lists"><div class="list"><h4><span>Hidden orders</span><span>${O.filter(o => o.status === 'open').length}</span></h4>${orders}</div><div class="list"><h4><span>Matches</span><span>${T.length}</span></h4>${tickets}</div></div>`;
}
$('#mine').addEventListener('click', async e => {
  const token = session(); const b = e.target.closest('button'); if (!b || !token) return;
  try {
    b.disabled = true;
    if (b.dataset.cancel) { await api('cancel', { token, id: b.dataset.cancel }); toast('Order cancelled'); }
    else if (b.dataset.void) { const r = await api('void', { token, id: b.dataset.void }); if (r.txs && r.txs.length) await sendTxs(r.txs); toast('Trade voided'); }
    else if (b.dataset.sign && b.dataset.role === 'a') { location.hash = '#trade'; await startTicket(token, { id: b.dataset.sign }); }
    else if (b.dataset.sign) {
      const r = await api('review?token=' + encodeURIComponent(token) + '&id=' + encodeURIComponent(b.dataset.sign));
      if (!r.sim || !r.sim.ok) throw new Error('This trade would fail right now: ' + ((r.sim && r.sim.err) || 'simulation failed'));
      const signed = await signTx(r.tx); const s = await api('settle', { token, id: b.dataset.sign, tx: signed });
      toast('Sent. Settling…'); await waitFor(s.sig); toast('Settled in the dark'); if (world) world.pulse(1.2);
    }
  } catch (err) { toast(err.message || 'Cancelled'); }
  finally { b.disabled = false; loadMine(); loadBook(); }
});
$('#refresh').addEventListener('click', () => loadMine());

/* ---------- config ---------- */
async function loadConfig() {
  try {
    S.cfg = await api('config');
    const box = $('#caBox');
    if (S.cfg.ca && box) { const ca = esc(S.cfg.ca); box.hidden = false; box.innerHTML = `<div class="ca"><span class="ca-l">$D4RK</span><code>${short(S.cfg.ca)}</code><button type="button" id="caCopy">Copy</button><a href="https://pump.fun/coin/${ca}" target="_blank" rel="noopener">Buy</a><a href="https://dexscreener.com/solana/${ca}" target="_blank" rel="noopener">Chart</a></div>`; $('#caCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(S.cfg.ca).then(() => toast('Address copied')); }; }
  } catch (e) { }
}

/* ---------- boot ---------- */
layout(); onScroll();
requestAnimationFrame(() => { document.body.classList.remove('loading'); $$('.hero .rv').forEach(el => el.classList.add('vis')); });
renderForm(); renderMine(); loadConfig(); loadCoins(); loadBook();
setInterval(() => { if (!document.hidden) loadBook(); }, 20000);
setInterval(() => { if (!document.hidden && W.acct && session()) loadMine(); }, 30000);
