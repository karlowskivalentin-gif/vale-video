// Admin-View: Roadmap — wo stehe ich, was ist als Nächstes dran, wie weit ist
// der Umsatz vom Ziel weg. Rein privat (Rolle admin), keine Kundenberührung.
//
// Sechs Blöcke von oben nach unten:
//   1. STAND        — aktuelle Phase + der eine nächste offene Schritt.
//   2. ZEITSTRAHL   — Sep 2026 bis Dez 2027 mit den vier Terminen.
//   3. UMSATZ       — Eingabe für den laufenden Monat, Balken bis 5.000 €.
//   4. DIESE WOCHE  — Mo–Sa bzw. Klausur-Modus, setzt sich montags zurück.
//   5. MEILENSTEINE — alle Phasen, jedes Item mit „Wie" und „Warum".
//   6. FUSSZEILE    — Speicher-Rückmeldung + Zurücksetzen.
//
// Die Inhalte stehen ALLE in js/roadmap-data.js — hier stehen nur
// UI-Beschriftungen. Wer Meilensteine ändert, fasst diese Datei nicht an.
//
// Gespeichert wird in Firestore (roadmap/valentin), nicht im localStorage:
// die Haken sollen auf Handy und Rechner identisch sein. Jede Änderung
// schreibt sofort ihr Teilobjekt — kein „Speichern"-Button.
import { getRoadmap, saveRoadmap, roadmapFeldWeg } from "../db.js";
import { PHASES, WEEK_NORMAL, WEEK_KLAUSUR,
         START, TARGET, DEUSSEN, ACHTZEHN } from "../roadmap-data.js";
import { escapeHtml, wochenKey, monatKey, monatsLabel } from "../util.js";
import { fmt, heute, tageBis, aktuellePhase, phaseFortschritt,
         gesamtFortschritt, naechsterSchritt, strahlPos } from "../roadmap-logik.js";

const BALKEN_MAX = 5000;        // Obergrenze des Umsatzbalkens (= Hauptziel)
const BALKEN_TICKS = [2000, 3000];
const PRO_VIDEO = 300;          // Rechengrundlage für „noch X Videos"

