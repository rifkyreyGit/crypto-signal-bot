"""Veto sebelum beli. Dua sumber (config "ai_veto" -> "source"):
- "binance" (gratis, default): tolak koin yang diumumkan akan di-delist atau diberi Monitoring Tag oleh Binance.
- "claude": Claude mencari berita terbaru tentang koin dan boleh MENOLAK (butuh API key).

AI tidak pernah menyuruh beli; sinyal tetap dari BreakoutTren. Kalau API gagal/timeout, transaksi
tetap jalan (fail-open) supaya bot tidak macet. Setiap keputusan dicatat ke user_data/ai_veto.jsonl
agar bisa dibandingkan: trade yang diveto AI vs hasil sebenarnya (mode bayangan / shadow).

Butuh paket `anthropic` dan env ANTHROPIC_API_KEY.
"""
import json
import re
from datetime import datetime, timezone

PROMPT = """Kamu adalah pemeriksa risiko untuk bot trading spot kripto di Binance.
Bot baru saja memberi sinyal BELI untuk {coin} ({pair}) karena harga menembus high 20 hari dengan volume tinggi.
Tanggal sekarang: {today}.

Tugasmu BUKAN menilai apakah harga akan naik. Cari di web berita {coin} dalam 14 hari terakhir dan
cari hanya alasan kuat untuk MENOLAK, misalnya:
- hack/eksploit, dana pengguna hilang, atau jaringan berhenti
- rencana delisting, investigasi regulator, gugatan besar terhadap proyek
- token unlock besar (>2% suplai beredar) dalam 7 hari ke depan
- tim/proyek kabur, rug pull, atau penarikan likuiditas
- kenaikan harga yang jelas karena berita palsu atau manipulasi

Kalau tidak menemukan alasan kuat seperti itu, jangan menolak. Berita biasa, opini analis,
atau harga yang "sudah naik banyak" bukan alasan menolak.

Akhiri jawabanmu dengan SATU baris JSON saja, tanpa teks lain sesudahnya:
{{"veto": true atau false, "reason": "alasan singkat dalam bahasa Indonesia, maks 30 kata"}}"""


NOTICE_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query"
NOTICE_CATALOGS = (161, 49)  # Delisting, Latest Binance News
SKIP = ("Futures", "Margin", "Alpha", "Notice of Removal", "Loans", "Convert")


def check_binance(pair: str, cfg: dict) -> dict:
    """Cari judul pengumuman Binance (30 hari) yang menyebut koin ini bersama delist / Monitoring Tag."""
    import requests

    coin, days = pair.split("/")[0].upper(), cfg.get("days", 30)
    since = datetime.now(timezone.utc).timestamp() * 1000 - days * 86400000
    word = re.compile(rf"(?<![A-Z0-9]){re.escape(coin)}(?![A-Z0-9])")
    try:
        for cat in NOTICE_CATALOGS:
            res = requests.get(NOTICE_URL, timeout=20, params={
                "type": 1, "pageNo": 1, "pageSize": 50, "catalogId": cat}).json()
            for group in res["data"]["catalogs"]:
                for a in group["articles"]:
                    title = a["title"]
                    if a["releaseDate"] < since or any(k in title for k in SKIP):
                        continue
                    if ("Delist" in title or "Monitoring Tag" in title) and word.search(title.upper()):
                        return {"veto": True, "reason": f"Pengumuman Binance: {title}"[:300], "error": None}
    except Exception as e:  # jaringan / format berubah: jangan hentikan bot
        return {"veto": False, "reason": "", "error": f"{type(e).__name__}: {e}"[:300]}
    return {"veto": False, "reason": "Tidak ada pengumuman delist / Monitoring Tag", "error": None}


def check(pair: str, cfg: dict) -> dict:
    """Kembalikan {"veto": bool, "reason": str, "error": str|None}. Tidak pernah melempar exception."""
    try:
        import anthropic
    except ImportError:
        return {"veto": False, "reason": "", "error": "paket anthropic belum terpasang"}

    coin = pair.split("/")[0]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    messages = [{"role": "user", "content": PROMPT.format(coin=coin, pair=pair, today=today)}]
    try:
        client = anthropic.Anthropic(timeout=cfg.get("timeout", 180), max_retries=1)
        for _ in range(4):  # web search bisa berhenti di tengah (pause_turn); lanjutkan
            r = client.beta.messages.create(
                model=cfg.get("model", "claude-opus-5-5"),
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": cfg.get("effort", "medium")},
                tools=[{"type": "web_search_20260209", "name": "web_search",
                        "max_uses": cfg.get("max_searches", 5)}],
                messages=messages,
            )
            if r.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": r.content})
    except Exception as e:  # API, jaringan, atau key belum diisi: jangan hentikan bot
        return {"veto": False, "reason": "", "error": f"{type(e).__name__}: {e}"[:300]}

    if r.stop_reason == "refusal":
        return {"veto": False, "reason": "", "error": "model menolak menjawab"}
    text = "".join(b.text for b in r.content if b.type == "text")
    found = re.findall(r"\{[^{}]*\"veto\"[^{}]*\}", text)
    if not found:
        return {"veto": False, "reason": "", "error": "jawaban tanpa JSON: " + text[-200:]}
    try:
        out = json.loads(found[-1])
    except json.JSONDecodeError:
        return {"veto": False, "reason": "", "error": "JSON rusak: " + found[-1][:200]}
    return {"veto": bool(out.get("veto")), "reason": str(out.get("reason", ""))[:300], "error": None}


def log(path: str, row: dict) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
