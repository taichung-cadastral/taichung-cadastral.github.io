// 伺服器端防護（Cloudflare Workers + 靜態資源）
// 只有 /data/* 會經過這支程式（見 wrangler.jsonc 的 run_worker_first），網頁本身直接由靜態資源回應。
//
// 規則：
//  1. 明顯的程式化請求（curl、wget、python、scrapy、無 User-Agent…）→ 403
//  2. 不是從本站網頁發出的資料請求（Sec-Fetch-Site 不是 same-origin）→ 403
//  3. 同一 IP 每 60 秒超過 LOT_LIMIT 次資料請求 → 429，並封鎖 COOLDOWN 秒（預設 120 秒）
//
// 封鎖期間的紀錄存在 Cloudflare 快取（Cache API），需要綁定自訂網域才會生效；
// 在 *.workers.dev 網址上只會有每 60 秒的計數限制。

const COOLDOWN = 120;
const BOT_UA = /curl|wget|python|scrapy|httpclient|okhttp|go-http|java\/|libwww|node-fetch|axios|aiohttp|httpx|headless|phantomjs|selenium|puppeteer|playwright/i;

function deny(status, seconds, text) {
  const h = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
  if (seconds) h['Retry-After'] = String(seconds);
  return new Response(text, { status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/data/')) return env.ASSETS.fetch(request);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request.headers.get('User-Agent') || '';
    if (!ua || BOT_UA.test(ua)) return deny(403, 0, '本站不提供自動化下載。');

    const site = request.headers.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin') return deny(403, 0, '請透過本站網頁使用。');

    // 封鎖中？
    const cache = caches.default;
    const penaltyKey = new Request(`https://${url.host}/__penalty/${encodeURIComponent(ip)}`);
    const penalty = await cache.match(penaltyKey);
    if (penalty) {
      const until = Number(await penalty.text()) || Date.now();
      const left = Math.max(1, Math.ceil((until - Date.now()) / 1000));
      return deny(429, left, `請求太頻繁，請 ${left} 秒後再試。`);
    }

    // 計數（Cloudflare Rate Limiting 綁定，每 60 秒）
    if (env.LOT_LIMITER) {
      const { success } = await env.LOT_LIMITER.limit({ key: ip });
      if (!success) {
        const until = Date.now() + COOLDOWN * 1000;
        ctx.waitUntil(cache.put(penaltyKey, new Response(String(until), {
          headers: { 'Cache-Control': `max-age=${COOLDOWN}` },
        })));
        return deny(429, COOLDOWN, `請求太頻繁，已暫停 ${COOLDOWN} 秒。`);
      }
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  },
};
