// Admin-View: Pipeline. Alle Videos mit Status-Dropdown (alle Stufen).
// Beim Setzen auf eine Freigabe-Stufe → EmailJS-Benachrichtigung an die Kunden.
// Zusätzlich: pro Video ein 💬-Nachrichten-Block (Kunden-Kommentare &
// Änderungswünsche) mit Bearbeitungs-Status (neu → gelesen → in Umsetzung →
// umgesetzt). Ein einziger collectionGroup-Listener liefert alle Kommentare.
import {
  beobachteVideos, adminSetzeStatus, loescheVideo, aktualisierePlan, aktualisiereVideo,
  beobachteAlleKommentare, kommentarSetzeBearbeitung, benachrichtigeKunde,
  beobachteBongNotizen, bongNotizAnlegen, loescheBongNotiz
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { STATUS, STATUS_REIHENFOLGE, statusIndex, istFreigabeStufe, kundenStatus, skriptFreigabeNoetig, istGebongt, autoGebongt } from "../status.js";
import { sendKundeFreigabe } from "../email.js";
import { videoNeuerEntwurf } from "../versionen.js";
import { escapeHtml, formatDatum, tsZuDateInput, dateInputZuDate } from "../util.js";

const BEARB_LABEL = {
  neu: "Neu", gelesen: "Gelesen", in_umsetzung: "In Umsetzung", umgesetzt: "Umgesetzt"
};

export function renderAdminPipeline(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Pipeline</h1>
      <a class="btn btn--accent btn--sm" href="#/admin/video/neu">+ Neues Video</a>
    </div>
    <p class="muted view-intro">Status frei steuerbar. Auf eine Freigabe-Stufe gesetzt → Kunde wird benachrichtigt.</p>
    <div id="plList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const plList = container.querySelector("#plList");

  let videos = [];
  let kommMap = new Map();   // videoId → [Kunden-Kommentare], neueste zuerst
  let bongMap = new Map();   // videoId → [private Bong-Notizen], älteste zuerst
  const offen = new Set();         // aufgeklappte Nachrichten-Blöcke (videoId)
  const offenBong = new Set();     // aufgeklappte Notiz-Blöcke (videoId)
  const offenTermin = new Set();   // aufgeklappte Termin-Editoren (videoId)
  const ctx = { offen, offenBong, offenTermin, state: { filterGebongt: false }, render: null };
  let videosGeladen = false;

  const render = () => zeichne(plList, videos, kommMap, bongMap, ctx);
  ctx.render = render;

  const unsubV = beobachteVideos(
    (v) => { videos = v; videosGeladen = true; render(); },
    (err) => {
      console.error(err);
      plList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    },
    kundeId
  );

  const unsubK = beobachteAlleKommentare(
    (liste) => {
      const m = new Map();
      liste.forEach((k) => {
        if (k.rolle !== "kunde" || !k.videoId) return;   // nur Kunden-Nachrichten
        if (!m.has(k.videoId)) m.set(k.videoId, []);
        m.get(k.videoId).push(k);
      });
      m.forEach((arr) => arr.sort((a, b) => tsSek(b.erstelltAm) - tsSek(a.erstelltAm)));
      kommMap = m;
      if (videosGeladen) render();
    },
    (err) => console.error(err)
  );

  // Private Bong-Notizen (Admin-only) — nach videoId gruppiert, chronologisch.
  const unsubB = beobachteBongNotizen(
    (liste) => {
      const m = new Map();
      liste.forEach((n) => {
        if (!n.videoId) return;
        if (!m.has(n.videoId)) m.set(n.videoId, []);
        m.get(n.videoId).push(n);
      });
      m.forEach((arr) => arr.sort((a, b) => tsSek(a.erstelltAm) - tsSek(b.erstelltAm)));
      bongMap = m;
      if (videosGeladen) render();
    },
    (err) => console.error(err)
  );

  beiViewWechsel(unsubV);
  beiViewWechsel(unsubK);
  beiViewWechsel(unsubB);
}

function zeichne(el, videos, kommMap, bongMap, ctx) {
  const { offen, offenBong, offenTermin, state } = ctx;
  if (!videos.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">🎬</div>
      <p class="empty-title">Noch keine Videos</p>
      <a class="btn btn--accent btn--sm" href="#/admin/video/neu">Erstes Video anlegen</a>
    </div>`;
    return;
  }

  const sichtbar = state.filterGebongt ? videos.filter(istGebongt) : videos;
  const liste = sichtbar.length
    ? `<div class="card row-list">${sichtbar.map((v) =>
        rowHtml(v, kommMap.get(v.id) || [], bongMap.get(v.id) || [], offen.has(v.id), offenBong.has(v.id), offenTermin.has(v.id))
      ).join("")}</div>`
    : `<div class="card card--pad"><p class="muted" style="margin:0">Noch keine gebongten Videos. Markier eins mit „Video ist gebongt" — oder setz es auf 🎥 Gedreht.</p></div>`;

  el.innerHTML = `${dashboardHtml(videos)}${filterHtml(state, videos)}${liste}`;

  // Alle | Gebongt umschalten (State merken, ganze Liste neu zeichnen).
  el.querySelectorAll(".pl-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gebongt = btn.getAttribute("data-filter") === "gebongt";
      if (gebongt === state.filterGebongt) return;
      state.filterGebongt = gebongt;
      ctx.render();
    });
  });

  el.querySelectorAll(".pl-item").forEach((item) => {
    const id = item.getAttribute("data-id");
    const sel = item.querySelector(".pl-status");
    const video = videos.find((x) => x.id === id);

    // Entfernen mit 2-Klick-Bestätigung (erst „Löschen?", dann wirklich weg).
    const del = item.querySelector(".pl-del");
    del.addEventListener("click", async () => {
      if (!del.classList.contains("is-bestaetigen")) {
        del.classList.add("is-bestaetigen");
        del.textContent = "Löschen?";
        setTimeout(() => { if (del.isConnected) { del.classList.remove("is-bestaetigen"); del.textContent = "✕"; } }, 4000);
        return;
      }
      del.disabled = true;
      try {
        await loescheVideo(id);   // Liste aktualisiert der Observer
        // Stammt das Video aus einem Plan → dessen Verknüpfung lösen, damit
        // der Plan wieder "🚀 In Video-Pipeline" anbietet (kein toter Link).
        if (video && video.planId) aktualisierePlan(video.planId, { videoId: null }).catch(() => {});
      }
      catch (e) { console.error(e); del.disabled = false; del.classList.remove("is-bestaetigen"); del.textContent = "✕"; }
    });

    sel.addEventListener("change", async () => {
      const neu = sel.value;
      sel.disabled = true;
      try {
        await adminSetzeStatus(id, neu);
        if (istFreigabeStufe(neu)) {
          const art = neu === STATUS.FREIGABE_SKRIPT ? "Skript" : "Schnitt";
          sendKundeFreigabe({ titel: (video && video.titel) || "Dein Video", art, videoId: id });
        }
        // Veröffentlicht → Kunde freut sich per News (wandert ins Archiv).
        if (neu === STATUS.GEPOSTET && video) {
          benachrichtigeKunde(video.kundeId, {
            text: `🚀 „${video.titel || "Dein Video"}" ist jetzt online!`,
            videoId: id, art: "gepostet"
          }).catch(() => {});
        }
      } catch (e) {
        console.error(e);
        alert("Status konnte nicht gespeichert werden.");
      } finally {
        sel.disabled = false;
      }
    });

    // 🔁 Neue Version an den Kunden geben (bestehender Entwurf-Mechanismus).
    const ver = item.querySelector(".pl-version");
    if (ver) ver.addEventListener("click", async () => {
      if (!video) return;
      const naechste = (video.entwurf || 1) + 1;
      if (!confirm(`„${video.titel || "Video"}": Neue Version (Entwurf ${naechste}) an den Kunden geben?\nDer Status springt auf die passende Freigabe-Stufe und der Kunde wird benachrichtigt.`)) return;
      ver.disabled = true;
      try {
        const res = await videoNeuerEntwurf(video);
        sendKundeFreigabe({ titel: video.titel || "Dein Video", art: res.artLabel, videoId: id });
        benachrichtigeKunde(video.kundeId, {
          text: `Neue Version (Entwurf ${res.entwurf}) von „${video.titel || "deinem Video"}" — wartet auf deine Freigabe.`,
          videoId: id, art: "version"
        }).catch(() => {});
      } catch (e) {
        console.error(e);
        alert("Neue Version konnte nicht veröffentlicht werden.");
      } finally {
        ver.disabled = false;
      }
    });

    // 💬 Nachrichten-Block auf-/zuklappen (Zustand in `offen` merken, damit er
    // ein Re-Render durch neue Snapshots übersteht).
    const msgBtn = item.querySelector(".pl-msg-btn");
    const msgs   = item.querySelector(".pl-msgs");
    if (msgBtn && msgs) {
      msgBtn.addEventListener("click", () => {
        const jetztOffen = msgs.hidden;
        msgs.hidden = !jetztOffen;
        if (jetztOffen) offen.add(id); else offen.delete(id);
      });
    }

    // Bearbeitungs-Status je Nachricht setzen (gelesen / in Umsetzung / umgesetzt).
    item.querySelectorAll(".pl-msg-set").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msg = btn.closest(".pl-msg");
        const kid = msg && msg.getAttribute("data-kid");
        const wert = btn.getAttribute("data-set");
        if (!kid) return;
        offen.add(id);   // Block offen halten
        try { await kommentarSetzeBearbeitung(id, kid, wert); }
        catch (e) { console.error(e); }
      });
    });

    // ✅ „Video ist gebongt" — manuelles Flag umschalten. Auto-gebongte Videos
    // (ab 🎥 Gedreht) haben keinen Button, sondern eine feste Anzeige.
    const bong = item.querySelector("button.pl-bong");
    if (bong) bong.addEventListener("click", async () => {
      if (!video) return;
      const neu = !(video.gebongt === true);
      bong.disabled = true;
      try { await aktualisiereVideo(id, { gebongt: neu }); }   // Observer zeichnet neu
      catch (e) { console.error(e); bong.disabled = false; }
    });

    // 📝 Notiz-Block auf-/zuklappen (Zustand in `offenBong` merken).
    const notesBtn = item.querySelector(".pl-notes-btn");
    const notes    = item.querySelector(".pl-notes");
    if (notesBtn && notes) notesBtn.addEventListener("click", () => {
      const jetztOffen = notes.hidden;
      notes.hidden = !jetztOffen;
      if (jetztOffen) offenBong.add(id); else offenBong.delete(id);
    });

    // Neue private Notiz speichern.
    const noteForm = item.querySelector(".pl-note-add");
    if (noteForm) noteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ta = noteForm.querySelector(".pl-note-input");
      const text = (ta.value || "").trim();
      if (!text) return;
      const save = noteForm.querySelector(".pl-note-save");
      save.disabled = true;
      offenBong.add(id);   // Block über das Re-Render offen halten
      try { await bongNotizAnlegen(id, text); ta.value = ""; }
      catch (err) { console.error(err); alert("Notiz konnte nicht gespeichert werden."); }
      finally { save.disabled = false; }
    });

    // Einzelne Notiz löschen.
    item.querySelectorAll(".pl-note-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const note = btn.closest(".pl-note");
        const nid = note && note.getAttribute("data-nid");
        if (!nid) return;
        offenBong.add(id);
        try { await loescheBongNotiz(nid); }
        catch (e) { console.error(e); }
      });
    });

    // 📅 Termin-Editor auf-/zuklappen — die Chips (Dreh/Veröffentlichung) sind
    // selbst die Auslöser (kein extra Button in der ohnehin vollen Zeile).
    const terminEdit = item.querySelector(".pl-termine-edit");
    item.querySelectorAll(".pl-termin-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!terminEdit) return;
        const jetztOffen = terminEdit.hidden;
        terminEdit.hidden = !jetztOffen;
        if (jetztOffen) offenTermin.add(id); else offenTermin.delete(id);
      });
    });

    // Dreh-/Veröffentlichungsdatum speichern → Video-Felder setzen. Beide Daten
    // erscheinen dadurch automatisch im Kalender (siehe _kalender-core.js).
    const terminForm = item.querySelector(".pl-termine-edit");
    if (terminForm) terminForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const dreh = terminForm.querySelector(".pl-dreh-input").value;
      const pub  = terminForm.querySelector(".pl-pub-input").value;
      const save = terminForm.querySelector(".pl-termin-save");
      save.disabled = true;
      offenTermin.add(id);   // Editor über das Re-Render offen halten
      try {
        await aktualisiereVideo(id, {
          geplanterDrehtermin: dateInputZuDate(dreh),
          geplantesDatum:      dateInputZuDate(pub)
        });
      } catch (err) {
        console.error(err); alert("Termin konnte nicht gespeichert werden.");
      } finally { save.disabled = false; }
    });
  });
}

