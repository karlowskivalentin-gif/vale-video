// Admin-View: Pläne (private Video-/Konzept-Planung, „Incognito").
// Listet alle Pläne; Klick öffnet die Detail-/Editor-Ansicht.
// Rein admin-seitig — der Kunde sieht diesen Bereich nie (Route + Rules).
import { beobachtePlaene, loeschePlan } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum } from "../util.js";

const STATUS_LABEL = {
  entwurf:        { txt: "Entwurf",        cls: "entwurf" },
  veroeffentlicht:{ txt: "Veröffentlicht", cls: "veroeffentlicht" }
};

export function renderAdminPlaene(container) {
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Pläne</h1>
      <a class="btn btn--accent btn--sm" href="#/admin/plan/neu">+ Neuer Plan</a>
    </div>
    <p class="muted view-intro">Deine private Video-Planung: Inspirationen, Sound und Shotlist.
      Nur du siehst diesen Bereich — der Kunde nie. „Veröffentlichen" macht einen Plan
      nicht öffentlich, sondern markiert ihn für dich als fertige Referenz.</p>
    <div id="plList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const plList = container.querySelector("#plList");

  const unsub = beobachtePlaene(
    (plaene) => zeichne(plList, plaene),
    (err) => {
      console.error(err);
      plList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}

function zeichne(el, plaene) {
  if (!plaene.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">🎬</div>
      <p class="empty-title">Noch keine Pläne</p>
      <p class="muted">Lege deinen ersten Planvideo-Entwurf an — mit Inspirationen, Sound und Shotlist.</p>
      <a class="btn btn--accent btn--sm" href="#/admin/plan/neu" style="margin-top:0.75rem">+ Neuer Plan</a>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card row-list">
    ${plaene.map((p) => {
      const s = STATUS_LABEL[p.status] || STATUS_LABEL.entwurf;
      const insp = Array.isArray(p.inspirationen) ? p.inspirationen.length : 0;
      const shots = Array.isArray(p.shotlist) ? p.shotlist : [];
      const erledigt = shots.filter((x) => x && x.erledigt).length;
      const teile = [];
      if (p.typ) teile.push(escapeHtml(p.typ));
      if (insp)  teile.push(`${insp} Inspiration${insp === 1 ? "" : "en"}`);
      if (shots.length) teile.push(`Shotlist ${erledigt}/${shots.length}`);
      if (p.erstelltAm) teile.push(escapeHtml(formatDatum(p.erstelltAm)));
      const href = `#/admin/plan/${encodeURIComponent(p.id)}`;
      return `
        <div class="pl-row" data-id="${escapeHtml(p.id)}">
          <div class="pl-main">
            <a class="row-name" href="${href}">${escapeHtml(p.titel || "Ohne Titel")}</a>
            <span class="row-sub muted">${teile.join(" · ") || "—"}</span>
          </div>
          <div class="pl-status" style="display:flex;align-items:center;gap:0.6rem">
            <span class="plan-badge plan-badge--${s.cls}">${s.txt}</span>
            <button class="btn btn--ghost btn--sm pl-del" type="button" aria-label="Löschen">Löschen</button>
          </div>
        </div>`;
    }).join("")}
  </div>`;

  el.querySelectorAll(".pl-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    const plan = plaene.find((x) => x.id === id);
    row.querySelector(".pl-del").addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm(`Plan „${(plan && plan.titel) || ""}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await loeschePlan(id);
      } catch (err) {
        console.error(err);
        alert("Löschen fehlgeschlagen.");
        btn.disabled = false;
      }
    });
  });
}
