// Admin-View: Drehtag — große, tap-freundliche Beat-Checkliste für den Dreh
// vor Ort. Liest `drehbeats` LIVE vom Video (beobachteVideo) und schreibt jedes
// Abhaken sofort zurück. Erzeugt werden die Beats im Video-Editor
// (admin-video-edit.js → „Drehplan / Beats"). Nur Admin.
import { beobachteVideo, aktualisiereVideo } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

export function renderAdminDrehtag(container, ctx) {
  const id = ctx.id;

  if (!id) {
    container.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
      Kein Video ausgewählt. <a href="#/admin/pipeline">Zurück zur Pipeline</a>.</p></div>`;
    return;
  }

  container.innerHTML = `
    <a class="back-link" href="#/admin/video/${escapeHtml(id)}">← Zurück zum Video</a>
    <div class="dreh-head">
      <h1 class="view-title" id="dtTitel" style="margin:0">Drehtag</h1>
      <span class="dreh-fortschritt" id="dtFortschritt"></span>
    </div>
    <div id="dtBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const titelEl = container.querySelector("#dtTitel");
  const fortEl  = container.querySelector("#dtFortschritt");
  const body    = container.querySelector("#dtBody");

  let beats = [];
  let speicherLauf = Promise.resolve();

  const unsub = beobachteVideo(id, (v) => {
    if (!v) {
      body.innerHTML = `<div class="card card--pad"><p class="muted">Dieses Video existiert nicht (mehr).</p></div>`;
      return;
    }
    titelEl.textContent = `🎬 ${v.titel || "Drehtag"}`;
    beats = Array.isArray(v.drehbeats) ? v.drehbeats.slice() : [];
    zeichne();
  }, (e) => {
    console.error(e);
    body.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">Konnte das Video nicht laden.</p></div>`;
  });
  beiViewWechsel(unsub);

  function aktualisiereFortschritt() {
    const done = beats.filter((b) => b.erledigt).length;
    fortEl.textContent = beats.length ? `${done}/${beats.length}` : "";
  }

  function zeichne() {
    aktualisiereFortschritt();
    if (!beats.length) {
      body.innerHTML = `<div class="card card--pad empty-card">
        <div class="empty-emoji">🎬</div>
        <p class="empty-title">Noch kein Drehplan</p>
        <p class="muted">Erzeuge die Beats im <a href="#/admin/video/${escapeHtml(id)}">Video-Editor</a> aus dem Skript.</p>
      </div>`;
      return;
    }
    body.innerHTML = `
      <ul class="dreh-beats dreh-beats--gross">
        ${beats.map((b, i) => `
          <li class="dreh-beat dreh-beat--gross${b.erledigt ? " is-done" : ""}" data-i="${i}" role="button" tabindex="0">
            <div class="dreh-beat-haupt">
              <span class="dreh-beat-box" aria-hidden="true">${b.erledigt ? "✅" : "⬜"}</span>
              <span class="dreh-beat-titel">${escapeHtml(b.text || `Beat ${i + 1}`)}</span>
            </div>
            ${b.sprechtext ? `<div class="dreh-beat-text">${escapeHtml(b.sprechtext)}</div>` : ""}
          </li>`).join("")}
      </ul>`;

    body.querySelectorAll(".dreh-beat").forEach((li) => {
      const toggle = () => setzeErledigt(Number(li.getAttribute("data-i")), li);
      li.addEventListener("click", toggle);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
  }

  function setzeErledigt(i, li) {
    beats = beats.map((b, idx) => idx === i ? { ...b, erledigt: !b.erledigt } : b);
    const nun = beats[i].erledigt;
    // Optimistisch die eine Zeile aktualisieren (kein Full-Rerender → kein Flackern).
    if (li) {
      li.classList.toggle("is-done", nun);
      const box = li.querySelector(".dreh-beat-box");
      if (box) box.textContent = nun ? "✅" : "⬜";
    }
    aktualisiereFortschritt();
    // Schreibvorgänge serialisieren, damit schnelles Tippen sich nicht überholt.
    speicherLauf = speicherLauf.then(() => aktualisiereVideo(id, { drehbeats: beats }).catch((e) => console.error(e)));
  }
}