// Umschalter „Alle | Gebongt" (mit Zählern). Reine Anzeige/Filter.
function filterHtml(state, videos) {
  const gebongtN = videos.filter(istGebongt).length;
  const tab = (gebongt, label) =>
    `<button class="pl-filter-btn${(!!state.filterGebongt) === gebongt ? " is-active" : ""}"
       data-filter="${gebongt ? "gebongt" : "alle"}" type="button">${label}</button>`;
  return `<div class="pl-filter">
    ${tab(false, `Alle <span class="pl-filter-n">${videos.length}</span>`)}
    ${tab(true, `✅ Gebongt <span class="pl-filter-n">${gebongtN}</span>`)}
  </div>`;
}

// --- Status-Dashboard: Fortschritt über alle aktiven Videos ------------
// Grundgesamtheit = alle Videos außer „Verworfen". „Geskriptet" zählt nur
// Formate, die überhaupt ein Skript brauchen (Cinematic/wortlose Edits fallen
// bei diesem Zähler aus Ist UND Gesamt — n/a). Reine Anzeige, keine DB-Schreibung.
function dashboardHtml(videos) {
  const aktiv = videos.filter((v) => v.status !== STATUS.VERWORFEN);
  if (!aktiv.length) return "";

  const idxFreigabeSkript  = statusIndex(STATUS.FREIGABE_SKRIPT);
  const idxFreigabeSchnitt = statusIndex(STATUS.FREIGABE_SCHNITT);
  const idxFreigegeben     = statusIndex(STATUS.FREIGEGEBEN);

  const skriptRelevant = aktiv.filter((v) => skriptFreigabeNoetig(v.typ));
  const geskriptet  = skriptRelevant.filter((v) => v.freigabeSkript || statusIndex(v.status) > idxFreigabeSkript).length;
  const drehtermin  = aktiv.filter((v) => v.geplanterDrehtermin).length;
  const geschnitten = aktiv.filter((v) => statusIndex(v.status) >= idxFreigabeSchnitt).length;
  const akzeptiert  = aktiv.filter((v) => v.freigabeSchnitt || statusIndex(v.status) >= idxFreigegeben).length;

  const kacheln = [
    { emoji: "📝", label: "Skript fertig",     ist: geskriptet,  gesamt: skriptRelevant.length },
    { emoji: "🎬", label: "Drehtermin geplant", ist: drehtermin,  gesamt: aktiv.length },
    { emoji: "✂️", label: "Schnitt fertig",    ist: geschnitten, gesamt: aktiv.length },
    { emoji: "✅", label: "Vom Kunden freigegeben", ist: akzeptiert, gesamt: aktiv.length }
  ];
  return `<div class="pl-dash">${kacheln.map(kachelHtml).join("")}</div>`;
}

