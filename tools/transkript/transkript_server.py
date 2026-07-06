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

    def do_GET(self):
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
