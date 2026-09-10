// =====================================================================
// Dokument-Parser + Datei-Viewer — rein clientseitig, keine API-Tokens.
//
// TEXT-EXTRAKTION (für Skript-Beats & Exposé-OCR):
//   extrahiereText(file) → Word (.docx) & PDF (pdf.js) direkt als Text;
//                          Bilder via OCR (tesseract, deutsch).
//   ocrBild(file)        → nur OCR (für den Exposé-Screenshot).
//
// Word (.docx) wird OHNE Fremdlib gelesen: die .docx ist ein ZIP; wir entpacken
// `word/document.xml` mit dem browsereigenen DecompressionStream('deflate-raw')
// und ziehen den Text aus den <w:t>-Knoten. (mammoth.js hängt im Browser-Bundle
// zuverlässig-unzuverlässig — dieser Weg ist schlank und robust.)
//
// DATEI-HANDLING (Base64 in Firestore, kein Firebase Storage — Cap ~700 KB):
//   dateiZuBase64(file)  → { base64 (ohne data:-Präfix), name, typ }
//   base64ZuBlobUrl(...) → blob:-URL (öffnet PDFs zuverlässig; anders als
//                          data:-URLs, die Chrome bei großen PDFs blockt)
//   zeigeDateiInline(el, {base64,typ,name}) → rendert Bild/Video/Audio/PDF
//                          (iframe) / Word (docx-preview, echtes Dokument) /
//                          Text (Absätze) / sonst Download.
//                          Gibt eine Cleanup-Funktion (revokeObjectURL) zurück.
// =====================================================================
import { escapeHtml } from "./util.js";
import { ladePdfJs, ladeTesseract, ladeDocxPreview } from "./libs.js";

export const MAX_DATEI = 700 * 1024;   // identisch zu admin-gedanken/admin-plan

function endetAuf(name, ...ext) {
  const n = String(name || "").toLowerCase();
  return ext.some((e) => n.endsWith(e));
}

// --- Datei → Text ---------------------------------------------------
export async function extrahiereText(file) {
  const typ = (file.type || "").toLowerCase();
  const name = file.name || "";
  if (typ.includes("wordprocessingml") || endetAuf(name, ".docx")) return textAusDocx(await file.arrayBuffer());
  if (typ === "application/pdf" || endetAuf(name, ".pdf"))          return textAusPdf(await file.arrayBuffer());
  if (typ.startsWith("image/") || endetAuf(name, ".png", ".jpg", ".jpeg", ".webp")) return ocrBild(file);
  if (endetAuf(name, ".doc")) throw new Error("Altes .doc-Format wird nicht unterstützt — bitte als .docx oder PDF speichern.");
  throw new Error("Nicht unterstützter Dateityp. Bitte Word (.docx), PDF oder ein Bild.");
}

// --- Word (.docx) ohne Fremdlib: ZIP entpacken + document.xml lesen ---
async function inflateRaw(u8) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Findet word/document.xml über das Central Directory und gibt sein XML zurück.
async function docxDocumentXml(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);
  const dec = new TextDecoder();

  // End Of Central Directory (rückwärts nach Signatur suchen).
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("Ungültige .docx-Datei (kein ZIP).");
  const cdOff = dv.getUint32(eocd + 16, true);
  const cdCount = dv.getUint16(eocd + 10, true);

  let p = cdOff, ziel = null;
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method   = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const fnLen = dv.getUint16(p + 28, true), exLen = dv.getUint16(p + 30, true), cmLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + fnLen));
    if (name === "word/document.xml") { ziel = { method, compSize, lho }; break; }
    p += 46 + fnLen + exLen + cmLen;
  }
  if (!ziel) throw new Error("word/document.xml nicht gefunden.");

  const lfnLen = dv.getUint16(ziel.lho + 26, true), lexLen = dv.getUint16(ziel.lho + 28, true);
  const dataStart = ziel.lho + 30 + lfnLen + lexLen;
  const comp = u8.subarray(dataStart, dataStart + ziel.compSize);
  const xmlBytes = ziel.method === 0 ? comp : await inflateRaw(comp);
  return dec.decode(xmlBytes);
}

// XML-Entities zurückübersetzen. &amp; MUSS zuletzt kommen, sonst wird aus dem
// Literal „&lt;" (= &amp;lt;) versehentlich ein echtes „<".
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Ein Absatz → Text. WICHTIG: nur das echte <w:t>-Tag treffen — nach „w:t" muss
// „>" oder ein Leerzeichen (Attribute wie xml:space="preserve") folgen. Ohne
// diese Grenze matchen auch <w:tbl>, <w:tblPr>, <w:tblW>, <w:tc>, <w:tcPr>,
// <w:tr>, <w:top> … und ziehen das komplette Tabellen-Markup als „Text" mit in
// die Ausgabe (genau das war der Bug bei Skripten mit Beat-Tabellen).
// <w:tab/> und <w:br/> stehen ZWISCHEN den <w:t>-Knoten — deshalb wird der
// Absatz in einem Durchlauf tokenisiert, damit die Reihenfolge stimmt.
const ABSATZ_TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\s*\/>/g;

