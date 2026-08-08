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

Datei-Upload: statt eines Links kann auch direkt eine MP4/MP3/M4A/WAV/MOV/…
hochgeladen werden (POST /upload). faster-whisper decodiert das Audio selbst
und erkennt Deutsch/Englisch automatisch. Alles bleibt lokal auf diesem PC.

API:
    GET  /health            -> {ok, modell, geraet}
    POST /transcribe        {url, sprache?}          -> {jobId}
    POST /upload?sprache=…  Body=rohe Datei-Bytes,  Header X-Dateiname (kodiert) -> {jobId}
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
from urllib.parse import unquote

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
# Datei-Upload: Obergrenze + erlaubte Endungen (av/ffmpeg holt die Audiospur
# selbst aus MP4/MOV/MKV usw. — kein separates ffmpeg noetig).
MAX_UPLOAD = 2 * 1024 * 1024 * 1024   # 2 GB
ERLAUBTE_ENDUNGEN = {
    ".mp4", ".mp3", ".m4a", ".wav", ".webm", ".mov", ".aac",
    ".ogg", ".oga", ".opus", ".flac", ".mkv", ".avi", ".wma", ".mpeg", ".mpg",
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
# Serialisiert die eigentliche Transkription. Ein einzelnes CTranslate2-Modell
# von mehreren Threads gleichzeitig zu benutzen bringt keinen Durchsatz — die
# Laeufe konkurrieren nur um dieselben CPU-Kerne und bremsen sich gegenseitig
# aus. Wer mehrfach auf "Transkribieren" klickt (z.B. weil scheinbar nichts
# passiert), startet sonst n gleichzeitige Whisper-Laeufe und jeder wird
# langsamer. Mit diesem Lock reihen sich die Jobs sauber hintereinander auf.
_transcribe_lock = threading.Lock()

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

def _cleanup(tmpdir):
    try:
        for f in os.listdir(tmpdir):
            os.remove(os.path.join(tmpdir, f))
        os.rmdir(tmpdir)
    except OSError:
        pass

def _transkribiere(job_id, audio_pfad, titel, dauer, sprache):
    """Gemeinsamer Whisper-Teil — von Link- (arbeite) und Datei-Upload
    (arbeite_datei) genutzt. faster-whisper decodiert m4a/webm/mp4/mp3 selbst."""
    setze(job_id, titel=titel, dauerSek=dauer, schritt="Whisper-Modell wird geladen …", progress=10)
    modell = hole_modell()

    # Laeuft schon ein anderes Transkript, das ehrlich anzeigen statt stumm zu
    # warten — sonst sieht der Nutzer "Transkribiert …" ohne Fortschritt und
    # klickt erneut. (Der locked()-Check ist nur Anzeige, ein Race ist egal.)
    if _transcribe_lock.locked():
        setze(job_id, schritt="Wartet — ein anderes Transkript läuft noch …", progress=12)

    segmente_out = []
    texte = []
    # transcribe() liefert einen GENERATOR: die eigentliche Rechenarbeit passiert
    # erst beim Iterieren. Das Lock muss deshalb die ganze Schleife umschliessen,
    # nicht nur den Aufruf.
    with _transcribe_lock:
        setze(job_id, schritt="Transkribiert …", progress=15)
        segments, seginfo = modell.transcribe(
            audio_pfad,
            language=(sprache or None),          # None = automatisch erkennen (Deutsch/Englisch …)
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

def arbeite(job_id, url, sprache):
    """Link-Modus: Audio per yt-dlp laden, dann lokal transkribieren."""
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

        # --- 2) Lokal transkribieren ---
        _transkribiere(job_id, audio_pfad, titel, dauer, sprache)
    except Exception as e:
        print(f"[Job {job_id[:8]}] FEHLER: {e}")
        setze(job_id, status="fehler", schritt="Fehler", fehler=str(e))
    finally:
        _cleanup(tmpdir)

def arbeite_datei(job_id, audio_pfad, titel, tmpdir, sprache):
    """Datei-Upload-Modus: hochgeladene MP4/MP3/… direkt transkribieren (kein Download)."""
    try:
        setze(job_id, status="laeuft", schritt="Datei wird gelesen …", progress=6)
        _transkribiere(job_id, audio_pfad, titel, 0, sprache)
    except Exception as e:
        print(f"[Job {job_id[:8]}] FEHLER: {e}")
        setze(job_id, status="fehler", schritt="Fehler", fehler=str(e))
    finally:
        _cleanup(tmpdir)

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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Dateiname")
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
        if self.path.split("?", 1)[0] == "/upload":
            self._upload()
            return
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

    def _upload(self):
        """POST /upload?sprache=auto|de|en  — Body = rohe Datei-Bytes,
        Dateiname prozent-kodiert im Header X-Dateiname. Speichert die Datei
        gestreamt auf Platte (kein RAM-Zwang) und startet einen Transkript-Job."""
        # Sprache aus Query
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        sprache = None
        for teil in q.split("&"):
            if teil.startswith("sprache="):
                sprache = (unquote(teil[len("sprache="):]).strip().lower() or None)
        if sprache == "auto":
            sprache = None

        # Dateiname (prozent-kodiert -> Umlaute reisen ASCII-sicher im Header)
        dateiname = unquote(self.headers.get("X-Dateiname", "") or "").strip() or "Upload"
        ext = os.path.splitext(dateiname)[1].lower()
        if ext not in ERLAUBTE_ENDUNGEN:
            self._json(415, {"fehler": f"Dateityp „{ext or '?'}“ nicht unterstützt. "
                                       "Erlaubt: MP4, MP3, M4A, WAV, MOV, WEBM, MKV, AAC, FLAC, OGG …"})
            return

        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            self._json(400, {"fehler": "Leere Datei."})
            return
        if n > MAX_UPLOAD:
            self._json(413, {"fehler": f"Datei zu groß (max {MAX_UPLOAD // (1024*1024)} MB)."})
            return

        tmpdir = tempfile.mkdtemp(prefix="vv-upload-")
        ziel = os.path.join(tmpdir, "upload" + ext)
        rest = n
        try:
            with open(ziel, "wb") as f:
                while rest > 0:
                    chunk = self.rfile.read(min(1024 * 256, rest))
                    if not chunk:
                        break
                    f.write(chunk)
                    rest -= len(chunk)
        except Exception as e:
            _cleanup(tmpdir)
            self._json(500, {"fehler": f"Upload fehlgeschlagen: {e}"})
            return
        if rest > 0:
            _cleanup(tmpdir)
            self._json(400, {"fehler": "Upload unvollständig — bitte erneut versuchen."})
            return

        titel = os.path.splitext(os.path.basename(dateiname))[0] or "Upload"
        job_id = str(uuid.uuid4())
        with jobs_lock:
            jobs[job_id] = {"status": "laeuft", "schritt": "Datei empfangen …", "progress": 4,
                            "titel": titel, "dauerSek": 0, "erstellt": time.time()}
        threading.Thread(target=arbeite_datei, args=(job_id, ziel, titel, tmpdir, sprache),
                         daemon=True).start()
        print(f"[Job {job_id[:8]}] Upload gestartet: {dateiname} ({n // 1024} KB)")
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
  .kartenkopf { font-weight:700; font-size:.95rem; margin-bottom:.9rem; }
  .kartenkopf .muted { font-weight:400; font-size:.85rem; }
  .drop { border:1.5px dashed var(--mid); border-radius:10px; background:var(--off); text-align:center;
    padding:1.6rem 1rem; cursor:pointer; transition:border-color .15s, background .15s; }
  .drop:hover { border-color:var(--accent); }
  .drop.ueber { border-color:var(--accent); background:#fdf1ea; }
  .drop.hat-datei { border-style:solid; border-color:var(--accent); background:#fdf1ea; }
  .drop-inner { display:flex; flex-direction:column; gap:.5rem; align-items:center; pointer-events:none; }
  .drop-inner .btn { pointer-events:auto; }
  .drop-icon { font-size:1.8rem; line-height:1; color:var(--accent); }
  #dropname { word-break:break-all; }
</style></head><body><div class="wrap">
  <div class="brand">vale<span>&mdash;</span>video</div>
  <h1>Transkript</h1>
  <p class="muted" style="margin:0">L&auml;uft komplett <strong>lokal auf diesem PC</strong> (Whisper). Keine Cloud, keine API-Kosten,
    nichts verl&auml;sst deinen Rechner. Deutsch/Englisch wird automatisch erkannt.</p>

  <div class="card">
    <div class="kartenkopf">Aus Link <span class="muted">&mdash; Instagram · TikTok · YouTube</span></div>
    <label for="url">Video-Link</label>
    <input id="url" type="url" placeholder="https://www.instagram.com/reel/…  ·  TikTok  ·  YouTube">
    <div id="vorschau" style="margin-top:.9rem"></div>
    <div class="row">
      <label for="spr" style="margin:0">Sprache</label>
      <select id="spr"><option value="auto" selected>Automatisch (erkennt Deutsch/Englisch selbst)</option><option value="de">Deutsch erzwingen</option><option value="en">Englisch erzwingen</option></select>
      <button class="btn btn-accent" id="go">Transkribieren</button>
    </div>
  </div>

  <div class="card" id="dropcard">
    <div class="kartenkopf">Datei hochladen <span class="muted">&mdash; MP4 · MP3 · M4A · WAV · MOV · WEBM · MKV …</span></div>
    <div id="drop" class="drop">
      <input id="datei" type="file" accept=".mp4,.mp3,.m4a,.wav,.webm,.mov,.aac,.ogg,.oga,.opus,.flac,.mkv,.avi,.wma,.mpeg,.mpg,audio/*,video/*" hidden>
      <div class="drop-inner">
        <div class="drop-icon">&#8681;</div>
        <div><strong id="dropname">Datei hierher ziehen</strong> &nbsp;oder&nbsp; <button type="button" class="btn btn-ghost" id="waehle">Datei w&auml;hlen</button></div>
        <div class="muted hint">MP4/MP3/… &mdash; wird nur an den lokalen Server (127.0.0.1) &uuml;bergeben, nicht ins Internet.</div>
      </div>
    </div>
    <div class="row">
      <label for="spr2" style="margin:0">Sprache</label>
      <select id="spr2"><option value="auto" selected>Automatisch (erkennt Deutsch/Englisch selbst)</option><option value="de">Deutsch erzwingen</option><option value="en">Englisch erzwingen</option></select>
      <button class="btn btn-accent" id="go2" disabled>Datei transkribieren</button>
    </div>
  </div>

  <div id="fehler" class="fehler" hidden></div>

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

// --- Video-Vorschau direkt nach dem Einfuegen des Links -----------------
function ladeSkript(src, id, cb){ if(document.getElementById(id)){ if(cb)cb(); return; }
  const s=document.createElement("script"); s.id=id; s.src=src; s.async=true; if(cb)s.onload=cb; document.body.appendChild(s); }
function vorschauHtml(url){
  let m = url.match(/(?:youtube\\.com\\/(?:watch\\?.*v=|shorts\\/|embed\\/)|youtu\\.be\\/)([\\w-]{11})/);
  if(m) return '<iframe style="width:100%;aspect-ratio:16/9;border:0;border-radius:8px" src="https://www.youtube-nocookie.com/embed/'+m[1]+'" allowfullscreen loading="lazy"></iframe>';
  m = url.match(/tiktok\\.com\\/.*\\/video\\/(\\d+)/);
  if(m) return '<blockquote class="tiktok-embed" cite="'+url+'" data-video-id="'+m[1]+'" style="max-width:325px;min-width:240px;margin:0"><section></section></blockquote>';
  if(/instagram\\.com\\/(reel|p|tv)\\//.test(url)){
    const clean = url.split("?")[0].replace(/\\/?$/,"/");
    return '<blockquote class="instagram-media" data-instgrm-permalink="'+clean+'" data-instgrm-version="14" style="max-width:340px;min-width:240px;margin:0"><a href="'+clean+'">Instagram-Beitrag</a></blockquote>';
  }
  return "";
}
function zeigeVorschau(){
  const url = $("url").value.trim();
  const box = $("vorschau");
  if(!/^https?:/.test(url)){ box.innerHTML=""; return; }
  const html = vorschauHtml(url);
  box.innerHTML = html || '<p class="muted hint" style="margin:0">Keine Vorschau f\\u00FCr diesen Link \\u2014 transkribieren geht trotzdem.</p>';
  if(html.includes("tiktok-embed")) ladeSkript("https://www.tiktok.com/embed.js","tt-js");
  if(html.includes("instagram-media")) ladeSkript("https://www.instagram.com/embed.js","ig-js",
    ()=>{ try{ window.instgrm.Embeds.process(); }catch(_){} });
  if(html.includes("instagram-media") && window.instgrm){ try{ window.instgrm.Embeds.process(); }catch(_){} }
}
$("url").addEventListener("input", zeigeVorschau);
$("url").addEventListener("paste", ()=>setTimeout(zeigeVorschau, 50));
function fmt(s){const m=Math.floor(s/60),r=Math.floor(s%60);return String(m).padStart(2,"0")+":"+String(r).padStart(2,"0");}
function zeige(){ $("zeiten").classList.toggle("aktiv", mitZeiten);
  $("text").value = mitZeiten ? segmente.map(s=>"["+fmt(s.start)+"] "+s.text).join("\\n") : transkript; }
// --- gemeinsames Job-Polling (Link UND Datei-Upload) --------------------
function pollJob(jobId){
  $("prog").hidden = false;
  clearInterval(timer);
  timer = setInterval(async () => {
    const j = await (await fetch("/job/"+jobId)).json();
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
}
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
    pollJob(d.jobId);
  }catch(e){ $("fehler").textContent = "Fehler: " + (e.message||e); $("fehler").hidden = false; }
  finally{ $("go").disabled = false; $("go").textContent = "Transkribieren"; }
};

// --- Datei-Upload: Auswahl per Klick oder Drag&Drop ---------------------
let gewaehlteDatei = null;
function setzeDatei(f){
  gewaehlteDatei = f || null;
  $("go2").disabled = !gewaehlteDatei;
  $("drop").classList.toggle("hat-datei", !!gewaehlteDatei);
  $("dropname").textContent = gewaehlteDatei ? gewaehlteDatei.name : "Datei hierher ziehen";
}
$("waehle").onclick = (e) => { e.stopPropagation(); $("datei").click(); };
$("drop").onclick = () => $("datei").click();
$("datei").onchange = () => setzeDatei($("datei").files[0]);
["dragenter","dragover"].forEach(ev => $("drop").addEventListener(ev, (e)=>{
  e.preventDefault(); $("drop").classList.add("ueber"); }));
["dragleave","drop"].forEach(ev => $("drop").addEventListener(ev, (e)=>{
  e.preventDefault(); $("drop").classList.remove("ueber"); }));
$("drop").addEventListener("drop", (e)=>{
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) setzeDatei(f);
});
$("go2").onclick = async () => {
  if(!gewaehlteDatei){ $("datei").click(); return; }
  $("fehler").hidden = true; $("erg").hidden = true;
  $("go2").disabled = true; $("go2").textContent = "L\\u00E4dt hoch …";
  try{
    const r = await fetch("/upload?sprache=" + encodeURIComponent($("spr2").value),
      {method:"POST", headers:{"X-Dateiname": encodeURIComponent(gewaehlteDatei.name)}, body: gewaehlteDatei});
    const d = await r.json();
    if(!d.jobId) throw new Error(d.fehler || "Upload fehlgeschlagen");
    pollJob(d.jobId);
  }catch(e){ $("fehler").textContent = "Fehler: " + (e.message||e); $("fehler").hidden = false; }
  finally{ $("go2").disabled = false; $("go2").textContent = "Datei transkribieren"; }
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