export function renderAdminRoadmap(container) {
  const tag = heute();
  const wocheJetzt = wochenKey(tag);
  const monatJetzt = monatKey(tag);

  // --- Zustand ---------------------------------------------------------
  let done = {};
  let revenue = {};
  let week = { mode: "normal", done: {} };
  // Welche Items sind aufgeklappt? BEWUSST nur zur Laufzeit gehalten und
  // nicht gespeichert: ohne das würde beim Neu-Rendern nach jedem Haken
  // alles wieder zuklappen.
  const offen = {};

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Roadmap</h1>
    </div>
    <div id="rmBody" class="rm-laedt">Lade Roadmap …</div>`;

  const body = container.querySelector("#rmBody");

  // --- Speichern -------------------------------------------------------
  // Jede Änderung schreibt sofort ihr Teilobjekt. Schlägt das fehl, wird die
  // Änderung im Zustand zurückgenommen und neu gerendert — sonst zeigt die
  // View einen Haken, den es in Firestore nicht gibt.
  function meldung(text, fehler) {
    const el = container.querySelector("#rmSaved");
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
    speichere({ done: { [id]: an ? true : roadmapFeldWeg() } }, () => {
      if (vorher) done[id] = true; else delete done[id];
    });
  }

  function setzeWochenHaken(key, an) {
    const vorher = week.done[key];
    if (an) week.done[key] = true; else delete week.done[key];
    zeichneWoche();
    speichere({ week: { done: { [key]: an ? true : roadmapFeldWeg() } } }, () => {
      if (vorher) week.done[key] = true; else delete week.done[key];
    });
  }

  // --- 1. Stand --------------------------------------------------------
  function htmlStand() {
    const cur = aktuellePhase(tag);
    const [n, gesamt] = phaseFortschritt(cur, done);
    const bis = new Date(cur.to).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    const ni = naechsterSchritt(done, tag);

    const naechstes = !ni
      ? `<p class="rm-fertig">Alles abgehakt. Roadmap erledigt.</p>`
      : (() => {
          const [item, p, ueberfaellig] = ni;
          return `
            <p class="rm-label">Als Nächstes</p>
            <label class="rm-next">
              <input type="checkbox" data-haken="${escapeHtml(item[0])}" />
              <span class="rm-next-text">${escapeHtml(item[1])}${
                ueberfaellig ? ` <span class="rm-offen">(offen aus ${escapeHtml(p.name)})</span>` : ""
              }</span>
            </label>
            <div class="rm-info">
              <div><span class="rm-info-lbl">Wie</span>${escapeHtml(item[2])}</div>
              <div><span class="rm-info-lbl">Warum</span>${escapeHtml(item[3])}</div>
            </div>`;
        })();

    return `
      <section class="card card--pad rm-block">
        <p class="rm-phase">Phase ${PHASES.indexOf(cur) + 1} — <em>${escapeHtml(cur.name)}</em></p>
        <p class="rm-stand">${n} von ${gesamt} Schritten dieser Phase erledigt.
          Ziel bis ${escapeHtml(bis)}: ${fmt(cur.ziel)} € im Monat.</p>
        ${naechstes}
      </section>`;
  }

  // --- 2. Zeitstrahl ---------------------------------------------------
  function htmlStrahl() {
    const pos = (d) => strahlPos(d, START, TARGET);
    const jetzt = pos(tag);
    const marken = [
      [DEUSSEN, "Deussen"],
      [new Date("2027-01-01"), "Phase 2"],
      [ACHTZEHN, "18 · Phase 3"],
      [TARGET, "5.000 €"]
    ];
    const cur = aktuellePhase(tag);

    return `
      <section class="card card--pad rm-block">
        <p class="rm-label">Zeitstrahl</p>
        <div class="rm-rail">
          <div class="rm-rail-fill" style="width:${jetzt.toFixed(1)}%"></div>
          ${marken.map((m) => `<span class="rm-mark" style="left:${pos(m[0]).toFixed(1)}%"></span>`).join("")}
          <span class="rm-mark rm-mark--now" style="left:${jetzt.toFixed(1)}%"></span>
        </div>
        <div class="rm-rail-labels">
          ${marken.map((m, i) => `<span class="rm-rail-lab rm-lab-${i}" style="left:${pos(m[0]).toFixed(1)}%">${escapeHtml(m[1])}</span>`).join("")}
          <span class="rm-rail-lab rm-rail-lab--now" style="left:${jetzt.toFixed(1)}%">heute</span>
        </div>
        <div class="rm-phasenzeile">
          ${PHASES.slice(0, 3).map((p) => `<span class="${p === cur ? "is-aktuell" : ""}">${escapeHtml(p.name)}</span>`).join("")}
        </div>
        <div class="rm-zaehler">
          <div><span class="rm-zahl rm-zahl--akzent">${tageBis(TARGET, tag)}</span><span class="rm-zahl-lbl">Tage bis 5.000 €/Monat</span></div>
          <div><span class="rm-zahl">${tageBis(DEUSSEN, tag)}</span><span class="rm-zahl-lbl">Tage bis Deussen-Verhandlung</span></div>
          <div><span class="rm-zahl">${tageBis(ACHTZEHN, tag)}</span><span class="rm-zahl-lbl">Tage bis 18</span></div>
          <div><span class="rm-zahl">${gesamtFortschritt(done)} %</span><span class="rm-zahl-lbl">Roadmap gesamt</span></div>
        </div>
      </section>`;
  }

  // --- 3. Umsatz -------------------------------------------------------
  function htmlUmsatz() {
    const cur = aktuellePhase(tag);
    const wert = Number(revenue[monatJetzt] || 0);
    const pct = Math.min(100, (wert / BALKEN_MAX) * 100);
    let status;
    if (!wert) {
      status = `Trag deinen Umsatz für ${escapeHtml(monatsLabel(monatJetzt))} ein. Der Balken läuft bis ${fmt(BALKEN_MAX)} €.`;
    } else if (wert >= cur.ziel) {
      status = `Phasenziel erreicht. Noch ${fmt(Math.max(0, BALKEN_MAX - wert))} € bis zum Hauptziel.`;
    } else {
      const luecke = cur.ziel - wert;
      status = `Noch ${fmt(luecke)} € bis zum Phasenziel — bei ~${PRO_VIDEO} €/Video sind das ${Math.ceil(luecke / PRO_VIDEO)} Videos mehr im Monat.`;
    }

    return `
      <section class="card card--pad rm-block">
        <p class="rm-label">Umsatz · ${escapeHtml(monatsLabel(monatJetzt))}</p>
        <div class="rm-umsatz-kopf">
          <input type="text" inputmode="numeric" id="rmUmsatz" class="rm-umsatz-feld"
                 value="${wert ? fmt(wert) : ""}" placeholder="0" aria-label="Monatsumsatz netto in Euro" />
          <span class="rm-umsatz-ziel">von ${fmt(cur.ziel)} € Phasenziel</span>
        </div>
        <div class="rm-bar">
          <div class="rm-bar-fill" style="width:${pct.toFixed(1)}%"></div>
          ${BALKEN_TICKS.map((v) => `<span class="rm-bar-tick" style="left:${((v / BALKEN_MAX) * 100).toFixed(1)}%"></span>`).join("")}
        </div>
        <p class="rm-umsatz-status">${status}</p>
      </section>`;
  }

  // --- 4. Diese Woche --------------------------------------------------
  function htmlWoche() {
    const liste = week.mode === "klausur" ? WEEK_KLAUSUR : WEEK_NORMAL;
    return `
      <section class="card card--pad rm-block" id="rmWoche">
        <div class="rm-woche-kopf">
          <div>
            <p class="rm-label">Diese Woche</p>
            <p class="rm-woche-sub">Kalenderwoche ${wocheJetzt.split("-W")[1]} — setzt sich montags zurück.</p>
          </div>
          <div class="rm-modi" role="group" aria-label="Wochenmodus">
            <button type="button" class="rm-modus ${week.mode === "normal" ? "is-an" : ""}" data-modus="normal">Normal</button>
            <button type="button" class="rm-modus ${week.mode === "klausur" ? "is-an" : ""}" data-modus="klausur">Klausur</button>
          </div>
        </div>
        <div class="rm-woche-liste">
          ${liste.map(([tagKuerzel, text], i) => {
            const key = `${wocheJetzt}:${week.mode}:${i}`;
            const an = !!week.done[key];
            return `
              <label class="rm-tag ${an ? "is-erledigt" : ""}">
                <input type="checkbox" data-woche="${escapeHtml(key)}" ${an ? "checked" : ""} />
                <span class="rm-tag-kuerzel">${escapeHtml(tagKuerzel)}</span>
                <span>${escapeHtml(text)}</span>
              </label>`;
          }).join("")}
        </div>
      </section>`;
  }

  // --- 5. Meilensteine -------------------------------------------------
  // Die Checkbox liegt BEWUSST außerhalb des <details>: läge sie im
  // <summary>, würde jeder Klick auf den Haken die Info mit auf- und
  // zuklappen (und umgekehrt).
  function htmlMeilensteine() {
    const cur = aktuellePhase(tag);
    return `
      <section class="rm-block">
        <p class="rm-label rm-label--frei">Meilensteine</p>
        ${PHASES.map((p) => {
          const [n, gesamt] = phaseFortschritt(p, done);
          const von = new Date(p.from).toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
          const bis = new Date(p.to).toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
          return `
            <details class="rm-phase-block ${p === cur ? "is-aktuell" : ""}" ${p === cur ? "open" : ""}>
              <summary>
                <span class="rm-phase-name">${escapeHtml(p.name)}<span class="rm-phase-zeit">${escapeHtml(von)} – ${escapeHtml(bis)}</span></span>
                <span class="rm-phase-prog">${n}/${gesamt}${n === gesamt ? " · erledigt" : ""}</span>
              </summary>
              <div class="rm-items">
                ${p.groups.map(([monat, items]) => `
                  <p class="rm-monat">${escapeHtml(monat)}</p>
                  ${items.map(([id, text, wie, warum]) => `
                    <div class="rm-item ${done[id] ? "is-erledigt" : ""}">
                      <input type="checkbox" data-haken="${escapeHtml(id)}" ${done[id] ? "checked" : ""}
                             aria-label="${escapeHtml(text)}" />
                      <details ${offen[id] ? "open" : ""} data-info="${escapeHtml(id)}">
                        <summary>
                          <span class="rm-item-text">${escapeHtml(text)}</span>
                          <span class="rm-item-mehr">Wie &amp; Warum</span>
                        </summary>
                        <div class="rm-info">
                          <div><span class="rm-info-lbl">Wie</span>${escapeHtml(wie)}</div>
                          <div><span class="rm-info-lbl">Warum</span>${escapeHtml(warum)}</div>
                        </div>
                      </details>
                    </div>`).join("")}
                `).join("")}
              </div>
            </details>`;
        }).join("")}
      </section>`;
  }

  // --- 6. Fußzeile -----------------------------------------------------
  function htmlFuss() {
    return `
      <div class="rm-fuss">
        <span class="rm-gespeichert" id="rmSaved"></span>
        <button type="button" class="btn btn--ghost btn--sm" id="rmReset">Alle Haken zurücksetzen</button>
      </div>`;
  }

  // --- Zeichnen --------------------------------------------------------
  // Der Wochenblock wird separat neu gezeichnet, damit ein Haken dort nicht
  // die aufgeklappten Meilensteine anfasst.
  function zeichneWoche() {
    const alt = body.querySelector("#rmWoche");
    if (!alt) return;
    const huelle = document.createElement("div");
    huelle.innerHTML = htmlWoche();
    alt.replaceWith(huelle.firstElementChild);
  }

  function zeichne() {
    const merkeMeldung = (container.querySelector("#rmSaved") || {}).textContent || "";
    body.classList.remove("rm-laedt");
    body.innerHTML = htmlStand() + htmlStrahl() + htmlUmsatz() + htmlWoche() + htmlMeilensteine() + htmlFuss();
    if (merkeMeldung) meldung(merkeMeldung, false);
  }

  // --- Ereignisse ------------------------------------------------------
  // Ein delegierter Listener für den ganzen Body: die Blöcke werden neu
  // gezeichnet, einzeln gebundene Handler wären danach weg.
  body.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("input[data-haken]")) {
      setzeHaken(el.getAttribute("data-haken"), el.checked);
    } else if (el.matches("input[data-woche]")) {
      setzeWochenHaken(el.getAttribute("data-woche"), el.checked);
    }
  });

  body.addEventListener("click", (e) => {
    const modus = e.target.closest(".rm-modus");
    if (modus) {
      const neu = modus.getAttribute("data-modus");
      if (neu === week.mode) return;
      const vorher = week.mode;
      week.mode = neu;
      zeichneWoche();
      speichere({ week: { mode: neu } }, () => { week.mode = vorher; });
      return;
    }
    if (e.target.closest("#rmReset")) {
      if (!window.confirm("Wirklich alle Haken zurücksetzen? Der eingetragene Umsatz bleibt erhalten.")) return;
      const vorherDone = done, vorherWoche = week.done;
      done = {};
      week.done = {};
      zeichne();
      // Umsatz wird BEWUSST nicht mitgelöscht: die Monatswerte sind Historie.
      speichere({ done: roadmapFeldWeg(), week: { done: roadmapFeldWeg() } }, () => {
        done = vorherDone;
        week.done = vorherWoche;
      });
    }
  });

  // Aufklapp-Zustand merken, solange die View offen ist.
  body.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.matches("details[data-info]")) {
      const id = d.getAttribute("data-info");
      if (d.open) offen[id] = true; else delete offen[id];
    }
  }, true);

  // Umsatz: erst beim Verlassen des Feldes schreiben, nicht bei jedem
  // Tastendruck — sonst entsteht pro Ziffer ein Firestore-Write.
  body.addEventListener("change", (e) => {
    if (!e.target.matches("#rmUmsatz")) return;
    const betrag = parseInt(String(e.target.value).replace(/[^\d]/g, ""), 10) || 0;
    const vorher = revenue[monatJetzt];
    revenue[monatJetzt] = betrag;
    zeichne();
    speichere({ revenue: { [monatJetzt]: betrag } }, () => {
      if (vorher === undefined) delete revenue[monatJetzt]; else revenue[monatJetzt] = vorher;
    });
  });

  // --- Start -----------------------------------------------------------
  (async () => {
    try {
      const daten = await getRoadmap();
      done = daten.done;
      revenue = daten.revenue;
      week = { mode: daten.week.mode || "normal", done: daten.week.done || {} };

      // Haken vergangener Wochen wegräumen — „Diese Woche" fängt montags bei
      // null an. Nur lokal entfernen reicht nicht, sonst wachsen die alten
      // Schlüssel im Dokument ewig weiter.
      const alt = Object.keys(week.done).filter((k) => !k.startsWith(wocheJetzt));
      if (alt.length) {
        alt.forEach((k) => delete week.done[k]);
        const patch = {};
        alt.forEach((k) => { patch[k] = roadmapFeldWeg(); });
        saveRoadmap({ week: { done: patch } }).catch(() => { /* nicht kritisch */ });
      }
      zeichne();
    } catch (_) {
      body.classList.remove("rm-laedt");
      body.innerHTML = `<section class="card card--pad rm-block">
        <p class="rm-fehler">Roadmap konnte nicht geladen werden — Verbindung prüfen und die Seite neu laden.</p>
      </section>`;
    }
  })();
}
