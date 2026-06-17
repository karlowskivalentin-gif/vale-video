#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vale-video Deploy-Script  —  Strato SFTP (Hosting Plus)

Laedt die statische Seite per SFTP hoch. NUR Upload/Overwrite,
NIEMALS Loeschen auf dem Server. Der SFTP-Benutzer ist ausserdem
auf /Website_v10 gejailt, kann also physisch nicht an die Seiten
der Fotografin oder an knowyourmeal.de.

Zugangsdaten kommen aus config/secrets.php (gitignored).

Aufruf:
    python deploy.py            # voller Upload der Seite
    python deploy.py --test     # nur eine harmlose Testdatei hochladen
    python deploy.py --dry-run  # nur anzeigen, was hochgeladen wuerde
"""

import os
import re
import sys
import stat
import posixpath

try:
    import paramiko
except ImportError:
    sys.exit("paramiko fehlt. Installieren mit:  pip install paramiko")

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS = os.path.join(HERE, "config", "secrets.php")

# Welche Dateien/Ordner gehoeren zur Seite und werden hochgeladen.
INCLUDE_DIRS = ["css", "js", "assets"]
INCLUDE_ROOT_FILES_EXT = (".html", ".css", ".js", ".ico", ".png", ".jpg",
                          ".jpeg", ".webp", ".svg", ".txt", ".xml", ".webmanifest")

# Niemals hochladen (lokale Artefakte / Geheimnisse / Repo / Rohmaterial).
EXCLUDE_NAMES = {".git", ".gitignore", "config", "deploy.py", "node_modules",
                 ".vscode", ".idea", "__pycache__"}
EXCLUDE_EXT = (".mp4", ".mov", ".avi", ".mkv", ".prproj", ".drp",
               ".py", ".php", ".log", ".tmp")


def load_secrets(path):
    if not os.path.exists(path):
        sys.exit("config/secrets.php nicht gefunden. Bitte zuerst anlegen.")
    txt = open(path, "r", encoding="utf-8").read()
    def grab(key):
        m = re.search(r"define\(\s*'%s'\s*,\s*'?([^')]+?)'?\s*\)" % re.escape(key), txt)
        return m.group(1).strip() if m else None
    host = grab("SFTP_HOST")
    port = grab("SFTP_PORT") or "22"
    user = grab("SFTP_USER")
    pw   = grab("SFTP_PASS")
    base = grab("SFTP_REMOTE_BASE") or "/"
    if not all([host, user, pw]):
        sys.exit("secrets.php unvollstaendig (HOST/USER/PASS).")
    return host, int(port), user, pw, base


def gather_files():
    """Liefert Liste (lokaler_pfad, relativer_remote_pfad)."""
    out = []
    # Root-Dateien
    for name in os.listdir(HERE):
        full = os.path.join(HERE, name)
        if os.path.isfile(full):
            if name in EXCLUDE_NAMES:
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in EXCLUDE_EXT:
                continue
            if ext in INCLUDE_ROOT_FILES_EXT:
                out.append((full, name))
    # Include-Ordner rekursiv
    for d in INCLUDE_DIRS:
        base = os.path.join(HERE, d)
        if not os.path.isdir(base):
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in EXCLUDE_NAMES]
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in EXCLUDE_EXT:
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, HERE).replace(os.sep, "/")
                out.append((full, rel))
    return out


def ensure_remote_dir(sftp, remote_dir):
    """Legt verschachtelte Verzeichnisse an, ohne Fehler bei bestehenden."""
    if remote_dir in ("", "/", "."):
        return
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur = cur + "/" + p if cur else "/" + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


def main():
    args = set(sys.argv[1:])
    test = "--test" in args
    dry  = "--dry-run" in args

    host, port, user, pw, base = load_secrets(SECRETS)
    base = "/" + base.strip("/") if base.strip("/") else ""

    print(f"Verbinde zu {host}:{port} als {user} ...")
    if dry:
        files = [("(test)", "deploy-test.txt")] if test else gather_files()
        print(f"[DRY-RUN] {len(files)} Datei(en) wuerden hochgeladen nach Basis '{base or '/'}':")
        for _, rel in sorted(files, key=lambda x: x[1]):
            print("   ", (base + "/" + rel).replace("//", "/"))
        return

    transport = paramiko.Transport((host, port))
    transport.connect(username=user, password=pw)
    sftp = paramiko.SFTPClient.from_transport(transport)
    try:
        # Sicht-Check: wo landen wir? (gejailter Root)
        cwd = sftp.normalize(".")
        print(f"Login-Verzeichnis: {cwd}")

        if test:
            tmp = os.path.join(HERE, "deploy-test.txt")
            open(tmp, "w", encoding="utf-8").write(
                "vale-video deploy test ok\n")
            remote = (base + "/deploy-test.txt").replace("//", "/") or "deploy-test.txt"
            sftp.put(tmp, remote)
            os.remove(tmp)
            print(f"Testdatei hochgeladen -> {remote}")
            print("Pruefe im Browser: https://vale-video.de/deploy-test.txt")
            return

        files = gather_files()
        print(f"{len(files)} Datei(en) werden hochgeladen ...")
        made = set()
        for full, rel in files:
            remote = (base + "/" + rel).replace("//", "/")
            rdir = posixpath.dirname(remote)
            if rdir and rdir not in made:
                ensure_remote_dir(sftp, rdir)
                made.add(rdir)
            sftp.put(full, remote)
            print("  ^", rel)
        print("Fertig. Live: https://vale-video.de/")
    finally:
        sftp.close()
        transport.close()


if __name__ == "__main__":
    main()
