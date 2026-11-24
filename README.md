# D4RK

A dark pool for memecoins. Hidden orders, matched wallet to wallet in one atomic swap at the mid price.

- `index.html`, `css/`, `js/`: the site (three.js black pool, Wallet Standard signing)
- `api/d4rk.js`: the order book and matching engine (Vercel function, Postgres)

Env: `DATABASE_URL` (Neon, set by Vercel Storage), optional `RPC_URL`, `D4RK_CA`, `D4RK_X`, `D4RK_TREASURY` + `D4RK_FEE_BPS`.