function docxAbsatzZuText(p) {
  let out = "";
  for (const m of p.matchAll(ABSATZ_TOKEN)) {
    if (m[1] !== undefined)             out += decodeEntities(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else                                out += "\n";
  }
  return out;
}

function docxXmlZuText(xml) {
  return xml.split("</w:p>").map(docxAbsatzZuText).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function textAusDocx(arrayBuffer) {
  return docxXmlZuText(await docxDocumentXml(arrayBuffer));
}

async function textAusPdf(arrayBuffer) {
  const pdfjs = await ladePdfJs();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const seiten = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    seiten.push(content.items.map((it) => (it.str || "")).join(" "));
  }
  return seiten.join("\n").trim();
}

// OCR eines Bildes (deutsch). onFortschritt(0..1) optional für die UI.
export async function ocrBild(file, onFortschritt) {
  const Tesseract = await ladeTesseract();
  const res = await Tesseract.recognize(file, "deu", onFortschritt ? {
    logger: (m) => { if (m.status === "recognizing text" && typeof m.progress === "number") onFortschritt(m.progress); }
  } : undefined);
  return String(res && res.data && res.data.text || "").trim();
}

// --- Datei → Base64 (für Firestore) ---------------------------------
function leseDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export async function dateiZuBase64(file) {
  if (file.size > MAX_DATEI) {
    throw new Error(`„${file.name}" ist ${Math.round(file.size / 1024)} KB — max. ~700 KB.`);
  }
  const durl = await leseDataUrl(file);
  const komma = durl.indexOf(",");
  return {
    base64: komma >= 0 ? durl.slice(komma + 1) : durl,
    name:   file.name || "datei",
    typ:    file.type || "application/octet-stream"
  };
}

// --- Base64 → blob:-URL (zuverlässiges Öffnen, auch für PDFs) --------
function base64ZuBytes(base64) {
  const bin = atob(base64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
export function base64ZuBlobUrl(base64, typ) {
  return URL.createObjectURL(new Blob([base64ZuBytes(base64)], { type: typ || "application/octet-stream" }));
}

// Text (.txt/.md) → lesbare Absätze: Leerzeile trennt Absätze, einzelne
// Zeilenumbrüche bleiben als <br> erhalten (ein Skript lebt von seinen
// Zeilen). Markdown-Rauten am Zeilenanfang werden zur fetten Zeile — das
// Cockpit lädt Fassungen als .md hoch, dort stehen die Beat-Überschriften so.
function textZuAbsaetzen(text) {
  return String(text).replace(/\r\n/g, "\n").split(/\n{2,}/)
    .map((abs) => abs.split("\n").map((z) => {
      const h = /^\s*(#{1,6})\s+(.*)$/.exec(z);
      return h ? `<strong>${escapeHtml(h[2])}</strong>` : escapeHtml(z);
    }).join("<br>"))
    .filter((a) => a.trim())
    .map((a) => `<p>${a}</p>`).join("");
}

// --- Datei portal-eigen anzeigen ------------------------------------
// Rendert in `el` je nach MIME. Gibt eine Cleanup-Funktion zurück, die alle
// erzeugten blob:-URLs freigibt (via beiViewWechsel registrieren).
export function zeigeDateiInline(el, { base64, typ, name }) {
  if (!el) return () => {};
  const mime = (typ || "").toLowerCase();
  const urls = [];
  const blobUrl = () => { const u = base64ZuBlobUrl(base64, typ); urls.push(u); return u; };
  // Das DOCX-Rendern läuft asynchron weiter, auch wenn die View inzwischen
  // gewechselt ist. Dann darf es nichts mehr in ein abgehängtes Element
  // schreiben und keine Lib mehr nachladen wollen.
  let abgebrochen = false;
  const cleanup = () => {
    abgebrochen = true;
    urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) { /* egal */ } });
  };

  if (mime.startsWith("image/")) {
    el.innerHTML = `<img class="datei-img" src="${blobUrl()}" alt="${escapeHtml(name || "")}">`;
  } else if (mime.startsWith("video/")) {
    el.innerHTML = `<video class="datei-vid" controls src="${blobUrl()}"></video>`;
  } else if (mime.startsWith("audio/")) {
    el.innerHTML = `<audio style="width:100%" controls src="${blobUrl()}"></audio>`;
  } else if (mime === "application/pdf") {
    // Der Download fehlte hier: ein PDF-Skript liess sich nur im Rahmen ansehen
    // oder in einem Tab oeffnen, aber nie als Datei sichern. Betraf auch die
    // Kundenansicht, die dieselbe Funktion nutzt.
    const u = blobUrl();
    el.innerHTML = `
      <div class="datei-pdf">
        <div class="datei-aktionen">
          <a class="btn btn--ghost btn--sm" href="${u}" download="${escapeHtml(name || "skript.pdf")}">Herunterladen ↓</a>
          <a class="btn btn--ghost btn--sm" href="${u}" target="_blank" rel="noopener">In neuem Tab öffnen ↗</a>
        </div>
        <iframe class="datei-pdf-frame" src="${u}" title="${escapeHtml(name || "PDF")}"></iframe>
      </div>`;
  } else if (mime.includes("wordprocessingml") || endetAuf(name, ".docx")) {
    // Word: das Dokument so zeigen, wie es geschrieben wurde — Logo,
    // Überschriften, Beat-Kästen, Bullet-Zeilen, Tabellen. Vorher stand hier
    // nur der extrahierte Text in einem <pre>: eine einfarbige Wand, in der
    // die Beat-Struktur des Skripts verschwand. Dieselbe Lib und dieselben
    // Optionen wie im social-brain-Cockpit, damit ein Skript dort und hier
    // gleich aussieht.
    //
    // Der Download steht BEWUSST ueber der Vorschau — darunter liegt er bei
    // einem langen Skript ausserhalb des Sichtfelds und gilt als nicht da.
    // Der Download liegt AUSSERHALB des scrollenden Kastens: im Word-Zweig
    // klebte er früher per position:sticky im Text — über einem gerenderten
    // Dokument (eigene Stapelkontexte) deckt das nicht mehr zuverlässig, die
    // Zeilen liefen durch den Knopf hindurch.
    el.innerHTML = `<div class="datei-word datei-word--docx">
        <div class="datei-aktionen">
          <a class="btn btn--ghost btn--sm" href="${blobUrl()}" download="${escapeHtml(name || "dokument.docx")}">Original herunterladen ↓</a>
        </div>
        <div class="datei-docx"><span class="muted" style="font-size:.85rem">Vorschau lädt …</span></div>
      </div>`;
    const ziel = el.querySelector(".datei-docx");
    (async () => {
      const bytes = base64ZuBytes(base64);
      try {
        const docx = await ladeDocxPreview();
        if (abgebrochen) return;
        ziel.innerHTML = "";
        // ignoreWidth/ignoreHeight: die Word-Seite ist 21 cm breit — in der
        // Kundenkarte und erst recht auf dem Handy muss der Inhalt in die
        // Karte fließen statt eine Seite zu simulieren. breakPages aus: ein
        // Skript liest sich hier als ein Stück, nicht als Seitenstapel.
        // useBase64URL: Bilder als data:-URL, damit sie das Aufräumen der
        // blob:-URLs (cleanup) überleben.
        await docx.renderAsync(bytes.buffer, ziel, null, {
          inWrapper: true, ignoreWidth: true, ignoreHeight: true,
          breakPages: false, useBase64URL: true,
          renderHeaders: true, renderFooters: true
        });
        if (abgebrochen) ziel.innerHTML = "";
      } catch (_) {
        // Offline, CDN blockiert oder kaputte Datei → der alte Weg als
        // Rückfallebene: extrahierter Text, immer noch lesbar.
        if (abgebrochen) return;
        try {
          const text = await textAusDocx(bytes.buffer);
          if (abgebrochen) return;
          ziel.innerHTML = `<pre class="datei-word-text">${escapeHtml(text || "(leeres Dokument)")}</pre>`;
        } catch (_e) {
          ziel.innerHTML = `<p class="muted" style="margin:0;font-size:.85rem">Vorschau nicht möglich — bitte die Datei herunterladen.</p>`;
        }
      }
    })();
  } else if (mime.startsWith("text/") || endetAuf(name, ".txt", ".md")) {
    // Reiner Text bekam bisher nur einen Download-Button — ein als .txt
    // hinterlegtes Skript war im Portal gar nicht lesbar. Jetzt als Absätze
    // statt als Monospace-Block: ein Skript ist Fließtext, kein Quellcode.
    let text = "";
    try { text = new TextDecoder().decode(base64ZuBytes(base64)); }
    catch (_) { /* unlesbar → nur der Download oben */ }
    el.innerHTML = `<div class="datei-word">
        <div class="datei-aktionen">
          <a class="btn btn--ghost btn--sm" href="${blobUrl()}" download="${escapeHtml(name || "skript.txt")}">Herunterladen ↓</a>
        </div>
        ${text ? `<div class="datei-text">${textZuAbsaetzen(text)}</div>` : ""}
      </div>`;
  } else {
    el.innerHTML = `<a class="btn btn--ghost btn--sm" href="${blobUrl()}" download="${escapeHtml(name || "datei")}">Herunterladen ↓</a>`;
  }
  return cleanup;
}
