// Cloudflare Pages Function: teruskan request tab Bot (versi web) ke tunnel bot di Mac.
// Dipakai karena sebagian jaringan/HP tidak bisa menjangkau *.trycloudflare.com langsung,
// sementara sinyal-kripto.pages.dev bisa. Dibatasi: hanya host trycloudflare, GET untuk /api/v1/*,
// dan POST hanya untuk /api/v1/forceexit (tombol Jual di app).
const HOST = /^[a-z0-9-]+\.trycloudflare\.com$/;
const POST_ALLOWED = new Set(['/api/v1/forceexit']);

async function forward(request, method) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/bot/, '');
  let target;
  try { target = new URL(request.headers.get('X-Bot-Url') || ''); } catch { /* kosong/rusak */ }
  const pathOk = method === 'GET' ? path.startsWith('/api/v1/') : POST_ALLOWED.has(path);
  if (!target || target.protocol !== 'https:' || !HOST.test(target.hostname) || !pathOk) {
    return new Response(JSON.stringify({ error: 'bad target' }), { status: 400 });
  }
  const headers = { Authorization: request.headers.get('Authorization') || '', Accept: 'application/json' };
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  let upstream;
  try {
    upstream = await fetch(`https://${target.hostname}${path}${url.search}`, {
      method, headers, body: method === 'POST' ? await request.text() : undefined,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'tunnel unreachable' }), { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet = ({ request }) => forward(request, 'GET');
export const onRequestPost = ({ request }) => forward(request, 'POST');
