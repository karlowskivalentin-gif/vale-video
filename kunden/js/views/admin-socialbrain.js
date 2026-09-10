// Admin-View: Social Brain (Admin-only) — startet das social-brain-Cockpit als eigene
// Anwendung aus dem Portal heraus.
//   - Das Cockpit ist KEIN Teil dieses Portals: es läuft als lokaler Node-Server aus
//     dem Repo `Vale-Code/social-brain` (`node frontend/server.js`, Port 4710) und
//     liest dort die Post-/Analyse-Dateien live. Hier gibt es nur der Rahmen drumherum.
//   - App-Modus: unter dem Portal-Header bleibt NUR Social Brain — kein View-Rand,
//     kein Weiß, kein Titel. Der Header bleibt, damit man zurück ins Portal kommt.
//     Die Fläche wird unterhalb des (sticky) Headers fixiert; seine Höhe wird
//     gemessen, weil sie von Schrift und Fensterbreite abhängt.
//   - Läuft der Server nicht, zeigt die View den Startbefehl statt eines leeren Frames.
//   - Der Frame ist auf http://localhost erlaubt, weil Chrome localhost auch aus einer
//     https-Seite heraus als vertrauenswürdig behandelt (kein Mixed-Content-Block).
// Der Kunde sieht diesen Bereich NIE (Route admin-only, keine Firestore-Daten).
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const COCKPIT_URL = "http://localhost:4710/";
const START_BEFEHL_WIN = "cd D:\\Vale-Code\\social-brain; node frontend/server.js";
const START_BEFEHL_MAC = "cd /Volumes/sandiskvale/Vale-Code/social-brain && node frontend/server.js";

async function serverErreichbar() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(COCKPIT_URL + "api/git", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch (_) { return false; }
}

// Oberkante der App = Unterkante des Portal-Headers (sticky, Höhe variabel).
function setzeOberkante(app) {
  const kopf = document.querySelector(".topbar");
  const top = kopf ? Math.round(kopf.getBoundingClientRect().bottom) : 64;
  app.style.top = top + "px";
}

export async function renderAdminSocialBrain(container) {
  document.body.classList.add("sb-app-modus");
  container.innerHTML = `
    <section class="sb-app" id="sbApp">
      <div id="sbInhalt" class="sb-inhalt"><div class="sb-boot">Verbinde mit Social Brain …</div></div>
    </section>`;

  const app = container.querySelector("#sbApp");
  const inhalt = container.querySelector("#sbInhalt");
  let pruefTimer = null;
  setzeOberkante(app);
  const beiResize = () => setzeOberkante(app);
  window.addEventListener("resize", beiResize);

  async function zeige() {
    const ok = await serverErreichbar();
    if (ok) {
      if (!inhalt.querySelector("iframe")) {
        // „In eigenem Fenster öffnen" bleibt auch bei laufendem Server sichtbar (klein, oben rechts):
        // im Frame fehlen Adresszeile und Browser-Zoom, und ein Claude-Lauf (Tab Analysen)
        // lässt sich in einem eigenen Fenster bequemer verfolgen.
        inhalt.style.position = "relative";
        inhalt.innerHTML = `<iframe class="sb-frame" src="${COCKPIT_URL}" title="Social Brain" allow="clipboard-write"></iframe>
          <a class="sb-extern" href="${COCKPIT_URL}" target="_blank" rel="noopener" title="Social Brain in eigenem Fenster öffnen"
             style="position:absolute;top:.35rem;right:.6rem;z-index:2;font-size:.72rem;padding:.15rem .5rem;border-radius:999px;background:rgba(12,14,18,.85);color:#a7adbb;border:1px solid #2f3542;text-decoration:none">In eigenem Fenster öffnen ↗</a>`;
      }
      clearInterval(pruefTimer); pruefTimer = null;
      return;
    }
    inhalt.innerHTML = `
      <div class="sb-aus">
        <h2>Social Brain ist nicht gestartet</h2>
        <p>Das Cockpit liest die Dateien direkt von der SanDisk-SSD. Dafür muss der lokale Server laufen —
           auf dem Rechner, an dem die SSD steckt.</p>
        <p><strong>Windows (PowerShell):</strong></p>
        <pre><code>${escapeHtml(START_BEFEHL_WIN)}</code></pre>
        <p><strong>macOS:</strong></p>
        <pre><code>${escapeHtml(START_BEFEHL_MAC)}</code></pre>
        <p class="sb-hint">Sobald der Server antwortet, startet Social Brain hier automatisch.
           <a href="${COCKPIT_URL}" target="_blank" rel="noopener">In eigenem Fenster öffnen ↗</a></p>
      </div>`;
    if (!pruefTimer) pruefTimer = setInterval(zeige, 4000);
  }

  beiViewWechsel(() => {
    clearInterval(pruefTimer);
    window.removeEventListener("resize", beiResize);
    document.body.classList.remove("sb-app-modus");
  });
  await zeige();
}
