// =====================================================================
// Admin-View „Social" — die Kennzahlen des aktiven Kunden.
//
// Zeigt Follower-Verlauf, Post-Kennzahlen und den Wirkungs-Nachweis
// („waechst der Account nach einem Video staerker als sonst?").
//
// Arbeitsteilung: gerechnet wird in js/socialstat.js, gezeichnet in
// js/socialchart.js — beides teilt sich diese View mit kunde-social.js,
// damit Valentin und sein Kunde nie verschiedene Zahlen sehen.
//
// Der Kunde wird NICHT hier gewaehlt: der Router liefert `opts.kundeId`
// aus dem globalen Mandanten-Umschalter (kunde-context.js).
//
// Rechte: Admin. Geschrieben wird von hier aus nur zweierlei — die
// manuelle Nacherfassung eines Tageswerts und die Verknuepfung eines
// Posts mit einem eigenen Video. Alles andere befuellt der Connector.
// =====================================================================
import {
  beobachteSocialKonten, beobachteSocialSnapshots, beobachteSocialPosts,
  beobachteVideos, speichereSocialSnapshot, setzeSocialPostVideo,
  loescheSocialSnapshot
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum, tagKey } from "../util.js";
import {
  zeitreihe, wachstum, wirkung, postsSortiert, postsMitVideo,
  postKennzahlen, engagement, zuDate, zahlKurz, zahlMitVorzeichen,
  reiheAuffuellen
} from "../socialstat.js";
import { toggleHtml, kurveHtml, wirkungHtml, kachelnHtml } from "../socialchart.js";

// Offen gebaut: das Datenmodell traegt ueberall ein `plattform`-Feld,
// hier muss spaeter nur eine Zeile dazu. Der Umschalter erscheint von
// selbst, sobald es zu mehr als einer Plattform Daten gibt.
const PLATTFORMEN = {
  instagram: { label: "Instagram", icon: "📸" },
  tiktok:    { label: "TikTok",    icon: "🎵" },
  youtube:   { label: "YouTube",   icon: "▶️" }
};

const GRAN = [["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"]];

const SORTIER_FELDER = [
  ["datum", "Neueste"], ["likes", "Likes"], ["reichweite", "Reichweite"],
  ["views", "Views"], ["engagement", "Engagement"]
];

const STATUS_TEXT = {
  aktiv:            { klasse: "ok",    text: "verbunden" },
  teilweise:        { klasse: "warn",  text: "verbunden, letzter Abruf unvollstaendig" },
  fehler:           { klasse: "error", text: "Fehler beim letzten Abruf" },
  token_abgelaufen: { klasse: "error", text: "Zugang abgelaufen — neu verbinden" },
  getrennt:         { klasse: "warn",  text: "getrennt" }
};

