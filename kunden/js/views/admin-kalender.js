// Admin-View: Kalender. Read-only Monatsansicht der Videos mit geplantesDatum.
// Nutzt das geteilte Kalender-Modul; Chips verlinken auf die Admin-Video-Bearbeitung.
// Zusätzlich (nur Admin): private Plan-Marker via beobachtePlaene.
import { renderKalender } from "./_kalender-core.js";
import { beobachtePlaene } from "../db.js";

export function renderAdminKalender(container, opts = {}) {
  renderKalender(container, {
    intro: "Geplante Veröffentlichungen. Datum setzt du im jeweiligen Video.",
    chipHref: (v) => `#/admin/video/${encodeURIComponent(v.id)}`,
    beobachtePlaene,
    kundeId: opts.kundeId || null,
    // Deep-Link aus der Pipeline: ?m=YYYY-MM springt zum Monat, ?mark=vd_/vp_<id>
    // hebt den Termin-Chip des Videos kurz hervor.
    startMonat: (opts.query && opts.query.m) || null,
    markiere:   (opts.query && opts.query.mark) || null
  });
}
