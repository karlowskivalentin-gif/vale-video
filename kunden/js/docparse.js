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
//                          (iframe) / Word (Text-Vorschau) / sonst Download.
//                          Gibt eine Cleanup-Funktion (revokeObjectURL) zurück.
// =====================================================================
import { escapeHtml } from "./util.js";
import { ladePdfJs, ladeTesseract } from "./libs.js";

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

function docxXmlZuText(xml) {
  const paras = xml.split("</w:p>").map((p) => {
    const t = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("");
    return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  });
  return paras.join("\n").trim();
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

// --- Datei portal-eigen anzeigen ------------------------------------
// Rendert in `el` je nach MIME. Gibt eine Cleanup-Funktion zurück, die alle
// erzeugten blob:-URLs freigibt (via beiViewWechsel registrieren).
export function zeigeDateiInline(el, { base64, typ, name }) {
  if (!el) return () => {};
  const mime = (typ || "").toLowerCase();
  const urls = [];
  const blobUrl = () => { const u = base64ZuBlobUrl(base64, typ); urls.push(u); return u; };
  const cleanup = () => { urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) { /* egal */ } }); };

  if (mime.startsWith("image/")) {
    el.innerHTML = `<img class="datei-img" src="${blobUrl()}" alt="${escapeHtml(name || "")}">`;
  } else if (mime.startsWith("video/")) {
    el.innerHTML = `<video class="datei-vid" controls src="${blobUrl()}"></video>`;
  } else if (mime.startsWith("audio/")) {
    el.innerHTML = `<audio style="width:100%" controls src="${blobUrl()}"></audio>`;
  } else if (mime === "application/pdf") {
    const u = blobUrl();
    el.innerHTML = `
      <div class="datei-pdf">
        <iframe class="datei-pdf-frame" src="${u}" title="${escapeHtml(name || "PDF")}"></iframe>
        <a class="btn btn--ghost btn--sm" href="${u}" target="_blank" rel="noopener">In neuem Tab öffnen ↗</a>
      </div>`;
  } else if (mime.includes("wordprocessingml") || endetAuf(name, ".docx")) {
    // Word: extrahierten Text als Vorschau (kein Fremdlib), plus Download.
    el.innerHTML = `<div class="datei-word"><span class="muted" style="font-size:.85rem">Vorschau lädt …</span></div>`;
    const ziel = el.querySelector(".datei-word");
    (async () => {
      try {
        const text = await textAusDocx(base64ZuBytes(base64).buffer);
        ziel.innerHTML = `<pre class="datei-word-text">${escapeHtml(text || "(leeres Dokument)")}</pre>
          <a class="btn btn--ghost btn--sm" href="${blobUrl()}" download="${escapeHtml(name || "dokument.docx")}">Original herunterladen ↓</a>`;
      } catch (_) {
        ziel.innerHTML = `<a class="btn btn--ghost btn--sm" href="${blobUrl()}" download="${escapeHtml(name || "dokument.docx")}">Herunterladen ↓</a>`;
      }
    })();
  } else {
    el.innerHTML = `<a class="btn btn--ghost btn--sm" href="${blobUrl()}" download="${escapeHtml(name || "datei")}">Herunterladen ↓</a>`;
  }
  return cleanup;
}
