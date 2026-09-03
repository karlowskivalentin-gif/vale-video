// =====================================================================
// Kunden-View „Meine Zahlen" — die Entwicklung des eigenen Social-Accounts.
//
// Bewusst KUNDENSICHER und bewusst schmal: Kurve, drei Kacheln, der
// Wirkungs-Nachweis und die staerksten Posts. Kein Verbindungsstatus,
// keine Fehlermeldungen des Connectors, keine Token-Zustaende, keine
// Bearbeitung — das ist alles Innenleben und geht den Kunden nichts an.
// Was hier steht, ist die Antwort auf „bringt das eigentlich was?".
//
// `beobachteSocial…(…, kundeId)` liefert nur die eigenen Daten,
// zusaetzlich in firestore.rules ueber gehoertMir() abgesichert.
// =====================================================================
import { beobachteSocialSnapshots, beobachteSocialPosts, beobachteVideos } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum } from "../util.js";
import {
  zeitreihe, wachstum, wirkung, postsSortiert, postKennzahlen,
  engagement, zuDate, zahlKurz, zahlMitVorzeichen, reiheAuffuellen
} from "../socialstat.js";
import { toggleHtml, kurveHtml, wirkungHtml, kachelnHtml } from "../socialchart.js";

const GRAN = [["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"]];

// So viele Posts zeigt die Bestenliste. Mehr waere fuer den Kunden keine
// Uebersicht mehr, sondern eine Tabelle.
const TOP_ANZAHL = 6;

export function renderKundeSocial(container, opts = {}) {
  const kundeId = opts.kundeId || null;

  let snapshots = [], posts = [], videos = [];
  let gran = "woche";

  container.innerHTML = `
    <h1 class="view-title">Meine Zahlen</h1>
    <p class="muted view-intro">Wie sich dein Account entwickelt — und was die Videos daran bewirkt haben.</p>
    <div id="ksInhalt" class="stack"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const inhaltEl = container.querySelector("#ksInhalt");

  // Aktuell wird nur Instagram befuellt. Sobald weitere Plattformen dazu
  // kommen, bekommt auch diese Ansicht einen Umschalter — bis dahin waere
  // er nur ein Knopf ohne Wahl.
  const nurIg = (liste) => liste.filter((x) => (x.plattform || "instagram") === "instagram");

  function topPostsHtml() {
    const liste = postsSortiert(nurIg(posts), "engagement").slice(0, TOP_ANZAHL);
    if (!liste.length) return "";

    return `
      <div class="card card--pad">
        <h2 class="sm-block-titel">Deine staerksten Beitraege</h2>
        <div class="ks-posts">
          ${liste.map((p) => {
            const d = zuDate(p.veroeffentlichtAm);
            const bild = p.thumbnail
              ? `<img class="ks-post-bild" src="${escapeHtml(p.thumbnail)}" alt="" loading="lazy"
                   onerror="this.style.display='none'">`
              : "";
            const inhalt = `
              ${bild}
              <div class="ks-post-zahlen">
                <span title="Likes">❤️ ${escapeHtml(zahlKurz(p.likes))}</span>
                <span title="Kommentare">💬 ${escapeHtml(zahlKurz(p.kommentare))}</span>
                ${Number(p.reichweite) > 0 ? `<span title="Reichweite">👁 ${escapeHtml(zahlKurz(p.reichweite))}</span>` : ""}
              </div>
              <div class="muted ks-post-datum">${escapeHtml(d ? formatDatum(d, false) : "")}</div>`;
            return p.permalink
              ? `<a class="ks-post" href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">${inhalt}</a>`
              : `<div class="ks-post">${inhalt}</div>`;
          }).join("")}
        </div>
      </div>`;
  }

  function zeichne() {
    const eigeneSnaps = nurIg(snapshots);
    const reihe = reiheAuffuellen(eigeneSnaps);

    if (!reihe.length) {
      inhaltEl.innerHTML = `
        <div class="card card--pad empty-card">
          <div class="empty-emoji">📈</div>
          <div class="empty-title">Noch keine Zahlen</div>
          <p class="muted">
            Sobald dein Instagram-Konto verbunden ist, entsteht hier deine Wachstumskurve —
            und du siehst, was die Videos bewirken. Melde dich, wenn du das einrichten moechtest.
          </p>
        </div>`;
      return;
    }

    const aktuell = Number(reihe[reihe.length - 1].follower);
    const w30 = wachstum(eigeneSnaps, 30);
    const k = postKennzahlen(nurIg(posts), aktuell);

    inhaltEl.innerHTML = `
      ${kachelnHtml([
        { zahl: zahlKurz(aktuell), label: "Follower" },
        {
          zahl: w30 ? zahlMitVorzeichen(w30.absolut) : "—",
          label: "letzte 30 Tage",
          trend: w30 ? { wert: `${w30.prozent > 0 ? "+" : ""}${w30.prozent} %`, auf: w30.absolut >= 0 } : null
        },
        { zahl: k.gesamt ? zahlKurz(k.gesamt.schnittLikes) : "—", label: "Ø Likes pro Beitrag" }
      ])}

      <div class="card card--pad">
        <div class="sm-block-kopf">
          <h2 class="sm-block-titel">Dein Wachstum</h2>
          ${toggleHtml("gran", gran, GRAN)}
        </div>
        ${kurveHtml(zeitreihe(eigeneSnaps, gran, gran === "tag" ? 60 : 24),
          "Die Kurve entsteht, sobald ein paar Tage erfasst sind.")}
      </div>

      <div class="card card--pad">
        <h2 class="sm-block-titel">Was die Videos bewirken</h2>
        ${wirkungHtml(wirkung(eigeneSnaps, videos, 7),
          "Sobald ein paar Videos veroeffentlicht sind und genug Tage erfasst wurden, "
          + "steht hier der direkte Vergleich: Wachstum nach einem Video gegen Wachstum ohne.")}
      </div>

      ${topPostsHtml()}`;

    inhaltEl.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.getAttribute("data-toggle") === "gran") gran = btn.getAttribute("data-val");
        zeichne();
      });
    });
  }

  // Fehler bekommt der Kunde bewusst ohne technische Einzelheiten zu sehen.
  function stillerFehler(err) {
    console.error(err);
    inhaltEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
      Deine Zahlen konnten gerade nicht geladen werden. Bitte spaeter erneut versuchen.</p></div>`;
  }

  const unsubS = beobachteSocialSnapshots((l) => { snapshots = l; zeichne(); }, stillerFehler, kundeId);
  const unsubP = beobachteSocialPosts((l) => { posts = l; zeichne(); }, stillerFehler, kundeId);
  const unsubV = beobachteVideos((l) => { videos = l; zeichne(); }, (err) => console.warn(err), kundeId);

  beiViewWechsel(unsubS);
  beiViewWechsel(unsubP);
  beiViewWechsel(unsubV);
}
