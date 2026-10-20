// 在 Node 模擬 Cloudflare 環境測試 worker.js
import worker from './worker.js';
const store = new Map();
globalThis.caches = { default: {
  async match(req) { const v = store.get(req.url); return v && v.exp > Date.now() ? new Response(v.body) : undefined; },
  async put(req, res) { const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control')); store.set(req.url, { body: await res.text(), exp: Date.now() + (+m[1]) * 1000 }); },
}};
let count = 0;
const env = { ASSETS: { fetch: async () => new Response('{"ok":1}', { headers: { 'Content-Type': 'application/json' } }) },
  LOT_LIMITER: { limit: async () => ({ success: ++count <= 60 }) } };
const waits = []; const ctx = { waitUntil: p => waits.push(p) };
const req = (path, h = {}) => new Request('https://site.example' + path, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130', 'Sec-Fetch-Site': 'same-origin', ...h } });
const show = async (label, r) => console.log(label.padEnd(26), r.status, r.headers.get('Retry-After') || '', (await r.text()).slice(0, 30));
await show('index.html', await worker.fetch(req('/index.html'), env, ctx));
await show('curl UA', await worker.fetch(req('/data/lots/BA0322.json', { 'User-Agent': 'curl/8.4' }), env, ctx));
await show('cross-site', await worker.fetch(req('/data/lots/BA0322.json', { 'Sec-Fetch-Site': 'cross-site' }), env, ctx));
let last; for (let i = 0; i < 60; i++) last = await worker.fetch(req(`/data/lots/X${i}.json`), env, ctx);
await show('60th normal request', last);
await show('61st -> blocked', await worker.fetch(req('/data/lots/X61.json'), env, ctx)); await Promise.all(waits);
count = 0;
await show('during cooldown', await worker.fetch(req('/data/lots/X62.json'), env, ctx));
