// Admin-View: Webseite (Admin-only) — steuert die ÖFFENTLICHE Seite
// vale-video.de aus dem Portal heraus. Zwei Tabs:
//
//   📮 Posts      — neue Videos/Projekte per Link anlegen (TikTok/Instagram/
//                   YouTube/Vimeo). Absenden = sofort live, kein Deploy nötig:
//                   die Website liest `webvideos` direkt aus Firestore.
//   🏠 Startseite — Baukasten für das Kachel-Raster (.hero-grid) auf index.html,
//                   mit echter Live-Vorschau im iframe.
//
// Bewusst EINE Route mit Tabs statt zweier: die Admin-Nav hat bereits 15
// Einträge, und beides gehört zur selben Sache („was steht auf der Website“).
//
// Alles, was hier entsteht, ist ÖFFENTLICH. Deshalb hat diese View als einzige
// Admin-View Collections, die ohne Login lesbar sind (siehe firestore.rules).
import {
  beobachteWebvideos, webvideoAnlegen, aktualisiereWebvideo, loescheWebvideo,
  webthumbAnlegen, ladeWebthumb, beobachteStartseite, speichereStartseiteEntwurf,
  veroeffentlicheStartseite, WEB_KATEGORIEN
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { erkennePlattform } from "../embeds.js";
import { youtubeId, vimeoId } from "../drive.js";

// Die sieben handgebauten Projektseiten. Sie bleiben statisches HTML im
// Eltern-Repo — hier stehen nur ihre Eckdaten, damit sie im Baukasten mit den
// neuen Posts mischbar sind, ohne sie nach Firestore migrieren zu müssen.
// ACHTUNG: Diese Liste existiert gespiegelt in ../../js/web-daten.js (die
// öffentliche Seite kennt das Portal nicht). Änderungen an beiden Stellen.
export const STATISCHE_PROJEKTE = [
  { ref: "projekt-amsterdam.html",   titel: "Amsterdam by Day",      tag: "Persönlich · Cinematic Travel", thumb: "assets/images/thumb-amsterdam.webp",   kategorie: "persoenlich" },
  { ref: "projekt-schneider.html",   titel: "Café Schneider Benrath", tag: "Auftrag · Imagefilm · Interview", thumb: "assets/images/thumb-schneider.webp", kategorie: "imagefilm" },
  { ref: "projekt-zicke.html",       titel: "Bistro Zicke Düsseldorf", tag: "Auftrag · Imagefilm",          thumb: "assets/images/thumb-zicke.webp",       kategorie: "imagefilm" },
  { ref: "projekt-clubpilates.html", titel: "Club Pilates × Fibo 2026", tag: "Auftrag · Event · Reel",      thumb: "assets/images/thumb-clubpilates.webp", kategorie: "reels" },
  { ref: "projekt-cathy.html",       titel: "Cathy Hummels Interview", tag: "Auftrag · Interview · Reel",   thumb: "assets/images/thumb-cathy.webp",       kategorie: "reels" },
  { ref: "projekt-goldhaus.html",    titel: "Goldhaus",               tag: "Auftrag · Imagefilm",           thumb: "assets/images/thumb-goldhaus.webp",    kategorie: "imagefilm" },
  { ref: "projekt-pia.html",         titel: "Pia — Urdenbach",        tag: "Persönlich · Objektfilm",       thumb: "assets/images/thumb-pia.webp",         kategorie: "persoenlich" }
];

const KAT_LABEL = {
  imagefilm:   "🎬 Imagefilm",
  reels:       "📱 Reels",
  objekt:      "🏠 Objektvideo",
  persoenlich: "✨ Persönlich"
};

// Plattformen, die selbst ein Vorschaubild liefern. Bei allen anderen muss
// eins hochgeladen werden — TikTok und Instagram geben keins ohne Login her.
const AUTO_THUMB = new Set(["youtube", "vimeo"]);

// =====================================================================
// Helfer
// =====================================================================

// Vorschaubild-URL aus dem Video-Link, wo die Plattform das hergibt.
// YouTube: direkt aus der ID. Vimeo: über deren oEmbed-Endpunkt (erlaubt CORS).
async function autoThumb(url) {
  const p = erkennePlattform(url);
  if (p === "youtube") {
    const id = youtubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : "";
  }
  if (p === "vimeo" && vimeoId(url)) {
    try {
      const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
                            { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      return d.thumbnail_url || "";
    } catch (_) { return ""; }   // kein Blocker: dann eben manuell hochladen
  }
  return "";
}

// Bild auf Web-Maß bringen, bevor es als base64 in Firestore geht.
// 640 px lange Kante als WebP landet bei ~30–60 KB — weit unter dem
// 1-MB-Limit eines Firestore-Dokuments, und für eine Kachel mehr als genug.
async function skaliereBild(file, maxKante = 640) {
  const bitmap = await createImageBitmap(file);
  const faktor = Math.min(1, maxKante / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * faktor);
  const h = Math.round(bitmap.height * faktor);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return c.toDataURL("image/webp", 0.82);   // vollständige data:-URL
}

// Anzeigbares Bild eines Posts: Auto-Thumb oder hochgeladenes (data:-URL).
function postBild(v, thumbCache) {
  if (v.thumbUrl) return v.thumbUrl;
  if (v.thumbId && thumbCache.has(v.thumbId)) return thumbCache.get(v.thumbId);
  return "";
}

// =====================================================================
// View
// =====================================================================
export function renderAdminWebseite(container) {
  let tab = "posts";                 // 'posts' | 'startseite'
  let posts = [];
  let startseite = { kacheln: [], entwurf: null };
  let entwurf = null;                // lokaler Arbeitsstand des Baukastens
  const thumbCache = new Map();      // thumbId → data:-URL
  let bearbeitet = null;             // id des Posts im Bearbeiten-Modus

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Webseite</h1>
      <a class="btn btn--ghost btn--sm" href="https://vale-video.de/" target="_blank" rel="noopener">vale-video.de ansehen ↗</a>
    </div>
    <p class="muted view-intro">Was hier steht, ist <strong>öffentlich</strong> — es landet direkt auf
      vale-video.de. Kein Deploy nötig: Absenden genügt.</p>
    <div class="wb-tabs" id="wbTabs">
      <button class="wb-tab is-active" data-tab="posts" type="button">📮 Posts</button>
      <button class="wb-tab" data-tab="startseite" type="button">🏠 Startseite</button>
    </div>
    <div id="wbInhalt"><div class="card card--pad"><p class="muted">Lädt …</p></div></div>`;

  const inhalt = container.querySelector("#wbInhalt");

  container.querySelectorAll(".wb-tab").forEach((b) => b.addEventListener("click", () => {
    tab = b.getAttribute("data-tab");
    container.querySelectorAll(".wb-tab").forEach((x) => x.classList.toggle("is-active", x === b));
    zeichne();
  }));

  // --- Datenquellen ----------------------------------------------------
  const unsubV = beobachteWebvideos(
    (liste) => {
      posts = liste;
      // Hochgeladene Vorschaubilder nachladen (einmal pro Blob).
      liste.filter((v) => v.thumbId && !thumbCache.has(v.thumbId)).forEach(async (v) => {
        try {
          const t = await ladeWebthumb(v.thumbId);
          if (t && t.base64) { thumbCache.set(v.thumbId, t.base64); zeichne(); }
        } catch (_) { /* Bild fehlt → Karte zeigt Platzhalter */ }
      });
      zeichne();
    },
    (err) => {
      console.warn("webvideos laden fehlgeschlagen:", err);
      inhalt.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden — sind die Firestore-Rules für „webvideos“ veröffentlicht?</p></div>`;
    }
  );

  const unsubS = beobachteStartseite(
    (d) => {
      startseite = d || { kacheln: [], entwurf: null };
      // Ein gespeicherter Entwurf hat Vorrang; sonst der veröffentlichte Stand.
      if (entwurf === null) entwurf = (startseite.entwurf || startseite.kacheln || []).slice();
      zeichne();
    },
    (err) => console.warn("startseite laden fehlgeschlagen:", err)
  );

  beiViewWechsel(unsubV);
  beiViewWechsel(unsubS);

  // =====================================================================
  // Zeichnen
  // =====================================================================
  function zeichne() {
    if (tab === "posts") zeichnePosts();
    else zeichneStartseite();
  }

  // --- Tab „Posts“ -----------------------------------------------------
  function zeichnePosts() {
    inhalt.innerHTML = `
      <section class="card card--pad wb-form-karte">
        <h2 class="wb-form-titel">${bearbeitet ? "Post bearbeiten" : "Neuer Post"}</h2>
        <form id="wbForm" novalidate>
          <div class="field">
            <label for="wb-url">Video-Link <span class="req">*</span></label>
            <input id="wb-url" type="url" placeholder="tiktok.com/… · instagram.com/reel/… · youtube.com/… · vimeo.com/…" />
            <p class="field-hint muted" id="wb-plattform">Plattform wird automatisch erkannt.</p>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="wb-titel">Titel <span class="req">*</span></label>
              <input id="wb-titel" type="text" placeholder="z. B. Café Schneider Benrath" />
            </div>
            <div class="field">
              <label for="wb-untertitel">Unterzeile</label>
              <input id="wb-untertitel" type="text" placeholder="z. B. Auftrag · Imagefilm · Interview" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="wb-kat">Kategorie</label>
              <select id="wb-kat">${WEB_KATEGORIEN.map((k) =>
                `<option value="${k}">${escapeHtml(KAT_LABEL[k])}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label for="wb-ort">Ort <span class="muted">(optional)</span></label>
              <input id="wb-ort" type="text" placeholder="z. B. Düsseldorf" />
            </div>
          </div>
          <div class="field">
            <label for="wb-art">Art <span class="muted">(optional — Meta-Block auf der Detailseite)</span></label>
            <input id="wb-art" type="text" placeholder="z. B. Auftrag · Imagefilm" />
          </div>
          <div class="field">
            <label for="wb-text">Beschreibung</label>
            <textarea id="wb-text" style="min-height:110px" placeholder="Was war das Projekt? Steht auf der Detailseite."></textarea>
          </div>

          <div class="wb-thumb-block" id="wbThumbBlock">
            <label>Vorschaubild</label>
            <div class="wb-thumb-zeile">
              <div class="wb-thumb-vorschau" id="wbThumbVorschau"><span class="muted">—</span></div>
              <div class="wb-thumb-aktion">
                <p class="field-hint muted" id="wbThumbHinweis">Link einfügen — bei YouTube und Vimeo kommt das Bild automatisch.</p>
                <input id="wb-bild" type="file" accept="image/*" hidden />
                <button class="btn btn--ghost btn--sm" id="wbBildBtn" type="button" hidden>Bild wählen</button>
              </div>
            </div>
          </div>

          <div class="field field--check">
            <label><input id="wb-hoch" type="checkbox" /> Hochformat (9:16) — für Reels und TikToks</label>
          </div>
          <div class="field field--check">
            <label><input id="wb-live" type="checkbox" checked /> Sofort veröffentlichen</label>
          </div>

          <div class="action-btns">
            <button class="btn btn--accent btn--sm" type="submit" id="wbSave">${bearbeitet ? "Änderungen speichern" : "Absenden — ab auf die Website"}</button>
            ${bearbeitet ? `<button class="btn btn--ghost btn--sm" id="wbAbbr" type="button">Abbrechen</button>` : ""}
          </div>
        </form>
      </section>

      <h2 class="wb-listen-titel">Deine Posts <span class="muted">(${posts.length})</span></h2>
      <div class="wb-grid" id="wbListe">${posts.length
        ? posts.map(postKarte).join("")
        : `<div class="card card--pad empty-card" style="grid-column:1/-1">
             <div class="empty-emoji">📮</div>
             <p class="empty-title">Noch keine Posts</p>
             <p class="muted">Füg oben einen Link ein — er steht sofort auf vale-video.de.</p>
           </div>`}</div>`;

    wirePostForm();
    wirePostListe();
  }

  function postKarte(v) {
    const bild = postBild(v, thumbCache);
    return `
      <article class="card wb-karte${v.veroeffentlicht ? "" : " is-entwurf"}" data-id="${escapeHtml(v.id)}">
        <div class="wb-karte-bild${v.hochformat ? " is-hoch" : ""}">
          ${bild ? `<img src="${escapeHtml(bild)}" alt="" loading="lazy" />`
                 : `<span class="wb-kein-bild">kein Bild</span>`}
          ${v.veroeffentlicht ? "" : `<span class="wb-entwurf-pill">Entwurf</span>`}
        </div>
        <div class="wb-karte-text">
          <p class="wb-karte-tag muted">${escapeHtml(v.untertitel || KAT_LABEL[v.kategorie] || "")}</p>
          <h3 class="wb-karte-titel">${escapeHtml(v.titel || "Ohne Titel")}</h3>
        </div>
        <div class="wb-karte-btns">
          <button class="btn btn--ghost btn--sm wb-live" type="button">${v.veroeffentlicht ? "Auf Entwurf" : "Veröffentlichen"}</button>
          <button class="btn btn--ghost btn--sm wb-edit" type="button">Bearbeiten</button>
          <button class="gd-del wb-del" type="button" title="Post löschen">✕</button>
        </div>
      </article>`;
  }

  function wirePostForm() {
    const form   = inhalt.querySelector("#wbForm");
    const urlEl  = inhalt.querySelector("#wb-url");
    const plat   = inhalt.querySelector("#wb-plattform");
    const vorsch = inhalt.querySelector("#wbThumbVorschau");
    const hinweis= inhalt.querySelector("#wbThumbHinweis");
    const bildBtn= inhalt.querySelector("#wbBildBtn");
    const bildEl = inhalt.querySelector("#wb-bild");

    // Beim Bearbeiten die vorhandenen Werte einsetzen.
    let thumbUrl = "", thumbBase64 = "", thumbIdAlt = "";
    if (bearbeitet) {
      const v = posts.find((x) => x.id === bearbeitet);
      if (v) {
        urlEl.value = v.url || "";
        inhalt.querySelector("#wb-titel").value      = v.titel || "";
        inhalt.querySelector("#wb-untertitel").value = v.untertitel || "";
        inhalt.querySelector("#wb-kat").value        = v.kategorie || "reels";
        inhalt.querySelector("#wb-ort").value        = v.ort || "";
        inhalt.querySelector("#wb-art").value        = v.art || "";
        inhalt.querySelector("#wb-text").value       = v.beschreibung || "";
        inhalt.querySelector("#wb-hoch").checked     = v.hochformat === true;
        inhalt.querySelector("#wb-live").checked     = v.veroeffentlicht !== false;
        thumbUrl = v.thumbUrl || ""; thumbIdAlt = v.thumbId || "";
        const b = postBild(v, thumbCache);
        if (b) vorsch.innerHTML = `<img src="${escapeHtml(b)}" alt="" />`;
      }
    }

    function zeigeBild(src) {
      vorsch.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="" />` : `<span class="muted">—</span>`;
    }

    // Link eingefügt → Plattform erkennen, Thumbnail holen bzw. Upload anbieten.
    async function pruefeUrl() {
      const url = urlEl.value.trim();
      if (!url) { plat.textContent = "Plattform wird automatisch erkannt."; bildBtn.hidden = true; return; }
      const p = erkennePlattform(url);
      plat.textContent = `Erkannt: ${p === "andere" ? "unbekannte Plattform" : p}`;
      if (AUTO_THUMB.has(p)) {
        hinweis.textContent = "Vorschaubild wird geholt …";
        const t = await autoThumb(url);
        if (t) {
          thumbUrl = t; thumbBase64 = "";
          zeigeBild(t);
          hinweis.textContent = "Vorschaubild automatisch übernommen.";
          bildBtn.hidden = true;
          return;
        }
      }
      // TikTok/Instagram (oder Vimeo ohne oEmbed-Treffer): manuell.
      thumbUrl = "";
      hinweis.textContent = `${p === "tiktok" || p === "instagram" ? "TikTok und Instagram" : "Diese Plattform"} gibt kein Vorschaubild her — bitte eins hochladen.`;
      bildBtn.hidden = false;
    }
    urlEl.addEventListener("change", pruefeUrl);
    urlEl.addEventListener("paste", () => setTimeout(pruefeUrl, 60));

    bildBtn.addEventListener("click", () => bildEl.click());
    bildEl.addEventListener("change", async () => {
      const f = bildEl.files && bildEl.files[0];
      if (!f) return;
      hinweis.textContent = "Bild wird verkleinert …";
      try {
        thumbBase64 = await skaliereBild(f);
        thumbUrl = "";
        zeigeBild(thumbBase64);
        hinweis.textContent = `Bild übernommen (${Math.round(thumbBase64.length / 1024)} KB).`;
      } catch (e) {
        console.warn("Bild verkleinern fehlgeschlagen:", e);
        hinweis.textContent = "Bild konnte nicht gelesen werden.";
      }
    });

    const abbr = inhalt.querySelector("#wbAbbr");
    if (abbr) abbr.addEventListener("click", () => { bearbeitet = null; zeichne(); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let url = urlEl.value.trim();
      const titel = inhalt.querySelector("#wb-titel").value.trim();
      if (!url || !titel) { (!url ? urlEl : inhalt.querySelector("#wb-titel")).focus(); return; }
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;

      const save = inhalt.querySelector("#wbSave");
      save.disabled = true; save.textContent = "Speichert …";
      try {
        // Neu hochgeladenes Bild zuerst ablegen, damit der Post die ID kennt.
        let thumbId = thumbIdAlt;
        if (thumbBase64) thumbId = await webthumbAnlegen({ base64: thumbBase64 });

        const daten = {
          url, titel,
          untertitel:   inhalt.querySelector("#wb-untertitel").value.trim(),
          kategorie:    inhalt.querySelector("#wb-kat").value,
          ort:          inhalt.querySelector("#wb-ort").value.trim(),
          art:          inhalt.querySelector("#wb-art").value.trim(),
          beschreibung: inhalt.querySelector("#wb-text").value.trim(),
          hochformat:   inhalt.querySelector("#wb-hoch").checked,
          veroeffentlicht: inhalt.querySelector("#wb-live").checked,
          plattform:    erkennePlattform(url),
          thumbUrl, thumbId
        };
        if (bearbeitet) await aktualisiereWebvideo(bearbeitet, daten);
        else await webvideoAnlegen(daten);
        bearbeitet = null;
        zeichne();   // Observer zeichnet ohnehin gleich nochmal
      } catch (err) {
        console.warn("Post speichern fehlgeschlagen:", err);
        alert("Konnte nicht speichern. Sind die Firestore-Rules für „webvideos“ veröffentlicht?");
        save.disabled = false; save.textContent = "Absenden — ab auf die Website";
      }
    });
  }

  function wirePostListe() {
    inhalt.querySelectorAll(".wb-karte").forEach((k) => {
      const id = k.getAttribute("data-id");
      const v = posts.find((x) => x.id === id);
      if (!v) return;

      k.querySelector(".wb-edit").addEventListener("click", () => {
        bearbeitet = id; zeichne();
        inhalt.querySelector("#wbForm").scrollIntoView({ behavior: "smooth", block: "start" });
      });

      k.querySelector(".wb-live").addEventListener("click", async (ev) => {
        ev.currentTarget.disabled = true;
        try { await aktualisiereWebvideo(id, { veroeffentlicht: !v.veroeffentlicht }); }
        catch (e) { console.warn(e); ev.currentTarget.disabled = false; }
      });

      // Löschen mit 2-Klick-Bestätigung (Muster aus admin-inspiration.js).
      const del = k.querySelector(".wb-del");
      del.addEventListener("click", async () => {
        if (!del.classList.contains("is-bestaetigen")) {
          del.classList.add("is-bestaetigen"); del.textContent = "Löschen?";
          setTimeout(() => { if (del.isConnected) { del.classList.remove("is-bestaetigen"); del.textContent = "✕"; } }, 4000);
          return;
        }
        try { await loescheWebvideo(id, v.thumbId); } catch (e) { console.warn(e); }
      });
    });
  }

  // --- Tab „Startseite“ (Baukasten) ------------------------------------
  function zeichneStartseite() {
    const gewaehlt = entwurf || [];
    const belegt = new Set(gewaehlt.map((k) => k.ref));
    const live = posts.filter((p) => p.veroeffentlicht);

    // Pool = statische Projekte + veröffentlichte Posts, ohne die bereits
    // platzierten (doppelte Kacheln auf der Startseite ergäben keinen Sinn).
    const pool = [
      ...STATISCHE_PROJEKTE.map((p) => ({ quelle: "statisch", ref: p.ref, titel: p.titel, tag: p.tag, bild: "../" + p.thumb })),
      ...live.map((p) => ({ quelle: "post", ref: p.id, titel: p.titel, tag: p.untertitel || KAT_LABEL[p.kategorie] || "", bild: postBild(p, thumbCache) }))
    ].filter((p) => !belegt.has(p.ref));

    const geaendert = JSON.stringify(gewaehlt) !== JSON.stringify(startseite.kacheln || []);

    inhalt.innerHTML = `
      <div class="wb-bk-kopf">
        <p class="muted" style="margin:0">Zieh Kacheln nach rechts — so sieht die Startseite oben aus.
          Die erste Kachel ist üblicherweise die breite.</p>
        <div class="action-btns" style="margin:0">
          <button class="btn btn--accent btn--sm" id="wbPub" type="button"${geaendert ? "" : " disabled"}>Veröffentlichen</button>
          <button class="btn btn--ghost btn--sm" id="wbReset" type="button"${geaendert ? "" : " disabled"}>Verwerfen</button>
        </div>
      </div>
      ${geaendert ? `<p class="notice notice--warn wb-hinweis">Ungespeicherte Änderungen — die Vorschau unten zeigt sie schon, vale-video.de noch nicht.</p>` : ""}

      <div class="wb-bk">
        <section class="card card--pad wb-bk-pool">
          <h3 class="wb-bk-titel">Verfügbar <span class="muted">(${pool.length})</span></h3>
          <div class="wb-bk-liste" id="wbPool">
            ${pool.length ? pool.map((p) => kachelHtml(p, "pool")).join("")
                          : `<p class="muted">Alles platziert.</p>`}
          </div>
        </section>

        <section class="card card--pad wb-bk-slots">
          <h3 class="wb-bk-titel">Auf der Startseite <span class="muted">(${gewaehlt.length})</span></h3>
          <div class="wb-bk-liste" id="wbSlots">
            ${gewaehlt.length ? gewaehlt.map((k, i) => slotHtml(k, i, live)).join("")
                              : `<p class="muted wb-bk-leer">Noch nichts gewählt — die Startseite zeigt dann ihr eingebautes Standard-Raster.</p>`}
          </div>
        </section>
      </div>

      <section class="card card--pad wb-vorschau-karte">
        <h3 class="wb-bk-titel">Live-Vorschau <span class="muted">— die echte Startseite</span></h3>
        <div class="wb-vorschau"><iframe id="wbFrame" src="../index.html?vorschau=1" title="Vorschau der Startseite"></iframe></div>
      </section>`;

    wireBaukasten(live);
  }

  function kachelHtml(p, wo) {
    return `
      <div class="wb-bk-kachel" draggable="true" data-ref="${escapeHtml(p.ref)}" data-quelle="${escapeHtml(p.quelle)}" data-wo="${wo}">
        <div class="wb-bk-bild">${p.bild ? `<img src="${escapeHtml(p.bild)}" alt="" loading="lazy" />` : ""}</div>
        <div class="wb-bk-text">
          <span class="wb-bk-tag muted">${escapeHtml(p.tag || "")}</span>
          <span class="wb-bk-name">${escapeHtml(p.titel || p.ref)}</span>
        </div>
        <button class="btn btn--ghost btn--sm wb-bk-add" type="button" title="Auf die Startseite">→</button>
      </div>`;
  }

  function slotHtml(k, i, live) {
    const meta = k.quelle === "statisch"
      ? STATISCHE_PROJEKTE.find((p) => p.ref === k.ref)
      : live.find((p) => p.id === k.ref);
    const titel = meta ? (meta.titel || "") : "(nicht mehr vorhanden)";
    const tag   = meta ? (meta.tag || meta.untertitel || "") : "";
    const bild  = !meta ? "" : (k.quelle === "statisch" ? "../" + meta.thumb : postBild(meta, thumbCache));
    return `
      <div class="wb-bk-kachel wb-bk-slot${k.breit ? " is-breit" : ""}${meta ? "" : " is-tot"}"
           draggable="true" data-i="${i}" data-wo="slot">
        <span class="wb-bk-pos">${i + 1}</span>
        <div class="wb-bk-bild">${bild ? `<img src="${escapeHtml(bild)}" alt="" loading="lazy" />` : ""}</div>
        <div class="wb-bk-text">
          <span class="wb-bk-tag muted">${escapeHtml(tag)}</span>
          <span class="wb-bk-name">${escapeHtml(titel)}</span>
        </div>
        <div class="wb-bk-slot-btns">
          <button class="wb-bk-breit${k.breit ? " is-on" : ""}" type="button" title="Breite Kachel (nimmt zwei Spalten)">⬌</button>
          <button class="wb-bk-hoch" type="button" title="Nach vorne">↑</button>
          <button class="wb-bk-runter" type="button" title="Nach hinten">↓</button>
          <button class="gd-del wb-bk-weg" type="button" title="Von der Startseite nehmen">✕</button>
        </div>
      </div>`;
  }

  function wireBaukasten(live) {
    const frame = inhalt.querySelector("#wbFrame");

    // Entwurf in die Vorschau schicken. Der iframe liest NICHT aus Firestore —
    // so muss ein unveröffentlichter Stand dort gar nicht erst öffentlich sein.
    function sendeVorschau() {
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage(
        { typ: "vv-startseite-vorschau", kacheln: aufgeloest(entwurf || [], live) },
        location.origin
      );
    }
    frame.addEventListener("load", sendeVorschau);
    sendeVorschau();

    function aendere(neu) {
      entwurf = neu;
      speichereStartseiteEntwurf(neu).catch((e) => console.warn("Entwurf speichern:", e));
      zeichne();
    }

    // Kachel aus dem Pool aufnehmen
    inhalt.querySelectorAll("#wbPool .wb-bk-add").forEach((b) => b.addEventListener("click", () => {
      const k = b.closest(".wb-bk-kachel");
      aendere([...(entwurf || []), { quelle: k.getAttribute("data-quelle"), ref: k.getAttribute("data-ref"), breit: false }]);
    }));

    // Slot-Aktionen
    inhalt.querySelectorAll("#wbSlots .wb-bk-slot").forEach((el) => {
      const i = Number(el.getAttribute("data-i"));
      const liste = () => (entwurf || []).slice();
      el.querySelector(".wb-bk-weg").addEventListener("click", () => {
        const l = liste(); l.splice(i, 1); aendere(l);
      });
      el.querySelector(".wb-bk-breit").addEventListener("click", () => {
        const l = liste(); l[i] = { ...l[i], breit: !l[i].breit }; aendere(l);
      });
      el.querySelector(".wb-bk-hoch").addEventListener("click", () => {
        if (i === 0) return;
        const l = liste(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; aendere(l);
      });
      el.querySelector(".wb-bk-runter").addEventListener("click", () => {
        const l = liste(); if (i >= l.length - 1) return;
        [l[i + 1], l[i]] = [l[i], l[i + 1]]; aendere(l);
      });
    });

    // Drag & Drop: aus dem Pool aufnehmen, innerhalb der Slots umsortieren.
    let zieh = null;
    inhalt.querySelectorAll(".wb-bk-kachel").forEach((el) => {
      el.addEventListener("dragstart", () => {
        zieh = { wo: el.getAttribute("data-wo"), i: Number(el.getAttribute("data-i")),
                 ref: el.getAttribute("data-ref"), quelle: el.getAttribute("data-quelle") };
        el.classList.add("is-zieht");
      });
      el.addEventListener("dragend", () => { el.classList.remove("is-zieht"); zieh = null; });
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("is-ziel"); });
      el.addEventListener("dragleave", () => el.classList.remove("is-ziel"));
      el.addEventListener("drop", (e) => {
        e.preventDefault(); el.classList.remove("is-ziel");
        if (!zieh) return;
        const zielI = Number(el.getAttribute("data-i"));
        const l = (entwurf || []).slice();
        if (zieh.wo === "pool") {
          l.splice(isNaN(zielI) ? l.length : zielI, 0, { quelle: zieh.quelle, ref: zieh.ref, breit: false });
        } else if (!isNaN(zieh.i) && !isNaN(zielI) && zieh.i !== zielI) {
          const [weg] = l.splice(zieh.i, 1);
          l.splice(zielI, 0, weg);
        } else return;
        aendere(l);
      });
    });

    // Leerer Slot-Bereich als Ablagefläche (sonst kann man nichts platzieren,
    // solange noch keine einzige Kachel gewählt ist).
    const slotBox = inhalt.querySelector("#wbSlots");
    slotBox.addEventListener("dragover", (e) => e.preventDefault());
    slotBox.addEventListener("drop", (e) => {
      if (!zieh || zieh.wo !== "pool" || e.target.closest(".wb-bk-kachel")) return;
      e.preventDefault();
      aendere([...(entwurf || []), { quelle: zieh.quelle, ref: zieh.ref, breit: false }]);
    });

    const pub = inhalt.querySelector("#wbPub");
    if (pub) pub.addEventListener("click", async () => {
      pub.disabled = true; pub.textContent = "Veröffentlicht …";
      try { await veroeffentlicheStartseite(entwurf || []); }
      catch (e) { console.warn(e); alert("Konnte nicht veröffentlichen."); pub.disabled = false; pub.textContent = "Veröffentlichen"; }
    });

    const reset = inhalt.querySelector("#wbReset");
    if (reset) reset.addEventListener("click", () => {
      entwurf = (startseite.kacheln || []).slice();
      speichereStartseiteEntwurf(null).catch(() => {});
      zeichne();
    });
  }

  // Kachel-Referenzen zu fertigen Anzeigedaten machen — das braucht die
  // Vorschau, weil der iframe selbst keine Posts nachschlagen kann.
  function aufgeloest(kacheln, live) {
    return kacheln.map((k) => {
      if (k.quelle === "statisch") {
        const p = STATISCHE_PROJEKTE.find((x) => x.ref === k.ref);
        return p ? { href: p.ref, titel: p.titel, tag: p.tag, bild: p.thumb, breit: !!k.breit } : null;
      }
      const p = live.find((x) => x.id === k.ref);
      return p ? {
        href: `projekt.html?id=${encodeURIComponent(p.id)}`,
        titel: p.titel, tag: p.untertitel || KAT_LABEL[p.kategorie] || "",
        bild: postBild(p, thumbCache), breit: !!k.breit
      } : null;
    }).filter(Boolean);
  }
}
