// Admin-View: Personal Brand → Skripte (Admin-only).
// Übersicht aller eigenen Video-Skripte. Klick öffnet die Werkstatt
// (admin-brand-skript.js), ab „drehreif" führt ein Direktweg in den
// Shoot-Modus (admin-shoot.js).
// Rein privat — mit Kunden hat dieser Bereich nichts zu tun.
import { beobachteBrandSkripte, brandSkriptAnlegen, loescheBrandSkript, ladeFormate } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum } from "../util.js";
import { STATUS_LABEL, PLATTFORMEN, labelVon, berechneFortschritt,
         gesamtDauer, dauerLabel, istAbgeschickt, takesAusFormat, AUFWAND } from "../brandplan.js";

const FILTER = [
  { id: "alle",       label: "Alle" },
  { id: "offen",      label: "In Arbeit" },
  { id: "drehreif",   label: "Drehreif" },
  { id: "gedreht",    label: "Gedreht" },
  { id: "veroeffentlicht", label: "Veröffentlicht" }
];

export function renderAdminBrand(container) {
  let skripte = [];
  let formate = [];
  let filter = "alle";

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Skripte</h1>
      <button class="btn btn--accent btn--sm" id="bsNeu" type="button">+ Neues Skript</button>
    </div>
    <p class="muted view-intro">Deine eigenen Videos von der Rohidee bis zum Drehtag: Skript schreiben,
      per KI schärfen, in Takes zerlegen, Kamera-Infos danebenschreiben. Bei 100 % Planung wird der
      Shoot-Modus frei. Nur du siehst das.</p>
    <div class="card card--pad bs-neu-panel" id="bsNeuPanel" hidden></div>
    <div class="insp-chips" id="bsChips">
      ${FILTER.map((f) => `<button class="insp-chip${f.id === "alle" ? " is-active" : ""}" data-f="${f.id}" type="button">${f.label}</button>`).join("")}
    </div>
    <div class="bs-liste" id="bsListe"><p class="muted">Lädt …</p></div>`;

  const liste = container.querySelector("#bsListe");
  const neuPanel = container.querySelector("#bsNeuPanel");

  // Formate im Hintergrund holen — sie entscheiden, was beim Anlegen
  // angeboten wird (ihre Beats werden direkt zum Take-Gerüst).
  ladeFormate()
    .then((l) => { formate = l; })
    .catch((e) => console.warn("Formate laden fehlgeschlagen:", e));

  container.querySelectorAll("#bsChips .insp-chip").forEach((c) => c.addEventListener("click", () => {
    filter = c.getAttribute("data-f");
    container.querySelectorAll("#bsChips .insp-chip").forEach((x) => x.classList.toggle("is-active", x === c));
    zeichne();
  }));

  // Neues Skript: Format wählen (oder frei starten) und sofort hineinspringen.
  // Ohne Formate wird gar nicht erst gefragt — dann ist „frei" die einzige
  // Antwort und ein Zwischenschritt wäre reine Reibung.
  const neuBtn = container.querySelector("#bsNeu");
  neuBtn.addEventListener("click", () => {
    if (!formate.length) { anlegen(null); return; }
    if (!neuPanel.hidden) { neuPanel.hidden = true; neuPanel.innerHTML = ""; return; }
    neuPanel.hidden = false;
    neuPanel.innerHTML = `
      <h2 class="section-title" style="margin-top:0">Womit fängst du an?</h2>
      <p class="muted" style="margin-top:-.4rem">Mit Format stehen die Takes schon als Gerüst da —
        du füllst nur noch den Text ein.</p>
      <div class="bs-neu-wahl">
        <button class="bs-neu-opt" type="button" data-fid="">
          <span class="bs-neu-opt-name">Frei schreiben</span>
          <span class="muted">Ohne Vorlage — Takes machst du selbst</span>
        </button>
        ${formate.map((f) => {
          const beats = Array.isArray(f.beats) ? f.beats.length : 0;
          const info = [
            `${beats} Beat${beats === 1 ? "" : "s"}`,
            f.talkingHead === false ? "kein Talking Head" : "Talking Head",
            labelVon(AUFWAND, f.aufwand)
          ].filter(Boolean).join(" · ");
          return `
            <button class="bs-neu-opt" type="button" data-fid="${escapeHtml(f.id)}">
              <span class="bs-neu-opt-name">${escapeHtml(f.name || "Ohne Namen")}</span>
              <span class="muted">${escapeHtml(info)}</span>
              ${f.materialBedarf ? `<span class="muted bs-neu-opt-mat">🎞️ ${escapeHtml(f.materialBedarf)}</span>` : ""}
            </button>`;
        }).join("")}
      </div>
      <div class="action-btns"><a class="btn btn--ghost btn--sm" href="#/admin/formate">Formate verwalten</a></div>`;
    neuPanel.querySelectorAll(".bs-neu-opt").forEach((b) => b.addEventListener("click", () => {
      anlegen(b.getAttribute("data-fid") || null);
    }));
  });

  async function anlegen(formatId) {
    neuBtn.disabled = true;
    const format = formatId ? formate.find((f) => f.id === formatId) : null;
    try {
      const ref = await brandSkriptAnlegen({
        titel: "",
        formatId: format ? format.id : null,
        formatName: format ? (format.name || "") : "",
        takes: format ? takesAusFormat(format) : []
      });
      location.hash = `/admin/skript/${encodeURIComponent(ref.id)}`;
    } catch (e) {
      console.warn("Skript anlegen fehlgeschlagen:", e);
      alert("Konnte nicht anlegen. Sind die Firestore-Rules für „brandskripte“ veröffentlicht?");
      neuBtn.disabled = false;
    }
  }

  function passtZumFilter(s) {
    if (filter === "alle") return true;
    if (filter === "offen") return !istAbgeschickt(s);
    return (s.status || "idee") === filter;
  }

  function karteHtml(s) {
    const st = STATUS_LABEL[s.status] || STATUS_LABEL.idee;
    const fort = berechneFortschritt(s);
    const takes = Array.isArray(s.takes) ? s.takes : [];
    const teile = [
      labelVon(PLATTFORMEN, s.plattform),
      s.formatName ? `Format: ${s.formatName}` : "",
      takes.length ? `${takes.length} Take${takes.length === 1 ? "" : "s"}` : "noch keine Takes",
      gesamtDauer(takes) ? `ca. ${dauerLabel(gesamtDauer(takes))}` : "",
      s.aktualisiertAm ? formatDatum(s.aktualisiertAm) : ""
    ].filter(Boolean);
    const href = `#/admin/skript/${encodeURIComponent(s.id)}`;

    return `
      <article class="card bs-karte" data-id="${escapeHtml(s.id)}">
        <div class="bs-karte-kopf">
          <a class="bs-karte-titel" href="${href}">${escapeHtml(s.titel || "Ohne Titel")}</a>
          <span class="bs-badge bs-badge--${st.cls}">${st.txt}</span>
        </div>
        <div class="bs-karte-sub muted">${escapeHtml(teile.join(" · "))}</div>
        <div class="bs-balken" title="${fort.gesamt} % geplant">
          <div class="bs-balken-fuell" style="width:${fort.gesamt}%"></div>
        </div>
        <div class="bs-karte-fuss">
          <span class="bs-prozent">${fort.gesamt} % geplant</span>
          <span class="bs-karte-aktionen">
            ${istAbgeschickt(s) ? `<a class="btn btn--ghost btn--sm" href="#/admin/shoot/${encodeURIComponent(s.id)}">🎬 Shoot-Modus</a>` : ""}
            <a class="btn btn--ghost btn--sm" href="${href}">Öffnen</a>
            <button class="btn btn--ghost btn--sm bs-del" type="button">Löschen</button>
          </span>
        </div>
      </article>`;
  }

  function zeichne() {
    const gefiltert = skripte.filter(passtZumFilter);
    if (!gefiltert.length) {
      liste.innerHTML = `<div class="card card--pad empty-card">
        <div class="empty-emoji">🎙️</div>
        <p class="empty-title">${skripte.length ? "Nichts in diesem Filter" : "Noch kein Skript"}</p>
        <p class="muted">Leg mit „+ Neues Skript" los — erst runterschreiben, den Rest machst du danach.</p>
      </div>`;
      return;
    }
    liste.innerHTML = gefiltert.map(karteHtml).join("");

    // Löschen mit 2-Klick-Bestätigung (gleiche Geste wie in der Inspiration).
    liste.querySelectorAll(".bs-karte").forEach((karte) => {
      const id = karte.getAttribute("data-id");
      const del = karte.querySelector(".bs-del");
      del.addEventListener("click", async () => {
        if (!del.classList.contains("is-bestaetigen")) {
          del.classList.add("is-bestaetigen");
          del.textContent = "Wirklich löschen?";
          return;
        }
        del.disabled = true;
        try { await loescheBrandSkript(id); }
        catch (e) { console.warn("Löschen fehlgeschlagen:", e); del.disabled = false; }
      });
    });
  }

  const unsub = beobachteBrandSkripte(
    (l) => { skripte = l; zeichne(); },
    (err) => {
      console.warn("Skripte laden fehlgeschlagen:", err);
      liste.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden — sind die Firestore-Rules für „brandskripte" veröffentlicht?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}
