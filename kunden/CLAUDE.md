# kunden/ — Kundenportal **und** Valentins privates Arbeitsportal

Dieser Ordner ist **eine** Vanilla-JS-SPA (Hash-Routing, Firebase/Firestore-Projekt
`vale-kunden`, kein Build), die **zwei völlig getrennte Welten** bedient. Wichtig für
jede Arbeit hier: erst klären, **welche Welt** gemeint ist.

- **Öffentliche Website** = das Eltern-Repo `../` (die `*.html`-Seiten, `../js/`, `../css/`).
  Das ist NICHT hier. Hier drin gibt es **nichts Öffentliches**.
- **Dieses Portal** liegt unter `vale-video.de/kunden/`, ist **noindex** und nur nach
  Login erreichbar.

## Die zwei (drei) Welten = Rollen

Die Rolle steuert alles (Nav, Start-Route, Firestore-Rules). Sie steckt **im Datei-
und Routen-Präfix** — daran erkennt man sofort, wozu eine View gehört:

| Präfix / Route        | Rolle          | Was                                                        |
|-----------------------|----------------|-----------------------------------------------------------|
| `admin-*` / `/admin/*`| **admin** (= Valentin) | **Valentins privates Arbeitsportal** — das „geheime" Backoffice, nur ich |
| `kunde-*` / `/…`      | **kunde**      | Was echte Kunden sehen (Aufgaben, Objekt melden, Kalender, Video-Freigabe) |
| (geteilte Views)      | **kollaborator** | Externer Mitarbeiter: nur Mindmap (Gedanken) + To-Dos + Stickies |

„Mein Arbeitsportal", „mein Backoffice", „mein Dashboard" ⇒ **immer die `admin-*`-Welt.**

## Arbeitsportal (admin) — Feature → Datei

Wenn Valentin ein Feature seines Arbeitsportals beim Namen nennt, ist das die Datei
(alle unter `js/views/`). Start-View nach Admin-Login: **Pipeline**.

| Feature (so sagt Valentin) | Route                | Datei                     |
|----------------------------|----------------------|---------------------------|
| Pipeline                   | `/admin/pipeline`    | `admin-pipeline.js`       |
| Video bearbeiten           | `/admin/video/:id`   | `admin-video-edit.js`     |
| Objekte                    | `/admin/objekte`     | `admin-objekte.js`        |
| Kalender (Admin)           | `/admin/kalender`    | `admin-kalender.js`       |
| Termine                    | `/admin/termine`     | `admin-termine.js`        |
| Pläne (Übersicht)          | `/admin/plaene`      | `admin-plaene.js`         |
| Plan (einzeln)             | `/admin/plan/:id`    | `admin-plan.js`           |
| **Fokus**                  | `/admin/fokus`       | `admin-fokus.js`          |
| Gedanken / Mindmap         | `/admin/gedanken`    | `admin-gedanken.js`       |
| To-Dos                     | `/admin/todos`       | `todos.js`                |
| Sticky Notes / Stickies    | `/admin/stickies`    | `todos.js` (Modus `sticky`) |
| Transkript                 | `/admin/transkript`  | `admin-transkript.js`     |
| Inspiration                | `/admin/inspiration` | `admin-inspiration.js`    |

Kunden-Views (Referenz): `kunde-aufgaben.js`, `kunde-objekt-melden.js`,
`kunde-kalender.js`, `kunde-video-detail.js`.

## Wo hängt was zusammen (nicht in `views/`)

- `js/router.js` — Routen-Tabelle, Nav pro Rolle, Rollen-Guard. **Neue View →
  hier registrieren** (Import + `ROUTES` + ggf. `NAV`).
- `js/roles.js` — Rollen-/Allowlist-Logik (wer ist admin/kunde/kollaborator).
- `js/auth.js` — Login (Google + E-Mail-Link + Passwort).
- `js/db.js` — Firestore-Zugriffe. `js/status.js`, `js/drive.js`, `js/email.js`,
  `js/ics.js`, `js/embeds.js`, `js/util.js`, `js/view-lifecycle.js` = Helfer.
- `firestore.rules` — **gehört in die Firebase-Console** (`firebase deploy`),
  **nicht** aufs Hosting. Vom Datei-Deploy ausgeschlossen.

## Deploy & Regeln

- Portal deployen: `python ../deploy-kunden.py` → Strato `Website_v10/kunden/`.
  Nur nach ausdrücklicher Ansage, nur Upload/Overwrite, **nie Löschen** auf dem Server.
- `../CLAUDE.md` (Read-only-Regel für Fremd-Inhalte, Cross-Platform) und
  `../../_ARCHITEKTUR.md` gelten auch hier.
- Realer Stand: Pilotphase — ein echter Kunde (Deussen-Immobilien), Rest Testzugänge.
  EmailJS-Auto-Versand steht bewusst auf Kill-Switch. Kein Datei-Upload im Portal
  (Medien via Google-Drive-/YouTube-Links).
