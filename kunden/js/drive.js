// =====================================================================
// Link-Helfer: Google-Drive-Freigabelinks → /preview-Embed (Skript-PDF)
// und YouTube-Links/IDs → /embed-URL (fertiger Schnitt, "nicht gelistet").
// Reines String-Parsing, keine Netzwerk-Calls.
// =====================================================================

// Holt die Drive-File-ID aus den gängigen Link-Formaten:
//   https://drive.google.com/file/d/<ID>/view?usp=sharing
//   https://drive.google.com/open?id=<ID>
//   https://drive.google.com/uc?id=<ID>&export=download
export function driveFileId(link) {
  if (!link) return null;
  const s = String(link).trim();
  let m =
    s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // Falls schon eine reine ID übergeben wurde.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

// Liefert die einbettbare /preview-URL oder null, wenn nicht parsebar.
export function drivePreviewUrl(link) {
  const id = driveFileId(link);
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

// Holt die YouTube-Video-ID aus den gängigen Formaten:
//   https://www.youtube.com/watch?v=<ID>
//   https://youtu.be/<ID>
//   https://www.youtube.com/embed/<ID>
//   https://www.youtube.com/shorts/<ID>
//   oder eine reine 11-stellige ID.
export function youtubeId(link) {
  if (!link) return null;
  const s = String(link).trim();
  let m =
    s.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
    s.match(/\/embed\/([a-zA-Z0-9_-]{11})/) ||
    s.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
}

// Liefert die einbettbare YouTube-/embed-URL oder null.
export function youtubeEmbedUrl(link) {
  const id = youtubeId(link);
  // youtube-nocookie + modestbranding: dezent, datenschutzfreundlicher.
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` : null;
}

// --- Vimeo -----------------------------------------------------------
// Holt die Vimeo-Video-ID aus den gängigen Formaten:
//   https://vimeo.com/<ID>            https://player.vimeo.com/video/<ID>
//   https://vimeo.com/channels/x/<ID> https://vimeo.com/<ID>/<hash>
export function vimeoId(link) {
  if (!link) return null;
  const s = String(link).trim();
  const m =
    s.match(/player\.vimeo\.com\/video\/(\d+)/) ||
    s.match(/vimeo\.com\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/\d+\/video\/)?(\d+)/);
  return m ? m[1] : null;
}

// Liefert die einbettbare Vimeo-/player-URL oder null.
export function vimeoEmbedUrl(link) {
  const id = vimeoId(link);
  return id ? `https://player.vimeo.com/video/${id}` : null;
}

// Google-Drive-Video: dieselbe /preview-URL wie beim Skript-PDF spielt auch
// hochgeladene Videos ab. Alias für drivePreviewUrl (semantisch klarer).
export function driveVideoPreview(link) {
  return drivePreviewUrl(link);
}
