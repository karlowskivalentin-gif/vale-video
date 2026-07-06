// Admin-View: Inspiration (Admin-only) — Dashboard mit eingebetteten Videos
// und Profilen, an denen sich die Arbeit orientiert.
//   - Card-Kategorien: 🎬 Video | 👤 Profil | ✨ Sonstiges (Filter-Chips)
//   - Referenz-Link wird eingebettet (YouTube/TikTok/Instagram via embeds.js);
//     Profile/Accounts als Kachel mit „Profil öffnen"-Link
//   - Pro Card: eigene, davon inspirierte Videos per Link hinterlegen —
//     werden ebenfalls eingebettet („Davon inspiriert — unsere Videos")
// Der Kunde sieht diesen Bereich NIE (Rules: /inspirationen admin-only).
import { beobachteInspirationen, inspirationAnlegen, aktualisiereInspiration,
         loescheInspiration } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { embedHtml, erkennePlattform, verarbeiteEmbeds } from "../embeds.js";

const KATEGORIEN = [
  { id: "video",     label: "🎬 Video" },
  { id: "profil",    label: "👤 Profil" },
  { id: "sonstiges", label: "✨ Sonstiges" }
];
const PLATTFORM_LABEL = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", andere: "Web" };

export function renderAdminInspiration(container) {
  let inspirationen = [];
  let filter = "alle";          // 'alle' | 'video' | 'profil' | 'sonstiges'
  let formOffen = false;

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Inspiration</h1>
      <button class="btn btn--accent btn--sm" id="inspNeu" type="button">+ Inspiration</button>
    </div>
    <p class="muted view-intro">Dein Dashboard mit Videos, Profilen und Ideen, an denen sich unsere Arbeit
      orientiert. Pro Card kannst du eigene Videos hinterlegen, die davon inspiriert sind. Nur du siehst das.</p>
    <div class="insp-chips" id="inspChips">
      <button class="insp-chip is-active" data-f="alle" type="button">Alle</button>
      ${KATEGORIEN.map((k) => `<button class="insp-chip" data-f="${k.id}" type="button">${k.label}</button>`).join("")}
    </div>
    <div class="card card--pad insp-form" id="inspForm" hidden></div>
    <div class="insp-grid" id="inspGrid"><p class="muted">Lädt …</p></div>`;

  const grid = container.querySelector("#inspGrid");
  const formBox = container.querySelector("#inspForm");

  // --- Filter-Chips --------------------------------------------------------
  container.querySelectorAll(".insp-chip").forEach((c) => c.addEventListener("click", () => {
    filter = c.getAttribute("data-f");
    container.querySelectorAll(".insp-chip").forEach((x) => x.classList.toggle("is-active", x === c));
    zeichne();
  }));

  // --- Neue Inspiration (aufklappbares Formular) ---------------------------
  container.querySelector("#inspNeu").addEventListener("click", () => {
    formOffen = !formOffen;
    formBox.hidden = !formOffen;
    if (!formOffen) { formBox.innerHTML = ""; return; }
    formBox.innerHTML = `
      <form id="inspAnlegen" novalidate>
        <div class="grid-2">
          <div class="field">
            <label for="if-titel">Titel <span class="req">*</span></label>
            <input id="if-titel" type="text" placeholder="z. B. Hook-Stil von XY, Immobilien-Reels Account …" />
          </div>
          <div class="field">
            <label for="if-kat">Kategorie</label>
            <select id="if-kat">${KATEGORIEN.map((k) => `<option value="${k.id}">${k.label}</option>`).join("")}</select>
          </div>
        </div>
        <div class="field">
          <label for="if-url">Link (Video oder Account) <span class="req">*</span></label>
          <input id="if-url" type="url" placeholder="https://youtube.com/…  ·  instagram.com/reel/… oder @account  ·  tiktok.com/…" />
        </div>
        <div class="field">
          <label for="if-notiz">Notiz (optional)</label>
          <textarea id="if-notiz" placeholder="Was ist hier inspirierend? Worauf achten wir?" style="min-height:70px"></textarea>
        </div>
        <div class="action-btns">
          <button class="btn btn--accent btn--sm" type="submit">Anlegen</button>
          <button class="btn btn--ghost btn--sm" id="if-abbr" type="button">Abbrechen</button>
        </div>
      </form>`;
    formBox.querySelector("#if-abbr").addEventListener("click", () => { formOffen = false; formBox.hidden = true; formBox.innerHTML = ""; });
    formBox.querySelector("#inspAnlegen").addEventListener("submit", async (e) => {
      e.preventDefault();
      const titel = formBox.querySelector("#if-titel").value.trim();
      let url = formBox.querySelector("#if-url").value.trim();
      if (!titel || !url) return;
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      try {
        await inspirationAnlegen({
          titel, url,
          kategorie: formBox.querySelector("#if-kat").value,
          notiz: formBox.querySelector("#if-notiz").value.trim()
        });
        formOffen = false; formBox.hidden = true; formBox.innerHTML = "";
      } catch (err) { console.warn("Inspiration anlegen fehlgeschlagen:", err); alert("Konnte nicht speichern."); }
    });
  });

  // --- Card-Rendering -------------------------------------------------------
  function katLabel(k) { return (KATEGORIEN.find((x) => x.id === k) || KATEGORIEN[2]).label; }

  function profilKachel(insp, p) {
    return `
      <a class="insp-profil" href="${escapeHtml(insp.url)}" target="_blank" rel="noopener">
        <span class="insp-profil-icon">👤</span>
        <span class="insp-profil-text">
          <strong>${escapeHtml(PLATTFORM_LABEL[p] || "Web")}-Profil</strong>
          <span class="muted">${escapeHtml(insp.url.replace(/^https?:\/\/(www\.)?/, ""))}</span>
        </span>
        <span class="insp-profil-pfeil">↗</span>
      </a>`;
  }

  function referenzHtml(insp) {
    // Videos einbetten; Profile mit ECHTER Vorschau, wo die Plattform es
    // offiziell hergibt (Instagram-Profil-Embed, TikTok-Creator-Embed).
    // YouTube-Kanäle/Sonstiges: Kachel mit Link (kein offizielles Embed).
    const p = erkennePlattform(insp.url);
    if (insp.kategorie !== "profil") return `<div class="insp-embed">${embedHtml(insp.url)}</div>`;

    if (p === "instagram") {
      // Offizielles Profil-Embed: Avatar + letzte Posts (embed.js rendert).
      const profilUrl = insp.url.replace(/\/?(\?.*)?$/, "/");
      return `<div class="insp-embed">
        <blockquote class="instagram-media embed-blockquote"
          data-instgrm-permalink="${escapeHtml(profilUrl)}" data-instgrm-version="14"
          style="max-width:340px;min-width:240px;margin:0;">
          <a href="${escapeHtml(insp.url)}" target="_blank" rel="noopener">Instagram-Profil ansehen</a>
        </blockquote>
      </div>` + profilKachel(insp, p);
    }
    if (p === "tiktok") {
      // Offizielles Creator-Embed (Profil-Card mit letzten Videos).
      const m = insp.url.match(/@([\w.\-]+)/);
      if (m) {
        return `<div class="insp-embed">
          <blockquote class="tiktok-embed embed-blockquote" cite="${escapeHtml(insp.url)}"
            data-unique-id="${escapeHtml(m[1])}" data-embed-type="creator"
            style="max-width:340px;min-width:240px;margin:0;">
            <section><a href="${escapeHtml(insp.url)}" target="_blank" rel="noopener">@${escapeHtml(m[1])} auf TikTok</a></section>
          </blockquote>
        </div>` + profilKachel(insp, p);
      }
    }
    return profilKachel(insp, p);
  }

  function cardHtml(insp) {
    const eigene = Array.isArray(insp.eigene) ? insp.eigene : [];
    return `
      <section class="card insp-card" data-id="${escapeHtml(insp.id)}">
        <div class="insp-card-kopf">
          <span class="insp-badge insp-badge--${escapeHtml(insp.kategorie || "sonstiges")}">${katLabel(insp.kategorie)}</span>
          <h2 class="insp-card-titel">${escapeHtml(insp.titel || "Ohne Titel")}</h2>
          <button class="gd-del insp-del" type="button" title="Card löschen">✕</button>
        </div>
        ${referenzHtml(insp)}
        ${insp.notiz ? `<p class="insp-notiz">${escapeHtml(insp.notiz)}</p>` : ""}
        <div class="insp-eigene">
          <div class="insp-eigene-titel">🎥 Davon inspiriert — unsere Videos ${eigene.length ? `<span class="muted">(${eigene.length})</span>` : ""}</div>
          ${eigene.map((v, i) => `
            <div class="insp-eigen">
              <div class="insp-embed">${embedHtml(v.url)}</div>
              <button class="gd-del insp-eigen-del" type="button" data-i="${i}" title="Video entfernen">✕</button>
            </div>`).join("")}
          <div class="insp-add">
            <input type="url" class="insp-add-url" placeholder="Eigenes Video (YouTube/Insta/TikTok) …" />
            <button class="btn btn--ghost btn--sm insp-add-btn" type="button">+ Video</button>
          </div>
        </div>
      </section>`;
  }

  function zeichne() {
    const liste = inspirationen.filter((i) => filter === "alle" || (i.kategorie || "sonstiges") === filter);
    if (!liste.length) {
      grid.innerHTML = `<div class="card card--pad empty-card" style="grid-column:1/-1">
        <div class="empty-emoji">💡</div>
        <p class="empty-title">${inspirationen.length ? "Nichts in dieser Kategorie" : "Noch keine Inspirationen"}</p>
        <p class="muted">Lege oben mit „+ Inspiration" deine erste Card an — Video, Profil oder Sonstiges.</p>
      </div>`;
      return;
    }
    grid.innerHTML = liste.map(cardHtml).join("");
    verarbeiteEmbeds(grid);

    grid.querySelectorAll(".insp-card").forEach((card) => {
      const id = card.getAttribute("data-id");
      const insp = inspirationen.find((x) => x.id === id);
      if (!insp) return;

      // Card löschen (2-Klick-Bestätigung wie in der Mindmap)
      const del = card.querySelector(".insp-del");
      del.addEventListener("click", async () => {
        if (!del.classList.contains("is-bestaetigen")) { del.classList.add("is-bestaetigen"); del.textContent = "Löschen?"; return; }
        try { await loescheInspiration(id); } catch (e) { console.warn(e); }
      });

      // Eigenes Video hinzufügen
      const addBtn = card.querySelector(".insp-add-btn");
      const addUrl = card.querySelector(".insp-add-url");
      const add = async () => {
        let u = (addUrl.value || "").trim();
        if (!u) return;
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        const eigene = [...(insp.eigene || []), { url: u }];
        try { await aktualisiereInspiration(id, { eigene }); addUrl.value = ""; }
        catch (e) { console.warn("Video hinzufügen fehlgeschlagen:", e); }
      };
      addBtn.addEventListener("click", add);
      addUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

      // Eigenes Video entfernen
      card.querySelectorAll(".insp-eigen-del").forEach((b) => b.addEventListener("click", async () => {
        const i = Number(b.getAttribute("data-i"));
        const eigene = [...(insp.eigene || [])];
        eigene.splice(i, 1);
        try { await aktualisiereInspiration(id, { eigene }); } catch (e) { console.warn(e); }
      }));
    });
  }

  const unsub = beobachteInspirationen(
    (liste) => {
      // Laufende Eingaben nicht durch Snapshot-Re-Render zerstören.
      if (grid.contains(document.activeElement) && document.activeElement.classList.contains("insp-add-url")) {
        inspirationen = liste; return;
      }
      inspirationen = liste; zeichne();
    },
    (err) => {
      console.warn("Inspirationen laden fehlgeschlagen:", err);
      grid.innerHTML = `<div class="card card--pad" style="grid-column:1/-1"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden — sind die Firestore-Rules für „inspirationen" veröffentlicht?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}
