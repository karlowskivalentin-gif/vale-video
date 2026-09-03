// =====================================================================
// Firestore-CRUD-Layer. Kapselt alle Lese-/Schreibzugriffe, damit die
// Views keine Firestore-Interna kennen müssen.
//
// Kunden-Schreibzugriffe (kundeGibtFrei / kundeFordertAenderung) berühren
// NUR die Felder, die die Security Rules erlauben:
//   { status, freigabeSkript, freigabeSchnitt, aktualisiertAm }
// und nur die 4 erlaubten Status-Übergänge.
// =====================================================================
import { db, auth } from "./firebase-init.js";
import {
  collection, collectionGroup, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch, arrayUnion, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  STATUS, OBJEKT_STATUS,
  kundenFreigabeZiel, kundenAenderungZiel, kundenVerwerfenZiel
} from "./status.js";
import { ADMIN_EMAILS } from "./roles.js";
import { monatKey, monatPlus } from "./util.js";

const snapToArr = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// =====================================================================
// OBJEKTE — vom Kunden gemeldete Immobilien
// =====================================================================
const objekteCol = () => collection(db, "objekte");

// `expose` ist der Verweis auf eine im Storage liegende Datei (siehe
// js/storage.js): { url, pfad, name, typ, groesse }. Die Datei selbst kann
// NICHT ins Dokument — ein Exposé-PDF sprengt die 1-MiB-Grenze von Firestore.
export async function objektMelden({ adresse, objektTyp, beschreibung, link, gemeldetVon, kundeId, produktionsMonat, expose }) {
  return addDoc(objekteCol(), {
    adresse:      adresse || "",
    objektTyp:    objektTyp || "",
    beschreibung: beschreibung || "",
    link:         link || "",
    expose:       expose || null,
    gemeldetVon:  gemeldetVon,
    kundeId:      kundeId || null,   // Mandant, zu dem dieses gemeldete Objekt gehört
    status:       OBJEKT_STATUS.EINGEGANGEN,
    // Produktionsmonat "YYYY-MM": was diesen Monat gemeldet wird, produzieren wir
    // im Folgemonat (im Admin pro Objekt umhängbar).
    produktionsMonat: produktionsMonat || monatPlus(monatKey(new Date()), 1),
    erstelltAm:   serverTimestamp()
  });
}

export async function ladeObjekte(kundeId) {
  const q = kundeId
    ? query(objekteCol(), where("kundeId", "==", kundeId))
    : query(objekteCol(), orderBy("erstelltAm", "desc"));
  return snapToArr(await getDocs(q));
}

