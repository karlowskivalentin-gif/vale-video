// Admin-View: Kurs — 8 Module, 36 Lektionen, je mit Lerninhalt, Verstanden-
// Check und YouTube-Suchbegriffen. Rein privat (Rolle admin).
//
// Gleiche Bauweise wie admin-roadmap.js:
//   Inhalte  -> js/kurs-data.js      (Texte, nichts anderes)
//   Rechnen  -> js/kurs-logik.js     (ohne Firebase, damit pruefbar)
//   Hier     -> nur Darstellung, ausser UI-Beschriftungen textfrei.
//
// Der Fortschritt liegt im FELD `kurs` des bestehenden Dokuments
// roadmap/valentin — kein eigenes Dokument, keine eigene Rule. Deshalb setzt
// der Reset hier auch nur `kurs` zurueck und laesst die Roadmap-Haken stehen.
import { getRoadmap, saveRoadmap, roadmapFeldWeg } from "../db.js";
import { MODS, NORDSTERN, LISTEN_HINWEIS } from "../kurs-data.js";
import { modulFortschritt, aktuellesModul, naechsteLektion,
         kursProzent, kursLektionen, fertigeModule, ytSuche } from "../kurs-logik.js";
import { escapeHtml } from "../util.js";
import { heute } from "../roadmap-logik.js";

