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
| **Roadmap**                | `/admin/roadmap`     | `admin-roadmap.js`        |
| **Kurs**                   | `/admin/kurs`        | `admin-kurs.js`           |
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
| **Skripte** (Personal Brand) | `/admin/brand`     | `admin-brand.js`          |
| Skript-Werkstatt (einzeln) | `/admin/skript/:id`  | `admin-brand-skript.js`   |
| Shoot-Modus                | `/admin/shoot/:id`   | `admin-shoot.js`          |
| Formate                    | `/admin/formate`     | `admin-formate.js`        |
| **Fonts** (Go-To-Schriften) | `/admin/fonts`      | `admin-fonts.js`          |
| **Social** (Zahlen der Kunden) | `/admin/social`  | `admin-social.js`         |
| **Social Brain** (Cockpit, hervorgehobener Tab) | `/admin/social-brain` | `admin-socialbrain.js` — Frame auf `localhost:4710` (Repo `social-brain`, `node frontend/server.js`) |

Kunden-Views (Referenz): `kunde-aufgaben.js`, `kunde-objekt-melden.js`,
`kunde-kalender.js`, `kunde-video-detail.js`, `kunde-social.js` („Meine Zahlen“, Route `/meine-zahlen`).

## Wo hängt was zusammen (nicht in `views/`)

- `js/router.js` — Routen-Tabelle, Nav pro Rolle, Rollen-Guard. **Neue View →
  hier registrieren** (Import + `ROUTES` + ggf. `NAV`).
- `js/brandplan.js` — Kernlogik der Personal-Brand-Werkstatt (Takes an den Text
  nachführen, Fortschrittsformel, Feld-Listen, Drehplan-Text). Rein rechnend,
  wird von Liste, Editor und Shoot-Modus geteilt — die Fortschrittsformel darf
  es nur **einmal** geben.
- `js/socialstat.js` — Rechenlogik der Social-Zahlen (Zeitreihen, Wachstum,
  Wirkungs-Nachweis). `js/socialchart.js` — die geteilten HTML-Bausteine
  (Kurve, Wirkungs-Gegenüberstellung, Kacheln). Beides teilen sich
  `admin-social.js` und `kunde-social.js`: Valentin und der Kunde müssen
  **dieselben** Zahlen und dieselbe Kurve sehen — deshalb steht jede Formel
  nur einmal da, genau wie bei `brandplan.js`.
  Die Collections `socialkonten` / `socialsnapshots` / `socialposts` befüllt
  im Normalbetrieb ein serverseitiger Connector (`../api/`, in Arbeit) über
  ein Google-Dienstkonto — das läuft per IAM an den Rules vorbei. Aus dem
  Portal heraus schreibt nur der Admin: manuelle Nacherfassung eines
  Tageswerts und die Verknüpfung eines Posts mit einem eigenen Video
  (`videoId`). Diese Verknüpfung ist Handarbeit und darf vom nächtlichen
  Lauf **nie** überschrieben werden.
- `js/roadmap-data.js` — **alle Inhalte** der Roadmap (4 Phasen, 48 Meilensteine
  mit „Wie" und „Warum", Wochenrhythmus). Bewusst getrennt von der View: die
  Meilensteine ändern sich, die View nicht. Wer die Roadmap fortschreibt,
  fasst nur diese Datei an. Die Meilenstein-`id` ist der Firestore-Schlüssel
  und darf **nie** nachträglich geändert werden — sonst verwaist der Haken.
  `js/roadmap-logik.js` — die reine Rechenlogik dazu (aktuelle Phase, nächster
  offener Schritt, Fortschritt, Position auf dem Zeitstrahl). Ohne
  Firebase-Abhängigkeit, damit sie prüfbar bleibt: `node tools/roadmap-check.mjs`
  rechnet sie gegen die Referenz-Implementierung. Gleiches Muster wie
  `brandplan.js` und `socialstat.js` — jede Formel steht nur einmal da.
  Gespeichert wird in **einem** Dokument `roadmap/valentin` (Haken, Monatsumsatz,
  Wochen-Aufgaben), Rules: nur `istAdmin()`.
