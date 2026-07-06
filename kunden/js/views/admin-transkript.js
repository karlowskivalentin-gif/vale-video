// Admin-View: Transkript (Admin-only) — Instagram/TikTok/YouTube-Link rein,
// fertiges Transkript raus. Die eigentliche Arbeit macht ein LOKALER
// Python-Server auf Valentins PC (tools/transkript/transkript_server.py):
// yt-dlp laedt die Audiospur, faster-whisper (lokales Whisper-Modell)
// transkribiert — keine Cloud, keine API-Tokens, keine Kosten.
// Diese View spricht ihn unter http://127.0.0.1:8237 an und pollt den Job.
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const SERVER = "http://127.0.0.1:8237";
const POLL_MS = 800;

export function renderAdminTranskript(container) {
  let pollTimer = null;
  let letztesTranskript = "";
  let letzteSegmente = [];
  let letzterTitel = "";

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Transkript</h1>
      <span class="tk-server" id="tkServer"><span class="tk-dot"></span> prüfe Server …</span>
    </div>
    <p class="muted view-intro">Instagram-Reel-, TikTok- oder YouTube-Link einfügen — das Transkript entsteht
      komplett lokal auf deinem PC (yt-dlp + Whisper), ohne Cloud, ohne API-Kosten. Nur du siehst das.</p>

    <div class="card card--pad" id="tkStartCard" hidden>
      <div class="notice notice--error" style="margin:0">
        <strong>Lokaler Transkript-Server läuft nicht.</strong><br>
        Starte auf deinem PC <code>D:\\Projekte\\Website\\tools\\transkript\\transkript-server.bat</code>
        (Doppelklick) und lass das Fenster offen — dann hier auf „Erneut prüfen" klicken.
        <div style="margin-top:.7rem"><button class="btn btn--ghost btn--sm" id="tkRetry" type="button">Erneut prüfen</button></div>
      </div>
    </div>

    <div class="card card--pad" id="tkForm" hidden>
      <form id="tkStart" novalidate>
        <div class="field" style="margin-bottom:.8rem">
          <label for="tkUrl">Video-Link</label>
          <input id="tkUrl" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…  ·  TikTok  ·  YouTube" />
        </div>
        <div class="tk-optionen">
          <label class="tk-opt-label" for="tkSprache">Sprache</label>
          <select id="tkSprache" class="gd-filter">
            <option value="auto">Automatisch erkennen</option>
            <option value="de" selected>Deutsch</option>
            <option value="en">Englisch</option>
          </select>
          <button class="btn btn--accent" id="tkGo" type="submit">Transkribieren</button>
        </div>
      </form>
    </div>

    <div class="card card--pad tk-progress" id="tkProgress" hidden>
      <div class="tk-progress-kopf">
        <span id="tkSchritt">Startet …</span>
        <span class="muted" id="tkTitel"></span>
      </div>
      <div class="tk-bar"><div class="tk-bar-fill" id="tkBar" style="width:0%"></div></div>
      <p class="muted tk-hint">Beim allerersten Lauf lädt Whisper einmalig sein Modell (~460 MB) — das dauert ein paar Minuten extra. Danach geht's schnell.</p>
    </div>

    <div class="card card--pad tk-ergebnis" id="tkErgebnis" hidden>
      <div class="tk-ergebnis-kopf">
        <h2 class="section-title" style="margin:0">Transkript <span class="muted" id="tkMeta"></span></h2>
        <div class="tk-ergebnis-btns">
          <button class="btn btn--ghost btn--sm" id="tkZeiten" type="button" aria-pressed="false">🕐 Zeitstempel</button>
          <button class="btn btn--ghost btn--sm" id="tkCopy" type="button">Kopieren</button>
          <button class="btn btn--ghost btn--sm" id="tkDownload" type="button">.txt ↓</button>
        </div>
      </div>
      <textarea id="tkText" class="tk-text" readonly></textarea>
    </div>`;

  const el = (id) => container.querySelector("#" + id);
  const startCard = el("tkStartCard"), form = el("tkForm"), progress = el("tkProgress"), ergebnis = el("tkErgebnis");

  // --- Server-Status -----------------------------------------------------
  async function pruefeServer() {
    const badge = el("tkServer");
    try {
      const r = await fetch(SERVER + "/health", { signal: AbortSignal.timeout(2500) });
      const d = await r.json();
      badge.innerHTML = `<span class="tk-dot is-ok"></span> lokaler Server läuft (Modell: ${escapeHtml(d.modell || "?")})`;
      startCard.hidden = true;
      form.hidden = false;
      return true;
    } catch (_) {
      badge.innerHTML = `<span class="tk-dot is-aus"></span> Server aus`;
      startCard.hidden = false;
      form.hidden = true;
      return false;
    }
  }
  pruefeServer();
  el("tkRetry").addEventListener("click", pruefeServer);

  // --- Job starten + pollen ----------------------------------------------
  el("tkStart").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = (el("tkUrl").value || "").trim();
    if (!/^https?:\/\//i.test(url)) { el("tkUrl").focus(); return; }
    const go = el("tkGo");
    go.disabled = true; go.textContent = "Startet …";
    ergebnis.hidden = true;
    try {
      const r = await fetch(SERVER + "/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, sprache: el("tkSprache").value })
      });
      const d = await r.json();
      if (!r.ok || !d.jobId) throw new Error(d.fehler || "Start fehlgeschlagen");
      progress.hidden = false;
      polle(d.jobId);
    } catch (err) {
      progress.hidden = true;
      alertFehler(String(err.message || err));
    } finally {
      go.disabled = false; go.textContent = "Transkribieren";
    }
  });

  function alertFehler(text) {
    el("tkSchritt").textContent = "";
    const box = document.createElement("div");
    box.className = "notice notice--error";
    box.textContent = "Fehler: " + text;
    form.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }

  function polle(jobId) {
    stoppePoll();
    pollTimer = setInterval(async () => {
      let d = null;
      try {
        const r = await fetch(`${SERVER}/job/${jobId}`);
        d = await r.json();
      } catch (_) { return; }   // Server kurz busy → einfach weiter pollen
      el("tkSchritt").textContent = d.schritt || "…";
      el("tkTitel").textContent = d.titel ? `„${d.titel}"` : "";
      el("tkBar").style.width = Math.max(2, Math.min(100, d.progress || 0)) + "%";
      if (d.status === "fertig") {
        stoppePoll();
        progress.hidden = true;
        letztesTranskript = d.transcript || "";
        letzteSegmente = Array.isArray(d.segmente) ? d.segmente : [];
        letzterTitel = d.titel || "transkript";
        el("tkMeta").textContent = `· ${letzteSegmente.length} Segmente${d.erkannteSprache ? ` · ${d.erkannteSprache}` : ""}`;
        zeigeText(false);
        ergebnis.hidden = false;
      } else if (d.status === "fehler") {
        stoppePoll();
        progress.hidden = true;
        alertFehler(d.fehler || "unbekannt");
      }
    }, POLL_MS);
  }
  function stoppePoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // --- Ergebnis: Anzeige, Zeitstempel, Kopieren, Download -----------------
  let mitZeiten = false;
  function fmtZeit(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  function zeigeText(neuZeiten) {
    if (typeof neuZeiten === "boolean") mitZeiten = neuZeiten;
    el("tkZeiten").classList.toggle("is-active", mitZeiten);
    el("tkZeiten").setAttribute("aria-pressed", String(mitZeiten));
    el("tkText").value = mitZeiten
      ? letzteSegmente.map((s) => `[${fmtZeit(s.start)}] ${s.text}`).join("\n")
      : letztesTranskript;
  }
  el("tkZeiten").addEventListener("click", () => zeigeText(!mitZeiten));
  el("tkCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el("tkText").value); el("tkCopy").textContent = "Kopiert ✓"; }
    catch (_) { el("tkText").select(); document.execCommand("copy"); el("tkCopy").textContent = "Kopiert ✓"; }
    setTimeout(() => { el("tkCopy").textContent = "Kopieren"; }, 1500);
  });
  el("tkDownload").addEventListener("click", () => {
    const blob = new Blob([el("tkText").value], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (letzterTitel || "transkript").replace(/[^\wäöüÄÖÜß \-]+/g, "").slice(0, 60).trim() + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  beiViewWechsel(stoppePoll);
}