export function renderAdminKurs(container) {
  const tag = heute();

  let done = {};
  // Aufgeklappte Lektionen — nur zur Laufzeit, sonst klappt nach jedem Haken
  // alles wieder zu.
  const offen = {};

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Kurs</h1>
    </div>
    <div id="kursBody" class="rm-laedt">Lade Kurs …</div>`;

  const body = container.querySelector("#kursBody");

  function meldung(text, fehler) {
    const el = container.querySelector("#kursSaved");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-fehler", !!fehler);
  }

  async function speichere(teil, rueckgaengig) {
    try {
      await saveRoadmap(teil);
      const t = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      meldung(`Gespeichert ${t}`, false);
    } catch (_) {
      if (typeof rueckgaengig === "function") rueckgaengig();
      zeichne();
      meldung("Konnte nicht speichern — Verbindung prüfen", true);
    }
  }

  function setzeHaken(id, an) {
    const vorher = done[id];
    if (an) done[id] = true; else delete done[id];
    zeichne();
    speichere({ kurs: { [id]: an ? true : roadmapFeldWeg() } }, () => {
      if (vorher) done[id] = true; else delete done[id];
    });
  }

  // Lerninhalt, Verstanden-Check und die Suchlinks einer Lektion. Wird oben
  // beim „Naechstes" immer sichtbar gezeigt und in der Modulliste aufklappbar.
  function htmlInhalt(l) {
    return `
      <div class="rm-info">
        <div><span class="rm-info-lbl">Lernen</span>${escapeHtml(l[2])}</div>
        <div><span class="rm-info-lbl">Verstanden, wenn</span>${escapeHtml(l[3])}</div>
        <div><span class="rm-info-lbl">YouTube</span>
          <span class="kurs-suchen">${l[4].map((q) =>
            `<a href="${escapeHtml(ytSuche(q))}" target="_blank" rel="noopener">${escapeHtml(q)}</a>`
          ).join("")}</span>
        </div>
      </div>`;
  }

  // --- 1. Kopf: Modul, Balken, drei Zaehler ----------------------------
  function htmlKopf() {
    const cur = aktuellesModul(tag);
    const [n, gesamt] = modulFortschritt(cur, done);
    const pct = kursProzent(done);
    const [ld, lg] = kursLektionen(done);
    const nl = naechsteLektion(done, tag);

    const naechstes = !nl
      ? `<p class="rm-fertig">Alle Lektionen abgeschlossen.</p>`
      : (() => {
          const [l, m, ueberfaellig] = nl;
          return `
            <p class="rm-label">Nächste Lektion</p>
            <label class="rm-next">
              <input type="checkbox" data-lektion="${escapeHtml(l[0])}" />
              <span class="rm-next-text">${escapeHtml(l[1])}
                <span class="kurs-next-modul">${escapeHtml(m.name)}${
                  ueberfaellig ? " — offen aus früherem Modul" : ""
                }</span>
              </span>
            </label>
            ${htmlInhalt(l)}`;
        })();

    return `
      <section class="card card--pad rm-block">
        <p class="rm-phase">Kurs — <em>${escapeHtml(cur.name)}</em></p>
        <p class="rm-stand">${n} von ${gesamt} Lektionen in diesem Modul. ${escapeHtml(cur.ziel)}</p>
        <div class="rm-bar kurs-gesamtbar">
          <div class="rm-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="rm-zaehler kurs-zaehler">
          <div><span class="rm-zahl rm-zahl--akzent">${pct} %</span><span class="rm-zahl-lbl">Kurs gesamt</span></div>
          <div><span class="rm-zahl">${ld}/${lg}</span><span class="rm-zahl-lbl">Lektionen</span></div>
          <div><span class="rm-zahl">${fertigeModule(done)}/${MODS.length}</span><span class="rm-zahl-lbl">Module abgeschlossen</span></div>
        </div>
        ${naechstes}
      </section>`;
  }

  // --- 2. Nordstern ----------------------------------------------------
  function htmlNordstern() {
    return `
      <section class="card card--pad rm-block kurs-nord">
        <p class="rm-label">Wofür das alles</p>
        <p class="kurs-nord-text">${escapeHtml(NORDSTERN)}</p>
      </section>`;
  }

  // --- 3. Module -------------------------------------------------------
  // Checkbox AUSSERHALB des <details> — sonst loest ein Klick auf den Haken
  // das Auf- und Zuklappen mit aus.
  function htmlModule() {
    const cur = aktuellesModul(tag);
    return `
      <section class="rm-block">
        <p class="rm-label rm-label--frei">Module</p>
        <p class="kurs-hinweis">${escapeHtml(LISTEN_HINWEIS)}</p>
        ${MODS.map((m) => {
          const [n, gesamt] = modulFortschritt(m, done);
          const pct = gesamt ? (n / gesamt) * 100 : 0;
          return `
            <details class="rm-phase-block ${m === cur ? "is-aktuell" : ""}" ${m === cur ? "open" : ""}>
              <summary>
                <span class="rm-phase-name">${escapeHtml(m.name)}<span class="rm-phase-zeit">${escapeHtml(m.wann)}</span></span>
                <span class="rm-phase-prog">${n}/${gesamt}${n === gesamt ? " · abgeschlossen" : ""}</span>
              </summary>
              <div class="kurs-modul-kopf">
                <p class="kurs-ziel">${escapeHtml(m.ziel)}</p>
                <div class="kurs-modulbar"><div style="width:${pct.toFixed(0)}%"></div></div>
              </div>
              <div class="rm-items">
                ${m.lessons.map((l) => `
                  <div class="rm-item ${done[l[0]] ? "is-erledigt" : ""}">
                    <input type="checkbox" data-lektion="${escapeHtml(l[0])}" ${done[l[0]] ? "checked" : ""}
                           aria-label="${escapeHtml(l[1])}" />
                    <details ${offen[l[0]] ? "open" : ""} data-info="${escapeHtml(l[0])}">
                      <summary>
                        <span class="rm-item-text">${escapeHtml(l[1])}</span>
                        <span class="rm-item-mehr">öffnen</span>
                      </summary>
                      ${htmlInhalt(l)}
                    </details>
                  </div>`).join("")}
              </div>
            </details>`;
        }).join("")}
      </section>`;
  }

  function htmlFuss() {
    return `
      <div class="rm-fuss">
        <span class="rm-gespeichert" id="kursSaved"></span>
        <button type="button" class="btn btn--ghost btn--sm" id="kursReset">Kurs-Fortschritt zurücksetzen</button>
      </div>`;
  }

  function zeichne() {
    const merke = (container.querySelector("#kursSaved") || {}).textContent || "";
    body.classList.remove("rm-laedt");
    body.innerHTML = htmlKopf() + htmlNordstern() + htmlModule() + htmlFuss();
    if (merke) meldung(merke, false);
  }

  // --- Ereignisse ------------------------------------------------------
  body.addEventListener("change", (e) => {
    if (e.target.matches("input[data-lektion]")) {
      setzeHaken(e.target.getAttribute("data-lektion"), e.target.checked);
    }
  });

  body.addEventListener("click", (e) => {
    if (!e.target.closest("#kursReset")) return;
    if (!window.confirm("Kurs-Fortschritt wirklich zurücksetzen? Die Roadmap-Haken bleiben unberührt.")) return;
    const vorher = done;
    done = {};
    zeichne();
    // Nur `kurs` — done/revenue/week der Roadmap bleiben stehen.
    speichere({ kurs: roadmapFeldWeg() }, () => { done = vorher; });
  });

  body.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.matches("details[data-info]")) {
      const id = d.getAttribute("data-info");
      if (d.open) offen[id] = true; else delete offen[id];
    }
  }, true);

  // --- Start -----------------------------------------------------------
  (async () => {
    try {
      const daten = await getRoadmap();
      done = daten.kurs || {};
      zeichne();
    } catch (_) {
      body.classList.remove("rm-laedt");
      body.innerHTML = `<section class="card card--pad rm-block">
        <p class="rm-fehler">Kurs konnte nicht geladen werden — Verbindung prüfen und die Seite neu laden.</p>
      </section>`;
    }
  })();
}
