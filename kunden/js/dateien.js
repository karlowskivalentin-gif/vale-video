// =====================================================================
// Große Dateien in Firestore — ohne Firebase Storage.
//
// WARUM SO: Ein Firestore-Dokument darf max. 1 MiB groß sein, und Base64
// bläht Binärdaten um ein Drittel auf. Ein echtes Immobilien-Exposé (2–5 MB)
// passt deshalb weder in ein Dokument noch in die 700-KB-Anhänge aus
// docparse.js. Der Lehrbuchweg wäre Cloud Storage — der verlangt aber den
// Blaze-Plan (Zahlungsmittel), und das Projekt läuft auf Spark. Also wird die
// Datei in Blöcke zerlegt, jeder Block ist ein eigenes Dokument, und beim
// Öffnen wird sie wieder zusammengesetzt. Firestore trägt das gut: ein
// 2,5-MB-Exposé sind vier Blöcke, also vier Schreib- und vier Lesevorgänge.
//
// Datenmodell:
//   dateien/<dateiId>              { name, typ, groesse, teile, kundeId,
//                                    hochgeladenVon, erstelltAm }
//   dateien/<dateiId>/teile/<i>    { i, b64 }
//
// Sollte später doch Blaze aktiviert werden, ist der Austausch klein: dieses
// Modul gegen einen Storage-Upload tauschen, `expose.dateiId` gegen
// `expose.url` — die Views hängen nur an speichereDatei/ladeDatei.
// =====================================================================
import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Roh-Bytes pro Block. 500 KB werden als Base64 ~667 KB — mit komfortablem
// Abstand unter der 1-MiB-Grenze eines Firestore-Dokuments.
const BLOCK = 500 * 1024;

// Obergrenze für eine Einzeldatei. 10 MB = ~20 Blöcke; darüber wird das
// Zusammensetzen im Browser spürbar und der Ansatz unangemessen.
export const MAX_DATEI_GROSS = 10 * 1024 * 1024;

export const EXPOSE_TYPEN = ".pdf,.docx,.png,.jpg,.jpeg,.webp";

// Wie viele Blöcke gleichzeitig übertragen werden. Genug für Tempo, wenig
// genug, um schmale Mobilverbindungen nicht zu überfahren.
const PARALLEL = 4;

const dateienCol = () => collection(db, "dateien");

function bytesZuBase64(bytes) {
  // In Häppchen, weil String.fromCharCode(...) bei großen Arrays den Stack sprengt.
  let bin = "";
  const schritt = 8192;
  for (let i = 0; i < bytes.length; i += schritt) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + schritt));
  }
  return btoa(bin);
}

function base64ZuBytes(base64) {
  const bin = atob(base64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Aufgaben in Wellen abarbeiten (kein Promise.all über alles).
async function inWellen(aufgaben, breite, onFertig) {
  let erledigt = 0;
  for (let i = 0; i < aufgaben.length; i += breite) {
    await Promise.all(aufgaben.slice(i, i + breite).map(async (f) => {
      await f();
      erledigt++;
      if (onFertig) onFertig(erledigt / aufgaben.length);
    }));
  }
}

/**
 * Legt eine Datei blockweise in Firestore ab.
 * @param {File} file
 * @param {{kundeId?: string, hochgeladenVon?: string, onFortschritt?: (p:number)=>void}} opts
 * @returns {Promise<{dateiId,name,typ,groesse,teile}>} Verweis für das Objekt-Dokument.
 */
export async function speichereDatei(file, { kundeId, hochgeladenVon, onFortschritt } = {}) {
  if (!file) throw new Error("Keine Datei übergeben.");
  if (file.size > MAX_DATEI_GROSS) {
    throw new Error(`„${file.name}" ist ${Math.round(file.size / 1024 / 1024)} MB — max. ${MAX_DATEI_GROSS / 1024 / 1024} MB.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const teile = Math.max(1, Math.ceil(bytes.length / BLOCK));
  const kopf = doc(dateienCol());          // ID vorab erzeugen

  // Blöcke zuerst, Kopf-Dokument zuletzt: bricht der Upload ab, gibt es keinen
  // Kopf, der auf unvollständige Blöcke zeigt.
  const schreiber = [];
  for (let i = 0; i < teile; i++) {
    const stueck = bytes.subarray(i * BLOCK, Math.min((i + 1) * BLOCK, bytes.length));
    schreiber.push(() => setDoc(doc(collection(kopf, "teile"), String(i)), {
      i,
      b64: bytesZuBase64(stueck)
    }));
  }
  // Der Kopf ist der letzte Schritt — deshalb bleiben 5 % für ihn reserviert.
  await inWellen(schreiber, PARALLEL, (p) => onFortschritt && onFortschritt(p * 0.95));

  await setDoc(kopf, {
    name:           file.name || "datei",
    typ:            file.type || "application/octet-stream",
    groesse:        bytes.length,
    teile,
    kundeId:        kundeId || null,
    hochgeladenVon: hochgeladenVon || null,
    erstelltAm:     serverTimestamp()
  });
  if (onFortschritt) onFortschritt(1);

  return { dateiId: kopf.id, name: file.name || "datei", typ: file.type || "application/octet-stream", groesse: bytes.length, teile };
}

/**
 * Holt eine blockweise gespeicherte Datei zurück.
 * @returns {Promise<{base64,name,typ,groesse}>} base64 passt direkt in
 *          zeigeDateiInline()/base64ZuBlobUrl() aus docparse.js.
 */
export async function ladeDatei(dateiId, onFortschritt) {
  if (!dateiId) throw new Error("Keine dateiId übergeben.");
  const kopfRef = doc(db, "dateien", dateiId);
  const kopf = await getDoc(kopfRef);
  if (!kopf.exists()) throw new Error("Datei nicht gefunden.");
  const meta = kopf.data();

  const snap = await getDocs(collection(kopfRef, "teile"));
  const stuecke = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.i || 0) - (b.i || 0));
  if (stuecke.length !== meta.teile) {
    throw new Error(`Datei unvollständig (${stuecke.length} von ${meta.teile} Blöcken).`);
  }
  if (onFortschritt) onFortschritt(0.6);

  // Blöcke als Bytes zusammenfügen und EINMAL zu Base64 machen. Die Base64-
  // Teilstrings direkt aneinanderzuhängen wäre falsch, sobald ein Block keine
  // durch 3 teilbare Länge hat (Padding mitten im String).
  const gesamt = new Uint8Array(meta.groesse);
  let pos = 0;
  for (const s of stuecke) {
    const b = base64ZuBytes(s.b64);
    gesamt.set(b, pos);
    pos += b.length;
  }
  if (onFortschritt) onFortschritt(1);

  return { base64: bytesZuBase64(gesamt), name: meta.name, typ: meta.typ, groesse: meta.groesse };
}

// Datei samt Blöcken entfernen (Admin). Blöcke zuerst, damit kein Kopf ohne
// Inhalt zurückbleibt.
export async function loescheDateiKomplett(dateiId) {
  if (!dateiId) return;
  const kopfRef = doc(db, "dateien", dateiId);
  const snap = await getDocs(collection(kopfRef, "teile"));
  await inWellen(snap.docs.map((d) => () => deleteDoc(d.ref)), PARALLEL);
  await deleteDoc(kopfRef);
}
