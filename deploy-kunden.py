#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vale-video Kundenportal-Deploy  —  Strato SFTP (Hosting Plus)

Wie deploy.py, aber laedt AUSSCHLIESSLICH den Ordner `kunden/` hoch
(das Kundenportal-SPA). Die oeffentliche Website (index.html, portfolio,
css/, assets/ ...) bleibt komplett unberuehrt — praktisch, solange dort
uncommittete Work-in-Progress liegt, die noch nicht live darf.

NUR Upload/Overwrite, NIEMALS Loeschen. firestore.rules wird NICHT
hochgeladen (gehoert in die Firebase-Console bzw. `firebase deploy`).
Zugangsdaten kommen aus config/secrets.php (gitignored).

Aufruf:
    python deploy-kunden.py            # kunden/ hochladen
    python deploy-kunden.py --dry-run  # nur anzeigen, was hochgeladen wuerde
"""

import os
import re
import sys
import posixpath

try:
    import paramiko
except ImportError:
    sys.exit("paramiko fehlt. Installieren mit:  pip install paramiko")

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS = os.path.join(HERE, "config", "secrets.php")

# Nur das Kundenportal. Rekursiv.
INCLUDE_DIRS = ["kunden"]

# Niemals hochladen (Geheimnisse/Repo/Rohmaterial). firestore.rules +
# firebase.json/.firebaserc gehoeren zu Firebase-CLI-Deploys, nicht aufs Hosting.
EXCLUDE_NAMES = {".git", ".gitignore", "config", "node_modules",
                 ".vscode", ".idea", "__pycache__", "firestore.rules",
                 "firebase.json", ".firebaserc", ".firebase"}
EXCLUDE_EXT = (".mp4", ".mov", ".avi", ".mkv", ".prproj", ".drp",
               ".py", ".php", ".log", ".tmp", ".rules")


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
    """Liefert Liste (lokaler_pfad, relativer_remote_pfad) — nur kunden/."""
    out = []
    for d in INCLUDE_DIRS:
        base = os.path.join(HERE, d)
        if not os.path.isdir(base):
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in EXCLUDE_NAMES]
            for f in files:
                if f in EXCLUDE_NAMES:
                    continue
                ext = os.path.splitext(f)[1].lower()
                if ext in EXCLUDE_EXT:
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, HERE).replace(os.sep, "/")
                out.append((full, rel))
    return out


def ensure_remote_dir(sftp, remote_dir):
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
    dry = "--dry-run" in args

    host, port, user, pw, base = load_secrets(SECRETS)
    base = "/" + base.strip("/") if base.strip("/") else ""

    print(f"Verbinde zu {host}:{port} als {user} ...")
    if dry:
        files = gather_files()
        print(f"[DRY-RUN] {len(files)} Datei(en) wuerden hochgeladen nach Basis '{base or '/'}':")
        for _, rel in sorted(files, key=lambda x: x[1]):
            print("   ", (base + "/" + rel).replace("//", "/"))
        return

    transport = paramiko.Transport((host, port))
    transport.connect(username=user, password=pw)
    sftp = paramiko.SFTPClient.from_transport(transport)
    try:
        cwd = sftp.normalize(".")
        print(f"Login-Verzeichnis: {cwd}")
        files = gather_files()
        print(f"{len(files)} Datei(en) (nur kunden/) werden hochgeladen ...")
        made = set()
        for full, rel in files:
            remote = (base + "/" + rel).replace("//", "/")
            rdir = posixpath.dirname(remote)
            if rdir and rdir not in made:
                ensure_remote_dir(sftp, rdir)
                made.add(rdir)
            sftp.put(full, remote)
            print("  ^", rel)
        print("Fertig. Live: https://vale-video.de/kunden/")
    finally:
        sftp.close()
        transport.close()


if __name__ == "__main__":
    main()