export function renderAdminSocial(container, opts = {}) {
  const kundeId = opts.kundeId || null;

  let konten = [], snapshots = [], posts = [], videos = [];
  let plattform = "instagram";
  let gran = "tag";
  let sortierung = "datum";
  let formOffen = false;

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title">Social</h1>
      <button id="smNeu" class="btn btn--ghost btn--sm" type="button">+ Wert nachtragen</button>
    </div>
    <p class="muted view-intro">Follower-Verlauf und Post-Zahlen des aktiven Kunden — und was deine Videos daran bewirkt haben.</p>
    <div id="smForm"></div>
    <div id="smInhalt" class="stack"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const formEl = container.querySelector("#smForm");
  const inhaltEl = container.querySelector("#smInhalt");

  container.querySelector("#smNeu").addEventListener("click", () => {
    formOffen = !formOffen;
    zeichneForm();
  });

  if (!kundeId) {
    inhaltEl.innerHTML = `
      <div class="card card--pad empty-card">
        <div class="empty-emoji">👥</div>
        <div class="empty-title">Kein Kunde ausgewaehlt</div>
        <p class="muted">Waehle oben einen Kunden aus, dann erscheinen hier seine Zahlen.</p>
      </div>`;
    return;
  }

  // Nur die Daten der gerade gezeigten Plattform.
  const eigene = (liste) => liste.filter((x) => (x.plattform || "instagram") === plattform);

  // --- Verbindungsstatus ----------------------------------------------
  function statusHtml() {
    const konto = konten.find((k) => k.plattform === plattform);
    const p = PLATTFORMEN[plattform] || { label: plattform, icon: "🔗" };

    if (!konto) {
      return `
        <div class="card card--pad sm-status">
          <div class="sm-status-kopf">
            <span class="sm-status-punkt is-warn"></span>
            <strong>${p.icon} ${escapeHtml(p.label)} — noch nicht verbunden</strong>
          </div>
          <p class="muted sm-status-meta">
            Solange kein Konto verbunden ist, kannst du Zahlen ueber „Wert nachtragen" von Hand
            erfassen. Der automatische Abruf kommt, sobald der Connector steht.
          </p>
        </div>`;
    }

    const s = STATUS_TEXT[konto.status] || { klasse: "warn", text: konto.status || "unbekannt" };
    return `
      <div class="card card--pad sm-status">
        <div class="sm-status-kopf">
          <span class="sm-status-punkt is-${s.klasse}"></span>
          <strong>${p.icon} ${escapeHtml(konto.handle ? "@" + konto.handle : p.label)}</strong>
          <span class="muted">— ${escapeHtml(s.text)}</span>
        </div>
        <p class="muted sm-status-meta">
          ${konto.letzterAbruf ? "Letzter Abruf: " + escapeHtml(formatDatum(konto.letzterAbruf, true)) : "Noch kein Abruf"}
          ${konto.verbundenAm ? " · verbunden seit " + escapeHtml(formatDatum(konto.verbundenAm, false)) : ""}
        </p>
        ${konto.letzterFehler
          ? `<p class="notice notice--error" style="margin:.6rem 0 0">${escapeHtml(String(konto.letzterFehler).slice(0, 300))}</p>`
          : ""}
      </div>`;
  }

  // --- Kacheln ---------------------------------------------------------
  function kacheln() {
    const reihe = reiheAuffuellen(eigene(snapshots));
    const aktuell = reihe.length ? Number(reihe[reihe.length - 1].follower) : 0;
    const w30 = wachstum(eigene(snapshots), 30);
    const k = postKennzahlen(eigene(posts), aktuell);

    return kachelnHtml([
      { zahl: zahlKurz(aktuell), label: "Follower" },
      {
        zahl: w30 ? zahlMitVorzeichen(w30.absolut) : "—",
        label: "letzte 30 Tage",
        trend: w30 ? { wert: `${w30.prozent > 0 ? "+" : ""}${w30.prozent} %`, auf: w30.absolut >= 0 } : null
      },
      { zahl: k.gesamt ? String(k.gesamt.anzahl) : "0", label: "erfasste Posts" },
      { zahl: k.gesamt ? zahlKurz(k.gesamt.schnittLikes) : "—", label: "Ø Likes" }
    ]);
  }

  // --- Post-Tabelle -----------------------------------------------------
  function postsHtml() {
    const liste = postsSortiert(postsMitVideo(eigene(posts), videos), sortierung);

    const kopf = `
      <div class="sm-block-kopf">
        <h2 class="sm-block-titel">Posts <span class="count-badge">${liste.length}</span></h2>
        ${toggleHtml("sort", sortierung, SORTIER_FELDER)}
      </div>`;

    if (!liste.length) {
      return `<div class="card card--pad">${kopf}
        <p class="muted">Noch keine Posts erfasst. Sie kommen mit dem ersten automatischen Abruf.</p>
      </div>`;
    }

    const optionen = (aktiv) => [`<option value="">— kein Video —</option>`]
      .concat(videos.map((v) =>
        `<option value="${escapeHtml(v.id)}"${v.id === aktiv ? " selected" : ""}>${escapeHtml(v.titel || "Ohne Titel")}</option>`))
      .join("");

    const zeilen = liste.map((p) => {
      const d = zuDate(p.veroeffentlichtAm);
      // Instagram-CDN-URLs laufen nach Stunden ab. Der Cron schreibt sie
      // taeglich neu; fuer die Luecken dazwischen liegt der Platzhalter als
      // CSS-Hintergrund BEREITS in der Box — das Bild blendet sich bei
      // Ladefehler nur aus und gibt ihn frei. Kein DOM-Gebastel im onerror.
      const bild = `<span class="sm-thumb-box">${p.thumbnail
        ? `<img class="sm-thumb" src="${escapeHtml(p.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : ""}</span>`;

      return `
        <tr>
          <td class="sm-td-bild">
            ${p.permalink ? `<a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">${bild}</a>` : bild}
          </td>
          <td>
            <div class="sm-post-datum">${escapeHtml(d ? formatDatum(d, false) : "—")}</div>
            <div class="muted sm-post-typ">${escapeHtml(p.typ || "")}</div>
          </td>
          <td class="sm-num">${escapeHtml(zahlKurz(p.likes))}</td>
          <td class="sm-num">${escapeHtml(zahlKurz(p.kommentare))}</td>
          <td class="sm-num">${escapeHtml(zahlKurz(p.reichweite))}</td>
          <td class="sm-num">${escapeHtml(zahlKurz(engagement(p)))}</td>
          <td class="sm-td-video">
            <select class="sm-video-wahl" data-id="${escapeHtml(p.id)}" aria-label="Video verknuepfen">
              ${optionen(p.videoId || "")}
            </select>
          </td>
        </tr>`;
    }).join("");

    return `
      <div class="card card--pad">
        ${kopf}
        <p class="muted sm-hinweis">
          Verknuepfe einen Post mit einem deiner Videos — daraus entsteht der Wirkungs-Nachweis oben.
          Die Zuordnung bleibt bestehen, auch wenn die Zahlen naechtlich aktualisiert werden.
        </p>
        <div class="sm-tabelle-wrap">
          <table class="sm-tabelle">
            <thead><tr>
              <th></th><th>Datum</th><th class="sm-num">Likes</th><th class="sm-num">Komm.</th>
              <th class="sm-num">Reichw.</th><th class="sm-num">Engag.</th><th>Mein Video</th>
            </tr></thead>
            <tbody>${zeilen}</tbody>
          </table>
        </div>
      </div>`;
  }

  // --- Erfasste Tage (mit Loeschen) -------------------------------------
  function tageHtml() {
    const liste = eigene(snapshots)
      .slice()
      .sort((a, b) => String(b.tag).localeCompare(String(a.tag)))
      .slice(0, 14);
    if (!liste.length) return "";

    return `
      <div class="card card--pad">
        <h2 class="sm-block-titel">Zuletzt erfasste Tage</h2>
        <div class="sm-tage">
          ${liste.map((s) => `
            <div class="sm-tag-zeile">
              <span class="sm-tag-datum">${escapeHtml(s.tag || "")}</span>
              <span class="sm-tag-wert">${escapeHtml(zahlKurz(s.follower))} Follower</span>
              <span class="muted sm-tag-quelle">${s.quelle === "manuell" ? "✍️ von Hand" : "⚙️ automatisch"}</span>
              ${s.quelle === "manuell"
                ? `<button class="sm-tag-del" data-id="${escapeHtml(s.id)}" type="button" title="Loeschen">×</button>`
                : ""}
            </div>`).join("")}
        </div>
      </div>`;
  }

  // --- Formular zur Nacherfassung ---------------------------------------
  function zeichneForm() {
    if (!formOffen) { formEl.innerHTML = ""; return; }

    formEl.innerHTML = `
      <div class="card card--pad sm-form">
        <h2 class="sm-block-titel">Wert nachtragen</h2>
        <p class="muted sm-hinweis">
          Von Hand erfasste Tage werden vom automatischen Abruf spaeter nicht ueberschrieben.
        </p>
        <div class="grid-2">
          <label class="field">Tag
            <input id="smTag" type="date" value="${escapeHtml(tagKey(new Date()))}">
          </label>
          <label class="field">Follower <span class="req">*</span>
            <input id="smFollower" type="number" min="0" step="1" placeholder="z. B. 1240">
          </label>
          <label class="field">Reichweite (an dem Tag)
            <input id="smReichweite" type="number" min="0" step="1" placeholder="optional">
          </label>
          <label class="field">Profilaufrufe (an dem Tag)
            <input id="smProfil" type="number" min="0" step="1" placeholder="optional">
          </label>
        </div>
        <div class="field-inline">
          <button id="smSpeichern" class="btn btn--accent btn--sm" type="button">Speichern</button>
          <button id="smAbbrechen" class="btn btn--ghost btn--sm" type="button">Abbrechen</button>
          <span id="smFormMeldung" class="muted"></span>
        </div>
      </div>`;

    const meldung = formEl.querySelector("#smFormMeldung");

    formEl.querySelector("#smAbbrechen").addEventListener("click", () => {
      formOffen = false;
      zeichneForm();
    });

    formEl.querySelector("#smSpeichern").addEventListener("click", async () => {
      const tag = formEl.querySelector("#smTag").value;
      const follower = formEl.querySelector("#smFollower").value;
      if (!tag || follower === "") {
        meldung.textContent = "Tag und Follower-Zahl sind noetig.";
        return;
      }
      meldung.textContent = "Speichert …";
      try {
        await speichereSocialSnapshot(kundeId, plattform, tag, {
          follower,
          reichweite: formEl.querySelector("#smReichweite").value,
          profilaufrufe: formEl.querySelector("#smProfil").value
        });
        formOffen = false;
        zeichneForm();
      } catch (err) {
        console.warn("Snapshot speichern fehlgeschlagen:", err);
        meldung.textContent = "Konnte nicht speichern.";
      }
    });
  }

  // --- Plattform-Umschalter (nur wenn es mehr als eine gibt) ------------
  function plattformWahlHtml() {
    const vorhanden = new Set(
      konten.map((k) => k.plattform)
        .concat(snapshots.map((s) => s.plattform))
        .filter((p) => p && PLATTFORMEN[p])
    );
    vorhanden.add("instagram");
    if (vorhanden.size < 2) return "";
    return toggleHtml("plattform", plattform,
      [...vorhanden].map((p) => [p, `${PLATTFORMEN[p].icon} ${PLATTFORMEN[p].label}`]));
  }

  // --- Gesamtes Zeichnen ------------------------------------------------
  function zeichne() {
    const reihe = zeitreihe(eigene(snapshots), gran, gran === "tag" ? 60 : 24);

    inhaltEl.innerHTML = `
      ${plattformWahlHtml()}
      ${statusHtml()}
      ${kacheln()}
      <div class="card card--pad">
        <div class="sm-block-kopf">
          <h2 class="sm-block-titel">Follower-Verlauf</h2>
          ${toggleHtml("gran", gran, GRAN)}
        </div>
        ${kurveHtml(reihe, "Noch zu wenig Datenpunkte. Ab dem zweiten erfassten Tag entsteht hier die Kurve.")}
      </div>
      <div class="card card--pad">
        <h2 class="sm-block-titel">Wirkung deiner Videos</h2>
        ${wirkungHtml(wirkung(eigene(snapshots), videos, 7),
          "Sobald genug Tage erfasst sind und mindestens ein Video auf „🚀 Gepostet\" mit "
          + "Veroeffentlichungsdatum steht, steht hier, wie stark der Account nach deinen Videos waechst.")}
      </div>
      ${postsHtml()}
      ${tageHtml()}`;

    // Delegation gibt es hier nicht (Hausstil) — nach jedem Neuaufbau
    // werden die Handler frisch gesetzt.
    inhaltEl.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const typ = btn.getAttribute("data-toggle");
        const val = btn.getAttribute("data-val");
        if (typ === "gran") gran = val;
        else if (typ === "sort") sortierung = val;
        else if (typ === "plattform") plattform = val;
        zeichne();
      });
    });

    inhaltEl.querySelectorAll(".sm-video-wahl").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await setzeSocialPostVideo(sel.getAttribute("data-id"), sel.value || null);
        } catch (err) {
          console.warn("Verknuepfung fehlgeschlagen:", err);
          alert("Konnte nicht speichern.");
        }
      });
    });

    // Zwei-Klick-Loeschen wie im Rest des Portals: der erste Klick fragt.
    inhaltEl.querySelectorAll(".sm-tag-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.sicher !== "1") {
          btn.dataset.sicher = "1";
          btn.textContent = "wirklich?";
          btn.classList.add("is-warnend");
          setTimeout(() => {
            if (!btn.isConnected) return;
            btn.dataset.sicher = "";
            btn.textContent = "×";
            btn.classList.remove("is-warnend");
          }, 4000);
          return;
        }
        try {
          await loescheSocialSnapshot(btn.getAttribute("data-id"));
        } catch (err) {
          console.warn("Loeschen fehlgeschlagen:", err);
          alert("Konnte nicht loeschen.");
        }
      });
    });
  }

  // --- Daten ------------------------------------------------------------
  function fehlerKarte(was) {
    inhaltEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
      ${escapeHtml(was)} konnte nicht geladen werden — sind die Firestore-Rules fuer die
      social-Collections veroeffentlicht?</p></div>`;
  }

  const unsubK = beobachteSocialKonten(
    (l) => { konten = l; zeichne(); },
    (err) => { console.warn("socialkonten:", err); fehlerKarte("Der Verbindungsstatus"); },
    kundeId
  );
  const unsubS = beobachteSocialSnapshots(
    (l) => { snapshots = l; zeichne(); },
    (err) => { console.warn("socialsnapshots:", err); fehlerKarte("Der Follower-Verlauf"); },
    kundeId
  );
  const unsubP = beobachteSocialPosts(
    (l) => { posts = l; zeichne(); },
    (err) => { console.warn("socialposts:", err); fehlerKarte("Die Posts"); },
    kundeId
  );
  const unsubV = beobachteVideos(
    (l) => { videos = l; zeichne(); },
    (err) => console.warn("videos:", err),
    kundeId
  );

  beiViewWechsel(unsubK);
  beiViewWechsel(unsubS);
  beiViewWechsel(unsubP);
  beiViewWechsel(unsubV);
}
