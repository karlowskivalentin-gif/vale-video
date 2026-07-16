// =====================================================================
// Lazy-Lib-Loader — lädt schwere Parser-Bibliotheken ERST bei Bedarf und
// cached die Ladepromise (mehrfacher Aufruf lädt nur einmal). Rein
// clientseitig, keine API-Tokens: nur statische CDN-Assets (jsDelivr).
//
//   ladePdfJs()     → PDF → Text + Seiten-Render   (ESM-Modul)
//   ladeTesseract() → Bild-OCR (deutsch)           (window.Tesseract)
//
// Word (.docx) braucht KEINE Lib — docparse.js entpackt die ZIP selbst mit dem
// browsereigenen DecompressionStream (mammoth.js hängt im Browser-Bundle).
//
// Muster wie embeds.js: klassische Skripte per <script> nachladen, ESM per
// dynamischem import(). Bewusst kein Init-Ballast — die Startseite lädt
// nichts davon, bis eine Funktion (PDF-Skript-Beats, Exposé-OCR) sie braucht.
// =====================================================================

// Klassisches <script> einmalig einbinden; resolved, wenn window[globalName] da ist.
function ladeSkriptEinmalig(src, id, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) { resolve(window[globalName]); return; }
    let s = document.getElementById(id);
    if (!s) {
      s = document.createElement("script");
      s.id = id; s.src = src; s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(`${globalName} nach Laden von ${src} nicht verfügbar`));
    }, { once: true });
    s.addEventListener("error", () => reject(new Error(`Konnte ${src} nicht laden`)), { once: true });
  });
}

// --- pdf.js (PDF-Text + Render) -------------------------------------
let _pdfjs = null;
export function ladePdfJs() {
  if (!_pdfjs) {
    _pdfjs = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs")
      .then((mod) => {
        // Worker als Modul-Worker aus demselben CDN.
        mod.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";
        return mod;
      });
  }
  return _pdfjs;
}

// --- tesseract.js (Bild-OCR, deutsch) -------------------------------
let _tesseract = null;
export function ladeTesseract() {
  if (!_tesseract) {
    _tesseract = ladeSkriptEinmalig(
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
      "vv-tesseract-js", "Tesseract"
    );
  }
  return _tesseract;
}
