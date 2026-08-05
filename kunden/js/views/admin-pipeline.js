// Admin-View: Pipeline. Alle Videos mit Status-Dropdown (alle Stufen).
// Beim Setzen auf eine Freigabe-Stufe → EmailJS-Benachrichtigung an die Kunden.
// Zusätzlich: pro Video ein 💬-Nachrichten-Block (Kunden-Kommentare &
// Änderungswünsche) mit Bearbeitungs-Status (neu → gelesen → in Umsetzung →
// umgesetzt). Ein einziger collectionGroup-Listener liefert alle Kommentare.
import {
  beobachteVideos, adminSetzeStatus, loescheVideo, aktualisierePlan, aktualisiereVideo,
  beobachteAlleKommentare, kommentarSetzeBearbeitung, benachrichtigeKunde,
  beobachteBongNotizen, bongNotizAnlegen, loescheBongNotiz, beobachteKunden,
  beobachteOffeneSkriptUploads
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { STATUS, STATUS_REIHENFOLGE, statusIndex, istFreigabeStufe, kundenStatus, skriptFreigabeNoetig, istGebongt, autoGebongt } from "../status.js";
import { sendKundeFreigabe } from "../email.js";
import { videoNeuerEntwurf } from "../versionen.js";
import { escapeHtml, formatDatum, tsZuDateInput, dateInputZuDate, monatKey, monatsLabel, monatPlus } from "../util.js";

const BEARB_LABEL = {
  neu: "Neu", gelesen: "Gelesen", in_umsetzung: "In Umsetzung", umgesetzt: "Umgesetzt"
};

// Einmalige Migration: Bestandsvideos ohne `monat`-Feld gehören zum Juli-Batch
// (so von Valentin festgelegt). Idempotent — schreibt nur Dokumente ohne das
// Feld; Konstante kann nach erfolgreicher Migration entfernt werden (dann
// greift für Nachzügler der erstelltAm-Fallback in anzeigeMonat()).
const MIGRATION_MONAT = "2026-07";
let _backfillLief = false;

// Pipeline-Monat eines Videos — mit Fallbacks, damit NIE ein Video aus der
// Ansicht fällt (alte Docs ohne Feld, Latenz-Snapshots mit null-Timestamp).
function anzeigeMonat(v) {
  if (v.monat) return v.monat;
  if (v.erstelltAm && typeof v.erstelltAm.toDate === "function") return monatKey(v.erstelltAm.toDate());
  return monatKey(new Date());
}

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
  const ctx = { offen, offenBong, offenTermin, kundenMap: new Map(), uploadMap: new Map(),
    state: { filterGebongt: false, offeneMonate: new Set([monatKey(new Date())]) }, render: null };
  let videosGeladen = false;

  const render = () => zeichne(plList, videos, kommMap, bongMap, ctx);
  ctx.render = render;

  const unsubV = beobachteVideos(
    (v) => {
      videos = v; videosGeladen = true;
      if (!_backfillLief) {
        _backfillLief = true;
        v.filter((x) => !x.monat).forEach((x) =>
          aktualisiereVideo(x.id, { monat: MIGRATION_MONAT }).catch(() => {}));
      }
      render();
    },
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

  // Kundenprofile für den Drive-Ordner-Fallback (video.driveOrdner leer →
  // Ordner des Kunden). Kein Blocker: rendert auch, bevor die Map da ist.
  const unsubKd = beobachteKunden(
    (liste) => {
      ctx.kundenMap = new Map(liste.map((k) => [k.id, k]));
      if (videosGeladen) render();
    },
    (err) => console.error(err)
  );

  // Offene Kunden-Skript-Uploads → 📄-Badge auf der Karte (bis „Erledigt").
  const unsubU = beobachteOffeneSkriptUploads(
    (liste) => {
      const m = new Map();
      liste.forEach((u) => { if (u.videoId) m.set(u.videoId, (m.get(u.videoId) || 0) + 1); });
      ctx.uploadMap = m;
      if (videosGeladen) render();
    },
    (err) => console.error(err)
  );

  beiViewWechsel(unsubV);
  beiViewWechsel(unsubK);
  beiViewWechsel(unsubB);
  beiViewWechsel(unsubKd);
  beiViewWechsel(unsubU);
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

  // Nach Pipeline-Monat gruppieren, neueste Monate zuerst. Der aktuelle Monat
  // wird IMMER angelegt (auch leer) — so „öffnet" sich am 1. automatisch die
  // neue Monats-Sektion, ganz ohne Backend/Cron. Im Gebongt-Filter entfallen
  // leere Sektionen (nur echte Treffer zählen).
  const aktuellerMonat = monatKey(new Date());
  const gruppen = new Map();
  sichtbar.forEach((v) => {
    const m = anzeigeMonat(v);
    if (!gruppen.has(m)) gruppen.set(m, []);
    gruppen.get(m).push(v);
  });
  if (!state.filterGebongt && !gruppen.has(aktuellerMonat)) gruppen.set(aktuellerMonat, []);
  const monate = [...gruppen.keys()].sort().reverse();

  const sektionHtml = (m) => {
    const vs = gruppen.get(m);
    const istOffenM = state.offeneMonate.has(m);
    const gebongtN = vs.filter(istGebongt).length;
    const inhalt = vs.length
      ? `<div class="pl-karten">${vs.map((v) =>
          rowHtml(v, kommMap.get(v.id) || [], bongMap.get(v.id) || [], offen.has(v.id), offenBong.has(v.id), offenTermin.has(v.id), ctx.kundenMap.get(v.kundeId), ctx.uploadMap.get(v.id) || 0)
        ).join("")}</div>`
      : `<div class="card card--pad"><p class="muted" style="margin:0">Noch keine Videos in diesem Monat — leg mit „+ Neues Video" los.</p></div>`;
    return `
      <section class="pl-monat${istOffenM ? " is-offen" : ""}" data-monat="${escapeHtml(m)}">
        <button class="pl-monat-head" type="button" title="${istOffenM ? "Monat zuklappen" : "Monat aufklappen"}">
          <span class="pl-monat-chevron">▸</span>
          <span class="pl-monat-label">${escapeHtml(monatsLabel(m))}</span>
          ${m === aktuellerMonat ? `<span class="pl-monat-jetzt">aktueller Monat</span>` : ""}
          <span class="pl-monat-n muted">${vs.length} Video${vs.length === 1 ? "" : "s"}${gebongtN ? ` · ${gebongtN} gebongt` : ""}</span>
        </button>
        <div class="pl-monat-body"${istOffenM ? "" : " hidden"}>${inhalt}</div>
      </section>`;
  };

  const liste = monate.length
    ? monate.map(sektionHtml).join("")
    : `<div class="card card--pad"><p class="muted" style="margin:0">Noch keine gebongten Videos. Markier eins mit „Video ist gebongt" — oder setz es auf 🎥 Gedreht.</p></div>`;

  el.innerHTML = `${dashboardHtml(videos)}${filterHtml(state, videos)}${liste}`;

  // Monats-Sektionen auf-/zuklappen (Zustand in offeneMonate, damit er
  // Snapshot-Re-Renders übersteht).
  el.querySelectorAll(".pl-monat-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.closest(".pl-monat").getAttribute("data-monat");
      if (state.offeneMonate.has(m)) state.offeneMonate.delete(m);
      else state.offeneMonate.add(m);
      ctx.render();
    });
  });

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

    // 📅 Pipeline-Monat umhängen (z. B. „für August vorproduziert").
    const monSel = item.querySelector(".pl-monat-sel");
    if (monSel) monSel.addEventListener("change", async () => {
      monSel.disabled = true;
      try { await aktualisiereVideo(id, { monat: monSel.value }); }   // Observer zeichnet neu
      catch (e) { console.error(e); alert("Monat konnte nicht gespeichert werden."); monSel.disabled = false; }
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

function rowHtml(v, komms, notizen, istOffen, istOffenBong, istOffenTermin, kunde, uploadsOffen) {
  const ks = kundenStatus(v.status);
  const opts = STATUS_REIHENFOLGE
    .map((s) => `<option value="${escapeHtml(s)}"${s === v.status ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");

  // 📅 Pipeline-Monat: Fenster Vormonat … +2 — plus den gesetzten Monat des
  // Videos, falls er außerhalb liegt (sonst wäre die Selektion unsichtbar).
  const vMonat = anzeigeMonat(v);
  const basis = monatKey(new Date());
  const fenster = [monatPlus(basis, -1), basis, monatPlus(basis, 1), monatPlus(basis, 2)];
  if (!fenster.includes(vMonat)) fenster.push(vMonat);
  const monatOpts = fenster.sort()
    .map((m) => `<option value="${escapeHtml(m)}"${m === vMonat ? " selected" : ""}>${escapeHtml(monatsLabel(m))}</option>`)
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

  // 🔗 Schnellzugriffe auf der Karte: Skript, Google Drive, Kalender-Eintrag.
  // Reine <a>-Links — brauchen kein Event-Wiring. Fehlt die Quelle, entfällt
  // der Link (leere Buttons wären auf der Karte nur Rauschen).
  const links = [];
  // 📄 Offener Kunden-Upload: auffälliger Badge, führt direkt zum Upload-Block
  // in der Video-Bearbeitung. Verschwindet, sobald der Upload „Erledigt" ist.
  if (uploadsOffen) links.push(
    `<a class="pl-link pl-link--upload" href="#/admin/video/${encodeURIComponent(v.id)}" title="Der Kunde hat ein überarbeitetes Skript hochgeladen — ansehen und auf Erledigt setzen">📄 Neues Kunden-Skript${uploadsOffen > 1 ? ` (${uploadsOffen})` : ""}</a>`);
  if (skriptFreigabeNoetig(v.typ)) {
    if (v.planId) links.push(`<a class="pl-link" href="#/admin/plan/${encodeURIComponent(v.planId)}">📝 Skript</a>`);
    else if (v.skriptLink) links.push(`<a class="pl-link" href="${escapeHtml(v.skriptLink)}" target="_blank" rel="noopener">📝 Skript ↗</a>`);
  }
  const drive = v.driveOrdner || (kunde && kunde.driveOrdner) || "";
  if (drive) links.push(`<a class="pl-link" href="${escapeHtml(drive)}" target="_blank" rel="noopener">📁 Google Drive ↗</a>`);
  const terminTs = v.geplanterDrehtermin || v.geplantesDatum;
  if (terminTs) {
    const markerId = v.geplanterDrehtermin ? `vd_${v.id}` : `vp_${v.id}`;
    const d = terminTs.toDate ? terminTs.toDate() : new Date(terminTs);
    if (!isNaN(d.getTime())) links.push(
      `<a class="pl-link" href="#/admin/kalender?m=${encodeURIComponent(monatKey(d))}&mark=${encodeURIComponent(markerId)}">📅 Kalender</a>`);
  }
  const linksHtml = links.length ? `<div class="pl-links">${links.join("")}</div>` : "";

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
        <select class="pl-monat-sel field-inline" aria-label="Pipeline-Monat" title="In welchen Monat gehört dieses Video?">${monatOpts}</select>
        <select class="pl-status field-inline" aria-label="Status">${opts}</select>
        <button class="pl-del" type="button" title="Video aus der Pipeline entfernen">✕</button>
      </div>
      ${linksHtml}
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
