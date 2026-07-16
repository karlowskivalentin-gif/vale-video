// Kunden-View: Video-Detail.
//   - Freigabe Skript  → Google-Drive-PDF (/preview-iframe)
//   - Freigabe Schnitt → YouTube-Embed
//   - Kommentar-Thread (lesen + schreiben)
//   - Aktionen: „Freigeben" (Auto-Sprung) / „Änderungen anfordern" (Pflicht-Kommentar)
import {
  beobachteVideo, beobachteKommentare,
  kommentarHinzufuegen, kundeGibtFrei, kundeFordertAenderung, kundeVerwirft,
  benachrichtigeAdmin, skriptUploadAnlegen, beobachteSkriptUploads, erledigeFreigabeNews
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { STATUS, kundenStatus, istFreigabeStufe } from "../status.js";
import { drivePreviewUrl } from "../drive.js";
import { escapeHtml, formatDatum } from "../util.js";
import { renderPlanDetails, planHatDetails } from "../plan-ansicht.js";
import { embedHtml, erkennePlattform, verarbeiteEmbeds } from "../embeds.js";
import { dateiZuBase64, extrahiereText } from "../docparse.js";

export function renderVideoDetail(container, ctx) {
  const user = ctx.user;
  const id = ctx.id;
  const kundeId = ctx.kundeId || null;

  if (!id) {
    container.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
      Kein Video ausgewählt. <a href="#/aufgaben">Zurück zu Aufgaben</a>.</p></div>`;
    return;
  }

  container.innerHTML = `
    <a class="back-link" href="#/aufgaben">← Zurück zu Aufgaben</a>
    <h1 class="view-title" id="vdTitel">Video</h1>
    <div id="vdMedia" class="vd-media"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>
    <div id="vdPlan" class="vd-plan"></div>
    <div id="vdAction" class="vd-action"></div>

    <section class="vd-skript-upload card card--pad">
      <h2 class="section-title" style="margin:0 0 .4rem">📄 Skript überarbeitet?</h2>
      <p class="muted" style="margin:0 0 .8rem">Zieh dein überarbeitetes Skript (Word oder PDF) hier rein — Valentin bekommt sofort Bescheid.</p>
      <div class="skript-drop" id="skDrop" tabindex="0" role="button" aria-label="Skript-Datei ablegen oder auswählen">
        <span class="skript-drop-icon" aria-hidden="true">⬆️</span>
        <span class="skript-drop-text">Datei hierher ziehen oder <span class="skript-drop-link">auswählen</span></span>
        <span class="muted skript-drop-hint">.docx oder .pdf · max ~700 KB</span>
      </div>
      <input type="file" id="skFile" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
      <div class="notice notice--ok"    id="skOk"  hidden role="status"></div>
      <div class="notice notice--error" id="skErr" hidden role="alert"></div>
      <div class="skript-upload-liste" id="skListe"></div>
    </section>

    <section class="vd-komm">
      <h2 class="section-title">Kommentare</h2>
      <div id="vdComments" class="komm-list"><p class="muted">Wird geladen …</p></div>
      <form id="kForm" class="komm-form card card--pad">
        <div class="field" style="margin:0 0 .75rem">
          <label for="kText">Kommentar</label>
          <textarea id="kText" placeholder="Frage oder Anmerkung an Valentin …"></textarea>
        </div>
        <div class="notice notice--error" id="kErr" hidden role="alert"></div>
        <button class="btn btn--ghost btn--sm" type="submit" id="kSubmit">Kommentar senden</button>
      </form>
    </section>`;

  const elTitel    = container.querySelector("#vdTitel");
  const elMedia    = container.querySelector("#vdMedia");
  const elPlan     = container.querySelector("#vdPlan");
  const elAction   = container.querySelector("#vdAction");
  const elComments = container.querySelector("#vdComments");
  const kForm      = container.querySelector("#kForm");
  const kText      = container.querySelector("#kText");
  const kErr       = container.querySelector("#kErr");
  const kSubmit    = container.querySelector("#kSubmit");

  let video = null;

  // Kunden-Aktivität an die Admin-Glocke melden (fire-and-forget, still bei Fehler).
  const meldeAdmin = (art, text, videoId) => {
    benachrichtigeAdmin({ von: user.email, text, videoId, art }).catch(() => {});
  };

  // Nach einer Reaktion die eigene(n) Freigabe-Neuigkeit(en) zu diesem Video als
  // erledigt markieren (grün/durchgestrichen im News-Feed & in der Glocke).
  const erledigeNews = (videoId) => {
    erledigeFreigabeNews(user.email, videoId).catch(() => {});
  };

  // --- Video-Subscription: Titel, Media, Aktionen ---------------------
  const unsubV = beobachteVideo(id,
    (v) => {
      video = v;
      if (!v) {
        elTitel.textContent = "Video nicht gefunden";
        elMedia.innerHTML = `<div class="card card--pad"><p class="muted">
          Dieses Video existiert nicht (mehr).</p></div>`;
        elPlan.innerHTML = "";
        elAction.innerHTML = "";
        kForm.style.display = "none";
        return;
      }
      kForm.style.display = "";
      elTitel.textContent = v.titel || "Unbenanntes Video";
      elMedia.innerHTML = mediaHtml(v);
      verarbeiteEmbeds(elMedia);   // TikTok/Instagram-Embeds aktivieren
      renderPlan(v);
      renderAction(v);
    },
    (err) => {
      console.error(err);
      elMedia.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Video konnte nicht geladen werden.</p></div>`;
    }
  );

  // --- Kommentar-Subscription -----------------------------------------
  const unsubK = beobachteKommentare(id,
    (liste) => renderComments(liste),
    (err) => { console.error(err); }
  );

  beiViewWechsel(unsubV);
  beiViewWechsel(unsubK);

  // --- Skript-Upload (Drag & Drop) ------------------------------------
  initSkriptUpload();

  function initSkriptUpload() {
    const drop  = container.querySelector("#skDrop");
    const input = container.querySelector("#skFile");
    const okB   = container.querySelector("#skOk");
    const errB  = container.querySelector("#skErr");
    const liste = container.querySelector("#skListe");
    if (!drop || !input) return;

    // Eigene Uploads dieses Videos anzeigen (Bestätigung, dass es ankam).
    const unsubU = beobachteSkriptUploads(id, (uploads) => {
      const meine = uploads
        .filter((u) => String(u.gemeldetVon || "").toLowerCase() === String(user.email).toLowerCase())
        .sort((a, b) => ((b.erstelltAm && b.erstelltAm.seconds) || 0) - ((a.erstelltAm && a.erstelltAm.seconds) || 0));
      liste.innerHTML = meine.length
        ? `<div class="skript-upload-head muted">Deine hochgeladenen Skripte:</div>` + meine.map((u) => `
            <div class="skript-upload-item">
              <span>📄 ${escapeHtml(u.dateiName || "Skript")}</span>
              <span class="muted">${escapeHtml(formatDatum(u.erstelltAm, true))}${u.erledigt ? " · ✅ übernommen" : ""}</span>
            </div>`).join("")
        : "";
    }, () => {});
    beiViewWechsel(unsubU);

    const verarbeite = async (file) => {
      if (!file) return;
      okB.hidden = true; errB.hidden = true;
      drop.classList.add("is-busy");
      const alt = drop.querySelector(".skript-drop-text").textContent;
      drop.querySelector(".skript-drop-text").textContent = "Wird hochgeladen …";
      try {
        const { base64, name, typ } = await dateiZuBase64(file);
        // Textextraktion best-effort (offline) — scheitert sie, wird trotzdem hochgeladen.
        let text = "";
        try { text = await extrahiereText(file); } catch (_) { /* ohne Text weiter */ }
        await skriptUploadAnlegen({
          videoId: id, kundeId, gemeldetVon: user.email,
          dateiName: name, dateiTyp: typ, base64, text
        });
        const titel = (video && video.titel) || "dein Video";
        benachrichtigeAdmin({
          von: user.email,
          text: `📝 ${kurzname(user.email)} hat das Skript für „${titel}" angepasst (${escapeHtml(name)})`,
          videoId: id, art: "skript"
        }).catch(() => {});
        okB.textContent = "Danke! Dein überarbeitetes Skript ist bei Valentin eingegangen.";
        okB.hidden = false;
      } catch (e) {
        console.error(e);
        errB.textContent = (e && e.message) ? e.message : "Upload fehlgeschlagen. Bitte erneut versuchen.";
        errB.hidden = false;
      } finally {
        drop.classList.remove("is-busy");
        drop.querySelector(".skript-drop-text").textContent = alt;
        input.value = "";
      }
    };

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => verarbeite(input.files && input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "dragend"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
      verarbeite(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  // --- Plan-Details (das Skript & ALLES, was deployt wurde) -----------
  // Bei aus einem Plan deployten Videos steckt das Skript nicht in einem
  // Drive-PDF, sondern im planSnapshot (Notiz, Sound, Shotlist, Inspira-
  // tionen, Anhänge). Gleiche Darstellung wie in der Admin-Video-Ansicht.
  function renderPlan(v) {
    if (v.planSnapshot && planHatDetails(v.planSnapshot)) {
      renderPlanDetails(elPlan, v.planSnapshot, {
        titel: "📝 Dein Skript & alle Details",
        anhangLabel: "Anhänge",
        leerText: ""
      });
    } else {
      elPlan.innerHTML = "";
    }
  }

  // --- Aktionen (Ampel: freigeben / ändern / verwerfen) ---------------
  // Skript-Freigabe → 3 Ampel-Buttons (grün/gelb/rot). Schnitt-Freigabe →
  // 2 Buttons wie bisher (bei einem fertigen Schnitt gibt es kein „nicht machen").
  function renderAction(v) {
    if (!istFreigabeStufe(v.status)) {
      const ks = kundenStatus(v.status);
      elAction.innerHTML = `
        <div class="card card--pad">
          <span class="pill pill--${ks.ton}">${escapeHtml(ks.label)}</span>
          <p class="muted" style="margin:.65rem 0 0">
            Sobald wieder etwas für dich ansteht, erscheint es hier und unter „Aufgaben".
          </p>
        </div>`;
      return;
    }

    const istSkript = v.status === STATUS.FREIGABE_SKRIPT;
    const ks    = kundenStatus(v.status);
    const was   = istSkript ? "das Skript" : "den Schnitt";
    const titel = v.titel || "Dein Video";
    const wer   = kurzname(user.email);

    const buttons = istSkript
      ? `<button class="btn btn--ok"    id="btnFreigeben" type="button">So umsetzen</button>
         <button class="btn btn--warn"  id="btnAendern"   type="button">Mit Änderungswünschen</button>
         <button class="btn btn--error" id="btnVerwerfen" type="button">Wird nicht gemacht</button>`
      : `<button class="btn btn--accent" id="btnFreigeben" type="button">Freigeben</button>
         <button class="btn btn--ghost"  id="btnAendern"   type="button">Änderungen anfordern</button>`;

    elAction.innerHTML = `
      <div class="card card--pad action-card">
        <span class="pill pill--aktion">${escapeHtml(ks.label)}</span>
        ${(v.entwurf || 1) > 1 ? `<p class="entwurf-hinweis">✓ Deine Änderungswünsche wurden umgesetzt – hier ist der neue Entwurf (Nr.&nbsp;${v.entwurf}).</p>` : ""}
        <p class="action-hint muted">Sieh dir ${was} oben an und entscheide:</p>
        <div class="action-btns action-ampel">${buttons}</div>

        <div id="aenderPanel" hidden>
          <div class="field" style="margin-top:1rem">
            <label for="aenderText">Was sollen wir ändern? <span class="req">*</span></label>
            <textarea id="aenderText" placeholder="Beschreibe möglichst konkret, was angepasst werden soll …"></textarea>
          </div>
          <div class="action-btns">
            <button class="btn btn--accent" id="btnAenderSenden"    type="button">Änderungen senden</button>
            <button class="btn btn--ghost"  id="btnAenderAbbrechen" type="button">Abbrechen</button>
          </div>
        </div>
        ${istSkript ? `
        <div id="verwerfenPanel" hidden>
          <div class="field" style="margin-top:1rem">
            <label for="verwerfenText">Warum nicht? <span class="muted">(optional)</span></label>
            <textarea id="verwerfenText" placeholder="Kurzer Grund, damit Valentin es nachvollziehen kann …"></textarea>
          </div>
          <div class="action-btns">
            <button class="btn btn--error" id="btnVerwerfenSenden"    type="button">Nicht produzieren</button>
            <button class="btn btn--ghost" id="btnVerwerfenAbbrechen" type="button">Abbrechen</button>
          </div>
        </div>` : ``}
        <div class="notice notice--error" id="actionErr" hidden role="alert"></div>
      </div>`;

    const btnFreigeben = elAction.querySelector("#btnFreigeben");
    const btnAendern   = elAction.querySelector("#btnAendern");
    const btnVerwerfen = elAction.querySelector("#btnVerwerfen");   // nur Skript
    const panel        = elAction.querySelector("#aenderPanel");
    const btnSenden    = elAction.querySelector("#btnAenderSenden");
    const btnAbbrechen = elAction.querySelector("#btnAenderAbbrechen");
    const aenderText   = elAction.querySelector("#aenderText");
    const vPanel       = elAction.querySelector("#verwerfenPanel"); // nur Skript
    const vSenden      = elAction.querySelector("#btnVerwerfenSenden");
    const vAbbrechen   = elAction.querySelector("#btnVerwerfenAbbrechen");
    const vText        = elAction.querySelector("#verwerfenText");
    const actionErr    = elAction.querySelector("#actionErr");

    const zeigeFehler = (msg) => { actionErr.textContent = msg; actionErr.hidden = false; };
    const alleBtns = [btnFreigeben, btnAendern, btnVerwerfen, btnSenden, vSenden].filter(Boolean);
    const setBusy = (busy) => alleBtns.forEach((b) => { b.disabled = busy; });
    // Primär-Buttons ein-/ausblenden (beim Öffnen/Schließen eines Panels).
    const zeigePrimaer = (sichtbar) => {
      btnFreigeben.hidden = !sichtbar;
      btnAendern.hidden = !sichtbar;
      if (btnVerwerfen) btnVerwerfen.hidden = !sichtbar;
    };

    // 🟢 Freigeben / So umsetzen
    btnFreigeben.addEventListener("click", async () => {
      actionErr.hidden = true;
      setBusy(true);
      btnFreigeben.textContent = "Wird freigegeben …";
      try {
        await kundeGibtFrei(v, user);
        meldeAdmin("freigabe", `✅ ${wer} hat ${was} freigegeben: „${titel}"`, v.id);
        erledigeNews(v.id);
        // onSnapshot rendert die Aktionen neu (Status ist gesprungen).
      } catch (e) {
        console.error(e);
        zeigeFehler("Freigabe fehlgeschlagen. Bitte erneut versuchen.");
        setBusy(false);
        btnFreigeben.textContent = istSkript ? "So umsetzen" : "Freigeben";
      }
    });

    // 🟡 Änderungen anfordern (Pflicht-Kommentar)
    btnAendern.addEventListener("click", () => {
      panel.hidden = false;
      if (vPanel) vPanel.hidden = true;
      zeigePrimaer(false);
      aenderText.focus();
    });
    btnAbbrechen.addEventListener("click", () => {
      panel.hidden = true;
      zeigePrimaer(true);
      aenderText.value = "";
      actionErr.hidden = true;
    });
    btnSenden.addEventListener("click", async () => {
      actionErr.hidden = true;
      const txt = aenderText.value.trim();
      if (!txt) { zeigeFehler("Bitte beschreibe kurz die gewünschten Änderungen."); aenderText.focus(); return; }
      setBusy(true);
      btnSenden.textContent = "Wird gesendet …";
      try {
        await kommentarHinzufuegen(v.id, { text: txt, autor: user.email, rolle: "kunde", art: "aenderungswunsch" });
        await kundeFordertAenderung(v);
        meldeAdmin("aenderung", `✏️ ${wer} wünscht Änderungen an „${titel}": ${kurz(txt)}`, v.id);
        erledigeNews(v.id);
        // onSnapshot aktualisiert Status + Kommentare.
      } catch (e) {
        console.error(e);
        zeigeFehler("Senden fehlgeschlagen. Bitte erneut versuchen.");
        setBusy(false);
        btnSenden.textContent = "Änderungen senden";
      }
    });

    // 🔴 Wird nicht gemacht (nur Skript; optionaler Grund)
    if (btnVerwerfen) {
      btnVerwerfen.addEventListener("click", () => {
        vPanel.hidden = false;
        panel.hidden = true;
        zeigePrimaer(false);
        vText.focus();
      });
      vAbbrechen.addEventListener("click", () => {
        vPanel.hidden = true;
        zeigePrimaer(true);
        vText.value = "";
        actionErr.hidden = true;
      });
      vSenden.addEventListener("click", async () => {
        actionErr.hidden = true;
        const txt = vText.value.trim();
        setBusy(true);
        vSenden.textContent = "Wird gesendet …";
        try {
          if (txt) await kommentarHinzufuegen(v.id, { text: txt, autor: user.email, rolle: "kunde", art: "kommentar" });
          await kundeVerwirft(v);
          meldeAdmin("verworfen", `🚫 ${wer} will „${titel}" nicht produzieren${txt ? ": " + kurz(txt) : ""}`, v.id);
          erledigeNews(v.id);
        } catch (e) {
          console.error(e);
          zeigeFehler("Senden fehlgeschlagen. Bitte erneut versuchen.");
          setBusy(false);
          vSenden.textContent = "Nicht produzieren";
        }
      });
    }
  }

  // --- Kommentar-Thread -----------------------------------------------
  function renderComments(liste) {
    if (!liste.length) {
      elComments.innerHTML = `<p class="muted">Noch keine Kommentare.</p>`;
      return;
    }
    elComments.innerHTML = liste.map((k) => {
      const autor = k.rolle === "admin" ? "Valentin" : kurzname(k.autor);
      const wunsch = k.art === "aenderungswunsch"
        ? `<span class="pill pill--aktion">Änderungswunsch</span>` : "";
      return `
        <div class="komm komm--${escapeHtml(k.rolle || "kunde")}">
          <div class="komm-head">
            <span class="komm-autor">${escapeHtml(autor)}</span>
            ${wunsch}
            <span class="komm-zeit muted">${escapeHtml(formatDatum(k.erstelltAm, true))}</span>
          </div>
          <div class="komm-text">${escapeHtml(k.text)}</div>
        </div>`;
    }).join("");
  }

  // --- Allgemeiner Kommentar ------------------------------------------
  kForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    kErr.hidden = true;
    const txt = kText.value.trim();
    if (!txt) { kErr.textContent = "Bitte einen Text eingeben."; kErr.hidden = false; return; }
    if (!video) return;
    kSubmit.disabled = true;
    kSubmit.textContent = "Wird gesendet …";
    try {
      await kommentarHinzufuegen(video.id, { text: txt, autor: user.email, rolle: "kunde", art: "kommentar" });
      meldeAdmin("kommentar", `💬 ${kurzname(user.email)} hat kommentiert bei „${video.titel || "Video"}": ${kurz(txt)}`, video.id);
      kText.value = "";
    } catch (err) {
      console.error(err);
      kErr.textContent = "Kommentar konnte nicht gesendet werden.";
      kErr.hidden = false;
    } finally {
      kSubmit.disabled = false;
      kSubmit.textContent = "Kommentar senden";
    }
  });
}

// --- Media nach Stufe -------------------------------------------------
function mediaHtml(v) {
  let art = null;
  if (v.status === STATUS.FREIGABE_SKRIPT) art = "skript";
  else if (v.status === STATUS.FREIGABE_SCHNITT) art = "schnitt";
  else if (v.schnittLink && erkennePlattform(v.schnittLink) !== "andere") art = "schnitt";
  else if (v.skriptLink && drivePreviewUrl(v.skriptLink)) art = "skript";

  // Skript aus einem Plan deployt? Dann steckt der Inhalt im planSnapshot
  // (wird als eigener Block unter dem Media gerendert) — kein leerer Platzhalter.
  const hatPlan = v.planSnapshot && planHatDetails(v.planSnapshot);

  if (art === "skript") {
    const url = drivePreviewUrl(v.skriptLink);
    if (!url) return hatPlan ? "" : infoCard("Das Skript liegt noch nicht vor.");
    return `
      <div class="card media-card">
        <div class="media-label">📝 Skript</div>
        <div class="embed-pdf"><iframe src="${escapeHtml(url)}" title="Skript" allow="autoplay"></iframe></div>
        <a class="media-extern muted" href="${escapeHtml(v.skriptLink)}" target="_blank" rel="noopener">In Google&nbsp;Drive öffnen ↗</a>
      </div>`;
  }
  if (art === "schnitt") {
    if (!v.schnittLink || erkennePlattform(v.schnittLink) === "andere") return infoCard("Der Schnitt liegt noch nicht vor.");
    // Universelles Embed: YouTube / TikTok / Instagram / Vimeo / Drive.
    return `
      <div class="card media-card">
        <div class="media-label">🎬 Schnitt</div>
        ${embedHtml(v.schnittLink)}
      </div>`;
  }
  return hatPlan ? "" : infoCard("Hier erscheinen Skript und Schnitt, sobald sie bereitstehen.");
}

function infoCard(text) {
  return `<div class="card card--pad"><p class="muted" style="margin:0">${escapeHtml(text)}</p></div>`;
}

function kurzname(email) {
  return String(email || "").split("@")[0] || "Kunde";
}

// Kürzt einen Nachrichtentext für die Glocken-Vorschau.
function kurz(t, max = 80) {
  const s = String(t || "").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
