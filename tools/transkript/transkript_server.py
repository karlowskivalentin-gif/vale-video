#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vale-video Transkript-Server — 100% lokal, keine Cloud, keine API-Tokens.

Nimmt einen Instagram-/TikTok-/YouTube-Link entgegen, laedt die Audiospur
per yt-dlp und transkribiert sie mit faster-whisper (lokales Whisper-Modell,
laeuft komplett auf diesem PC). Das Kundenportal (Tab "Transkript") spricht
diesen Server unter http://127.0.0.1:8237 an.

Einmalige Installation:
    pip install yt-dlp faster-whisper

Start (oder transkript-server.bat doppelklicken):
    python transkript_server.py

Beim ALLERERSTEN Transkript laedt faster-whisper das Modell (~460 MB,
"small") einmalig herunter — danach ist alles offline.

API:
    GET  /health            -> {ok, modell, geraet}
    POST /transcribe        {url, sprache?}          -> {jobId}
    GET  /job/<jobId>       -> {status, schritt, progress, titel, dauerSek,
                                transcript?, segmente?, fehler?}
Sicherheit: bindet NUR an 127.0.0.1 (kein Zugriff aus dem Netz).
CORS erlaubt https://vale-video.de (und localhost zum Entwickeln).
"""

import json
import os
import re
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Windows-Zertifikatsspeicher fuer alle HTTPS-Verbindungen nutzen (der reine
# Python-Truststore ist auf diesem PC unvollstaendig -> Modell-/Video-Downloads
# schlugen mit CERTIFICATE_VERIFY_FAILED fehl).
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass   # optional; der yt-dlp-Fallback unten greift trotzdem

PORT = 8237
MODELL = os.environ.get("TRANSKRIPT_MODELL", "small")   # tiny|base|small|medium|large-v3
ERLAUBTE_ORIGINS = {
    "https://vale-video.de", "https://www.vale-video.de",
    "http://localhost", "http://127.0.0.1",
}

try:
    import yt_dlp
except ImportError:
    sys.exit("yt-dlp fehlt.  Installieren mit:  pip install yt-dlp")
try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.exit("faster-whisper fehlt.  Installieren mit:  pip install faster-whisper")

# ----------------------------------------------------------------------
# Whisper-Modell: einmal laden, fuer alle Jobs wiederverwenden (Threadsafe
# via Lock — CTranslate2 kann parallel, aber wir halten es simpel/seriell).
# ----------------------------------------------------------------------
_modell = None
_modell_lock = threading.Lock()

def hole_modell():
    global _modell
    with _modell_lock:
        if _modell is None:
            print(f"[Modell] Lade Whisper '{MODELL}' (beim ersten Mal: Download ~460 MB) ...")
            _modell = WhisperModel(MODELL, device="cpu", compute_type="int8")
            print("[Modell] Bereit.")
        return _modell

# ----------------------------------------------------------------------
# Jobs (im Speicher; der Server laeuft nur waehrend der Nutzung)
# ----------------------------------------------------------------------
jobs = {}            # jobId -> dict
jobs_lock = threading.Lock()

def setze(job_id, **felder):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(felder)

def arbeite(job_id, url, sprache):
    tmpdir = tempfile.mkdtemp(prefix="vv-transkript-")
    audio_pfad = None
    try:
        # --- 1) Audio laden (yt-dlp, Originalformat -> kein ffmpeg noetig) ---
        setze(job_id, status="laeuft", schritt="Video wird geladen …", progress=2)
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(tmpdir, "audio.%(ext)s"),
            "quiet": True, "no_warnings": True, "noplaylist": True,
        }
        # Auf diesem PC ist der Python-Zertifikatsspeicher unvollstaendig
        # (AV/Proxy bricht TLS auf) -> bei Zertifikatsfehler einmal ohne
        # Pruefung wiederholen. Rein lokales Download-Tool, vertretbar.
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
        except Exception as e:
            if "CERTIFICATE_VERIFY_FAILED" not in str(e):
                raise
            setze(job_id, schritt="Video wird geladen (Zertifikats-Workaround) …")
            with yt_dlp.YoutubeDL({**ydl_opts, "nocheckcertificate": True}) as ydl:
                info = ydl.extract_info(url, download=True)
        titel = info.get("title") or "Ohne Titel"
        dauer = float(info.get("duration") or 0)
        for f in os.listdir(tmpdir):
            if f.startswith("audio."):
                audio_pfad = os.path.join(tmpdir, f)
                break
        if not audio_pfad:
            raise RuntimeError("Audiodatei nicht gefunden (Download fehlgeschlagen?)")
        setze(job_id, titel=titel, dauerSek=dauer, schritt="Whisper-Modell wird geladen …", progress=10)

        # --- 2) Lokal transkribieren (faster-whisper decodiert m4a/webm selbst) ---
        modell = hole_modell()
        setze(job_id, schritt="Transkribiert …", progress=15)
        segmente_out = []
        texte = []
        segments, seginfo = modell.transcribe(
            audio_pfad,
            language=(sprache or None),          # None = automatisch erkennen
            vad_filter=True,                      # Stille/Musik ueberspringen
        )
        gesamt = float(seginfo.duration or dauer or 1)
        for seg in segments:
            t = seg.text.strip()
            if t:
                texte.append(t)
                segmente_out.append({"start": round(seg.start, 2), "ende": round(seg.end, 2), "text": t})
            p = 15 + min(84, int((seg.end / gesamt) * 84)) if gesamt else 50
            setze(job_id, progress=p)

        transcript = "\n".join(texte).strip() or "(kein gesprochener Text erkannt)"
        setze(job_id, status="fertig", schritt="Fertig", progress=100,
              transcript=transcript, segmente=segmente_out,
              erkannteSprache=getattr(seginfo, "language", None))
        print(f"[Job {job_id[:8]}] fertig: {titel!r} ({len(texte)} Segmente)")
    except Exception as e:
        print(f"[Job {job_id[:8]}] FEHLER: {e}")
        setze(job_id, status="fehler", schritt="Fehler", fehler=str(e))
    finally:
        try:
            for f in os.listdir(tmpdir):
                os.remove(os.path.join(tmpdir, f))
            os.rmdir(tmpdir)
        except OSError:
            pass

# ----------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):   # eigene, ruhigere Logs
        pass

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ERLAUBTE_ORIGINS or origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1"):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome Private-Network-Access: https-Seite darf localhost ansprechen.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _html(self, code, html):
        raw = html.encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            # Eigene Mini-UI direkt vom lokalen Server (same-origin ->
            # keinerlei Browser-Sperren wie bei https-Seite -> localhost).
            self._html(200, UI_HTML)
            return
        if self.path == "/health":
            self._json(200, {"ok": True, "modell": MODELL, "geraet": "cpu"})
            return
        m = re.match(r"^/job/([0-9a-f-]+)$", self.path)
        if m:
            with jobs_lock:
                job = dict(jobs.get(m.group(1)) or {})
            if not job:
                self._json(404, {"fehler": "Job unbekannt"})
            else:
                self._json(200, job)
            return
        self._json(404, {"fehler": "Unbekannter Pfad"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._json(404, {"fehler": "Unbekannter Pfad"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            daten = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"fehler": "Ungueltiges JSON"})
            return
        url = str(daten.get("url") or "").strip()
        if not re.match(r"^https?://", url):
            self._json(400, {"fehler": "Bitte einen gueltigen Link angeben."})
            return
        sprache = (str(daten.get("sprache") or "").strip().lower() or None)
        if sprache == "auto":
            sprache = None
        job_id = str(uuid.uuid4())
        with jobs_lock:
            jobs[job_id] = {"status": "laeuft", "schritt": "Startet …", "progress": 0,
                            "titel": "", "dauerSek": 0, "erstellt": time.time()}
        threading.Thread(target=arbeite, args=(job_id, url, sprache), daemon=True).start()
        print(f"[Job {job_id[:8]}] gestartet: {url}")
        self._json(200, {"jobId": job_id})


# ----------------------------------------------------------------------
# Mini-UI (vale-video-Look) — wird unter http://127.0.0.1:8237/ ausgeliefert
# ----------------------------------------------------------------------
UI_HTML = """<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transkript — vale-video (lokal)</title>
<style>
  :root { --black:#14110d; --mid:#e3ded6; --muted:#6b6258; --off:#f6f4f1; --accent:#e2622c; --accent-dim:#b8491c; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:var(--black); font:16px/1.6 Inter,system-ui,sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 2.2rem 1.25rem 4rem; }
  .brand { font-weight:800; letter-spacing:.25em; text-transform:uppercase; font-size:.95rem; }
  .brand span { color: var(--accent); }
  h1 { font-size:1.6rem; margin:.4rem 0 .3rem; }
  .muted { color: var(--muted); }
  .card { background:#fff; border:1px solid var(--mid); border-radius:10px; padding:1.5rem; margin-top:1.25rem;
          box-shadow: 0 1px 3px rgba(20,17,13,.06), 0 8px 24px rgba(20,17,13,.05); }
  label { display:block; font-size:.8rem; font-weight:600; color:var(--muted); margin-bottom:.35rem; }
  input, select, textarea { width:100%; font:inherit; color:var(--black); background:#fff;
    border:1px solid var(--mid); border-radius:6px; padding:.7rem .85rem; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(226,98,44,.12); }
  .row { display:flex; gap:.7rem; align-items:center; flex-wrap:wrap; margin-top:.9rem; }
  .row select { width:auto; }
  .btn { font:inherit; font-size:.75rem; font-weight:600; letter-spacing:.12em; text-transform:uppercase;
    border-radius:999px; padding:.85rem 1.5rem; cursor:pointer; border:1px solid transparent; }
  .btn-accent { background:var(--accent); color:#fff; } .btn-accent:hover { background:var(--accent-dim); }
  .btn-ghost { background:transparent; border-color:var(--mid); color:var(--black); padding:.55rem 1rem; font-size:.68rem; }
  .btn-ghost:hover { border-color:var(--black); }
  .btn-ghost.aktiv { background:var(--accent); border-color:var(--accent); color:#fff; }
  .bar { height:10px; border-radius:999px; background:var(--off); border:1px solid var(--mid); overflow:hidden; margin-top:.7rem; }
  .bar i { display:block; height:100%; width:0; background:var(--accent); border-radius:999px; transition:width .4s; }
  textarea { min-height:320px; margin-top:.8rem; background:var(--off); resize:vertical; }
  .kopf { display:flex; justify-content:space-between; align-items:center; gap:.8rem; flex-wrap:wrap; }
  .fehler { background:#fdecea; color:#c0392b; border:1px solid #f3c4bd; border-radius:6px; padding:.8rem 1rem; margin-top:.9rem; }
  .hint { font-size:.76rem; }
</style></head><body><div class="wrap">
  <div class="brand">vale<span>&mdash;</span>video</div>
  <h1>Transkript</h1>
  <p class="muted" style="margin:0">Instagram-Reel-, TikTok- oder YouTube-Link einf&uuml;gen &mdash; l&auml;uft komplett
    lokal auf diesem PC (yt-dlp + Whisper). Keine Cloud, keine API-Kosten.</p>

  <div class="card">
    <label for="url">Video-Link</label>
    <input id="url" type="url" placeholder="https://www.instagram.com/reel/…  ·  TikTok  ·  YouTube">
    <div class="row">
      <label for="spr" style="margin:0">Sprache</label>
      <select id="spr"><option value="auto">Automatisch</option><option value="de" selected>Deutsch</option><option value="en">Englisch</option></select>
      <button class="btn btn-accent" id="go">Transkribieren</button>
    </div>
    <div id="fehler" class="fehler" hidden></div>
  </div>

  <div class="card" id="prog" hidden>
    <div class="kopf"><strong id="schritt">Startet …</strong><span class="muted" id="titel"></span></div>
    <div class="bar"><i id="barfill"></i></div>
    <p class="muted hint">Beim allerersten Lauf l&auml;dt Whisper einmalig sein Modell (~460&nbsp;MB).</p>
  </div>

  <div class="card" id="erg" hidden>
    <div class="kopf">
      <strong>Transkript <span class="muted" id="meta"></span></strong>
      <span>
        <button class="btn btn-ghost" id="zeiten">&#128336; Zeitstempel</button>
        <button class="btn btn-ghost" id="copy">Kopieren</button>
        <button class="btn btn-ghost" id="dl">.txt &darr;</button>
      </span>
    </div>
    <textarea id="text" readonly></textarea>
  </div>

<script>
const $ = (id) => document.getElementById(id);
let transkript = "", segmente = [], titel = "", mitZeiten = false, timer = null;
function fmt(s){const m=Math.floor(s/60),r=Math.floor(s%60);return String(m).padStart(2,"0")+":"+String(r).padStart(2,"0");}
function zeige(){ $("zeiten").classList.toggle("aktiv", mitZeiten);
  $("text").value = mitZeiten ? segmente.map(s=>"["+fmt(s.start)+"] "+s.text).join("\\n") : transkript; }
$("go").onclick = async () => {
  const url = $("url").value.trim();
  if(!/^https?:/.test(url)){ $("url").focus(); return; }
  $("fehler").hidden = true; $("erg").hidden = true;
  $("go").disabled = true; $("go").textContent = "Startet …";
  try{
    const r = await fetch("/transcribe", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({url, sprache: $("spr").value})});
    const d = await r.json();
    if(!d.jobId) throw new Error(d.fehler || "Start fehlgeschlagen");
    $("prog").hidden = false;
    clearInterval(timer);
    timer = setInterval(async () => {
      const j = await (await fetch("/job/"+d.jobId)).json();
      $("schritt").textContent = j.schritt || "…";
      $("titel").textContent = j.titel ? "\\u201E"+j.titel+"\\u201C" : "";
      $("barfill").style.width = Math.max(2, j.progress||0) + "%";
      if(j.status === "fertig"){ clearInterval(timer); $("prog").hidden = true;
        transkript = j.transcript||""; segmente = j.segmente||[]; titel = j.titel||"transkript";
        $("meta").textContent = "\\u00B7 " + segmente.length + " Segmente" + (j.erkannteSprache ? " \\u00B7 "+j.erkannteSprache : "");
        mitZeiten = false; zeige(); $("erg").hidden = false; }
      if(j.status === "fehler"){ clearInterval(timer); $("prog").hidden = true;
        $("fehler").textContent = "Fehler: " + (j.fehler||"unbekannt"); $("fehler").hidden = false; }
    }, 800);
  }catch(e){ $("fehler").textContent = "Fehler: " + (e.message||e); $("fehler").hidden = false; }
  finally{ $("go").disabled = false; $("go").textContent = "Transkribieren"; }
};
$("zeiten").onclick = () => { mitZeiten = !mitZeiten; zeige(); };
$("copy").onclick = async () => { try{ await navigator.clipboard.writeText($("text").value);}catch(_){ $("text").select(); document.execCommand("copy"); }
  $("copy").textContent = "Kopiert \\u2713"; setTimeout(()=>{ $("copy").textContent = "Kopieren"; }, 1500); };
$("dl").onclick = () => { const b = new Blob([$("text").value], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(b);
  a.download = (titel||"transkript").replace(/[^\\w\\u00E4\\u00F6\\u00FC\\u00C4\\u00D6\\u00DC\\u00DF \\-]+/g,"").slice(0,60).trim()+".txt"; a.click(); };
</script>
</div></body></html>"""


def main():
    print("=" * 60)
    print("  vale-video Transkript-Server  —  lokal & kostenlos")
    print(f"  Modell: {MODELL}   |   http://127.0.0.1:{PORT}")
    print("  Portal-Tab: https://vale-video.de/kunden/#/admin/transkript")
    print("  Beenden: Strg+C")
    print("=" * 60)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
