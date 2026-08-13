// Admin-View: Shoot-Modus (Admin-only) — Route #/admin/shoot/{id}
//
// Der Drehtag am Handy: ein Take pro Bildschirm, großer Sprechtext, die
// Dreh-Infos als Chips darunter, eine fette Abhak-Fläche. Alles andere
// (Portal-Navigation, Formulare) ist bewusst weg — beim Filmen will man
// nicht zielen müssen.
//
// Nach den Sprech-Takes folgen die B-Roll-Bänder als eigene Schritte: die
// dreht man ohnehin am Stück, nicht zwischendrin.
import { ladeBrandSkript, aktualisiereBrandSkript } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { sortierteTakes, takeChips, merkmaleVonTake, brollSpanne, istAbgeschickt,
         labelVon, GROESSEN, BEWEGUNGEN, BROLL_QUELLEN, dauerLabel, gesamtDauer } from "../brandplan.js";

export function renderAdminShoot(container, ctx) {
  const id = ctx.id;
  container.innerHTML = `<div id="shBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;
  const body = container.querySelector("#shBody");

  (async function init() {
    let skript = null;
    try { skript = await ladeBrandSkript(id); }
    catch (e) { console.warn("Skript laden fehlgeschlagen:", e); }
    if (!skript) {
      body.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Skript nicht gefunden. <a href="#/admin/brand">Zurück zur Übersicht</a>.</p></div>`;
      return;
    }

    const state = {
      status: skript.status || "idee",
      takes:  Array.isArray(skript.takes) ? skript.takes.map((t) => ({ ...t })) : [],
      broll:  Array.isArray(skript.broll) ? skript.broll.map((b) => ({ ...b })) : [],
      checkliste: skript.checkliste || {}
    };

    // Vollbild: die Portal-Shell wird per Body-Klasse ausgeblendet und beim
    // Verlassen der Route zuverlässig wiederhergestellt.
    document.body.classList.add("is-shoot");
    beiViewWechsel(() => document.body.classList.remove("is-shoot"));

    let schritt = 0;

    function schritte() {
      const sortiert = sortierteTakes(state.takes);
      const liste = sortiert.map((take, i) => ({ art: "take", take, nr: i + 1, gesamt: sortiert.length }));
      state.broll.forEach((band) => {
        const sp = brollSpanne(band, sortiert);
        liste.push({ art: "broll", band, spanne: sp });
      });
      liste.push({ art: "ende" });
      return liste;
    }

    function gedrehtZahl() {
      const alle = state.takes.length + state.broll.length;
      const fertig = state.takes.filter((t) => t.gedreht).length + state.broll.filter((b) => b.gedreht).length;
      return { fertig, alle };
    }

    let timer = null;
    function speichere() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        aktualisiereBrandSkript(id, { takes: state.takes, broll: state.broll, status: state.status })
          .catch((e) => console.warn("Speichern fehlgeschlagen:", e));
      }, 400);
    }
    beiViewWechsel(() => {
      clearTimeout(timer);
      aktualisiereBrandSkript(id, { takes: state.takes, broll: state.broll, status: state.status })
        .catch(() => { /* best effort beim Verlassen */ });
    });

    function gehe(delta) {
      const max = schritte().length - 1;
      schritt = Math.max(0, Math.min(schritt + delta, max));
      zeichne();
    }

    function zeichne() {
      const liste = schritte();
      const s = liste[Math.min(schritt, liste.length - 1)];
      const z = gedrehtZahl();
      const fortschritt = z.alle ? Math.round((z.fertig / z.alle) * 100) : 0;

      body.innerHTML = `
        <div class="sh-wrap">
          <header class="sh-kopf">
            <a class="sh-zurueck" href="#/admin/skript/${encodeURIComponent(id)}" title="Zurück zum Skript">✕</a>
            <div class="sh-kopf-mitte">
              <div class="sh-titel">${escapeHtml(skript.titel || "Ohne Titel")}</div>
              <div class="sh-zaehler">${z.fertig}/${z.alle} gedreht${gesamtDauer(state.takes) ? " · ca. " + dauerLabel(gesamtDauer(state.takes)) : ""}</div>
            </div>
            <div class="sh-balken"><div class="sh-balken-fuell" style="width:${fortschritt}%"></div></div>
          </header>

          ${istAbgeschickt(state) ? "" : `<div class="sh-warnung">Dieses Skript ist noch nicht abgeschickt — du drehst eine unfertige Planung.</div>`}

          <main class="sh-buehne">${karteHtml(s, liste.length)}</main>

          <nav class="sh-nav">
            <button class="sh-pfeil" id="shPrev" type="button" ${schritt === 0 ? "disabled" : ""} aria-label="Vorheriger Schritt">←</button>
            ${s.art === "ende" ? "" : `
              <button class="sh-haken${erledigt(s) ? " is-an" : ""}" id="shHaken" type="button">
                ${erledigt(s) ? "✓ Gedreht" : "Als gedreht markieren"}
              </button>`}
            <button class="sh-pfeil" id="shNext" type="button" ${schritt >= liste.length - 1 ? "disabled" : ""} aria-label="Nächster Schritt">→</button>
          </nav>
        </div>`;

      const prev = body.querySelector("#shPrev");
      const next = body.querySelector("#shNext");
      if (prev) prev.addEventListener("click", () => gehe(-1));
      if (next) next.addEventListener("click", () => gehe(1));

      const haken = body.querySelector("#shHaken");
      if (haken) haken.addEventListener("click", () => {
        setzeErledigt(s, !erledigt(s));
        speichere();
        // Nach dem Abhaken automatisch weiter — die Hände sind am Stativ.
        if (erledigt(s) && schritt < schritte().length - 1) { gehe(1); return; }
        zeichne();
      });

      const fertigBtn = body.querySelector("#shFertig");
      if (fertigBtn) fertigBtn.addEventListener("click", () => {
        state.status = "gedreht";
        speichere();
        zeichne();
      });

      const sprung = body.querySelector("#shSprung");
      if (sprung) sprung.addEventListener("click", () => { schritt = 0; zeichne(); });
    }

    function erledigt(s) {
      if (s.art === "take")  return !!s.take.gedreht;
      if (s.art === "broll") return !!s.band.gedreht;
      return false;
    }

    function setzeErledigt(s, wert) {
      if (s.art === "take")  s.take.gedreht = wert;
      if (s.art === "broll") s.band.gedreht = wert;
    }

    function karteHtml(s, gesamtSchritte) {
      if (s.art === "take") {
        const merkmale = merkmaleVonTake({ checkliste: state.checkliste }, s.take.tid);
        const chips = takeChips(s.take);
        return `
          <div class="sh-karte${s.take.gedreht ? " is-gedreht" : ""}">
            <div class="sh-karte-kopf">
              <span class="sh-schritt">Take ${s.nr} von ${s.gesamt}</span>
              ${s.take.label ? `<span class="sh-label">${escapeHtml(s.take.label)}</span>` : ""}
              ${merkmale.map((m) => `<span class="sh-merkmal">● ${escapeHtml(m.label.replace(/\s*\(.*\)$/, ""))}</span>`).join("")}
            </div>
            <p class="sh-text">${s.take.text ? escapeHtml(s.take.text) : `<span class="sh-leer">Kein Sprechtext hinterlegt</span>`}</p>
            ${chips.length ? `<div class="sh-chips">${chips.map((c) => `<span class="sh-chip">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
            ${s.take.notiz ? `<p class="sh-notiz">${escapeHtml(s.take.notiz)}</p>` : ""}
            ${brollHinweis(s.nr)}
          </div>`;
      }

      if (s.art === "broll") {
        const b = s.band;
        const ueber = s.spanne
          ? (s.spanne.von === s.spanne.bis
              ? `läuft über Take ${s.spanne.von + 1}`
              : `läuft über Take ${s.spanne.von + 1}–${s.spanne.bis + 1}`)
          : "ohne Zuordnung";
        const chips = [labelVon(GROESSEN, b.groesse), labelVon(BEWEGUNGEN, b.bewegung), labelVon(BROLL_QUELLEN, b.quelle)].filter(Boolean);
        return `
          <div class="sh-karte sh-karte--broll${b.gedreht ? " is-gedreht" : ""}">
            <div class="sh-karte-kopf">
              <span class="sh-schritt">B-Roll</span>
              <span class="sh-label">${escapeHtml(ueber)}</span>
            </div>
            <p class="sh-text">${escapeHtml(b.beschreibung || "B-Roll ohne Beschreibung")}</p>
            ${chips.length ? `<div class="sh-chips">${chips.map((c) => `<span class="sh-chip">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
            ${b.notiz ? `<p class="sh-notiz">${escapeHtml(b.notiz)}</p>` : ""}
          </div>`;
      }

      const z = gedrehtZahl();
      const allesDa = z.alle > 0 && z.fertig === z.alle;
      return `
        <div class="sh-karte sh-karte--ende">
          <div class="sh-ende-emoji">${allesDa ? "🎉" : "📋"}</div>
          <p class="sh-ende-titel">${allesDa ? "Alles im Kasten." : `${z.fertig} von ${z.alle} gedreht`}</p>
          <p class="sh-ende-text">${allesDa
            ? "Du kannst das Video als gedreht markieren — es wandert dann in der Übersicht nach hinten."
            : "Es fehlen noch Schritte. Geh zurück und hak sie ab, oder mach beim nächsten Mal weiter."}</p>
          <div class="sh-ende-btns">
            ${allesDa && state.status !== "gedreht" && state.status !== "veroeffentlicht"
              ? `<button class="sh-haken is-an" id="shFertig" type="button">✓ Video als gedreht markieren</button>` : ""}
            ${state.status === "gedreht" ? `<p class="sh-ende-ok">✓ Als gedreht markiert</p>` : ""}
            <button class="sh-pfeil sh-pfeil--breit" id="shSprung" type="button">Zurück zum ersten Take</button>
            <a class="sh-pfeil sh-pfeil--breit" href="#/admin/skript/${encodeURIComponent(id)}">Zum Skript</a>
          </div>
        </div>`;
    }

    // Läuft über diesem Take eine B-Roll? Beim Dreh ist das wichtig: dann muss
    // der Ton sitzen, aber das Bild darf ruhig „nur" Basis sein.
    function brollHinweis(nr) {
      const sortiert = sortierteTakes(state.takes);
      const treffer = state.broll.filter((b) => {
        const sp = brollSpanne(b, sortiert);
        return sp && nr - 1 >= sp.von && nr - 1 <= sp.bis;
      });
      if (!treffer.length) return "";
      return `<div class="sh-broll-band">
        ${treffer.map((b) => `<span>🎞️ B-Roll darüber: ${escapeHtml(b.beschreibung || "ohne Beschreibung")}</span>`).join("")}
      </div>`;
    }

    // --- Steuerung: Tastatur + Wischen ---------------------------------
    const beiTaste = (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); gehe(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); gehe(-1); }
      else if (e.key === " " || e.key === "Enter") {
        const h = body.querySelector("#shHaken");
        if (h) { e.preventDefault(); h.click(); }
      } else if (e.key === "Escape") {
        location.hash = `/admin/skript/${encodeURIComponent(id)}`;
      }
    };
    document.addEventListener("keydown", beiTaste);
    beiViewWechsel(() => document.removeEventListener("keydown", beiTaste));

    let startX = null;
    body.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
    body.addEventListener("touchend", (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 60) gehe(dx < 0 ? 1 : -1);
    }, { passive: true });

    zeichne();
  })();
}
