// =====================================================================
// Firestore-CRUD-Layer. Kapselt alle Lese-/Schreibzugriffe, damit die
// Views keine Firestore-Interna kennen müssen.
//
// Kunden-Schreibzugriffe (kundeGibtFrei / kundeFordertAenderung) berühren
// NUR die Felder, die die Security Rules erlauben:
//   { status, freigabeSkript, freigabeSchnitt, aktualisiertAm }
// und nur die 4 erlaubten Status-Übergänge.
// =====================================================================
import { db } from "./firebase-init.js";
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  STATUS, OBJEKT_STATUS,
  kundenFreigabeZiel, kundenAenderungZiel
} from "./status.js";

const snapToArr = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// =====================================================================
// OBJEKTE — vom Kunden gemeldete Immobilien
// =====================================================================
const objekteCol = () => collection(db, "objekte");

export async function objektMelden({ adresse, objektTyp, beschreibung, link, gemeldetVon }) {
  return addDoc(objekteCol(), {
    adresse:      adresse || "",
    objektTyp:    objektTyp || "",
    beschreibung: beschreibung || "",
    link:         link || "",
    gemeldetVon:  gemeldetVon,
    status:       OBJEKT_STATUS.EINGEGANGEN,
    erstelltAm:   serverTimestamp()
  });
}

export async function ladeObjekte() {
  return snapToArr(await getDocs(query(objekteCol(), orderBy("erstelltAm", "desc"))));
}