function kachelHtml(k) {
  const pct  = k.gesamt ? Math.round((k.ist / k.gesamt) * 100) : 0;
  const wert = k.gesamt ? `${k.ist}<span class="pl-dash-von">/${k.gesamt}</span>` : "–";
  return `
    <div class="pl-dash-kachel">
      <div class="pl-dash-top">
        <span class="pl-dash-emoji">${k.emoji}</span>
        <span class="pl-dash-wert">${wert}</span>
      </div>
      <div class="pl-dash-label">${escapeHtml(k.label)}</div>
      <div class="pl-dash-bar"><span style="width:${pct}%"></span></div>
    </div>`;
}

function rowHtml(v, komms, notizen, istOffen, istOffenBong, istOffenTermin) {
  const ks = kundenStatus(v.status);
  const opts = STATUS_REIHENFOLGE
    .map((s) => `<option value="${escapeHtml(s)}"${s === v.status ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");

  const ungelesen = komms.filter((k) => (k.bearbeitung || "neu") === "neu").length;
  const hatMsgs = komms.length > 0;
  const verworfen = v.status === STATUS.VERWORFEN ? " pl-item--verworfen" : "";

  const msgBtn = hatMsgs
    ? `<button class="pl-msg-btn${ungelesen ? " has-neu" : ""}" type="button" title="Kunden-Nachrichten">💬${ungelesen ? `<span class="pl-msg-badge">${ungelesen}</span>` : ""}</button>`
    : "";

  // ✅ Gebongt-Steuerung: Auto-gebongt (ab 🎥 Gedreht) → feste Anzeige,
  // sonst ein Toggle-Button. Bei „Verworfen" gar nichts.
  const auto    = autoGebongt(v);
  const gebongt = istGebongt(v);
  const bongBtn = v.status === STATUS.VERWORFEN
    ? ""
    : auto
      ? `<span class="pl-bong is-on is-auto" title="Automatisch gebongt — Video ist gedreht/veröffentlicht">✅ Gebongt</span>`
      : `<button class="pl-bong${gebongt ? " is-on" : ""}" type="button" title="${gebongt ? "Gebongt — wird produziert. Klick zum Zurücknehmen." : "Bongen: fix einplanen, dass dieses Video kommt"}">${gebongt ? "✅ Gebongt" : "Video ist gebongt"}</button>`;

  // 📝 Private Notizen nur für gebongte Videos (der Kunde sieht sie nie).
  const notesBtn = gebongt
    ? `<button class="pl-notes-btn${notizen.length ? " has-notes" : ""}" type="button" title="Private Notizen zu diesem gebongten Video">📝${notizen.length ? `<span class="pl-msg-badge pl-notes-badge">${notizen.length}</span>` : ""}</button>`
    : "";

  const notesBlock = gebongt
    ? `<div class="pl-notes"${istOffenBong ? "" : " hidden"}>
        ${notizen.map(noteHtml).join("")}
        <form class="pl-note-add">
          <textarea class="pl-note-input" rows="2" placeholder="Private Notiz zu diesem gebongten Video …"></textarea>
          <button class="btn btn--accent btn--sm pl-note-save" type="submit">Notiz speichern</button>
        </form>
      </div>`
    : "";

  // 📅 Termin-Status als klickbare Chips (öffnen den Editor darunter). Bei
  // „Verworfen" nicht relevant — kein Dreh/keine Veröffentlichung.
  const drehGesetzt = !!v.geplanterDrehtermin;
  const pubGesetzt  = !!v.geplantesDatum;
  const terminChips = v.status === STATUS.VERWORFEN ? "" : `
    <div class="pl-termine">
      <button type="button" class="pl-termin-chip ${drehGesetzt ? "is-set" : "is-offen"}" title="Drehtermin planen — erscheint im Kalender">
        🎬 ${drehGesetzt ? escapeHtml(formatDatum(v.geplanterDrehtermin)) : "Kein Drehtermin"}
      </button>
      <button type="button" class="pl-termin-chip ${pubGesetzt ? "is-set" : "is-offen"}" title="Veröffentlichung planen — erscheint im Kalender">
        📣 ${pubGesetzt ? escapeHtml(formatDatum(v.geplantesDatum)) : "Kein Termin"}
      </button>
    </div>`;

  const terminEdit = v.status === STATUS.VERWORFEN ? "" : `
    <form class="pl-termine-edit"${istOffenTermin ? "" : " hidden"}>
      <div class="pl-termin-feld">
        <label>🎬 Drehtermin</label>
        <input type="date" class="pl-dreh-input" value="${escapeHtml(tsZuDateInput(v.geplanterDrehtermin))}" />
      </div>
      <div class="pl-termin-feld">
        <label>📣 Veröffentlichung</label>
        <input type="date" class="pl-pub-input" value="${escapeHtml(tsZuDateInput(v.geplantesDatum))}" />
      </div>
      <div class="pl-termin-actions">
        <button class="btn btn--accent btn--sm pl-termin-save" type="submit">Speichern</button>
        <span class="muted pl-termin-hint">Erscheint im Kalender · Feld leeren = Termin entfernen</span>
      </div>
    </form>`;

  return `
    <div class="pl-item${verworfen}" data-id="${escapeHtml(v.id)}">
      <div class="pl-row">
        <div class="pl-main">
          <a class="row-name" href="#/admin/video/${encodeURIComponent(v.id)}">${escapeHtml(v.titel || "Unbenanntes Video")}</a>
          <span class="row-sub muted">
            ${v.typ ? escapeHtml(v.typ) + " · " : ""}Kunde sieht: „${escapeHtml(ks.label)}"
            ${(v.entwurf || 1) > 1 ? " · 📝 Entwurf " + (v.entwurf || 1) : ""}
          </span>
          ${terminChips}
        </div>
        ${bongBtn}
        ${notesBtn}
        ${msgBtn}
        <button class="pl-version" type="button" title="Neue Version an den Kunden geben — zählt den Entwurf hoch und benachrichtigt den Kunden zur Freigabe">🔁 <span class="pl-version-txt">Neue Version</span></button>
        <select class="pl-status field-inline" aria-label="Status">${opts}</select>
        <button class="pl-del" type="button" title="Video aus der Pipeline entfernen">✕</button>
      </div>
      ${hatMsgs ? `<div class="pl-msgs"${istOffen ? "" : " hidden"}>${komms.map(msgHtml).join("")}</div>` : ""}
      ${notesBlock}
      ${terminEdit}
    </div>`;
}

// Einzelne private Bong-Notiz (Admin-only).
function noteHtml(n) {
  return `
    <div class="pl-note" data-nid="${escapeHtml(n.id)}">
      <div class="pl-note-text">${escapeHtml(n.text)}</div>
      <div class="pl-note-foot">
        <span class="muted pl-note-zeit">${escapeHtml(formatDatum(n.erstelltAm, true))}</span>
        <button class="pl-note-del" type="button" title="Notiz löschen">✕</button>
      </div>
    </div>`;
}

function msgHtml(k) {
  const status = k.bearbeitung || "neu";
  const neu = status === "neu";
  const artPill = k.art === "aenderungswunsch"
    ? `<span class="pill pill--aktion">Änderungswunsch</span>` : "";
  const setBtn = (val, label) =>
    `<button class="pl-msg-set${status === val ? " is-active" : ""}" data-set="${val}" type="button">${label}</button>`;

  return `
    <div class="pl-msg${neu ? " is-neu" : ""}" data-kid="${escapeHtml(k.id)}">
      <div class="pl-msg-head">
        <span class="pl-msg-autor">${escapeHtml(kurzname(k.autor))}</span>
        ${artPill}
        <span class="pl-msg-status pl-msg-status--${status}">${BEARB_LABEL[status] || status}</span>
        <span class="muted pl-msg-zeit">${escapeHtml(formatDatum(k.erstelltAm, true))}</span>
      </div>
      <div class="pl-msg-text">${escapeHtml(k.text)}</div>
      <div class="pl-msg-btns">
        ${setBtn("gelesen", "Gelesen")}
        ${setBtn("in_umsetzung", "In Umsetzung")}
        ${setBtn("umgesetzt", "Umgesetzt")}
      </div>
    </div>`;
}

function tsSek(t) { return (t && t.seconds) || 0; }
function kurzname(email) { return String(email || "").split("@")[0] || "Kunde"; }
