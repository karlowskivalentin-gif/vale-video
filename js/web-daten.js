// =====================================================================
// vale-video.de — Anbindung an Firestore (öffentlich, ohne Login)
//
// Die Website ist weiterhin statisches HTML. Nur zwei Dinge kommen live aus
// Firestore, damit Valentin sie aus dem Portal steuern kann, ohne zu deployen:
//   webvideos/*          → Video-Posts (Portfolio-Karten + Detailseiten)
//   webseite/startseite  → welche Kacheln oben auf index.html stehen
//
// Gelesen wird ausschließlich Veröffentlichtes (siehe firestore.rules).
// Es wird KEIN firebase-auth geladen — die Seite meldet sich nirgends an.
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Bewusst dupliziert statt aus kunden/ importiert: die öffentliche Seite soll
// nicht vom Portal abhängen (getrennte Deploys). Die Werte sind by design
// öffentlich — die Sicherheit kommt aus den Security Rules.
const firebaseConfig = {
  apiKey: "AIzaSyDRqmsuibooA1sBmS9yPtQxtCyRsuybMhw",
  authDomain: "vale-kunden.firebaseapp.com",
  projectId: "vale-kunden",
  storageBucket: "vale-kunden.firebasestorage.app",
  messagingSenderId: "451151414446",
  appId: "1:451151414446:web:e331c3a3e22a42f9e8193f"
};

const db = getFirestore(initializeApp(firebaseConfig));

// Spiegel von STATISCHE_PROJEKTE in kunden/js/views/admin-webseite.js.
// Die sieben handgebauten Projektseiten bleiben statisches HTML; hier stehen
// nur ihre Eckdaten, damit der Startseiten-Baukasten sie referenzieren kann.
// ÄNDERUNGEN IMMER AN BEIDEN STELLEN.
export const STATISCHE_PROJEKTE = {
  "projekt-amsterdam.html":   { titel: "Amsterdam by Day",       tag: "Persönlich · Cinematic Travel",  thumb: "assets/images/thumb-amsterdam.webp" },
  "projekt-schneider.html":   { titel: "Café Schneider Benrath", tag: "Auftrag · Imagefilm · Interview", thumb: "assets/images/thumb-schneider.webp" },
  "projekt-zicke.html":       { titel: "Bistro Zicke Düsseldorf", tag: "Auftrag · Imagefilm",           thumb: "assets/images/thumb-zicke.webp" },
  "projekt-clubpilates.html": { titel: "Club Pilates × Fibo 2026", tag: "Auftrag · Event · Reel",       thumb: "assets/images/thumb-clubpilates.webp" },
  "projekt-cathy.html":       { titel: "Cathy Hummels Interview", tag: "Auftrag · Interview · Reel",    thumb: "assets/images/thumb-cathy.webp" },
  "projekt-goldhaus.html":    { titel: "Goldhaus",                tag: "Auftrag · Imagefilm",           thumb: "assets/images/thumb-goldhaus.webp" },
  "projekt-pia.html":         { titel: "Pia — Urdenbach",         tag: "Persönlich · Objektfilm",       thumb: "assets/images/thumb-pia.webp" }
};

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// --- Laden ------------------------------------------------------------

