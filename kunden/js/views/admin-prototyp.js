// Admin-View: Prototypen (Admin-only) — zeigt eigenständige HTML-Prototypen
// (z. B. für Präsentationen) bildschirmfüllend wie eine eigene Website.
//   - Jeder Prototyp ist eine fertige, statische Seite unter `prototypen/<id>/index.html`
//     und wird mit dem Portal deployt. Die View ist nur der Rahmen um den Frame.
//   - App-Modus wie bei Social Brain: unter dem Portal-Header bleibt NUR der Prototyp,
//     der Header bleibt, damit man zurück ins Portal kommt.
//   - Neuer Prototyp: Ordner unter `prototypen/` anlegen, hier in PROTOTYPEN eintragen
//     und in router.js (NAV, Gruppe „Prototyp") verlinken.
// Der Kunde sieht diesen Bereich NIE (Route admin-only, keine Firestore-Daten).
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const PROTOTYPEN = {
  // Lerncoaching-Präsentation (Vale, 06.10.2026): Schul-Hilfeseite der SV.
  "lernen-mit-ki": { titel: "Lernen mit KI", pfad: "prototypen/lernen-mit-ki/index.html" }
};
const STANDARD_ID = "lernen-mit-ki";

// Oberkante der App = Unterkante des Portal-Headers (sticky, Höhe variabel).
function setzeOberkante(app) {
  const kopf = document.querySelector(".topbar");
  const top = kopf ? Math.round(kopf.getBoundingClientRect().bottom) : 64;
  app.style.top = top + "px";
}

export function renderAdminPrototyp(container, opts = {}) {
  const proto = PROTOTYPEN[opts.id] || PROTOTYPEN[STANDARD_ID];
  document.body.classList.add("pt-app-modus");
  const alterTitel = document.title;
  document.title = proto.titel;
  container.innerHTML = `
    <section class="pt-app" id="ptApp">
      <iframe class="pt-frame" src="${escapeHtml(proto.pfad)}" title="${escapeHtml(proto.titel)}" allow="clipboard-write"></iframe>
      <a class="pt-extern" href="${escapeHtml(proto.pfad)}" target="_blank" rel="noopener"
         title="${escapeHtml(proto.titel)} in eigenem Fenster öffnen">In eigenem Fenster öffnen ↗</a>
    </section>`;

  const app = container.querySelector("#ptApp");
  setzeOberkante(app);
  const beiResize = () => setzeOberkante(app);
  window.addEventListener("resize", beiResize);

  beiViewWechsel(() => {
    window.removeEventListener("resize", beiResize);
    document.body.classList.remove("pt-app-modus");
    document.title = alterTitel;
  });
}
