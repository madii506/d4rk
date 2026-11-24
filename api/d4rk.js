// D4RK API: a dark pool for memecoins.
// An order is a message the wallet signs. It is stored server-side and never listed: no feed, no per-coin book, no lookup by
// anyone but its own wallet (a signed sign-in). When a new order crosses a resting one on the same coin, they match at the live
// mid price, inside both orders' price bands. The wallet that just ordered starts the trade: ONE legacy transaction with its durable
// nonce first (so its signature stays valid while the other side gets round to it), the coin leg, the SOL leg, a memo and a 0-lamport
// tag transfer. The other wallet's signature settles it. No program, no custody, no desk key: if either leg can't pay, nothing moves.
// GET  config · stats · prints · coins · coin?mint= · balance?wallet=&mint= · challenge?wallet= · mine?token= · review?token=&id=
//      status?sig= · nonces?wallet= · sim?wa=&wb=&mint=&sol= (dry run between any two wallets, for verification)
// POST session · prepare · order · build · ticket · settle · cancel · void · send
const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, NonceAccount, NONCE_ACCOUNT_LENGTH, VersionedTransaction } = require('@solana/web3.js');
const SPL = require('@solana/spl-token');
const { ed25519 } = require('@noble/curves/ed25519');
const bs58 = (m => m.default || m)(require('bs58'));
const crypto = require('crypto');

const MOCK = process.env.D4RK_MOCK === '1';
const E = k => (process.env[k] || '').trim();
const RPCS = [E('RPC_URL'), 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'].filter(Boolean);
async function rpcFetch(url, opts) { let last = null; for (let round = 0; round < 2; round++) { for (const u of RPCS) { try { const r = await fetch(u, { ...opts, signal: AbortSignal.timeout(12000) }); if (r.status === 429 || r.status === 401 || r.status === 403 || r.status >= 500) { last = r; continue; } return r; } catch (e) { last = e; } } await new Promise(r => setTimeout(r, 600)); } if (last instanceof Error) throw last; return last; }
const conn = new Connection(RPCS[0], { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true });
const JUP = 'https://lite-api.jup.ag';
const SOL = 'So11111111111111111111111111111111111111112';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// every settled trade pays 0 SOL to this address, so the chain itself lists D4RK prints (nobody holds its key)
const TAG = new PublicKey(E('D4RK_TAG') || '6bZVvxZGg2o2Mk9q6Bjauz5uC3pcUC3qgL3xsMnsfz2c');
const TREASURY = (() => { try { return E('D4RK_TREASURY') ? new PublicKey(E('D4RK_TREASURY')) : null; } catch { return null; } })();
const FEE_BPS = TREASURY ? Math.max(0, Math.min(100, +(E('D4RK_FEE_BPS') || 20))) : 0;
const SLOTS = 8, SEED = 'd4rk-', MIN_LAMPORTS = 5000000, SESSION_DAYS = 7;
const ALLOWED = new Set([SystemProgram.programId.toBase58(), SPL.TOKEN_PROGRAM_ID.toBase58(), SPL.TOKEN_2022_PROGRAM_ID.toBase58(), SPL.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), MEMO.toBase58()]);