// Alle veröffentlichten Posts, neueste zuerst.
//
// Das where() ist PFLICHT: die Rules erlauben Lesen nur für
// veroeffentlicht == true, und Firestore weist eine Query ab, die auch
// unerlaubte Dokumente treffen könnte.
//
// Sortiert wird bewusst HIER statt per orderBy(): die Kombination aus
// where() und orderBy() verlangt einen zusammengesetzten Index, den man
// anlegen, deployen und pflegen müsste. Für ein Portfolio in dieser
// Größenordnung ist das unnötige Infrastruktur — bei mehreren hundert
// Posts wäre der Index die bessere Wahl.
export async function ladeWebvideos() {
  try {
    const snap = await getDocs(query(
      collection(db, "webvideos"),
      where("veroeffentlicht", "==", true)
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((b.erstelltAm && b.erstelltAm.seconds) || 0)
                    - ((a.erstelltAm && a.erstelltAm.seconds) || 0));
  } catch (e) {
    console.warn("[vale-video] Posts konnten nicht geladen werden:", e);
    return [];   // Seite bleibt mit ihrem statischen Inhalt benutzbar
  }
}

export async function ladeWebvideo(id) {
  try {
    const s = await getDoc(doc(db, "webvideos", id));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  } catch (e) {
    console.warn("[vale-video] Post nicht ladbar:", e);
    return null;
  }
}

// Hochgeladenes Vorschaubild (nur bei TikTok/Instagram nötig).
export async function ladeThumb(id) {
  try {
    const s = await getDoc(doc(db, "webthumbs", id));
    return s.exists() ? (s.data().base64 || "") : "";
  } catch (_) { return ""; }
}

export async function ladeStartseite() {
  try {
    const s = await getDoc(doc(db, "webseite", "startseite"));
    return s.exists() ? (s.data().kacheln || []) : [];
  } catch (e) {
    console.warn("[vale-video] Startseiten-Anordnung nicht ladbar:", e);
    return [];
  }
}

// Bild eines Posts — Auto-Thumbnail oder hochgeladenes nachladen.
export async function postBild(v) {
  if (v.thumbUrl) return v.thumbUrl;
  if (v.thumbId) return await ladeThumb(v.thumbId);
  return "";
}

// --- Player ------------------------------------------------------------
// Alle Plattformen laufen über dieselbe Zwei-Klick-Fassade wie die
// bestehenden YouTube-Einbettungen (.yt-facade in css/portfolio.css):
// vor dem Klick liegt NUR ein Bild da. Erst der Klick lädt das iframe bzw.
// bei TikTok/Instagram deren embed.js. Dadurch kontaktiert die Seite von
// sich aus keine fremden Server — wichtig, weil das hier die öffentliche
// Seite ist und nicht das eingeloggte Portal.

function youtubeId(url) {
  const s = String(url || "");
  const m = s.match(/[?&]v=([\w-]{11})/) || s.match(/youtu\.be\/([\w-]{11})/)
         || s.match(/\/embed\/([\w-]{11})/) || s.match(/\/shorts\/([\w-]{11})/);
  return m ? m[1] : null;
}
function vimeoId(url) {
  const m = String(url || "").match(/player\.vimeo\.com\/video\/(\d+)/)
         || String(url || "").match(/vimeo\.com\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/);
  return m ? m[1] : null;
}
function tiktokId(url) {
  const m = String(url || "").match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

// Fassade: Bild + Play-Button. Der Klick wird von aktivierePlayer() behandelt.
export function playerHtml(v, bild) {
  const cover = bild
    ? `<img src="${escapeHtml(bild)}" alt="${escapeHtml(v.titel || "")}" />`
    : `<div class="yt-kein-bild"></div>`;
  return `
    <div class="yt-wrap" data-plattform="${escapeHtml(v.plattform || "")}" data-url="${escapeHtml(v.url || "")}">
      <div class="yt-facade">
        ${cover}
        <div class="yt-play">
          <div class="yt-play-ring"><div class="yt-play-triangle"></div></div>
          <span class="yt-play-label">Abspielen</span>
        </div>
      </div>
      <div class="yt-ziel"></div>
    </div>`;
}

// Klick auf die Fassade → echtes Embed nachladen. Erst hier fließen Daten
// zu YouTube/Vimeo/TikTok/Instagram.
export function aktivierePlayer(wurzel) {
  wurzel.querySelectorAll(".yt-wrap").forEach((wrap) => {
    const facade = wrap.querySelector(".yt-facade");
    if (!facade) return;
    facade.addEventListener("click", () => {
      const url  = wrap.getAttribute("data-url") || "";
      const ziel = wrap.querySelector(".yt-ziel");
      const yt = youtubeId(url), vi = vimeoId(url), tt = tiktokId(url);

      if (yt) {
        ziel.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(yt)}?autoplay=1&rel=0&modestbranding=1"
          title="${escapeHtml(document.title)}" allowfullscreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
      } else if (vi) {
        ziel.innerHTML = `<iframe src="https://player.vimeo.com/video/${escapeHtml(vi)}?autoplay=1"
          title="Vimeo" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>`;
      } else if (tt) {
        ziel.innerHTML = `<blockquote class="tiktok-embed" cite="${escapeHtml(url)}"
          data-video-id="${escapeHtml(tt)}" style="max-width:340px;min-width:240px;margin:0 auto;">
          <section><a href="${escapeHtml(url)}" target="_blank" rel="noopener">Auf TikTok ansehen ↗</a></section>
        </blockquote>`;
        ladeSkript("https://www.tiktok.com/embed.js", "tiktok-embed-js");
      } else if (/instagram\.com/.test(url)) {
        ziel.innerHTML = `<blockquote class="instagram-media"
          data-instgrm-permalink="${escapeHtml(url.split("?")[0])}" data-instgrm-version="14"
          style="max-width:340px;min-width:240px;margin:0 auto;">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Auf Instagram ansehen ↗</a>
        </blockquote>`;
        ladeSkript("https://www.instagram.com/embed.js", "instagram-embed-js",
          () => { try { window.instgrm.Embeds.process(); } catch (_) {} });
      } else {
        // Unbekannte Plattform: ehrlich verlinken statt etwas vorzutäuschen.
        ziel.innerHTML = `<a class="btn btn--accent" href="${escapeHtml(url)}" target="_blank" rel="noopener">Video ansehen ↗</a>`;
      }
      wrap.classList.add("active");
    }, { once: true });
  });
}

function ladeSkript(src, id, cb) {
  const alt = document.getElementById(id);
  if (alt) { if (cb) cb(); return; }
  const s = document.createElement("script");
  s.id = id; s.src = src; s.async = true;
  if (cb) s.onload = cb;
  document.body.appendChild(s);
}