- `js/kurs-data.js` / `js/kurs-logik.js` — dasselbe Paar für den Lernkurs
  (8 Module, 36 Lektionen mit Lerninhalt, Verstanden-Check und YouTube-
  Suchbegriffen). Der Fortschritt liegt im **Feld `kurs` desselben Dokuments**
  `roadmap/valentin` — kein eigenes Dokument, keine eigene Rule. Der
  Kurs-Reset fasst deshalb nur `kurs` an und lässt die Roadmap-Haken stehen.
  Prüfbar mit `node tools/kurs-check.mjs`. Die YouTube-Links sind bewusst
  **Suchlinks statt Video-IDs** — eine feste ID ist in einem Jahr tot.
  CSS-Präfix ist `kurs-`, **nicht** `ks-`: das gehört den Post-Kacheln in
  `kunde-social.js`.
- `js/fontprobe.js` — Schrift-Technik der Fonts-Abteilung: Google-Stylesheets in
  den `<head>` hängen und wieder aufräumen, plus die Messung „ist diese
  Schrift auf DIESEM Rechner überhaupt da?“ (Canvas-Breitenvergleich).
  Bewusst getrennt von `views/admin-fonts.js`, weil es DOM-Seiteneffekte
  außerhalb der View hat.
- `js/roles.js` — Rollen-/Allowlist-Logik (wer ist admin/kunde/kollaborator).
- `js/auth.js` — Login (Google + E-Mail-Link + Passwort).
- `js/db.js` — Firestore-Zugriffe. `js/status.js`, `js/drive.js`, `js/email.js`,
  `js/ics.js`, `js/embeds.js`, `js/util.js`, `js/view-lifecycle.js` = Helfer.
- `js/dateien.js` — große Dateien (Exposé-PDFs, 2–5 MB) **blockweise in
  Firestore**: Kopf-Dokument `dateien/<id>` + Rohdaten als Base64 in der
  Subcollection `teile` (500 KB pro Block, Limit 10 MB). Nötig, weil ein
  Firestore-Dokument max. 1 MiB fasst und `docparse.js` Anhänge als Base64
  direkt ins Dokument legt (max. 700 KB). Cloud Storage wäre der Lehrbuchweg,
  verlangt aber den **Blaze-Plan** — das Projekt läuft auf Spark
  (`billingEnabled: false`, geprüft 2026-08-17). Im Objekt steht nur
  `expose = {dateiId,name,typ,groesse,teile}`.
- `firestore.rules` — **gehört in die Firebase-Console** (`firebase deploy
  --only firestore:rules`), **nicht** aufs Hosting. Vom Datei-Deploy
  ausgeschlossen.

## Deploy & Regeln

- Portal deployen: `python ../deploy-kunden.py` → Strato `Website_v10/kunden/`.
  Nur nach ausdrücklicher Ansage, nur Upload/Overwrite, **nie Löschen** auf dem Server.
- `../CLAUDE.md` (Read-only-Regel für Fremd-Inhalte, Cross-Platform) und
  `../../_ARCHITEKTUR.md` gelten auch hier.
- Realer Stand: Pilotphase — ein echter Kunde (Deussen-Immobilien), Rest Testzugänge.
  EmailJS-Auto-Versand steht bewusst auf Kill-Switch. Bewegtbild kommt weiterhin
  nur als Google-Drive-/YouTube-Link ins Portal; **Dokumente** dagegen werden
  hochgeladen — kleine Anhänge als Base64 ins Firestore-Dokument (`docparse.js`,
  ≤ 700 KB), Exposés blockweise über `js/dateien.js` (≤ 10 MB). Kein Firebase
  Storage, solange das Projekt auf Spark läuft.
