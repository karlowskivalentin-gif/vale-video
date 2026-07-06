# vale-video — Website (Source of Truth)

Dieses Repo (`D:\Projekte\Website`) ist die **einzige Wahrheit** (Source of Truth)
für die Website vale-video.de — Dev **und** Deploy. Hier wird entwickelt, committet
und deployt. Der Vale-OS-Spiegel unter
`C:\Users\Admin\Desktop\Vale-OS\03_Bereiche\vale-video` ist nur eine **read-only
Referenz** und bleibt langfristig als solche erhalten.

- GitHub-Remote: `github.com/karlowskivalentin-gif/vale-video` (privat)
- Zwei Sites: öffentliche Website (Root) + Kundenportal (`kunden/`)
- Deploy öffentliche Seite: `python deploy.py`  (`--dry-run` / `--test` verfügbar)
- Deploy Portal: `python deploy-kunden.py`
- Zugangsdaten in `config/secrets.php` (gitignored, NIE ins Repo/Vault).

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
