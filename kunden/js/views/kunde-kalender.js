// Kunden-View: Kalender. Dieselbe read-only Monatsansicht wie beim Admin,
// aber Chips verlinken auf die Kunden-Video-Detailseite (#/video/{id}).
import { renderKalender } from "./_kalender-core.js";

export function renderKundeKalender(container, opts = {}) {
  renderKalender(container, {
    intro: "Geplante Veröffentlichungen deiner Videos. Tippe auf einen Eintrag, um das Video zu öffnen.",
    chipHref: (v) => `#/video/${encodeURIComponent(v.id)}`,
    kundeId: opts.kundeId || null
  });
}
