// Cloudflare Pages Function: proxy ke API publik Indodax untuk versi web (iPhone).
// Endpoint candle Indodax tidak mengirim header CORS, jadi browser tidak bisa memanggilnya langsung.
// Hanya dua endpoint baca-saja yang diizinkan supaya proxy ini tidak bisa dipakai untuk hal lain.
const ALLOWED = { '/tradingview/history_v2': 300, '/api/summaries': 30, '/api/ticker/usdtidr': 60 };  // path -> detik cache

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/indodax/, '');
  const ttl = ALLOWED[path];
  if (!ttl) return new Response('Not found', { status: 404 });
  const upstream = await fetch(`https://indodax.com${path}${url.search}`, {
    headers: { 'User-Agent': 'sinyal-kripto-pwa', Accept: 'application/json' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
  });
}