const out = (res, code, body, cache) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache || 'no-store'); res.end(JSON.stringify(body)); };
const body = req => new Promise(ok => { if (req.body) return ok(typeof req.body === 'string' ? JSON.parse(req.body) : req.body); let d = ''; req.on('data', c => d += c); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });
const pk = (s, what) => { try { return new PublicKey(String(s)); } catch { throw new Error(what || 'bad address'); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = () => crypto.randomBytes(9).toString('base64').replace(/\+/g, 'x').replace(/\//g, 'y').replace(/=+$/, '');
const cache = new Map(); const memo = async (k, ttl, fn) => { const c = cache.get(k); if (c && Date.now() - c.t < ttl) return c.v; const v = await fn(); cache.set(k, { t: Date.now(), v }); return v; };
async function getJ(url, ms = 8000) { for (let k = 0; k < 2; k++) { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json', 'user-agent': 'd4rk/1.0' } }); if (r.status === 429 && !k) { await sleep(1200); continue; } if (!r.ok) throw new Error(url.split('/')[2] + ' ' + r.status); return r.json(); } }
const memoIx = (signer, text) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: signer, isSigner: true, isWritable: false }], data: Buffer.from(text, 'utf8') });
const ser = t => Buffer.from(t.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');

// ---------------------------------------------------------------- storage: Postgres (Neon on Vercel, PGlite locally)
let _q = null;
async function q(text, params = []) {
  if (!_q) {
    const url = E('DATABASE_URL') || E('POSTGRES_URL') || E('STORAGE_URL') || E('STORAGE_DATABASE_URL');
    if (url) { const { neon } = require('@neondatabase/serverless'); const sql = neon(url); _q = (t, p) => sql.query(t, p); }
    else if (E('D4RK_PGLITE')) { const { PGlite } = await import('@electric-sql/pglite'); const pg = global.__d4pg || (global.__d4pg = new PGlite(E('D4RK_PGLITE'))); _q = async (t, p) => (await pg.query(t, p)).rows; }
    else throw new Error('the order book is not switched on yet');
    await _q(`create table if not exists d4_orders (id text primary key, wallet text not null, mint text not null, symbol text, side text not null, amount numeric not null, remaining numeric not null, decimals int not null, px_ref double precision not null, band_bps int not null, created timestamptz not null default now(), expires timestamptz not null, status text not null default 'open', msg text, sig text)`);
    await _q(`create index if not exists d4_orders_book on d4_orders (mint, side, status)`);
    await _q(`create index if not exists d4_orders_wallet on d4_orders (wallet)`);
    await _q(`create table if not exists d4_tickets (id text primary key, mint text not null, symbol text, decimals int, buy_id text, sell_id text, buyer text, seller text, a text, b text, token_raw numeric, lamports numeric, px double precision, nonce_account text, nonce text, tx text, sig text, status text not null default 'awaiting_a', created timestamptz not null default now(), updated timestamptz not null default now())`);
    await _q(`create index if not exists d4_tickets_a on d4_tickets (a)`); await _q(`create index if not exists d4_tickets_b on d4_tickets (b)`);
    await _q(`create table if not exists d4_meta (k text primary key, v text)`);
  }
  return _q(text, params);
}
let _secret = null;
async function secret() { if (_secret) return _secret; if (E('D4RK_SECRET')) return (_secret = E('D4RK_SECRET'));
  const r = await q(`select v from d4_meta where k='secret'`); if (r[0]) return (_secret = r[0].v);
  const v = crypto.randomBytes(32).toString('hex'); await q(`insert into d4_meta (k, v) values ('secret', $1) on conflict (k) do nothing`, [v]);
  return (_secret = (await q(`select v from d4_meta where k='secret'`))[0].v); }
const hmac = async s => crypto.createHmac('sha256', await secret()).update(s).digest('base64url');

// ---------------------------------------------------------------- tokens and prices
const MOCK_COINS = MOCK ? require('../dev/coins.json') : [];
async function jupInfo(mints) { const o = {}; const L = [...new Set(mints)].filter(Boolean); for (let i = 0; i < L.length; i += 90) { try { const j = await getJ(`${JUP}/tokens/v2/search?query=${L.slice(i, i + 90).join(',')}`); for (const t of j || []) o[t.id] = { symbol: t.symbol, name: t.name, image: t.icon || null, decimals: t.decimals, usd: t.usdPrice ?? null, mcapUsd: t.mcap ?? t.fdv ?? null, liquidity: t.liquidity ?? null }; } catch { } } return o; }
async function solUsd() { return memo('solusd', 20000, async () => ((await jupInfo([SOL]))[SOL] || {}).usd || null); }
async function mintInfo(mintStr) { const mint = pk(mintStr, 'bad coin address').toBase58();
  if (MOCK) { const c = MOCK_COINS.find(x => x.mint === mint); if (!c) throw new Error('that mint does not exist'); return { mint, decimals: 6, program: SPL.TOKEN_PROGRAM_ID.toBase58(), ok: true, block: null, warn: [] }; }
  return memo('mint:' + mint, 300000, async () => {
    const acc = await conn.getParsedAccountInfo(new PublicKey(mint)); const v = acc.value; if (!v) throw new Error('that mint does not exist');
    const prog = v.owner.toBase58(); if (prog !== SPL.TOKEN_PROGRAM_ID.toBase58() && prog !== SPL.TOKEN_2022_PROGRAM_ID.toBase58()) throw new Error('not a token mint');
    const info = v.data.parsed && v.data.parsed.info; if (!info || v.data.parsed.type !== 'mint') throw new Error('not a token mint');
    const ext = Object.fromEntries((info.extensions || []).map(e => [e.extension, e.state || {}])); const warn = []; let block = null;
    const tf = ext.transferFeeConfig; if (tf && ((tf.newerTransferFee && +tf.newerTransferFee.transferFeeBasisPoints > 0) || (tf.olderTransferFee && +tf.olderTransferFee.transferFeeBasisPoints > 0))) block = 'this token takes a fee on every transfer';
    if (ext.transferHook && ext.transferHook.programId) block = 'this token runs a transfer hook';
    if (ext.nonTransferable) block = 'this token cannot be transferred';
    if (ext.pausableConfig && ext.pausableConfig.paused) block = 'its issuer has paused transfers';
    if (ext.defaultAccountState && ext.defaultAccountState.accountState === 'frozen') block = 'new holders start frozen by its issuer';
    if (ext.scaledUiAmountConfig || ext.interestBearingConfig) block = 'its displayed balance is scaled; D4RK only trades plain coins';
    if (ext.permanentDelegate) warn.push('its issuer keeps a permanent delegate');
    if (info.freezeAuthority) warn.push('its issuer can freeze accounts');
    return { mint, decimals: info.decimals, program: prog, ok: !block, block, warn };
  }); }
// a coin with its live mid in SOL (Jupiter's last price, in SOL terms)
async function coin(mintStr, fresh) { const m = await mintInfo(mintStr);
  if (MOCK) { const c = MOCK_COINS.find(x => x.mint === m.mint); const wob = 1 + 0.004 * Math.sin(Date.now() / 60000); return { ...m, symbol: c.symbol, name: c.name, image: c.image, priceSol: c.priceSol * wob, mcapSol: c.mcapSol }; }
  const [J, su] = await Promise.all([memo('jup:' + m.mint, fresh ? 3000 : 20000, () => jupInfo([m.mint])), solUsd()]); const j = J[m.mint] || {};
  return { ...m, symbol: j.symbol || m.mint.slice(0, 4), name: j.name || '', image: j.image || null, priceSol: j.usd && su ? j.usd / su : null, mcapSol: j.mcapUsd && su ? j.mcapUsd / su : null, liquidityUsd: j.liquidity ?? null }; }
async function coins() { return memo('coins', 60000, async () => {
  if (MOCK) return MOCK_COINS;
  let pools = []; try { pools = ((await getJ('https://afk-fawn.vercel.app/api/pools', 12000)).pools || []).filter(p => p.tvlSol >= 25).sort((a, b) => b.volSol - a.volSol).slice(0, 40); } catch { }
  const J = await jupInfo(pools.map(p => p.mint)); const su = await solUsd();
  return pools.map(p => { const j = J[p.mint] || {}; return { mint: p.mint, symbol: p.symbol || j.symbol, name: p.name || j.name, image: p.image || j.image || null, priceSol: j.usd && su ? j.usd / su : null, mcapSol: p.mcapSol || null, volSol: p.volSol || null }; }).filter(c => c.priceSol); }); }
const toRaw = (ui, dec) => { const s = String(ui).trim(); if (!/^\d*\.?\d+$/.test(s)) throw new Error('enter an amount above zero'); const [w, f = ''] = s.split('.'); const raw = BigInt(w || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0'); if (raw <= 0n) throw new Error('enter an amount above zero'); return raw; };
const toUi = (raw, dec) => Number(BigInt(raw)) / 10 ** dec;
async function balanceOf(owner, m) { const w = new PublicKey(owner);
  if (MOCK) return m === SOL ? 42n * 10n ** 9n : 10n ** 12n;
  if (m === SOL) return BigInt(await conn.getBalance(w));
  const r = await conn.getTokenAccountsByOwner(w, { mint: new PublicKey(m) }); let raw = 0n; for (const x of r.value) raw += BigInt(SPL.AccountLayout.decode(x.account.data).amount.toString()); return raw; }

// ---------------------------------------------------------------- sessions: one signed message, then a token only this server can mint
const challenge = w => `D4RK sign-in\nwallet: ${w}\nissued: ${new Date().toISOString().slice(0, 16)}Z\nThis proves the wallet is yours, so only you can read your hidden orders. It costs nothing and moves nothing.`;
const verifySig = (msg, sigB64, wallet) => { if (MOCK) return true; const sig = Buffer.from(String(sigB64 || ''), 'base64'); if (sig.length !== 64) return false; return ed25519.verify(sig, Buffer.from(msg, 'utf8'), new PublicKey(wallet).toBytes()); };
async function session(req) { const B = await body(req), w = pk(B.wallet, 'connect a wallet first').toBase58(), msg = String(B.message || '');
  const m = msg.match(/^D4RK sign-in\nwallet: ([1-9A-HJ-NP-Za-km-z]{32,44})\nissued: (\S+)\n/); if (!m || m[1] !== w) throw new Error('that is not a D4RK sign-in');
  if (Math.abs(Date.now() - Date.parse(m[2])) > 15 * 60000) throw new Error('that sign-in is stale; try again');
  if (!verifySig(msg, B.sig, w)) throw new Error('the signature does not match the wallet');
  const exp = Date.now() + SESSION_DAYS * 864e5, p = Buffer.from(JSON.stringify({ w, exp })).toString('base64url'); return { token: p + '.' + await hmac(p), exp }; }
async function who(token) { const [p, s] = String(token || '').split('.'); if (!p || !s || s !== await hmac(p)) throw new Error('session expired; sign in again'); const o = JSON.parse(Buffer.from(p, 'base64url').toString()); if (!(o.exp > Date.now())) throw new Error('session expired; sign in again'); return o.w; }

// ---------------------------------------------------------------- orders: drafted here (so the price reference can't be forged), signed by the wallet
const orderMsg = d => `D4RK hidden order ${d.id}\nwallet: ${d.wallet}\n${d.side === 'buy' ? `buy $${d.symbol} with up to ${d.amountUi} SOL` : `sell up to ${d.amountUi} $${d.symbol}`}\ncoin: ${d.mint}\nfill only within ${d.band}% of ${d.pxRef.toPrecision(6)} SOL\nexpires: ${new Date(d.expires).toISOString()}\nThis signs an order, not a transaction. Nothing moves until both wallets sign one trade.`;
async function prepare(req) { const B = await body(req), w = await who(B.token); const c = await coin(B.mint, true); if (!c.ok) throw new Error(`$${c.symbol}: ${c.block}`); if (!(c.priceSol > 0)) throw new Error('no live price for this coin yet');
  const side = B.side === 'sell' ? 'sell' : 'buy', band = [1, 3, 10].includes(+B.band) ? +B.band : 3, ttl = [1, 6, 24].includes(+B.ttl) ? +B.ttl : 6;
  const dec = side === 'buy' ? 9 : c.decimals, raw = toRaw(B.amount, dec);
  const lamports = side === 'buy' ? raw : BigInt(Math.floor(toUi(raw, dec) * c.priceSol * 1e9)); if (lamports < BigInt(MIN_LAMPORTS)) throw new Error('the smallest order is about 0.005 SOL');
  const have = await balanceOf(w, side === 'buy' ? SOL : c.mint); if (have < raw) throw new Error(side === 'buy' ? 'you do not hold that much SOL' : `you hold ${toUi(have, dec).toLocaleString('en-US')} $${c.symbol}, not that much`);
  const d = { id: rid(), wallet: w, mint: c.mint, symbol: c.symbol, side, amountRaw: raw.toString(), amountUi: toUi(raw, dec).toString(), decimals: c.decimals, band, pxRef: c.priceSol, expires: Date.now() + ttl * 3600e3 };
  d.mac = await hmac(JSON.stringify(d)); return { draft: d, message: orderMsg(d) }; }
async function placeOrder(req) { const B = await body(req), w = await who(B.token), d = B.draft || {};
  const { mac, ...plain } = d; if (!mac || mac !== await hmac(JSON.stringify(plain))) throw new Error('that order draft was changed; start again');
  if (d.wallet !== w) throw new Error('that order belongs to another wallet'); if (!(d.expires > Date.now())) throw new Error('that draft expired');
  const msg = orderMsg(plain); if (!verifySig(msg, B.sig, w)) throw new Error('the signature does not match the order');
  await q(`insert into d4_orders (id, wallet, mint, symbol, side, amount, remaining, decimals, px_ref, band_bps, expires, msg, sig) values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,to_timestamp($10 / 1000.0),$11,$12)`,
    [d.id, w, d.mint, d.symbol, d.side, d.amountRaw, d.decimals, d.pxRef, d.band * 100, d.expires, msg, String(B.sig)]);
  const t = await match(d.id); return { order: { id: d.id }, ticket: t ? { id: t } : null }; }
// match a fresh order against the oldest resting orders on the other side, at the live mid, inside both bands
async function match(orderId) {
  const [o] = await q(`select * from d4_orders where id=$1`, [orderId]); if (!o || o.status !== 'open') return null;
  const opp = o.side === 'buy' ? 'sell' : 'buy';
  const C = await q(`select * from d4_orders where mint=$1 and side=$2 and status='open' and wallet<>$3 and expires > now() and remaining > 0 order by created asc limit 25`, [o.mint, opp, o.wallet]);
  if (!C.length) return null;
  const c = await coin(o.mint, true); const mid = c.priceSol; if (!(mid > 0)) return null;
  const inBand = x => Math.abs(mid / x.px_ref - 1) <= x.band_bps / 1e4;
  if (!inBand(o)) return null;
  const lpr = mid * 1e9 / 10 ** o.decimals;                    // lamports per raw coin unit
  for (const k of C) {
    if (!inBand(k)) continue;
    const sell = o.side === 'sell' ? o : k, buy = o.side === 'buy' ? o : k;
    const tokens = BigInt(Math.min(Number(sell.remaining), Math.floor(Number(buy.remaining) / lpr)));
    const lamports = BigInt(Math.round(Number(tokens) * lpr)); if (tokens <= 0n || lamports < BigInt(MIN_LAMPORTS)) continue;
    // reserve both sides atomically; if either moved under us, put the other back
    const r1 = await q(`update d4_orders set remaining = remaining - $2 where id=$1 and status='open' and remaining >= $2 returning id`, [sell.id, tokens.toString()]); if (!r1.length) continue;
    const r2 = await q(`update d4_orders set remaining = remaining - $2 where id=$1 and status='open' and remaining >= $2 returning id`, [buy.id, lamports.toString()]);
    if (!r2.length) { await q(`update d4_orders set remaining = remaining + $2 where id=$1`, [sell.id, tokens.toString()]); continue; }
    await q(`update d4_orders set status = case when remaining <= 0 then 'filled' else status end where id = any($1)`, [[sell.id, buy.id]]);
    const id = rid();
    await q(`insert into d4_tickets (id, mint, symbol, decimals, buy_id, sell_id, buyer, seller, a, b, token_raw, lamports, px) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, o.mint, o.symbol, o.decimals, buy.id, sell.id, buy.wallet, sell.wallet, o.wallet, k.wallet, tokens.toString(), lamports.toString(), mid]);
    return id;
  }
  return null;
}

// ---------------------------------------------------------------- durable nonces: up to 8 per wallet, at addresses derived from the wallet
const nonceAddr = (w, k) => PublicKey.createWithSeed(w, SEED + k, SystemProgram.programId);
const mockNonces = global.__d4nonces || (global.__d4nonces = new Map());
async function nonces(walletStr) { const w = pk(walletStr, 'bad wallet'); const addrs = await Promise.all(Array.from({ length: SLOTS }, (_, k) => nonceAddr(w, k)));
  const busy = new Set((await q(`select nonce_account, nonce from d4_tickets where a=$1 and status in ('awaiting_b','sent')`, [w.toBase58()])).map(r => r.nonce_account + ':' + r.nonce));
  if (MOCK) return addrs.map((a, k) => { const n = mockNonces.get(a.toBase58()); return { slot: k, address: a.toBase58(), exists: !!n, lamports: n ? 1447680 : 0, nonce: n || null, busy: !!(n && busy.has(a.toBase58() + ':' + n)) }; });
  const accs = await conn.getMultipleAccountsInfo(addrs);
  return addrs.map((a, k) => { const acc = accs[k]; let nonce = null; if (acc && acc.data.length === NONCE_ACCOUNT_LENGTH) { try { nonce = NonceAccount.fromAccountData(acc.data).nonce; } catch { } }
    return { slot: k, address: a.toBase58(), exists: !!acc, lamports: acc ? acc.lamports : 0, nonce, busy: !!(nonce && busy.has(a.toBase58() + ':' + nonce)) }; }); }
async function latest() { if (MOCK) return { blockhash: '11111111111111111111111111111111' }; return conn.getLatestBlockhash('confirmed'); }
async function nonceSetup(w) { const N = await nonces(w.toBase58()); const free = N.find(n => !n.exists); if (!free) throw new Error('you have 8 trades waiting; void one first');
  const rent = MOCK ? 1447680 : await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH); const t = new Transaction();
  t.add(...SystemProgram.createNonceAccount({ fromPubkey: w, noncePubkey: new PublicKey(free.address), basePubkey: w, seed: SEED + free.slot, authorizedPubkey: w, lamports: rent }).instructions, memoIx(w, 'd4rk:nonce:' + free.slot));
  t.recentBlockhash = (await latest()).blockhash; t.feePayer = w; return { needsNonce: true, slot: free.slot, rentSol: rent / 1e9, txs: [ser(t)] }; }

// ---------------------------------------------------------------- the trade: two legs, one transaction
function legIxs(payer, from, to, m, raw) { if (m.native) return [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: BigInt(raw) })];
  const mint = new PublicKey(m.mint), prog = new PublicKey(m.program), src = SPL.getAssociatedTokenAddressSync(mint, from, true, prog), dst = SPL.getAssociatedTokenAddressSync(mint, to, true, prog);
  return [SPL.createAssociatedTokenAccountIdempotentInstruction(payer, dst, to, mint, prog), SPL.createTransferCheckedInstruction(src, mint, dst, from, BigInt(raw), m.decimals, [], prog)]; }
const RENT0 = 890880;
async function feeFor(lamports) { if (!TREASURY || !FEE_BPS) return 0; let f = Math.max(10000, Math.round(Number(lamports) * FEE_BPS / 1e4)); try { const tb = MOCK ? 1e9 : await conn.getBalance(TREASURY); if (tb < RENT0) f = Math.max(f, RENT0 - tb + 10000); } catch { } return f; }
async function tradeTx(T, m, nonceAccount, nonceValue) {
  const a = new PublicKey(T.a), b = new PublicKey(T.b), buyer = new PublicKey(T.buyer), seller = new PublicKey(T.seller);
  const t = new Transaction(); t.feePayer = a; t.recentBlockhash = nonceValue;
  if (nonceAccount) t.add(SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: a }));
  t.add(...legIxs(a, seller, buyer, m, T.token_raw), ...legIxs(a, buyer, seller, { native: true }, T.lamports));
  const fee = await feeFor(T.lamports); if (fee > 0) t.add(SystemProgram.transfer({ fromPubkey: a, toPubkey: TREASURY, lamports: fee }));
  t.add(memoIx(a, 'd4rk:' + T.id), SystemProgram.transfer({ fromPubkey: a, toPubkey: TAG, lamports: 0 }));
  return { t, fee }; }
async function simulate(t) { if (MOCK) return { ok: true, units: 31000 }; try { const r = await conn.simulateTransaction(new VersionedTransaction(t.compileMessage()), { sigVerify: false, replaceRecentBlockhash: false }); return { ok: !r.value.err, err: r.value.err ? JSON.stringify(r.value.err) : null, units: r.value.unitsConsumed, logs: (r.value.logs || []).filter(l => /rror|insufficient|failed/i.test(l)).slice(-4) }; } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 180) }; } }
const legText = (T, side) => side === 'coin' ? `${(+toUi(T.token_raw, T.decimals).toPrecision(6)).toLocaleString('en-US')} $${T.symbol}` : `${(+toUi(T.lamports, 9).toPrecision(6))} SOL`;
async function ticketFor(id, w) { const [T] = await q(`select * from d4_tickets where id=$1`, [String(id || '')]); if (!T) throw new Error('no such trade'); if (w && T.a !== w && T.b !== w) throw new Error('that trade is not yours'); return T; }
// the wallet that ordered last signs first: build its transaction (or the one-time nonce setup)
async function build(req) { const B = await body(req), w = await who(B.token), T = await ticketFor(B.id, w);
  if (T.a !== w) throw new Error('the other wallet starts this trade'); if (T.status !== 'awaiting_a') throw new Error('this trade is already ' + T.status.replace('_', ' '));
  const m = await coin(T.mint), a = new PublicKey(w);
  const giveRaw = T.a === T.buyer ? BigInt(T.lamports) + 3000000n : BigInt(T.token_raw); const have = await balanceOf(w, T.a === T.buyer ? SOL : T.mint);
  if (have < giveRaw) throw new Error(T.a === T.buyer ? 'you no longer hold enough SOL for this trade' : `you no longer hold enough $${T.symbol} for this trade`);
  const N = await nonces(w); const slot = N.find(n => n.exists && n.nonce && !n.busy); if (!slot) return nonceSetup(a);
  const { t, fee } = await tradeTx(T, m, new PublicKey(slot.address), slot.nonce); const sim = await simulate(t);
  return { tx: ser(t), px: T.px, feeSol: fee / 1e9, give: T.a === T.buyer ? legText(T, 'sol') : legText(T, 'coin'), get: T.a === T.buyer ? legText(T, 'coin') : legText(T, 'sol'), sim }; }
// read a signed trade back out of its own bytes, so what gets stored is exactly what the transaction does
function parseTrade(txB64, T) { const t = Transaction.from(Buffer.from(String(txB64 || ''), 'base64')); const ix = t.instructions;
  for (const i of ix) if (!ALLOWED.has(i.programId.toBase58())) throw new Error('unexpected program in the trade');
  if (!t.feePayer || t.feePayer.toBase58() !== T.a) throw new Error('wrong fee payer');
  const adv = ix[0]; if (!adv || !adv.programId.equals(SystemProgram.programId) || adv.data.readUInt32LE(0) !== 4) throw new Error('a trade must start by advancing a nonce');
  const mem = ix.find(i => i.programId.equals(MEMO)); if (!mem || mem.data.toString('utf8') !== 'd4rk:' + T.id) throw new Error('this transaction is not that trade');
  let coinOk = false, solOk = false;
  for (const i of ix.slice(1)) { const p = i.programId.toBase58();
    if (p === SystemProgram.programId.toBase58()) { const k = i.data.readUInt32LE(0); if (k !== 2) throw new Error('unexpected system instruction'); const lam = i.data.readBigUInt64LE(4), from = i.keys[0].pubkey.toBase58(), to = i.keys[1].pubkey.toBase58();
      if (to === TAG.toBase58() && lam === 0n) continue; if (TREASURY && to === TREASURY.toBase58() && from === T.a) continue;
      if (from === T.buyer && to === T.seller && lam === BigInt(T.lamports)) { solOk = true; continue; } throw new Error('unexpected SOL transfer'); }
    if (p === SPL.TOKEN_PROGRAM_ID.toBase58() || p === SPL.TOKEN_2022_PROGRAM_ID.toBase58()) { if (i.data[0] !== 12) throw new Error('unexpected token instruction'); const raw = i.data.readBigUInt64LE(1), mint = i.keys[1].pubkey.toBase58(), owner = i.keys[3].pubkey.toBase58();
      if (mint === T.mint && owner === T.seller && raw === BigInt(T.token_raw) && i.keys[2].pubkey.equals(SPL.getAssociatedTokenAddressSync(new PublicKey(T.mint), new PublicKey(T.buyer), true, i.programId))) { coinOk = true; continue; } throw new Error('unexpected token transfer'); }
    if (p === SPL.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) { if (!(i.data.length === 1 && i.data[0] === 1) || i.keys[0].pubkey.toBase58() !== T.a) throw new Error('unexpected token-account instruction'); continue; } }
  if (!coinOk || !solOk) throw new Error('the trade legs do not match the match');
  return { t, nonceAccount: adv.keys[0].pubkey.toBase58(), nonce: t.recentBlockhash }; }
const sigOf = (t, w) => { const s = t.signatures.find(x => x.publicKey.toBase58() === w); return s && s.signature; };
async function submitA(req) { const B = await body(req), w = await who(B.token), T = await ticketFor(B.id, w); if (T.a !== w || T.status !== 'awaiting_a') throw new Error('this trade is not waiting for you');
  const P = parseTrade(B.tx, T); const s = sigOf(P.t, w); if (!MOCK && (!s || !ed25519.verify(s, P.t.serializeMessage(), new PublicKey(w).toBytes()))) throw new Error('the trade is not signed by your wallet');
  await q(`update d4_tickets set tx=$2, nonce_account=$3, nonce=$4, status='awaiting_b', updated=now() where id=$1 and status='awaiting_a'`, [T.id, ser(P.t), P.nonceAccount, P.nonce]); return { id: T.id }; }
async function review(qs) { const w = await who(qs.get('token')), T = await ticketFor(qs.get('id'), w); if (T.b !== w || T.status !== 'awaiting_b') throw new Error('this trade is not waiting for you');
  const t = Transaction.from(Buffer.from(T.tx, 'base64')); const sim = await simulate(t);
  return { tx: T.tx, sim, px: T.px, give: T.b === T.buyer ? legText(T, 'sol') : legText(T, 'coin'), get: T.b === T.buyer ? legText(T, 'coin') : legText(T, 'sol') }; }
async function settle(req) { const B = await body(req), w = await who(B.token), T = await ticketFor(B.id, w); if (T.b !== w || T.status !== 'awaiting_b') throw new Error('this trade is not waiting for you');
  const P = parseTrade(B.tx, T); if (P.nonce !== T.nonce || P.nonceAccount !== T.nonce_account) throw new Error('that is not the transaction the other wallet signed');
  const raw = P.t.serialize({ requireAllSignatures: !MOCK, verifySignatures: !MOCK }); let sig;
  if (MOCK) sig = bs58.encode(crypto.randomBytes(64)); else sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
  await q(`update d4_tickets set status='sent', sig=$2, tx=null, updated=now() where id=$1`, [T.id, sig]); return { sig }; }
async function cancelOrder(req) { const B = await body(req), w = await who(B.token); const r = await q(`update d4_orders set status='cancelled' where id=$1 and wallet=$2 and status='open' returning id`, [String(B.id || ''), w]); if (!r.length) throw new Error('nothing to cancel'); return { id: r[0].id }; }
async function voidTicket(req) { const B = await body(req), w = await who(B.token), T = await ticketFor(B.id, w); if (T.a !== w) throw new Error('only the wallet that signed first can void it');
  if (T.status === 'awaiting_a') { await release(T, 'void'); return { txs: [] }; }
  if (T.status !== 'awaiting_b') throw new Error('this trade is already ' + T.status);
  const a = new PublicKey(w), t = new Transaction().add(SystemProgram.nonceAdvance({ noncePubkey: new PublicKey(T.nonce_account), authorizedPubkey: a }), memoIx(a, 'd4rk:void:' + T.id)); t.recentBlockhash = (await latest()).blockhash; t.feePayer = a;
  await release(T, 'void'); return { txs: [ser(t)] }; }
async function release(T, status) { await q(`update d4_tickets set status=$2, tx=null, updated=now() where id=$1`, [T.id, status]);
  await q(`update d4_orders set remaining = remaining + $2, status = case when status='filled' and expires > now() then 'open' else status end where id=$1`, [T.sell_id, T.token_raw]);
  await q(`update d4_orders set remaining = remaining + $2, status = case when status='filled' and expires > now() then 'open' else status end where id=$1`, [T.buy_id, T.lamports]); }

// ---------------------------------------------------------------- housekeeping: settle what landed, void what went stale, expire old orders
async function sweep() { return memo('sweep', 8000, async () => {
  await q(`update d4_orders set status='expired' where status='open' and expires <= now()`);
  for (const T of await q(`select * from d4_tickets where status='awaiting_a' and updated < now() - interval '30 minutes'`)) await release(T, 'void');
  const sent = await q(`select id, sig from d4_tickets where status='sent' limit 100`);
  if (sent.length) { if (MOCK) { for (const s of sent) await q(`update d4_tickets set status='settled', updated=now() where id=$1`, [s.id]); }
    else { const st = await conn.getSignatureStatuses(sent.map(s => s.sig), { searchTransactionHistory: true }); for (let i = 0; i < sent.length; i++) { const v = st.value[i]; if (v && v.err) await q(`update d4_tickets set status='failed', updated=now() where id=$1`, [sent[i].id]); else if (v && /confirmed|finalized/.test(v.confirmationStatus || '')) await q(`update d4_tickets set status='settled', updated=now() where id=$1`, [sent[i].id]); } } }
  return true; }); }
async function stats() { await sweep(); const [o] = await q(`select count(*)::int n, coalesce(sum(case when side='buy' then remaining / 1e9 else remaining / power(10, decimals) * px_ref end), 0)::float8 sol from d4_orders where status='open' and expires > now()`);
  const [t] = await q(`select count(*) filter (where status <> 'void')::int matched, count(*) filter (where status='settled')::int settled, coalesce(sum(lamports) filter (where status='settled'), 0)::float8 / 1e9 vol from d4_tickets`);
  return { open: o.n, openSol: Math.round(o.sol * 10) / 10, matched: t.matched, settled: t.settled, volSol: Math.round(t.vol * 100) / 100, feeBps: FEE_BPS }; }
async function prints() { await sweep(); const R = await q(`select id, mint, symbol, decimals, token_raw, lamports, px, sig, extract(epoch from updated) * 1000 as ts from d4_tickets where status='settled' order by updated desc limit 20`);
  const info = MOCK ? {} : await jupInfo(R.map(r => r.mint)); return R.map(r => ({ id: r.id, mint: r.mint, symbol: r.symbol, image: (info[r.mint] || {}).image || (MOCK_COINS.find(c => c.mint === r.mint) || {}).image || null, tokensUi: toUi(r.token_raw, r.decimals), sol: toUi(r.lamports, 9), px: r.px, sig: r.sig, ts: Number(r.ts) })); }
async function mine(qs) { const w = await who(qs.get('token')); await sweep();
  const O = await q(`select id, mint, symbol, side, amount, remaining, decimals, band_bps, status, extract(epoch from expires) * 1000 as expires from d4_orders where wallet=$1 order by created desc limit 50`, [w]);
  const T = await q(`select * from d4_tickets where a=$1 or b=$1 order by created desc limit 50`, [w]);
  return { orders: O.map(o => ({ id: o.id, symbol: o.symbol, side: o.side, band: o.band_bps / 100, status: o.status, expires: Number(o.expires), amountUi: +toUi(o.amount, o.side === 'buy' ? 9 : o.decimals).toPrecision(6), remainingUi: +toUi(o.remaining, o.side === 'buy' ? 9 : o.decimals).toPrecision(6) })),
    tickets: T.map(t => { const role = t.a === w ? 'a' : 'b', mineBuy = t.buyer === w; return { id: t.id, role, status: t.status, px: t.px, sig: t.sig, give: mineBuy ? legText(t, 'sol') : legText(t, 'coin'), get: mineBuy ? legText(t, 'coin') : legText(t, 'sol') }; }) }; }
async function sendTxs(req) { const B = await body(req); if (!Array.isArray(B.txs) || !B.txs.length || B.txs.length > 3) throw new Error('nothing to send'); const sigs = [];
  for (const b64 of B.txs) { const t = Transaction.from(Buffer.from(String(b64), 'base64')); for (const i of t.instructions) if (!ALLOWED.has(i.programId.toBase58())) throw new Error('unexpected program');
    if (MOCK) { for (const i of t.instructions) if (i.programId.equals(SystemProgram.programId) && i.data.readUInt32LE(0) === 3) mockNonces.set(i.keys[1].pubkey.toBase58(), bs58.encode(crypto.randomBytes(32))); sigs.push(bs58.encode(crypto.randomBytes(64))); continue; }
    sigs.push(await conn.sendRawTransaction(t.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 })); }
  return { sigs }; }
// dry run between any two wallets: is a D4RK trade of this coin buildable and does it simulate? (no nonce, recent blockhash)
async function sim(qs) { const wa = pk(qs.get('wa'), 'bad buyer').toBase58(), wb = pk(qs.get('wb'), 'bad seller').toBase58(), m = await coin(qs.get('mint'), true); const sol = Number(qs.get('sol') || 0.05);
  const lamports = BigInt(Math.round(sol * 1e9)), tokens = BigInt(Math.floor(sol / m.priceSol * 10 ** m.decimals));
  const T = { id: 'dryrun' + rid().slice(0, 4), a: wa, b: wb, buyer: wa, seller: wb, token_raw: tokens.toString(), lamports: lamports.toString(), decimals: m.decimals, symbol: m.symbol };
  const { t } = await tradeTx(T, m, null, (await latest()).blockhash); const r = await simulate(t); const bytes = t.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  return { coin: m.symbol, priceSol: m.priceSol, give: legText(T, 'sol'), get: legText(T, 'coin'), bytes, ...r }; }

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const qs = u.searchParams; const p = (qs.get('__p') || u.pathname.replace(/^\/api\/?(d4rk)?\/?/, '')).replace(/\/+$/, '');
  try {
    if (req.method === 'POST') {
      const R = { session, prepare, order: placeOrder, build, ticket: submitA, settle, cancel: cancelOrder, void: voidTicket, send: sendTxs }[p];
      if (!R) return out(res, 404, { ok: false, error: 'not found' }); return out(res, 200, { ok: true, ...(await R(req)) });
    }
    if (p === 'config') return out(res, 200, { ok: true, feeBps: FEE_BPS, treasury: TREASURY ? TREASURY.toBase58() : null, ca: E('D4RK_CA') || null, x: E('D4RK_X') || null, tag: TAG.toBase58(), book: !!(E('DATABASE_URL') || E('POSTGRES_URL') || E('STORAGE_URL') || E('STORAGE_DATABASE_URL') || E('D4RK_PGLITE')), rpc: E('RPC_URL') ? 'private' : 'public' }, 'public, s-maxage=60');
    if (p === 'stats') return out(res, 200, { ok: true, ...(await stats()) });
    if (p === 'prints') return out(res, 200, { ok: true, prints: await prints() });
    if (p === 'coins') return out(res, 200, { ok: true, coins: await coins() }, 'public, s-maxage=60, stale-while-revalidate=240');
    if (p === 'coin') return out(res, 200, { ok: true, coin: await coin(qs.get('mint')) });
    if (p === 'balance') { const w = pk(qs.get('wallet'), 'bad wallet').toBase58(), m = qs.get('mint') === 'SOL' ? SOL : (await mintInfo(qs.get('mint'))).mint; const raw = await balanceOf(w, m); const dec = m === SOL ? 9 : (await mintInfo(m)).decimals; return out(res, 200, { ok: true, raw: raw.toString(), ui: toUi(raw, dec) }); }
    if (p === 'challenge') return out(res, 200, { ok: true, message: challenge(pk(qs.get('wallet'), 'connect a wallet first').toBase58()) });
    if (p === 'mine') return out(res, 200, { ok: true, ...(await mine(qs)) });
    if (p === 'review') return out(res, 200, { ok: true, ...(await review(qs)) });
    if (p === 'status') { const s = qs.get('sig'); if (MOCK) return out(res, 200, { ok: true, status: 'confirmed', err: null }); const r = await conn.getSignatureStatuses([s], { searchTransactionHistory: true }); const v = r.value[0]; return out(res, 200, { ok: true, status: v ? v.confirmationStatus : null, err: v ? v.err : null }); }
    if (p === 'nonces') return out(res, 200, { ok: true, nonces: await nonces(qs.get('wallet')) });
    if (p === 'sim') return out(res, 200, { ok: true, ...(await sim(qs)) });
    return out(res, 404, { ok: false, error: 'not found' });
  } catch (e) { return out(res, 400, { ok: false, error: String(e && e.message || e).slice(0, 300) }); }
};
