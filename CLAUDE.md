# vale-video — Website (Source of Truth)

Dieses Repo ist die **einzige Wahrheit** (Source of Truth) für die Website
vale-video.de — Dev **und** Deploy. Es liegt im portablen Code-Hub
**`<Vale-Code>/vale-video`** (Windows: `D:\Vale-Code\vale-video`, macOS:
`/Volumes/sandiskvale/Vale-Code/vale-video`) auf einer SanDisk-SSD, die zwischen
PC und MacBook umgesteckt wird. Übergeordneter Wegweiser: `../_ARCHITEKTUR.md`.

- GitHub-Remote: `github.com/karlowskivalentin-gif/vale-video` (privat), Branch `main`
- Zwei Sites: öffentliche Website (Root) + Kundenportal (`kunden/`)
- Deploy öffentliche Seite: `python deploy.py`  (`--dry-run` / `--test` verfügbar)
- Deploy Portal: `python deploy-kunden.py`
- Zugangsdaten in `config/secrets.php` (gitignored, NIE ins Repo/Vault).
- **Design-System:** `design-system/` ist ein **eigenes Repo**
  (`vale-video-design-system`), hier nur geklont + per `.gitignore` ausgeklammert.
  Commits dort gehen an dessen eigenen Remote.

## Cross-Platform (Mac ⇄ Windows, exFAT-SSD)

- **Nur relative Pfade** — kein `D:\...` / `/Volumes/...` im Code. Deploy-Scripts sind
  bereits `__file__`-relativ.
- SSD **sauber auswerfen** (exFAT ohne Journaling). `node_modules` nie mitschleppen
  (`npm install` pro Rechner, nur im `design-system/` relevant).
- Git ist exFAT-tauglich vorbereitet (`.gitattributes` = LF, `core.fileMode=false`,
  `safe.directory=*`). Mac-Setup: siehe `../_ARCHITEKTUR.md`.

## ⛔ Read-only-Regel für Fremd-Inhalte (WICHTIG, überschreibt Standard)

Auf dem Strato-Hosting liegen neben vale-video **fremde** Inhalte (u.a. das
Familien-Fotostudio Karlowski: `fotograf-*`, `STRATO-apps`; alte Experimente wie
`batmanplakat`; `cgi-bin`). Diese und **alles, was weder zu vale-video noch zu
KnowYourMeal gehört oder nicht von uns selbst angelegt wurde, sind strikt
READ-ONLY**: niemals hochladen, überschreiben, verschieben, umbenennen oder löschen —
auch nicht "zum Aufräumen". Maximal ansehen. Im Zweifel gar nichts tun und fragen.

Technische Absicherung: Der SFTP-Deploy-User ist auf `/Website_v10` **gejailt** und
kann fremde Verzeichnisse physisch nicht erreichen. Diese Regel gilt zusätzlich für
jedes andere Werkzeug (manuelles SFTP, Skripte, Konsole).

## Deploy-Verhalten

- `deploy.py` macht **nur** Upload/Overwrite der vale-video-Dateien, **niemals
  Löschen** auf dem Server. Gezielte Löschungen (z.B. Testreste) nur bewusst und
  ausschließlich innerhalb des vale-video-Jails.
- `firestore.rules` gehört in die Firebase-Console, **nicht** aufs Hosting
  (vom Deploy ausgeschlossen).

## Stand-Referenz

Repo == live byte-genau (öffentlich 35/35, Portal 32/32), auf GitHub gesichert.
Details & Historie: Handoffs in Obsidian `08 Handoffs/` (zuletzt
"vale-video unter Git und Source of Truth vereinheitlicht 2026-07-06").