export function beobachteObjekte(callback, onError) {
  return onSnapshot(
    query(objekteCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function setzeObjektStatus(id, status) {
  return updateDoc(doc(db, "objekte", id), { status });
}

export async function loescheObjekt(id) {
  return deleteDoc(doc(db, "objekte", id));
}

// =====================================================================
// VIDEOS — der eigentliche Produktions-Datensatz
// =====================================================================
const videosCol = () => collection(db, "videos");

export async function videoAnlegen(daten) {
  return addDoc(videosCol(), {
    titel:          daten.titel || "",
    typ:            daten.typ || "",
    objektId:       daten.objektId || null,
    status:         daten.status || STATUS.IDEE,
    skriptLink:     daten.skriptLink || "",
    schnittLink:    daten.schnittLink || "",
    freigabeSkript: null,
    freigabeSchnitt: null,
    geplantesDatum:     daten.geplantesDatum || null,
    geplanterDrehtermin: daten.geplanterDrehtermin || null,
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function ladeVideo(id) {
  const d = await getDoc(doc(db, "videos", id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export function beobachteVideo(id, callback, onError) {
  return onSnapshot(
    doc(db, "videos", id),
    (d) => callback(d.exists() ? { id: d.id, ...d.data() } : null),
    onError || (() => {})
  );
}

export async function ladeVideos() {
  return snapToArr(await getDocs(query(videosCol(), orderBy("erstelltAm", "desc"))));
}

export function beobachteVideos(callback, onError) {
  return onSnapshot(
    query(videosCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// Admin: beliebige Felder aktualisieren (inkl. freier Statuswahl).
export async function aktualisiereVideo(id, felder) {
  return updateDoc(doc(db, "videos", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function adminSetzeStatus(id, status) {
  return aktualisiereVideo(id, { status });
}

export async function loescheVideo(id) {
  return deleteDoc(doc(db, "videos", id));
}

// --- Kunden-Schreibzugriffe (rules-konform) ---------------------------

// Kunde gibt frei → Auto-Sprung. Schreibt nur erlaubte Felder.
export async function kundeGibtFrei(video, user) {
  const ziel = kundenFreigabeZiel(video.status);
  if (!ziel) throw new Error("Freigabe in diesem Status nicht möglich.");

  const felder = { status: ziel, aktualisiertAm: serverTimestamp() };
  const freigabe = { by: user.email, at: serverTimestamp() };
  if (video.status === STATUS.FREIGABE_SKRIPT) felder.freigabeSkript = freigabe;
  else                                         felder.freigabeSchnitt = freigabe;

  return updateDoc(doc(db, "videos", video.id), felder);
}

// Kunde fordert Änderungen → eine Stufe zurück. Pflicht-Kommentar separat.
export async function kundeFordertAenderung(video) {
  const ziel = kundenAenderungZiel(video.status);
  if (!ziel) throw new Error("Änderungsanforderung in diesem Status nicht möglich.");

  return updateDoc(doc(db, "videos", video.id), {
    status: ziel,
    aktualisiertAm: serverTimestamp()
  });
}

// =====================================================================
// KOMMENTARE — Subcollection unter videos/{id}/kommentare
// =====================================================================
const kommentareCol = (videoId) => collection(db, "videos", videoId, "kommentare");

export async function kommentarHinzufuegen(videoId, { text, autor, rolle, art }) {
  return addDoc(kommentareCol(videoId), {
    text:       text || "",
    autor:      autor,
    rolle:      rolle,                 // 'kunde' | 'admin'
    art:        art || "kommentar",    // 'kommentar' | 'aenderungswunsch'
    erstelltAm: serverTimestamp()
  });
}

export async function ladeKommentare(videoId) {
  return snapToArr(await getDocs(query(kommentareCol(videoId), orderBy("erstelltAm", "asc"))));
}

export function beobachteKommentare(videoId, callback, onError) {
  return onSnapshot(
    query(kommentareCol(videoId), orderBy("erstelltAm", "asc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// TERMINE — manuelle, frei stehende Kalender-Einträge (ohne Pipeline-Video)
// Felder: kategorie ('besprechung'|'drehtermin'|'veroeffentlichung'),
//         bezeichnung, datum (Date), uhrzeitVon, uhrzeitBis (opt. "HH:MM"),
//         ort, notiz (alle optional).
// Rechte: Admin legt an/ändert/löscht; Kunde liest nur (siehe firestore.rules).
// =====================================================================
const termineCol = () => collection(db, "termine");

export async function terminAnlegen(daten) {
  return addDoc(termineCol(), {
    kategorie:   daten.kategorie || "besprechung",
    bezeichnung: daten.bezeichnung || "",
    datum:       daten.datum || null,
    uhrzeitVon:  daten.uhrzeitVon || "",
    uhrzeitBis:  daten.uhrzeitBis || "",
    ort:         daten.ort || "",
    notiz:       daten.notiz || "",
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereTermin(id, felder) {
  return updateDoc(doc(db, "termine", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheTermin(id) {
  return deleteDoc(doc(db, "termine", id));
}

export async function ladeTermine() {
  return snapToArr(await getDocs(query(termineCol(), orderBy("datum", "asc"))));
}

export function beobachteTermine(callback, onError) {
  return onSnapshot(
    query(termineCol(), orderBy("datum", "asc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// PLAENE — private Video-/Konzept-Planung (Admin-only, „Incognito")
// Felder: titel (Pflicht), typ, objektId, status ('entwurf'|'veroeffentlicht'),
//         inspirationen [{ url, plattform }], sound { name, link },
//         shotlist [{ text, erledigt }], notiz,
//         geplanterDrehtermin (Date|null), geplantesDatum (Date|null).
// Rechte: ausschließlich Admin (read + write) — der Kunde sieht Pläne NIE
//         (siehe firestore.rules: match /plaene/{id}).
// =====================================================================
const plaeneCol = () => collection(db, "plaene");

export async function planAnlegen(daten) {
  return addDoc(plaeneCol(), {
    titel:         daten.titel || "",
    typ:           daten.typ || "",
    objektId:      daten.objektId || null,
    status:        daten.status || "entwurf",
    inspirationen: Array.isArray(daten.inspirationen) ? daten.inspirationen : [],
    sound:         daten.sound || { name: "", link: "" },
    shotlist:      Array.isArray(daten.shotlist) ? daten.shotlist : [],
    notiz:         daten.notiz || "",
    geplanterDrehtermin: daten.geplanterDrehtermin || null,
    geplantesDatum:      daten.geplantesDatum || null,
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function ladePlan(id) {
  const d = await getDoc(doc(db, "plaene", id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function aktualisierePlan(id, felder) {
  return updateDoc(doc(db, "plaene", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loeschePlan(id) {
  return deleteDoc(doc(db, "plaene", id));
}

export async function ladePlaene() {
  return snapToArr(await getDocs(query(plaeneCol(), orderBy("erstelltAm", "desc"))));
}

export function beobachtePlaene(callback, onError) {
  return onSnapshot(
    query(plaeneCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// SHOTVORLAGEN — globale, wiederverwendbare Shot-Textzeilen (Admin-only)
// Ein Dokument = eine Shot-Textzeile. Der Admin kopiert sie im Plan-Editor
// in die Shotlist eines Plans. Felder: text, erstelltAm, aktualisiertAm.
// Rechte: ausschließlich Admin (read + write) — der Kunde sieht das NIE
//         (siehe firestore.rules: match /shotvorlagen/{id}).
// =====================================================================
const shotvorlagenCol = () => collection(db, "shotvorlagen");

export async function shotvorlageAnlegen({ text }) {
  return addDoc(shotvorlagenCol(), {
    text:           text || "",
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereShotvorlage(id, felder) {
  return updateDoc(doc(db, "shotvorlagen", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheShotvorlage(id) {
  return deleteDoc(doc(db, "shotvorlagen", id));
}

export async function ladeShotvorlagen() {
  return snapToArr(await getDocs(query(shotvorlagenCol(), orderBy("erstelltAm", "asc"))));
}

// =====================================================================
// GEDANKEN — persönliche Mindmap-Plattform (Admin-only, „Incognito")
// Jeder Gedanke ist ein frei platzierbarer Knoten auf der Leinwand.
// Felder:
//   text        (string)          — die Überschrift/der Gedanke selbst
//   ebene       (string)          — Hierarchie-/Größenstufe:
//                                    'bereich' (H1, groß/fett), 'sub' (H2, mittel),
//                                    'untersub' (H3, klein-fett), 'gedanke' (normal, Standard)
//   detail      (string)          — ausführlicher Markdown-Body („Ausführung")
//   x, y        (number)          — Position auf der Leinwand (Weltkoordinaten)
//   erledigt    (bool)            — Checkbox → durchgestrichen/abgehakt
//   archiviert  (bool)            — true → aus der Haupt-Leinwand ins Archiv
//                                    verschoben (eigene Leinwand erledigter
//                                    Gedanken; Verbindungen bleiben erhalten)
//   farbe       (string|null)     — optionaler Akzent (Hex), sonst Standard
//   verbindungen(array<string>)   — IDs anderer Gedanken (ungerichtete Kanten;
//                                    beim Zeichnen werden A-B/B-A dedupliziert,
//                                    tote IDs werden übersprungen)
//   dateien     (array<obj>)      — Anhänge (Metadaten, KEIN Blob):
//                                    { art:'datei', blobId, name, typ } oder
//                                    { art:'link',  url,   name, typ:'link' }
//                                    Die eigentlichen Datei-Bytes liegen als
//                                    Base64 in der Collection dateiblobs (on-demand).
//   erstelltAm, aktualisiertAm    (serverTimestamp)
// Rechte: ausschließlich Admin (read + write) — der Kunde sieht das NIE
//         (siehe firestore.rules: match /gedanken/{id}).
// =====================================================================
const gedankenCol = () => collection(db, "gedanken");

export async function gedankeAnlegen(daten) {
  return addDoc(gedankenCol(), {
    text:        daten.text || "",
    ebene:       (daten.ebene === "bereich" || daten.ebene === "sub" || daten.ebene === "untersub") ? daten.ebene : "gedanke",
    kind:        daten.kind === "post" ? "post" : "gedanke",  // Format: normaler Gedanke | Post-Card
    todo:        !!daten.todo,                                 // To-Do-Status (grün / im Filter)
    sticky:      !!daten.sticky,                               // 📌 Sticky Note (gelb; offene Fragestellung, eigener Tab)
    dringend:    !!daten.dringend,                             // ❗ dringliches To-Do (roter Glow, oben fixiert)
    mapId:       daten.mapId || "default",                     // Zugehörigkeit zu einer Mindmap
    verantwortlich: (daten.verantwortlich || "").toLowerCase(),// zuständige E-Mail fürs To-Do ("" = niemand)
    neuVon:      daten.neuVon || null,                         // auf geteilten Maps: E-Mail des Erstellers (NEU-Markierung)
    hinweis:     daten.hinweis || null,                        // roter Partner-Kommentar {von, text, am} | null
    fokusKategorie: typeof daten.fokusKategorie === "boolean" ? daten.fokusKategorie : null, // Sub/Bereich als Fokus-Kategorie? (null = Default: Sub ja, Bereich nein)
    detail:      daten.detail || "",
    x:           Number.isFinite(daten.x) ? daten.x : 0,
    y:           Number.isFinite(daten.y) ? daten.y : 0,
    erledigt:    !!daten.erledigt,
    archiviert:  !!daten.archiviert,
    farbe:       daten.farbe || null,
    verbindungen: Array.isArray(daten.verbindungen) ? daten.verbindungen : [],
    dateien:     Array.isArray(daten.dateien) ? daten.dateien : [],
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereGedanke(id, felder) {
  return updateDoc(doc(db, "gedanken", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheGedanke(id) {
  return deleteDoc(doc(db, "gedanken", id));
}

export async function ladeGedanken() {
  return snapToArr(await getDocs(query(gedankenCol(), orderBy("erstelltAm", "asc"))));
}

// Admin: ohne nurMapId → alle Gedanken (orderBy erstelltAm).
// Kollaborator: mit nurMapId → nur diese Map (where mapId; KEIN orderBy, damit
// kein Composite-Index nötig ist — die Mindmap ordnet ohnehin über x/y).
export function beobachteGedanken(callback, onError, nurMapId) {
  const q = nurMapId
    ? query(gedankenCol(), where("mapId", "==", nurMapId))
    : query(gedankenCol(), orderBy("erstelltAm", "asc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

// =====================================================================
// DATEIBLOBS — die eigentlichen Datei-Bytes eines Gedanken-Anhangs.
// Ein Dokument = eine Datei, Base64-kodiert. Getrennt von gedanken, damit
// die Realtime-Leinwand NICHT megabyteweise Base64 mitlädt — Blobs werden
// erst bei Bedarf (Abspielen/Öffnen) geladen.
// Spark-Plan-Kompromiss (kein Firebase Storage): Firestore-Doc-Limit ist
// 1 MiB, daher Upload-Cap ~700 KB Rohdatei in der View.
// Felder: { base64 (ohne data:-Präfix), name, typ (MIME) }.
// Rechte: ausschließlich Admin (read + write) — siehe firestore.rules.
// =====================================================================
const dateiblobsCol = () => collection(db, "dateiblobs");

export async function dateiblobAnlegen({ base64, name, typ }) {
  return addDoc(dateiblobsCol(), {
    base64:     base64 || "",
    name:       name || "",
    typ:        typ || "application/octet-stream",
    erstelltAm: serverTimestamp()
  });
}

export async function ladeDateiblob(id) {
  const d = await getDoc(doc(db, "dateiblobs", id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function loescheDateiblob(id) {
  return deleteDoc(doc(db, "dateiblobs", id));
}

// =====================================================================
// FOKUSVIDEOS — private Fokus-/Ambient-YouTube-Videos (Admin-only)
// Kuratierte Anspiel-Liste auf der Fokus-Seite: Karten-Grid + Inline-Player.
// Ein Dokument = ein Video. Es werden NUR Metadaten gespeichert (kein Blob):
//   url        (string)  — der eingefügte YouTube-Link (Original)
//   videoId    (string)  — 11-stellige YouTube-ID (fürs Embed + Thumbnail)
//   titel      (string)  — via noembed.com automatisch geholt (Fallback: "")
//   thumbnail  (string)  — Vorschaubild-URL (i.ytimg.com/img.youtube.com)
//   erstelltAm (serverTimestamp)
// Rechte: ausschließlich Admin (read + write) — der Kunde sieht das NIE
//         (siehe firestore.rules: match /fokusvideos/{id}).
// =====================================================================
const fokusvideosCol = () => collection(db, "fokusvideos");

export async function fokusvideoAnlegen({ url, videoId, titel, thumbnail, loop }) {
  return addDoc(fokusvideosCol(), {
    url:        url || "",
    videoId:    videoId || "",
    titel:      titel || "",
    thumbnail:  thumbnail || "",
    loop:       loop !== false,   // Default: Schleife an; für Livestreams ausschaltbar
    erstelltAm: serverTimestamp()
  });
}

export async function aktualisiereFokusvideo(id, felder) {
  return updateDoc(doc(db, "fokusvideos", id), felder);
}

export async function loescheFokusvideo(id) {
  return deleteDoc(doc(db, "fokusvideos", id));
}

export function beobachteFokusvideos(callback, onError) {
  return onSnapshot(
    query(fokusvideosCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// FOKUSSESSIONS — Verlauf abgeschlossener Fokus-Sessions (Admin-only)
// Ein Dokument = eine abgeschlossene Session (Timer voll durchgelaufen ODER
// per „Beenden" vorzeitig abgeschlossen; „Abbrechen" schreibt NICHTS).
//   name       (string)  — frei benannt vor dem Start (Fallback: "Fokus")
//   dauerMin   (number)  — tatsächlich fokussierte Minuten
//   startAt    (Date)    — Beginn der Session
//   endeAt     (Date)    — Abschluss der Session
//   erstelltAm (serverTimestamp)
// Rechte: ausschließlich Admin — der Kunde sieht das NIE
//         (siehe firestore.rules: match /fokussessions/{id}).
// =====================================================================
const fokussessionsCol = () => collection(db, "fokussessions");

export async function fokusSessionAnlegen({ name, dauerMin, startAt, endeAt, kategorie }) {
  return addDoc(fokussessionsCol(), {
    name:       name || "Fokus",
    dauerMin:   Number.isFinite(dauerMin) ? dauerMin : 0,
    startAt:    startAt instanceof Date ? startAt : new Date(),
    endeAt:     endeAt instanceof Date ? endeAt : new Date(),
    kategorie:  kategorie || "",
    erstelltAm: serverTimestamp()
  });
}

export function beobachteFokusSessions(callback, onError) {
  return onSnapshot(
    query(fokussessionsCol(), orderBy("startAt", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function loescheFokusSession(id) {
  return deleteDoc(doc(db, "fokussessions", id));
}

// =====================================================================
// MINDMAPS — benannte Gedanken-Leinwände (Admin-only)
// Jeder Gedanke trägt ein Feld `mapId`; fehlt es (Altbestand), gehört er
// zur virtuellen Standard-Map "default" (kein eigenes Dokument). Ein
// Dokument hier = eine zusätzliche, benannte Mindmap.
//   name       (string)
//   erstelltAm (serverTimestamp)
// Rechte: ausschließlich Admin (siehe firestore.rules: match /mindmaps/{id}).
// =====================================================================
const mindmapsCol = () => collection(db, "mindmaps");

// besitzer + mitglieder steuern, wer die Map sieht/bearbeitet (siehe Rules):
// der Besitzer darf sie löschen; Mitglieder sehen sie und ihre Gedanken.
export async function mindmapAnlegen({ name, besitzer, mitglieder }) {
  return addDoc(mindmapsCol(), {
    name:       name || "Neue Map",
    besitzer:   (besitzer || "").toLowerCase(),
    mitglieder: Array.isArray(mitglieder) ? mitglieder.map((e) => String(e).toLowerCase()) : [],
    erstelltAm: serverTimestamp()
  });
}

export function beobachteMindmaps(callback, onError) {
  return onSnapshot(
    query(mindmapsCol(), orderBy("erstelltAm", "asc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// Nur die Maps, in denen diese E-Mail Mitglied ist (Kollaborator-Sicht).
// Kein orderBy → kein Composite-Index nötig; Sortierung macht der Client.
export function beobachteMeineMindmaps(email, callback, onError) {
  const e = (email || "").trim().toLowerCase();
  return onSnapshot(
    query(mindmapsCol(), where("mitglieder", "array-contains", e)),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function ladeMindmap(id) {
  const d = await getDoc(doc(db, "mindmaps", id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function aktualisiereMindmap(id, felder) {
  return updateDoc(doc(db, "mindmaps", id), felder);
}

export async function loescheMindmap(id) {
  return deleteDoc(doc(db, "mindmaps", id));
}

// Mindmap mit fester Doc-ID anlegen (z. B. "johannvale" für die geteilte Map).
export async function mindmapAnlegenMitId(id, name) {
  return setDoc(doc(db, "mindmaps", id), { name: name || "Mindmap", erstelltAm: serverTimestamp() }, { merge: true });
}

// =====================================================================
// BENACHRICHTIGUNGEN — Glocke in der Topbar (anerkannt/kommentiert)
// Ein Doc = eine Nachricht an genau eine E-Mail (fuer). gelesen-Flag
// steuert den Zähler. Rules: lesen/gelesen-setzen nur der Empfänger.
// =====================================================================
const benachrichtigungenCol = () => collection(db, "benachrichtigungen");

export async function benachrichtigungAnlegen({ fuer, von, text }) {
  return addDoc(benachrichtigungenCol(), {
    fuer:       (fuer || "").toLowerCase(),
    von:        (von || "").toLowerCase(),
    text:       text || "",
    gelesen:    false,
    erstelltAm: serverTimestamp()
  });
}

export function beobachteBenachrichtigungen(email, callback, onError) {
  const e = (email || "").trim().toLowerCase();
  return onSnapshot(
    query(benachrichtigungenCol(), where("fuer", "==", e)),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function markiereBenachrichtigungenGelesen(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, "benachrichtigungen", id), { gelesen: true }));
  return batch.commit();
}

// =====================================================================
// KOLLABORATOREN + EINLADUNG — geteilte Map-Bearbeitung per Einmal-Code
// Ein externer Nutzer meldet sich mit seiner E-Mail an und löst einen
// Einladungscode ein → wird Kollaborator mit Zugriff auf GENAU EINE Map.
//   einladung/{id}      : { code, mapId, eingeloestVon: null|email }  (Einmal-Code)
//   kollaboratoren/{email}: { mapId, erstelltAm }                     (Freischaltung)
// Sicherheit steckt in firestore.rules (Code wird dort gegengeprüft,
// eingeloestVon verhindert Mehrfach-Einlösung). Siehe roles.js/auth.js.
// =====================================================================
export async function ladeKollaborator(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const d = await getDoc(doc(db, "kollaboratoren", e));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function ladeEinladung(id) {
  const d = await getDoc(doc(db, "einladung", id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

// Admin-seitige Erstanlage eines Einladungscodes (einmalig aufrufen).
export async function einladungAnlegen(id, code, mapId) {
  return setDoc(doc(db, "einladung", id), { code: String(code), mapId, eingeloestVon: null });
}

// Code einlösen: atomar (writeBatch) den Code als verbraucht markieren UND
// den Kollaborator freischalten. Wirft, wenn die Rules ablehnen (Code falsch,
// bereits verbraucht, oder E-Mail passt nicht). Der eingegebene `code` wird
// beim einladung-Update mitgesendet; die Rule prüft ihn gegen den gespeicherten.
export async function loeseEinladungEin(einladungId, code, email, mapId) {
  const e = (email || "").trim().toLowerCase();
  const batch = writeBatch(db);
  batch.update(doc(db, "einladung", einladungId), { code: String(code), mapId, eingeloestVon: e });
  batch.set(doc(db, "kollaboratoren", e), { mapId, erstelltAm: serverTimestamp() });
  // Zusätzlich Mitglied der geteilten Map werden (Rules: nur via dieses Batches
  // möglich, getAfter-Prüfung). Ab dann kennt die Map ihre Nutzer → Zuweisung,
  // Geteilt-Erkennung fürs Neu-/Akzeptier-System.
  batch.update(doc(db, "mindmaps", mapId), { mitglieder: arrayUnion(e) });
  return batch.commit();
}
