// Admin-View: Transkript (Admin-only) — Startseite fürs LOKALE Transkript-Tool.
// Die eigentliche Arbeit + UI liefert ein lokaler Python-Server auf Valentins
// PC (tools/transkript/transkript_server.py): yt-dlp lädt die Audiospur,
// faster-whisper (lokales Whisper-Modell) transkribiert — keine Cloud, keine
// API-Tokens, keine Kosten.
//
// Warum ein eigener Tab beim Server (http://127.0.0.1:8237/) statt Inline-UI
// hier? Chrome blockiert/limitiert Zugriffe von einer https-Seite auf
// localhost („Local Network Access"). Die Tool-Seite kommt DIREKT vom lokalen
// Server (same-origin) — da funkt der Browser garantiert nicht dazwischen.
import { escapeHtml } from "../util.js";

const SERVER = "http://127.0.0.1:8237";

export function renderAdminTranskript(container) {
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Transkript</h1>
      <span class="tk-server" id="tkServer"><span class="tk-dot"></span> prüfe lokalen Server …</span>
    </div>
    <p class="muted view-intro">Instagram-Reel-, TikTok- oder YouTube-Link → fertiges Transkript.
      Läuft zu 100 % lokal auf deinem PC (yt-dlp + Whisper) — keine Cloud, keine API-Kosten. Nur du siehst das.</p>

    <section class="card card--pad" style="max-width:640px">
      <h2 class="section-title" style="margin-top:0">So funktioniert's</h2>
      <ol class="tk-schritte">
        <li><strong>Server starten</strong> (falls noch nicht an): im Projektordner unter
          <code>tools/transkript/</code> &mdash; unter Windows <code>transkript-server.bat</code>
          doppelklicken, sonst <code>python transkript_server.py</code> im Terminal.
          Fenster offen lassen.</li>
        <li><strong>Tool öffnen</strong> und Link einfügen — fertig.</li>
      </ol>
      <div class="action-btns" style="margin-top:1.1rem">
        <a class="btn btn--accent" href="${escapeHtml(SERVER)}/" target="_blank" rel="noopener">🎬 Transkript-Tool öffnen</a>
        <button class="btn btn--ghost btn--sm" id="tkRetry" type="button">Server erneut prüfen</button>
      </div>
      <p class="field-hint muted" style="margin-top:.8rem">Das Tool öffnet sich in einem eigenen Tab direkt
        von deinem PC (127.0.0.1) — gleiche Optik, volle Funktion: Fortschritt, Zeitstempel, Kopieren, .txt-Export.</p>
    </section>`;

  // Best-effort-Statusanzeige. Kann an Chromes „Local Network Access"-Sperre
  // scheitern, obwohl der Server läuft — deshalb nur Hinweis, kein Blocker.
  async function pruefeServer() {
    const badge = container.querySelector("#tkServer");
    badge.innerHTML = `<span class="tk-dot"></span> prüfe lokalen Server …`;
    try {
      const r = await fetch(SERVER + "/health", { signal: AbortSignal.timeout(2500) });
      const d = await r.json();
      badge.innerHTML = `<span class="tk-dot is-ok"></span> lokaler Server läuft (Modell: ${escapeHtml(d.modell || "?")})`;
    } catch (_) {
      badge.innerHTML = `<span class="tk-dot is-aus"></span> Status nicht prüfbar — einfach „Tool öffnen" klicken`;
    }
  }
  pruefeServer();
  container.querySelector("#tkRetry").addEventListener("click", pruefeServer);
}
