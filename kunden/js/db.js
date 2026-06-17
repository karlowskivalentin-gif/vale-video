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
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
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
    geplantesDatum: daten.geplantesDatum || null,
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
