// =====================================================================
// Multi-Plattform-Embeds für die private Plan-Ansicht (Admin-only).
// Erzeugt Inline-Vorschauen für YouTube/Shorts, TikTok und Instagram.
//
// Rein clientseitig (Spark-Plan, kein Backend, kein Token):
//   - YouTube/Shorts → youtube-nocookie-iframe (über drive.js).
//   - TikTok / Instagram → deren offizielle blockquote-Embeds + embed.js.
// Schlägt ein Embed fehl (kein parsebarer Link), kommt eine Fallback-Karte.
// In der View ist der Original-Link ZUSÄTZLICH immer separat anklickbar.
// =====================================================================
import { youtubeEmbedUrl, vimeoEmbedUrl, drivePreviewUrl } from "./drive.js";
import { escapeHtml } from "./util.js";

// URL → 'youtube' | 'tiktok' | 'instagram' | 'vimeo' | 'drive' | 'andere'
export function erkennePlattform(url) {
  const s = String(url || "").toLowerCase();
  if (!s) return "andere";
  if (/youtube\.com|youtu\.be/.test(s)) return "youtube";
  if (/tiktok\.com/.test(s))            return "tiktok";
  if (/instagram\.com/.test(s))         return "instagram";
  if (/vimeo\.com/.test(s))             return "vimeo";
  if (/drive\.google\.com/.test(s))     return "drive";
  return "andere";
}

// TikTok-Video-ID aus voller URL: …/video/<digits>
function tiktokId(url) {
  const m = String(url || "").match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

// YouTube-Link im Hochformat (Short)?
function istShort(url) {
  return /\/shorts\//.test(String(url || ""));
}

// Liefert das Inline-Vorschau-HTML für eine einzelne URL.
export function embedHtml(url) {
  const plattform = erkennePlattform(url);
  const safeUrl = escapeHtml(url);

  if (plattform === "youtube") {
    const embed = youtubeEmbedUrl(url);
    if (embed) {
      const cls = istShort(url) ? "embed-wrap embed-wrap--hoch" : "embed-wrap";
      return `<div class="${cls}"><iframe src="${escapeHtml(embed)}"
        title="YouTube-Vorschau" loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    }
    return fallbackHtml(url, "youtube");
  }

  if (plattform === "tiktok") {
    const vid = tiktokId(url);
    if (vid) {
      return `<blockquote class="tiktok-embed embed-blockquote" cite="${safeUrl}"
        data-video-id="${escapeHtml(vid)}" style="max-width:325px;min-width:240px;margin:0;">
        <section><a href="${safeUrl}" target="_blank" rel="noopener">TikTok ansehen ↗</a></section>
      </blockquote>`;
    }
    return fallbackHtml(url, "tiktok");
  }

  if (plattform === "instagram") {
    return `<blockquote class="instagram-media embed-blockquote"
      data-instgrm-permalink="${safeUrl}" data-instgrm-version="14"
      style="max-width:340px;min-width:240px;margin:0;">
      <a href="${safeUrl}" target="_blank" rel="noopener">Instagram-Beitrag ansehen ↗</a>
    </blockquote>`;
  }

  if (plattform === "vimeo") {
    const embed = vimeoEmbedUrl(url);
    if (embed) {
      return `<div class="embed-wrap"><iframe src="${escapeHtml(embed)}"
        title="Vimeo-Vorschau" loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    }
    return fallbackHtml(url, "vimeo");
  }

  if (plattform === "drive") {
    const embed = drivePreviewUrl(url);
    if (embed) {
      return `<div class="embed-wrap"><iframe src="${escapeHtml(embed)}"
        title="Google-Drive-Vorschau" loading="lazy"
        allow="autoplay" allowfullscreen></iframe></div>`;
    }
    return fallbackHtml(url, "drive");
  }

  return fallbackHtml(url, "andere");
}

function fallbackHtml(url, plattform) {
  const labelMap = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", vimeo: "Vimeo", drive: "Google Drive", andere: "Link" };
  const label = labelMap[plattform] || "Link";
  return `<div class="embed-fallback">
    <span class="embed-fallback-label">${escapeHtml(label)}-Vorschau nicht verfügbar</span>
    <a class="btn btn--ghost btn--sm" href="${escapeHtml(url)}" target="_blank" rel="noopener">Im neuen Tab öffnen ↗</a>
  </div>`;
}

// Lädt TikTok-/Instagram-embed.js (einmalig) und stößt das Rendern an.
// Nach jedem (Neu-)Render der Inspirations-Liste aufrufen.
export function verarbeiteEmbeds(container) {
  if (!container) return;

  if (container.querySelector(".tiktok-embed")) {
    // TikTok scannt nur beim Skript-Laden → frisch neu anhängen.
    ladeSkript("https://www.tiktok.com/embed.js", "tiktok-embed-js", true);
  }

  if (container.querySelector(".instagram-media")) {
    if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === "function") {
      try { window.instgrm.Embeds.process(); } catch (_) { /* egal */ }
    } else {
      ladeSkript("https://www.instagram.com/embed.js", "instagram-embed-js", false);
    }
  }
}

// Skript einbinden. neuAnhaengen=true entfernt ein vorhandenes vorher und
// hängt es neu an (nötig, weil TikTok nur beim Laden scannt).
function ladeSkript(src, id, neuAnhaengen) {
  const alt = document.getElementById(id);
  if (alt && !neuAnhaengen) return;
  if (alt && neuAnhaengen) alt.remove();
  const s = document.createElement("script");
  s.id = id;
  s.src = src;
  s.async = true;
  document.body.appendChild(s);
}
