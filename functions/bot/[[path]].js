// Cloudflare Pages Function: teruskan request tab Bot (versi web) ke tunnel bot di Mac.
// Dipakai karena sebagian jaringan/HP tidak bisa menjangkau *.trycloudflare.com langsung,
// sementara sinyal-kripto.pages.dev bisa. Dibatasi: hanya GET, hanya /api/v1/, hanya host trycloudflare.
const HOST = /^[a-z0-9-]+\.trycloudflare\.com$/;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/bot/, '');
  let target;
  try { target = new URL(request.headers.get('X-Bot-Url') || ''); } catch { /* kosong/rusak */ }
  if (!target || target.protocol !== 'https:' || !HOST.test(target.hostname) || !path.startsWith('/api/v1/')) {
    return new Response(JSON.stringify({ error: 'bad target' }), { status: 400 });
  }
  let upstream;
  try {
    upstream = await fetch(`https://${target.hostname}${path}${url.search}`, {
      headers: { Authorization: request.headers.get('Authorization') || '', Accept: 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'tunnel unreachable' }), { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
