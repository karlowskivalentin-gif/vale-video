// Admin-View: Kalender. Read-only Monatsansicht der Videos mit geplantesDatum.
// Nutzt das geteilte Kalender-Modul; Chips verlinken auf die Admin-Video-Bearbeitung.
// Zusätzlich (nur Admin): private Plan-Marker via beobachtePlaene.
import { renderKalender } from "./_kalender-core.js";
import { beobachtePlaene } from "../db.js";

export function renderAdminKalender(container) {
  renderKalender(container, {
    intro: "Geplante Veröffentlichungen. Datum setzt du im jeweiligen Video.",
    chipHref: (v) => `#/admin/video/${encodeURIComponent(v.id)}`,
    beobachtePlaene
  });
}
