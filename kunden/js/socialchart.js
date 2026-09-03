// =====================================================================
// Social-Darstellung: die HTML-Bausteine, die Admin- und Kunden-Ansicht
// gemeinsam benutzen.
//
// Warum eine eigene Datei: die Kurve ist ~40 Zeilen SVG-Mathematik und die
// Wirkungs-Gegenueberstellung ist die Kernaussage des ganzen Features.
// Beides zweimal zu pflegen hiesse, dass Valentin und sein Kunde
// irgendwann verschiedene Bilder sehen. Gerechnet wird weiterhin nur in
// socialstat.js — hier steht ausschliesslich Darstellung.
//
// Bewusst KEINE Chart-Bibliothek: das Repo baut seine Diagramme von Hand
// (siehe admin-fokus.js), und fuer eine Linie plus Flaeche braucht es
// nichts ausser einer <polyline>.
// =====================================================================
import { escapeHtml } from "./util.js";
import { zahlKurz, zahlMitVorzeichen } from "./socialstat.js";

// --- Umschalter (Tag/Woche/Monat, Sortierung, Plattform) --------------
export function toggleHtml(typ, aktiv, optionen) {
  return `<div class="sm-toggle" role="tablist">${optionen.map(([val, lbl]) =>
    `<button class="sm-toggle-btn${val === aktiv ? " is-active" : ""}" data-toggle="${escapeHtml(typ)}" data-val="${escapeHtml(val)}" type="button">${escapeHtml(lbl)}</button>`
  ).join("")}</div>`;
}

// --- Follower-Kurve ---------------------------------------------------
// `reihe` kommt aus socialstat.zeitreihe(): [{ label, follower, zuwachs }].
// Gibt nur den Inhalt zurueck, nicht die Karte drumherum — die Ansichten
// setzen ihre eigene Ueberschrift davor.
export function kurveHtml(reihe, leerText = "Noch zu wenig Datenpunkte.") {
  if (!reihe || reihe.length < 2) {
    return `<p class="muted">${escapeHtml(leerText)}</p>`;
  }

  const werte = reihe.map((b) => b.follower);
  const min = Math.min(...werte), max = Math.max(...werte);
  // Waere die Linie konstant, ergaebe die Spanne 0 → Division durch null.
  const spanne = max - min || 1;

  const B = 600, H = 170, PAD_X = 8, PAD_Y = 14;
  const nutzB = B - PAD_X * 2, nutzH = H - PAD_Y * 2;

  const punkte = reihe.map((b, i) => {
    const x = PAD_X + (i / (reihe.length - 1)) * nutzB;
    const y = PAD_Y + nutzH - ((b.follower - min) / spanne) * nutzH;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });

  const linie = punkte.map((p) => p.join(",")).join(" ");
  // Flaeche darunter: dieselbe Linie, unten herum geschlossen.
  const flaeche = `${PAD_X},${H - PAD_Y} ${linie} ${PAD_X + nutzB},${H - PAD_Y}`;

  // Unsichtbare, grosszuegige Trefferflaechen fuer den Tooltip — die
  // sichtbaren Punkte waeren mit 3 px Radius auf dem Handy nicht treffbar.
  const marker = punkte.map((p, i) =>
    `<circle class="sm-punkt" cx="${p[0]}" cy="${p[1]}" r="8">
       <title>${escapeHtml(reihe[i].label)}: ${escapeHtml(zahlKurz(reihe[i].follower))} Follower (${escapeHtml(zahlMitVorzeichen(reihe[i].zuwachs))})</title>
     </circle>`).join("");

  // Nur drei Beschriftungen — mehr ueberlappt auf schmalen Schirmen.
  const idx = reihe.length > 2 ? [0, Math.floor(reihe.length / 2), reihe.length - 1] : [0, reihe.length - 1];
  const achse = idx.map((i) => `<span class="sm-achse-lbl">${escapeHtml(reihe[i].label)}</span>`).join("");

  return `
    <div class="sm-kurve-wrap">
      <svg class="sm-kurve" viewBox="0 0 ${B} ${H}" preserveAspectRatio="none"
           role="img" aria-label="Follower-Verlauf">
        <polygon class="sm-flaeche" points="${flaeche}"></polygon>
        <polyline class="sm-linie" points="${linie}"></polyline>
        ${marker}
      </svg>
      <div class="sm-achse">${achse}</div>
    </div>
    <div class="sm-kurve-fuss muted">
      ${escapeHtml(zahlKurz(min))} – ${escapeHtml(zahlKurz(max))} Follower im gezeigten Zeitraum
    </div>`;
}

// --- Wirkungs-Gegenueberstellung --------------------------------------
// `w` kommt aus socialstat.wirkung() oder ist null.
export function wirkungHtml(w, leerText) {
  if (!w) return `<p class="muted">${escapeHtml(leerText)}</p>`;

  const besser = w.unterschied > 0;
  return `
    <p class="muted sm-wirkung-frage">
      Follower-Zuwachs in den ${w.fenster} Tagen nach einem Video, verglichen mit Zeitraeumen ohne:
    </p>
    <div class="sm-wirkung">
      <div class="sm-wirkung-seite is-mit">
        <div class="sm-wirkung-zahl">${escapeHtml(zahlMitVorzeichen(w.mitVideo))}</div>
        <div class="sm-wirkung-lbl">nach einem Video</div>
        <div class="muted sm-wirkung-n">${w.anzahlMit} Zeitfenster</div>
      </div>
      <div class="sm-wirkung-seite">
        <div class="sm-wirkung-zahl">${escapeHtml(zahlMitVorzeichen(w.ohneVideo))}</div>
        <div class="sm-wirkung-lbl">ohne Video</div>
        <div class="muted sm-wirkung-n">${w.anzahlOhne} Zeitfenster</div>
      </div>
    </div>
    <p class="sm-wirkung-fazit${besser ? " is-gut" : ""}">
      ${besser
        ? `${escapeHtml(zahlMitVorzeichen(w.unterschied))} Follower mehr pro Woche${w.faktor ? ` — das ${w.faktor}-fache` : ""}.`
        : "Aktuell noch kein messbarer Unterschied."}
    </p>
    <p class="muted sm-hinweis">
      Gerechnet ueber ${w.videoTage} veroeffentlichte${w.videoTage === 1 ? "s Video" : " Videos"}.
      Als Vergleich zaehlen nur Zeitraeume, in denen weder ein Video lief noch kurz davor
      eines lag${w.anzahlVerworfen ? ` (${w.anzahlVerworfen} Zeitfenster deshalb ausgelassen)` : ""} —
      sonst wuerde die Nachwirkung den Vergleichswert anheben und die Wirkung kleiner
      erscheinen lassen, als sie ist.
    </p>`;
}

// --- Kennzahl-Kacheln -------------------------------------------------
// `kacheln` = [{ zahl, label, trend?: { wert, auf } }]
export function kachelnHtml(kacheln) {
  return `<div class="sm-kacheln">${kacheln.map((k) => `
    <div class="sm-kachel">
      <div class="sm-kachel-zahl">${escapeHtml(String(k.zahl))}</div>
      <div class="sm-kachel-lbl">${escapeHtml(k.label)}</div>
      ${k.trend
        ? `<div class="sm-kachel-trend ${k.trend.auf ? "is-auf" : "is-ab"}">${escapeHtml(k.trend.wert)}</div>`
        : ""}
    </div>`).join("")}</div>`;
}