export function beobachteObjekte(callback, onError, kundeId) {
  const q = kundeId
    ? query(objekteCol(), where("kundeId", "==", kundeId))
    : query(objekteCol(), orderBy("erstelltAm", "desc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

export async function setzeObjektStatus(id, status) {
  return updateDoc(doc(db, "objekte", id), { status });
}

// Objekt bearbeiten (Admin): Adresse, Typ, Beschreibung, Link, Produktionsmonat.
export async function aktualisiereObjekt(id, daten) {
  return updateDoc(doc(db, "objekte", id), { ...daten, aktualisiertAm: serverTimestamp() });
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
    kundeId:        daten.kundeId || null,   // Mandant (Kundenprofil), zu dem dieses Video gehört
    objektId:       daten.objektId || null,
    planId:         daten.planId || null,   // Herkunfts-Plan (Video-Edit zeigt dessen volle Details)
    planSnapshot:   daten.planSnapshot || null,  // kundensichtbarer Ausschnitt des Plans (Kunde darf /plaene nicht lesen)
    status:         daten.status || STATUS.IDEE,
    monat:          daten.monat || monatKey(new Date()),   // Pipeline-Monat "YYYY-MM" (Sektion in der Admin-Pipeline)
    entwurf:        1,                       // Entwurfs-/Versionsnummer (steigt mit jedem „Neuen Entwurf")
    skriptLink:     daten.skriptLink || "",
    schnittLink:    daten.schnittLink || "",
    driveOrdner:    daten.driveOrdner || "",  // Google-Drive-Ordner des Videos (leer → Fallback: Kunde)
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

// kundeId (optional): auf einen Mandanten filtern (where OHNE orderBy → kein
// Composite-Index; der Client sortiert). Ohne kundeId: alle Videos (orderBy).
export async function ladeVideos(kundeId) {
  const q = kundeId
    ? query(videosCol(), where("kundeId", "==", kundeId))
    : query(videosCol(), orderBy("erstelltAm", "desc"));
  return snapToArr(await getDocs(q));
}

export function beobachteVideos(callback, onError, kundeId) {
  const q = kundeId
    ? query(videosCol(), where("kundeId", "==", kundeId))
    : query(videosCol(), orderBy("erstelltAm", "desc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
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

// Kunde verwirft das Skript („wird nicht gemacht") → Status Verworfen.
// Optionaler Grund-Kommentar wird separat via kommentarHinzufuegen geschrieben.
export async function kundeVerwirft(video) {
  const ziel = kundenVerwerfenZiel(video.status);
  if (!ziel) throw new Error("Verwerfen in diesem Status nicht möglich.");

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
  const daten = {
    text:       text || "",
    autor:      autor,
    rolle:      rolle,                 // 'kunde' | 'admin'
    art:        art || "kommentar",    // 'kommentar' | 'aenderungswunsch'
    erstelltAm: serverTimestamp()
  };
  // Kunden-Nachrichten starten ungelesen; der Admin arbeitet sie ab
  // (neu → gelesen → in_umsetzung → umgesetzt). Admin-Kommentare bleiben ohne.
  if (rolle === "kunde") daten.bearbeitung = "neu";
  return addDoc(kommentareCol(videoId), daten);
}

// Admin setzt den Bearbeitungs-Status einer Kunden-Nachricht.
// Erlaubte Werte: 'neu' | 'gelesen' | 'in_umsetzung' | 'umgesetzt' (siehe Rules).
export async function kommentarSetzeBearbeitung(videoId, kommentarId, status) {
  return updateDoc(doc(db, "videos", videoId, "kommentare", kommentarId), {
    bearbeitung:  status,
    bearbeitetAm: serverTimestamp()
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

// Alle Kommentare aller Videos in EINEM Listener (Admin-only, für die Pipeline).
// Liefert je Kommentar zusätzlich videoId (aus dem Parent-Pfad). Ohne orderBy
// (kein Composite-Index nötig) — die Sortierung übernimmt der Client.
export function beobachteAlleKommentare(callback, onError) {
  return onSnapshot(
    collectionGroup(db, "kommentare"),
    (snap) => callback(snap.docs.map((d) => ({
      id: d.id,
      videoId: d.ref.parent.parent ? d.ref.parent.parent.id : null,
      ...d.data()
    }))),
    onError || (() => {})
  );
}

// =====================================================================
// BONG-NOTIZEN — private Admin-Notizen zu „gebongten" Videos (Admin-only)
// Ein Doc = eine Notiz { videoId, text, erstelltAm }. BEWUSST eine eigene
// Top-Level-Collection und NICHT die videos/.../kommentare-Subcollection:
// letztere darf der Eigentümer-Kunde mitlesen (siehe firestore.rules). Diese
// Notizen sind rein intern — der Kunde sieht sie NIE (Rules: nur Admin).
// =====================================================================
const bongNotizenCol = () => collection(db, "bongnotizen");

export async function bongNotizAnlegen(videoId, text) {
  return addDoc(bongNotizenCol(), {
    videoId:    videoId,
    text:       text || "",
    erstelltAm: serverTimestamp()
  });
}

export async function loescheBongNotiz(id) {
  return deleteDoc(doc(db, "bongnotizen", id));
}

// Alle Bong-Notizen in EINEM Listener (Admin-only, für die Pipeline). Ohne
// orderBy (kein Index nötig) — der Client gruppiert nach videoId und sortiert.
export function beobachteBongNotizen(callback, onError) {
  return onSnapshot(
    bongNotizenCol(),
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
    kundeId:     daten.kundeId || null,   // Mandant, zu dem dieser Termin gehört
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

export async function ladeTermine(kundeId) {
  const q = kundeId
    ? query(termineCol(), where("kundeId", "==", kundeId))
    : query(termineCol(), orderBy("datum", "asc"));
  return snapToArr(await getDocs(q));
}

export function beobachteTermine(callback, onError, kundeId) {
  const q = kundeId
    ? query(termineCol(), where("kundeId", "==", kundeId))
    : query(termineCol(), orderBy("datum", "asc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
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
    kundeId:       daten.kundeId || null,   // Mandant, zu dem dieser Plan gehört
    objektId:      daten.objektId || null,
    status:        daten.status || "entwurf",
    poststatus:    daten.poststatus || "",   // aus einem Post übernommen: ''|skript|shotlist|geschnitten
    inspirationen: Array.isArray(daten.inspirationen) ? daten.inspirationen : [],
    sound:         daten.sound || { name: "", link: "" },
    shotlist:      Array.isArray(daten.shotlist) ? daten.shotlist : [],
    notiz:         daten.notiz || "",
    dateien:       Array.isArray(daten.dateien) ? daten.dateien : [],   // Anhänge aus dem Post (Bilder/Links/Dateien)
    gedankeId:     daten.gedankeId || null,   // Rück-Verknüpfung zum Ursprungs-Post (Gedanke) → Anhänge bleiben beidseitig synchron
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

export async function ladePlaene(kundeId) {
  const q = kundeId
    ? query(plaeneCol(), where("kundeId", "==", kundeId))
    : query(plaeneCol(), orderBy("erstelltAm", "desc"));
  return snapToArr(await getDocs(q));
}

export function beobachtePlaene(callback, onError, kundeId) {
  const q = kundeId
    ? query(plaeneCol(), where("kundeId", "==", kundeId))
    : query(plaeneCol(), orderBy("erstelltAm", "desc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
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
    poststatus:  daten.poststatus || "",                      // Post-Produktionsphase: ''|skript|shotlist|geschnitten
    todo:        !!daten.todo,                                 // To-Do-Status (grün / im Filter)
    sticky:      !!daten.sticky,                               // 📌 Sticky Note (gelb; offene Fragestellung, eigener Tab)
    dringend:    !!daten.dringend,                             // ❗ dringliches To-Do (roter Glow, oben fixiert)
    kundeId:     daten.kundeId || null,                        // Mandant, zu dem dieser Gedanke gehört
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

// Drei Betriebsarten (Priorität kundeId → nurMapId → global):
//   • kundeId  (Admin/Mindmap): alle Gedanken EINES Kunden (where kundeId).
//     Die Map-Auswahl filtert der View clientseitig über g.mapId.
//   • nurMapId (Kollaborator):  nur eine geteilte Map (where mapId).
//   • keins    (To-Dos/Fokus):  ALLE Gedanken kundenübergreifend (orderBy) —
//     bewusst global, damit To-Do-/Fokus-Sichten über alle Kunden aggregieren.
// where OHNE orderBy → kein Composite-Index nötig (die Leinwand ordnet über x/y).
export function beobachteGedanken(callback, onError, nurMapId, kundeId) {
  let q;
  if (kundeId)       q = query(gedankenCol(), where("kundeId", "==", kundeId));
  else if (nurMapId) q = query(gedankenCol(), where("mapId", "==", nurMapId));
  else               q = query(gedankenCol(), orderBy("erstelltAm", "asc"));
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
// INSPIRATIONEN — Inspirations-Dashboard (Admin-only)
// Eine Card = eine Inspirationsquelle:
//   kategorie  ('video'|'profil'|'sonstiges')
//   titel      (string)  — eigener Name der Card
//   url        (string)  — Referenz-Link (Video ODER Account/Profil)
//   notiz      (string)  — warum inspirierend / worauf achten
//   eigene     (array)   — eigene, davon inspirierte Videos: [{ url }]
// Rechte: ausschließlich Admin (siehe firestore.rules: /inspirationen).
// =====================================================================
const inspirationenCol = () => collection(db, "inspirationen");

export async function inspirationAnlegen(daten) {
  return addDoc(inspirationenCol(), {
    kategorie:  ["video", "profil", "sonstiges"].includes(daten.kategorie) ? daten.kategorie : "video",
    titel:      daten.titel || "",
    url:        daten.url || "",
    notiz:      daten.notiz || "",
    eigene:     Array.isArray(daten.eigene) ? daten.eigene : [],
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereInspiration(id, felder) {
  return updateDoc(doc(db, "inspirationen", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheInspiration(id) {
  return deleteDoc(doc(db, "inspirationen", id));
}

export function beobachteInspirationen(callback, onError) {
  return onSnapshot(
    query(inspirationenCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// MOODBOARD — persönliche Kanal-Haftnotizen (Admin-only)
// Eine Notiz = ein Inspirations-YouTube-Kanal:
//   kanalName   (string) — Anzeigename des Kanals
//   kanalUrl    (string) — Link zum Kanal
//   gefaelltMir (string) — was an dem Kanal gefällt
//   nachahmen   (string) — was davon nachgeahmt werden soll
//   farbe       ('gelb'|'rosa'|'blau'|'gruen'|'orange')
// Rechte: ausschließlich Admin (siehe firestore.rules: /moodboard).
// =====================================================================
export const MOODBOARD_FARBEN = ["gelb", "rosa", "blau", "gruen", "orange"];

const moodboardCol = () => collection(db, "moodboard");

export async function moodboardNotizAnlegen(daten) {
  return addDoc(moodboardCol(), {
    kanalName:   daten.kanalName || "",
    kanalUrl:    daten.kanalUrl || "",
    gefaelltMir: daten.gefaelltMir || "",
    nachahmen:   daten.nachahmen || "",
    farbe:       MOODBOARD_FARBEN.includes(daten.farbe) ? daten.farbe : "gelb",
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereMoodboardNotiz(id, felder) {
  return updateDoc(doc(db, "moodboard", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheMoodboardNotiz(id) {
  return deleteDoc(doc(db, "moodboard", id));
}

export function beobachteMoodboard(callback, onError) {
  return onSnapshot(
    query(moodboardCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// FONTS — Go-To-Schriften für Videos (Admin-only)
// Eine Karte = eine Schrift, die in Bauchbinden/Titeln/Untertiteln benutzt
// wird. Zweck des Bereichs: nie wieder vergessen, wie eine Schrift exakt
// heißt (der Name muss in DaVinci/Premiere buchstabengenau stimmen).
//   name       (string)  — Anzeigename der Karte
//   familie    (string)  — EXAKTER CSS-/System-Name (Vorschau + Kopier-Button)
//   quelle     ('google'|'lokal') — nachladen oder direkt rendern
//   gewichte   (string)  — nur Google, z. B. "400;700" für den Stylesheet-Link
//   zwecke     (array)   — wofür benutzt, aus FONT_ZWECKE
//   notiz      (string)  — worauf achten / warum diese Schrift
//   link       (string)  — Bezugsquelle (Google-Fonts-Seite, Kaufseite, Lizenz)
//   angeheftet (bool)    — Go-To: erscheint in der oberen Sektion
//   probetext  (string)  — optional, überschreibt den globalen Probetext
// Rechte: ausschließlich Admin (siehe firestore.rules: /fonts).
// =====================================================================
export const FONT_ZWECKE = ["titel", "bauchbinde", "untertitel", "logo", "flaeche", "akzent"];
const FONT_QUELLEN = ["google", "lokal"];

const fontsCol = () => collection(db, "fonts");

// Gemeinsame Feld-Normalisierung für Anlegen und Aktualisieren: Enums werden
// gegen die Whitelist geprüft, damit kein Tippfehler in der Collection landet.
function normFontFelder(daten) {
  const felder = {};
  if ("name"       in daten) felder.name       = String(daten.name || "").trim();
  if ("familie"    in daten) felder.familie    = String(daten.familie || "").trim() || String(daten.name || "").trim();
  if ("quelle"     in daten) felder.quelle     = FONT_QUELLEN.includes(daten.quelle) ? daten.quelle : "lokal";
  if ("gewichte"   in daten) felder.gewichte   = String(daten.gewichte || "").replace(/[^0-9;]/g, "");
  if ("zwecke"     in daten) felder.zwecke     = Array.isArray(daten.zwecke) ? daten.zwecke.filter((z) => FONT_ZWECKE.includes(z)) : [];
  if ("notiz"      in daten) felder.notiz      = String(daten.notiz || "").trim();
  if ("link"       in daten) felder.link       = String(daten.link || "").trim();
  if ("probetext"  in daten) felder.probetext  = String(daten.probetext || "").trim();
  if ("angeheftet" in daten) felder.angeheftet = !!daten.angeheftet;
  return felder;
}

export async function fontAnlegen(daten) {
  return addDoc(fontsCol(), {
    name: "", familie: "", quelle: "lokal", gewichte: "", zwecke: [],
    notiz: "", link: "", probetext: "", angeheftet: false,
    ...normFontFelder(daten),
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereFont(id, felder) {
  return updateDoc(doc(db, "fonts", id), {
    ...normFontFelder(felder),
    aktualisiertAm: serverTimestamp()
  });
}

export async function loescheFont(id) {
  return deleteDoc(doc(db, "fonts", id));
}

export function beobachteFonts(callback, onError) {
  return onSnapshot(
    query(fontsCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
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
export async function mindmapAnlegen({ name, besitzer, mitglieder, kundeId }) {
  return addDoc(mindmapsCol(), {
    name:       name || "Neue Map",
    besitzer:   (besitzer || "").toLowerCase(),
    mitglieder: Array.isArray(mitglieder) ? mitglieder.map((e) => String(e).toLowerCase()) : [],
    kundeId:    kundeId || null,   // Mandant, zu dem diese Mindmap gehört
    erstelltAm: serverTimestamp()
  });
}

// kundeId (optional): nur die Mindmaps EINES Kunden (where; kein orderBy →
// Client sortiert). Ohne kundeId: alle Mindmaps (orderBy) — für globale Sichten.
export function beobachteMindmaps(callback, onError, kundeId) {
  const q = kundeId
    ? query(mindmapsCol(), where("kundeId", "==", kundeId))
    : query(mindmapsCol(), orderBy("erstelltAm", "asc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
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

export async function benachrichtigungAnlegen({ fuer, von, text, videoId, art, gruppe }) {
  const daten = {
    fuer:       (fuer || "").toLowerCase(),
    von:        (von || "").toLowerCase(),
    text:       text || "",
    gelesen:    false,
    erstelltAm: serverTimestamp()
  };
  // Optionale Verknüpfung → Glocken-Item wird zum Video klickbar.
  if (videoId) daten.videoId = videoId;
  if (art)     daten.art = art;
  // gruppe: verbindet die pro-E-Mail-Kopien EINER Kunden-News, damit der Admin
  // sie als ein Item ansehen/löschen kann (siehe admin-kunde-feed.js).
  if (gruppe)  daten.gruppe = gruppe;
  return addDoc(benachrichtigungenCol(), daten);
}

// Meldet eine Kunden-Aktivität an den Admin (Glocke). Fire-and-forget-tauglich.
// Empfänger ist die (einzige) Admin-Adresse aus roles.js.
export async function benachrichtigeAdmin({ von, text, videoId, art }) {
  return benachrichtigungAnlegen({ fuer: ADMIN_EMAILS[0], von, text, videoId, art });
}

// Benachrichtigt ALLE Login-Adressen eines Kunden (Glocke + News-Dashboard).
// Ein Kunde kann mehrere E-Mails haben (kunden/{id}.emails[]) → pro Adresse ein
// Doc. `von` = die eingeloggte Admin-Adresse (Rules verlangen von == auth-email).
// Fire-and-forget-tauglich; wirft nicht, wenn Kunde/Emails fehlen.
export async function benachrichtigeKunde(kundeId, { text, videoId, art } = {}) {
  if (!kundeId) return;
  const von = (auth.currentUser && auth.currentUser.email) || ADMIN_EMAILS[0];
  let kunde = null;
  try { kunde = await ladeKunde(kundeId); } catch (_) { return; }
  const emails = (kunde && Array.isArray(kunde.emails)) ? kunde.emails : [];
  // Gemeinsame Gruppen-ID über alle E-Mail-Kopien dieser einen News.
  const gruppe = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `g${Date.now()}-${emails.length}`;
  await Promise.all(emails.map((email) =>
    benachrichtigungAnlegen({ fuer: email, von, text, videoId, art, gruppe }).catch(() => {})
  ));
}

// Admin: die Neuigkeiten EINES Kunden (alle E-Mail-Kopien) live beobachten —
// für die per-Kunde-News-Verwaltung. `in`-Query über die (wenigen) Login-Mails;
// der Aufrufer dedupliziert über `gruppe`. Kein orderBy → Client sortiert.
export function beobachteBenachrichtigungenFuerKunde(kunde, callback, onError) {
  const emails = (kunde && Array.isArray(kunde.emails))
    ? kunde.emails.map((e) => String(e).toLowerCase()).filter(Boolean).slice(0, 30)
    : [];
  if (!emails.length) { callback([]); return () => {}; }
  return onSnapshot(
    query(benachrichtigungenCol(), where("fuer", "in", emails)),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// Admin löscht eine News (alle übergebenen Kopie-IDs) in einem Batch.
export async function loescheBenachrichtigungen(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, "benachrichtigungen", id)));
  return batch.commit();
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

// Arten von Kunden-News, die eine HANDLUNG (Freigabe) einfordern und damit
// „erledigt" werden können — im Gegensatz zu reinen Infos (z.B. 'gepostet').
const FREIGABE_ARTEN = ["version", "freigabe"];

// Eine Kunden-News gilt als erledigbare Freigabe-Aufforderung, wenn ihre `art`
// dazu passt ODER (Fallback für ältere/untypisierte News) der Text auf eine
// Freigabe hindeutet. Reine Infos ('gepostet') sind explizit ausgenommen.
export function istFreigabeAufforderung(n) {
  if (!n || !n.videoId) return false;
  if (n.art === "gepostet") return false;
  if (FREIGABE_ARTEN.includes(n.art)) return true;
  const t = String(n.text || "").toLowerCase();
  return t.includes("freigabe") || t.includes("freigeben");
}

// Nach einer Kunden-Reaktion (freigeben / ändern / verwerfen) alle offenen
// Freigabe-Aufforderungen dieses Kunden zu genau diesem Video als erledigt
// markieren. Persistenter Flag → bleibt auch korrekt, wenn später eine neue
// Version dasselbe Video wieder in Freigabe schickt (die alte News bleibt
// erledigt, nur die neue ist offen). Fire-and-forget-tauglich; still bei Fehler.
export async function erledigeFreigabeNews(email, videoId) {
  const e = (email || "").trim().toLowerCase();
  if (!e || !videoId) return;
  const snap = await getDocs(query(
    benachrichtigungenCol(),
    where("fuer", "==", e),
    where("videoId", "==", videoId)
  ));
  const offen = snap.docs.filter((d) => {
    const n = d.data();
    return istFreigabeAufforderung({ ...n, videoId }) && n.erledigt !== true;
  });
  if (!offen.length) return;
  const batch = writeBatch(db);
  offen.forEach((d) => batch.update(d.ref, { erledigt: true }));
  return batch.commit();
}

// =====================================================================
// SKRIPTUPLOADS — vom Kunden hochgeladene überarbeitete Skripte (Word/PDF)
// Eigene Collection (NICHT dateiblobs — dort darf der Kunde nicht schreiben;
// NICHT als Kommentar — sonst zöge der pipeline-weite collectionGroup-Listener
// das Base64 mit). Ein Doc = eine hochgeladene Skript-Datei:
//   { videoId, kundeId, gemeldetVon, dateiName, dateiTyp, base64,
//     text (offline extrahiert), erledigt, erstelltAm }
// Rechte: Kunde legt im eigenen Namen an; Admin liest/erledigt/löscht.
// =====================================================================
const skriptUploadsCol = () => collection(db, "skriptuploads");

// `erledigt` ist der Badge-Schalter der Pipeline: Kunden-Uploads starten offen
// (false → 📄-Badge), Uploads des Admins gelten sofort als erledigt — sonst
// würde Valentin sich selbst anbadgen.
export async function skriptUploadAnlegen({ videoId, kundeId, gemeldetVon, dateiName, dateiTyp, base64, text, erledigt }) {
  return addDoc(skriptUploadsCol(), {
    videoId:     videoId || null,
    kundeId:     kundeId || null,
    gemeldetVon: (gemeldetVon || "").toLowerCase(),
    dateiName:   dateiName || "skript",
    dateiTyp:    dateiTyp || "application/octet-stream",
    base64:      base64 || "",
    text:        text || "",
    erledigt:    !!erledigt,
    erstelltAm:  serverTimestamp()
  });
}

// Uploads eines Videos live beobachten (Admin + Eigentümer-Kunde). Kein orderBy
// → Client sortiert.
export function beobachteSkriptUploads(videoId, callback, onError) {
  return onSnapshot(
    query(skriptUploadsCol(), where("videoId", "==", videoId)),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// Offene (nicht erledigte) Uploads ALLER Videos — für den Pipeline-Badge.
// Bewusst nur erledigt==false: die Docs tragen Base64-Blobs (bis ~700 KB),
// offene sind aber typischerweise nur eine Handvoll.
export function beobachteOffeneSkriptUploads(callback, onError) {
  return onSnapshot(
    query(skriptUploadsCol(), where("erledigt", "==", false)),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function setzeSkriptUploadErledigt(id, erledigt) {
  return updateDoc(doc(db, "skriptuploads", id), { erledigt: !!erledigt });
}

export async function loescheSkriptUpload(id) {
  return deleteDoc(doc(db, "skriptuploads", id));
}

// =====================================================================
// FEEDBACK — Mini-Feedback-Box des Kunden (schwebend, seiten-bewusst)
// Ein Doc = ein Feedback-Eintrag:
//   { kundeId, gemeldetVon, text, seite (Hash-Route), seiteLabel,
//     erledigt, erstelltAm }
// Rechte: Kunde legt im eigenen Namen an; Admin liest/erledigt/löscht.
// =====================================================================
const feedbackCol = () => collection(db, "feedback");

export async function feedbackAnlegen({ kundeId, gemeldetVon, text, seite, seiteLabel }) {
  return addDoc(feedbackCol(), {
    kundeId:     kundeId || null,
    gemeldetVon: (gemeldetVon || "").toLowerCase(),
    text:        text || "",
    seite:       seite || "",
    seiteLabel:  seiteLabel || "",
    erledigt:    false,
    erstelltAm:  serverTimestamp()
  });
}

export function beobachteFeedback(kundeId, callback, onError) {
  const q = kundeId
    ? query(feedbackCol(), where("kundeId", "==", kundeId))
    : query(feedbackCol(), orderBy("erstelltAm", "desc"));
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

export async function setzeFeedbackErledigt(id, erledigt) {
  return updateDoc(doc(db, "feedback", id), { erledigt: !!erledigt });
}

export async function loescheFeedback(id) {
  return deleteDoc(doc(db, "feedback", id));
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

// =====================================================================
// KUNDEN + KUNDENMITGLIEDER — Mandanten (Kundenprofile) des Arbeitsportals
//
// Ein Kunde ist ein echtes Datenobjekt:
//   kunden/{kundeId}         : { name, emails[], erstelltAm, aktualisiertAm }
//                              Stammdaten + Quelle für die Admin-UI/Anzeige.
//   kundenmitglieder/{email} : { kundeId }
//                              INVERTIERTER Lookup (analog kollaboratoren/{email}).
//                              Das ist die für die Security Rules AUTORITATIVE
//                              Mitgliedschaft (Rules können nicht queryen; ein
//                              O(1)-get per E-Mail liefert den Kunden). MUSS immer
//                              synchron zu kunden.emails[] bleiben → deshalb wird
//                              beides ausschließlich über kundeSpeichern() (ein
//                              writeBatch) geschrieben.
//
// Jeder kundenbezogene Datensatz (videos/objekte/termine/plaene/gedanken/
// mindmaps) trägt ein Feld `kundeId`, das auf kunden/{kundeId} verweist.
// =====================================================================
const kundenCol           = () => collection(db, "kunden");

export function beobachteKunden(callback, onError) {
  return onSnapshot(
    query(kundenCol(), orderBy("erstelltAm", "asc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function ladeKunde(id) {
  const d = await getDoc(doc(db, "kunden", id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

// Rollen-Lookup: zu welchem Kunden gehört diese E-Mail? (null = keiner)
// Spiegelbild von ladeKollaborator — von auth.js zur Rollenauflösung genutzt.
export async function ladeKundenmitglied(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const d = await getDoc(doc(db, "kundenmitglieder", e));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

// Kunde anlegen ODER bearbeiten. Hält kunden/{id} und kundenmitglieder/{email}
// in EINEM Batch synchron (Single Source of Truth für die Rules). `altEmails` =
// die vorher gespeicherten E-Mails, damit entfernte Mitglieds-Docs gelöscht
// werden. `istNeu` setzt erstelltAm nur bei der Erstanlage.
export async function kundeSpeichern({ id, name, emails, altEmails, istNeu, driveOrdner, kundenart }) {
  const kundeId = (id || "").trim().toLowerCase();
  if (!kundeId) throw new Error("kundeId fehlt");
  const norm = (arr) => Array.from(new Set(
    (arr || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  ));
  const neu = norm(emails);
  const alt = norm(altEmails);

  const batch = writeBatch(db);
  const kundeDaten = { name: name || kundeId, emails: neu, aktualisiertAm: serverTimestamp() };
  if (istNeu) kundeDaten.erstelltAm = serverTimestamp();
  // Nur bedingt schreiben: migriereAltbestand() ruft ohne driveOrdner/kundenart
  // auf — merge:true erhält dann den Bestandswert (und Firestore mag kein undefined).
  if (typeof driveOrdner === "string") kundeDaten.driveOrdner = driveOrdner.trim();
  if (typeof kundenart === "string" && kundenart) kundeDaten.kundenart = kundenart;
  batch.set(doc(db, "kunden", kundeId), kundeDaten, { merge: true });

  // Neue/bestehende Mitglieder eintragen …
  neu.forEach((e) => batch.set(doc(db, "kundenmitglieder", e), { kundeId }, { merge: true }));
  // … entfernte Mitglieder löschen.
  alt.filter((e) => !neu.includes(e)).forEach((e) => batch.delete(doc(db, "kundenmitglieder", e)));

  await batch.commit();
  return kundeId;
}

// =====================================================================
// MIGRATION — einmalige Zuordnung des Altbestands zum Kunden „deussen".
//
// Läuft im Browser unter Admin-Rechten (kein Admin-SDK nötig). Idempotent:
// es werden NUR Dokumente ohne gesetzte kundeId angefasst — ein zweiter Lauf
// ist ein No-op. `seedEmails` = die echten Kunden-Adressen (ohne Test-Zugänge),
// die dem Kunden deussen als Login-E-Mails zugeordnet werden.
// =====================================================================
export async function migriereAltbestand(seedEmails) {
  // 1) Kunde „deussen" + kundenmitglieder sicherstellen (Name/erstelltAm bei
  //    Wiederholung bewahren; entfernte Seed-Adressen sauber abräumen).
  const vorhanden = await ladeKunde("deussen");
  await kundeSpeichern({
    id:       "deussen",
    name:     (vorhanden && vorhanden.name) || "Deussen Immobilien",
    emails:   seedEmails || [],
    altEmails: (vorhanden && vorhanden.emails) || [],
    istNeu:   !vorhanden
  });

  // 2) Alle kundenbezogenen Collections: Docs OHNE kundeId auf „deussen" setzen.
  const namen = ["videos", "objekte", "termine", "plaene", "gedanken", "mindmaps"];
  const bericht = {};
  for (const name of namen) {
    const snap = await getDocs(collection(db, name));
    const ohne = snap.docs.filter((d) => !d.data().kundeId);   // fehlt oder null → migrieren
    bericht[name] = ohne.length;
    for (let i = 0; i < ohne.length; i += 450) {   // Firestore-Batch-Limit 500
      const batch = writeBatch(db);
      ohne.slice(i, i + 450).forEach((d) => batch.update(d.ref, { kundeId: "deussen" }));
      await batch.commit();
    }
  }
  return bericht;
}

// =====================================================================
// ÖFFENTLICHE WEBSITE — Video-Posts, Vorschaubilder, Startseiten-Baukasten
//
// Diese drei Collections sind die EINZIGEN, die vale-video.de ohne Login
// liest (siehe firestore.rules). Was hier landet, ist öffentlich.
//
// webvideos/{id}   ein Post: Link + Titel/Beschreibung/Kategorie
// webthumbs/{id}   base64-Vorschaubild (getrennt, damit die Listen-Query
//                  der Website klein bleibt)
// webseite/startseite  Kachel-Anordnung der Startseite
// =====================================================================
const webvideosCol = () => collection(db, "webvideos");
const webthumbsCol = () => collection(db, "webthumbs");

export const WEB_KATEGORIEN = ["imagefilm", "reels", "objekt", "persoenlich"];

export async function webvideoAnlegen(daten) {
  return addDoc(webvideosCol(), {
    titel:        daten.titel || "",
    untertitel:   daten.untertitel || "",
    beschreibung: daten.beschreibung || "",
    url:          daten.url || "",
    plattform:    daten.plattform || "andere",
    kategorie:    WEB_KATEGORIEN.includes(daten.kategorie) ? daten.kategorie : "reels",
    art:          daten.art || "",
    ort:          daten.ort || "",
    thumbUrl:     daten.thumbUrl || "",
    thumbId:      daten.thumbId || "",
    hochformat:   daten.hochformat === true,
    ordnerId:     daten.ordnerId || null,    // null = „ohne Ordner", steht oben
    reihenfolge:  Number.isFinite(daten.reihenfolge) ? daten.reihenfolge : Date.now(),
    veroeffentlicht: daten.veroeffentlicht !== false,   // Default: sofort live
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function aktualisiereWebvideo(id, felder) {
  return updateDoc(doc(db, "webvideos", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

// Löscht den Post samt zugehörigem Vorschaubild — sonst bliebe der Blob
// als Waise in webthumbs liegen.
export async function loescheWebvideo(id, thumbId) {
  if (thumbId) await deleteDoc(doc(db, "webthumbs", thumbId)).catch(() => {});
  return deleteDoc(doc(db, "webvideos", id));
}

// Admin-Sicht: ALLE Posts inkl. Entwürfe (die Rules lassen das für Admin zu).
export function beobachteWebvideos(callback, onError) {
  return onSnapshot(
    query(webvideosCol(), orderBy("erstelltAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// --- Vorschaubilder ---------------------------------------------------
// Nur nötig, wo die Plattform kein Thumbnail hergibt (TikTok/Instagram).
export async function webthumbAnlegen({ base64, typ }) {
  const ref = await addDoc(webthumbsCol(), {
    base64, typ: typ || "image/webp", erstelltAm: serverTimestamp()
  });
  return ref.id;
}

export async function ladeWebthumb(id) {
  const s = await getDoc(doc(db, "webthumbs", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// --- Startseiten-Baukasten -------------------------------------------
// Ein Singleton-Doc. `kacheln` ist der veröffentlichte Stand (den die
// Website liest), `entwurf` der Arbeitsstand im Baukasten.
const startseiteRef = () => doc(db, "webseite", "startseite");

export function beobachteStartseite(callback, onError) {
  return onSnapshot(
    startseiteRef(),
    (s) => callback(s.exists() ? s.data() : { kacheln: [], entwurf: null }),
    onError || (() => {})
  );
}

export async function speichereStartseiteEntwurf(kacheln) {
  return setDoc(startseiteRef(), { entwurf: kacheln, aktualisiertAm: serverTimestamp() }, { merge: true });
}

// Entwurf → live. Danach ist `entwurf` bewusst geleert, damit der Baukasten
// nicht dauerhaft „ungespeicherte Änderungen" suggeriert.
export async function veroeffentlicheStartseite(kacheln) {
  return setDoc(startseiteRef(), {
    kacheln, entwurf: null, veroeffentlichtAm: serverTimestamp()
  }, { merge: true });
}

// =====================================================================
// PORTFOLIO-ORDNER — die Abschnitte auf portfolio.html
//
// Ein Ordner = eine Sektion mit Überschrift. Die Zugehörigkeit steht am
// ELEMENT (webvideos.ordnerId bzw. webstatisch.ordnerId), nicht als
// Mitgliederliste im Ordner: beim Verschieben ändert sich so genau ein
// Dokument, und ein Element kann nie in zwei Ordnern gleichzeitig hängen.
// =====================================================================
const webordnerCol   = () => collection(db, "webordner");
const webstatischCol = () => collection(db, "webstatisch");

export async function ordnerAnlegen({ name, beschreibung, reihenfolge }) {
  return addDoc(webordnerCol(), {
    name: name || "Neuer Abschnitt",
    beschreibung: beschreibung || "",
    reihenfolge: Number.isFinite(reihenfolge) ? reihenfolge : Date.now(),
    erstelltAm: serverTimestamp()
  });
}

export async function aktualisiereOrdner(id, felder) {
  return updateDoc(doc(db, "webordner", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

// Ordner löschen und seine Mitglieder freistellen: sie landen wieder in
// „ohne Ordner" (oben auf der Seite) statt unsichtbar zu werden.
export async function loescheOrdner(id) {
  const batch = writeBatch(db);
  const [videos, statisch] = await Promise.all([
    getDocs(query(webvideosCol(),   where("ordnerId", "==", id))),
    getDocs(query(webstatischCol(), where("ordnerId", "==", id)))
  ]);
  videos.docs.forEach((d)   => batch.update(d.ref, { ordnerId: null }));
  statisch.docs.forEach((d) => batch.update(d.ref, { ordnerId: null }));
  batch.delete(doc(db, "webordner", id));
  return batch.commit();
}

export function beobachteOrdner(callback, onError) {
  return onSnapshot(
    webordnerCol(),
    (snap) => callback(snapToArr(snap).sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0))),
    onError || (() => {})
  );
}

// --- Einsortierung der 7 statischen Projektseiten ---------------------
// Doc-ID ist der Slug der Seite (z.B. "projekt-amsterdam"), damit die
// Zuordnung idempotent geschrieben werden kann.
export async function setzeStatischZuordnung(ref, { ordnerId, reihenfolge }) {
  const slug = String(ref).replace(/\.html$/, "");
  return setDoc(doc(db, "webstatisch", slug), {
    ref, ordnerId: ordnerId || null,
    reihenfolge: Number.isFinite(reihenfolge) ? reihenfolge : 0,
    aktualisiertAm: serverTimestamp()
  }, { merge: true });
}

export function beobachteStatisch(callback, onError) {
  return onSnapshot(webstatischCol(), (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

// =====================================================================
// BRANDSKRIPTE — Personal-Brand-Skriptwerkstatt (Admin-only)
//
// Ein Dokument = ein geplantes eigenes Video, vom Rohskript bis zum Dreh.
// Bewusst NICHT an /videos oder /plaene gehängt: dort steckt die komplette
// Kunden-Maschinerie (Freigabe-Stufen, Entwurfsnummern, planSnapshot), von
// der hier nichts gebraucht wird.
//
//   titel      (string)
//   plattform  ('reel'|'short'|'tiktok'|'youtube'|'linkedin')
//   status     ('idee'|'rohfassung'|'drehreif'|'gedreht'|'veroeffentlicht')
//   text       (string)  — der aktuelle Arbeitstext (Rohskript / KI-Fassung)
//   kiPrompt   (string)  — Prompt-Vorlage für „Mit KI-Prompt kopieren"
//   fassungen  (array)   — Verlauf [{ text, notiz, erstelltAm: ISO-String }]
//   takes      (array)   — Dreh-Einheiten, s. brandplan.js (leererTake)
//   broll      (array)   — B-Roll-Bänder über einen Take-Bereich (vonTid…bisTid)
//   checkliste (object)  — { hook, kernaussage, cta: tid|null,
//                            caption, hashtags, postDatum: string }
//   notiz      (string)
//
// serverTimestamp() ist in Array-Elementen nicht erlaubt — Zeitstempel
// innerhalb von `fassungen` sind deshalb ISO-Strings.
// Rechte: ausschließlich Admin (siehe firestore.rules: /brandskripte).
// =====================================================================
const brandskripteCol = () => collection(db, "brandskripte");

export async function brandSkriptAnlegen(daten = {}) {
  return addDoc(brandskripteCol(), {
    titel:      daten.titel || "",
    // Ein Video läuft oft auf mehreren Kanälen — deshalb eine Liste. Ältere
    // Dokumente mit einzelnem `plattform`-Feld liest brandplan.js weiterhin
    // (plattformenVon), sie müssen nicht angefasst werden.
    plattformen: Array.isArray(daten.plattformen) ? daten.plattformen : [],
    status:     daten.status || "idee",
    text:       daten.text || "",
    kiPrompt:   daten.kiPrompt || "",
    // Herkunfts-Format: die ID zeigt auf /formate, der Name wird mitkopiert,
    // damit Liste und Editor ihn ohne Nachladen anzeigen können (und er
    // erhalten bleibt, falls das Format später gelöscht wird).
    formatId:   daten.formatId || null,
    formatName: daten.formatName || "",
    fassungen:  [],
    takes:      Array.isArray(daten.takes) ? daten.takes : [],
    broll:      [],
    checkliste: daten.checkliste || {},
    notiz:      daten.notiz || "",
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function ladeBrandSkript(id) {
  const s = await getDoc(doc(db, "brandskripte", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function aktualisiereBrandSkript(id, felder) {
  return updateDoc(doc(db, "brandskripte", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheBrandSkript(id) {
  return deleteDoc(doc(db, "brandskripte", id));
}

export function beobachteBrandSkripte(callback, onError) {
  return onSnapshot(
    query(brandskripteCol(), orderBy("aktualisiertAm", "desc")),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

// =====================================================================
// FORMATE — wiederverwendbare Baupläne für eigene Videos (Admin-only)
//
// Ein Format ist ein Rezept, keine Linksammlung: seine `beats` werden beim
// Anlegen eines Skripts direkt zum Take-Gerüst (brandplan.js → takesAusFormat).
//
//   name           (string)
//   beschreibung   (string)  — wofür das Format gut ist
//   plattformen    (array)   — Plattform-IDs, für die es taugt
//   talkingHead    (bool)    — muss ich dafür vor die Kamera?
//   materialBedarf (string)  — welches Footage gebraucht wird
//   aufwand        ('schnell'|'mittel'|'gross')
//   beats          (array)   — [{ bid, label, hinweis, groesse, perspektive, bewegung, dauer }]
//   hooks          (array)   — Hook-Vorlagen [{ hid, text }]
//   inspirationIds (array)   — Referenzen auf /inspirationen (keine Doppelpflege)
//   links          (array)   — zusätzliche Referenz-Links [{ url }]
//
// Rechte: ausschließlich Admin (siehe firestore.rules: /formate).
// =====================================================================
const formateCol = () => collection(db, "formate");

// Die Feldliste eines Formats — geteilt von /formate (Personal Brand) und
// /kundenformate (pro Kunde), damit beide garantiert dieselbe Struktur haben
// und EINE View beide bedienen kann.
function formatFelder(daten = {}) {
  return {
    name:           daten.name || "",
    beschreibung:   daten.beschreibung || "",
    plattformen:    Array.isArray(daten.plattformen) ? daten.plattformen : [],
    talkingHead:    daten.talkingHead !== false,
    materialBedarf: daten.materialBedarf || "",
    aufwand:        daten.aufwand || "mittel",
    beats:          Array.isArray(daten.beats) ? daten.beats : [],
    hooks:          Array.isArray(daten.hooks) ? daten.hooks : [],
    inspirationIds: Array.isArray(daten.inspirationIds) ? daten.inspirationIds : [],
    links:          Array.isArray(daten.links) ? daten.links : []
  };
}

export async function formatAnlegen(daten = {}) {
  return addDoc(formateCol(), {
    ...formatFelder(daten),
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

export async function ladeFormat(id) {
  const s = await getDoc(doc(db, "formate", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function ladeFormate() {
  const snap = await getDocs(query(formateCol(), orderBy("name")));
  return snapToArr(snap);
}

export async function aktualisiereFormat(id, felder) {
  return updateDoc(doc(db, "formate", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheFormat(id) {
  return deleteDoc(doc(db, "formate", id));
}

export function beobachteFormate(callback, onError) {
  return onSnapshot(
    formateCol(),
    (snap) => callback(snapToArr(snap).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"))),
    onError || (() => {})
  );
}

// =====================================================================
// KUNDENFORMATE — dieselben Baupläne, aber PRO KUNDE.
//
// Eigene Collection statt eines kundeId-Feldes an /formate: gehoertMir()
// faellt bei fehlendem Feld auf 'deussen' zurueck (Altbestand-Netz), und
// Valentins Personal-Brand-Formate haben kein kundeId — sie waeren damit
// fuer Deussen-Logins lesbar geworden. Die Trennung ist die sichere Variante
// und spart zugleich eine Migration des Altbestands.
//
// Felder wie /formate (formatFelder) plus:
//   kundeId (string) — Pflicht. Die Rules vergleichen direkt dagegen; fehlt
//                      das Feld, schlaegt der Lesezugriff fehl (fail-closed).
//
// Rechte: Admin schreibt, der Kunde liest seine eigenen (firestore.rules).
// =====================================================================
const kundenformateCol = () => collection(db, "kundenformate");

export async function kundenformatAnlegen(kundeId, daten = {}) {
  if (!kundeId) throw new Error("kundenformatAnlegen: kundeId fehlt");
  return addDoc(kundenformateCol(), {
    ...formatFelder(daten),
    kundeId,
    erstelltAm:     serverTimestamp(),
    aktualisiertAm: serverTimestamp()
  });
}

// Sortiert wird bewusst im Client: ein where + orderBy braeuchte einen
// zusammengesetzten Index, der eigens deployt werden muesste.
export async function ladeKundenformate(kundeId) {
  if (!kundeId) return [];
  const snap = await getDocs(query(kundenformateCol(), where("kundeId", "==", kundeId)));
  return snapToArr(snap)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"));
}

export async function aktualisiereKundenformat(id, felder) {
  return updateDoc(doc(db, "kundenformate", id), { ...felder, aktualisiertAm: serverTimestamp() });
}

export async function loescheKundenformat(id) {
  return deleteDoc(doc(db, "kundenformate", id));
}

// =====================================================================
// TRAINING — Valentins eigene Einheiten (Springseil-Timer). Rein privat:
// die Rules geben `training` und `trainingKonfig` nur dem Admin.
// Ein Dokument = eine absolvierte Einheit; `trainingKonfig/<art>` hält die
// zuletzt benutzten Timer-Einstellungen, damit sie auf jedem Gerät gleich sind.
// =====================================================================
const trainingCol = () => collection(db, "training");

export async function speichereTraining(daten) {
  return addDoc(trainingCol(), { ...daten, erstelltAm: serverTimestamp() });
}

// Neueste zuerst. `anzahl` begrenzt, damit die Historie nach Jahren nicht
// unbemerkt zu einem Megabyte-Download wird.
export function beobachteTrainings(callback, onError, anzahl = 400) {
  return onSnapshot(
    query(trainingCol(), orderBy("erstelltAm", "desc"), limit(anzahl)),
    (snap) => callback(snapToArr(snap)),
    onError || (() => {})
  );
}

export async function loescheTraining(id) {
  return deleteDoc(doc(db, "training", id));
}

export async function ladeTrainingKonfig(art) {
  const snap = await getDoc(doc(db, "trainingKonfig", art));
  return snap.exists() ? snap.data() : null;
}

export async function speichereTrainingKonfig(art, konfig) {
  return setDoc(doc(db, "trainingKonfig", art), { ...konfig, aktualisiertAm: serverTimestamp() });
}

// =====================================================================
// SOCIAL — Kennzahlen der Kunden-Accounts (Instagram, spaeter TikTok/YouTube).
//
// Drei Collections, alle mit `kundeId` und `plattform`:
//   socialkonten/{kundeId}_{plattform}
//     kundeId, plattform, handle, externeId, status, verbundenAm,
//     letzterAbruf, letzterFehler
//   socialsnapshots/{kundeId}_{plattform}_{YYYY-MM-DD}
//     kundeId, plattform, tag, follower, reichweite, profilaufrufe,
//     quelle('api'|'manuell'), erfasstAm
//   socialposts/{kundeId}_{plattform}_{externeId}
//     kundeId, plattform, externeId, permalink, thumbnail, typ,
//     veroeffentlichtAm, likes, kommentare, saves, shares, reichweite,
//     views, videoId, quelle, aktualisiertAm
//
// GESCHRIEBEN werden diese Collections normalerweise vom PHP-Connector
// (api/cron-social.php) ueber ein Google-Dienstkonto — das laeuft an den
// Rules vorbei (IAM). Von hier aus schreibt nur der Admin: manuelle
// Nacherfassung und das Verknuepfen eines Posts mit einem eigenen Video.
//
// Rechte (firestore.rules): lesen darf der eigene Mandant (gehoertMir),
// schreiben nur der Admin.
//
// Doc-IDs sind bewusst zusammengesetzt statt automatisch: derselbe Tag
// bzw. derselbe Post ergibt immer dasselbe Dokument, ein doppelter
// Cron-Lauf kann also nichts verdoppeln.
// =====================================================================
const socialKontenCol   = () => collection(db, "socialkonten");
const socialSnapshotCol = () => collection(db, "socialsnapshots");
const socialPostCol     = () => collection(db, "socialposts");

// Die ID-Bildung steht hier EINMAL — der PHP-Connector bildet dieselben IDs.
// Weicht eine der beiden Seiten ab, entstehen stumme Doppel-Dokumente.
export function socialKontoId(kundeId, plattform) {
  return `${kundeId}_${plattform}`;
}
export function socialSnapshotId(kundeId, plattform, tag) {
  return `${kundeId}_${plattform}_${tag}`;
}
export function socialPostId(kundeId, plattform, externeId) {
  return `${kundeId}_${plattform}_${externeId}`;
}

// Kein orderBy neben dem kundeId-Filter (spart den Composite-Index, wie
// ueberall hier) und bewusst auch kein limit: ein Snapshot pro Tag sind
// ~365 winzige Dokumente im Jahr, das faellt selbst nach Jahren nicht ins
// Gewicht. Sortiert wird im Client (socialstat.js).
export function beobachteSocialKonten(callback, onError, kundeId) {
  const q = kundeId ? query(socialKontenCol(), where("kundeId", "==", kundeId)) : socialKontenCol();
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

export function beobachteSocialSnapshots(callback, onError, kundeId) {
  const q = kundeId ? query(socialSnapshotCol(), where("kundeId", "==", kundeId)) : socialSnapshotCol();
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

export function beobachteSocialPosts(callback, onError, kundeId) {
  const q = kundeId ? query(socialPostCol(), where("kundeId", "==", kundeId)) : socialPostCol();
  return onSnapshot(q, (snap) => callback(snapToArr(snap)), onError || (() => {}));
}

// Manuelle Nacherfassung eines Tageswerts. `quelle: "manuell"` ist kein
// Schmuck: der Connector liest das Feld und laesst solche Tage in Ruhe,
// damit ein spaeterer API-Lauf die Handeingabe nicht ueberschreibt.
export async function speichereSocialSnapshot(kundeId, plattform, tag, werte) {
  const id = socialSnapshotId(kundeId, plattform, tag);
  return setDoc(doc(db, "socialsnapshots", id), {
    kundeId,
    plattform,
    tag,
    follower:      Number.isFinite(Number(werte.follower))      ? Number(werte.follower)      : 0,
    reichweite:    Number.isFinite(Number(werte.reichweite))    ? Number(werte.reichweite)    : 0,
    profilaufrufe: Number.isFinite(Number(werte.profilaufrufe)) ? Number(werte.profilaufrufe) : 0,
    quelle:        "manuell",
    erfasstAm:     serverTimestamp()
  }, { merge: true });
}

export async function loescheSocialSnapshot(id) {
  return deleteDoc(doc(db, "socialsnapshots", id));
}

// Verknuepft einen Post mit einem eigenen Video (oder loest die Verknuepfung).
// Das ist Handarbeit und darf vom naechtlichen Lauf nie ueberschrieben
// werden — deshalb steht `videoId` beim Connector nicht in der updateMask.
export async function setzeSocialPostVideo(id, videoId) {
  return updateDoc(doc(db, "socialposts", id), {
    videoId: videoId || null,
    aktualisiertAm: serverTimestamp()
  });
}

// =====================================================================
// ROADMAP — Valentins Geschäfts-Roadmap (Phasen, Haken, Monatsumsatz).
// Streng privat: die Rules geben `roadmap` nur dem Admin.
//
// EIN Dokument, kein Collection-Wachstum — roadmap/valentin:
//   done     { "<meilenstein-id>": true }   nur gesetzte Haken; ein
//                                           entfernter Haken wird geloescht,
//                                           nicht auf false gesetzt.
//   revenue  { "YYYY-MM": 1250 }            Netto-Umsatz je Monat, von Hand
//                                           eingetragen. Frühere Monate
//                                           bleiben stehen (Historie).
//   week     { mode, done: { "<isoweek>:<mode>:<index>": true } }
//   kurs     { "<lesson-id>": true }         Fortschritt der Kurs-View. Liegt
//                                           BEWUSST im selben Dokument: so
//                                           braucht der Kurs keine eigene
//                                           Collection und keine eigene Rule.
//   updatedAt
//
// Geschrieben wird IMMER mit merge:true — sonst würde ein einzelner Haken
// den Umsatz mitloeschen. Aufbau wie bei trainingKonfig.
// =====================================================================
const ROADMAP_ID = "valentin";
const roadmapDoc = () => doc(db, "roadmap", ROADMAP_ID);

// Liest das Dokument. Fehlt es noch (erster Aufruf), wird es leer angelegt,
// damit die View nicht zwischen "leer" und "gibt es nicht" unterscheiden muss.
export async function getRoadmap() {
  const snap = await getDoc(roadmapDoc());
  if (snap.exists()) {
    const d = snap.data();
    return { done: d.done || {}, revenue: d.revenue || {},
             week: d.week || { mode: "normal", done: {} },
             kurs: d.kurs || {} };
  }
  const leer = { done: {}, revenue: {}, week: { mode: "normal", done: {} }, kurs: {} };
  await setDoc(roadmapDoc(), { ...leer, updatedAt: serverTimestamp() }, { merge: true });
  return leer;
}

// Schreibt nur die uebergebenen Felder. `partial` ist z. B. { done } oder
// { revenue } — nie das ganze Objekt, damit parallele Aenderungen auf einem
// zweiten Geraet nicht ueberschrieben werden.
export async function saveRoadmap(partial) {
  return setDoc(roadmapDoc(), { ...partial, updatedAt: serverTimestamp() }, { merge: true });
}

// Sentinel zum Loeschen EINES Map-Eintrags. Noetig, weil merge:true
// verschachtelte Maps zusammenfuehrt statt sie zu ersetzen: ein entfernter
// Haken bliebe sonst stehen. Re-exportiert, damit die View kein
// Firestore-Modul importieren muss (siehe Kopf dieser Datei).
//   saveRoadmap({ done: { "p1-web": roadmapFeldWeg() } })
export function roadmapFeldWeg() {
  return deleteField();
}
