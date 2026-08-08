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
import { STATUS, kundenStatus, istFreigabeStufe, skriptFreigabeNoetig,
         kundenSchritte, kundenSchrittIndex } from "../status.js";
import { drivePreviewUrl } from "../drive.js";
import { escapeHtml, formatDatum } from "../util.js";
import { renderPlanDetails, planHatDetails } from "../plan-ansicht.js";
import { embedHtml, erkennePlattform, verarbeiteEmbeds } from "../embeds.js";
import { dateiZuBase64, extrahiereText, zeigeDateiInline } from "../docparse.js";
import { rolleVon } from "../roles.js";

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
    <p class="vd-meta muted" id="vdMeta" hidden></p>
    <div id="vdFortschritt"></div>
    <div id="vdTodo"></div>
    <div id="vdMedia" class="vd-media"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>
    <div id="vdPlan" class="vd-plan"></div>
    <div id="vdAction" class="vd-action"></div>

    <section class="vd-skript-upload card card--pad">
      <h2 class="section-title" style="margin:0 0 .4rem">📄 Dein überarbeitetes Skript</h2>
      <p class="muted" style="margin:0 0 .8rem">Zieh dein überarbeitetes Skript (Word oder PDF) hier rein — Valentin bekommt sofort Bescheid.</p>
      <p class="vd-upload-anreiz" hidden>💡 Du hast Formulierungen im Kopf, die besser zu dir passen? Lade dein überarbeitetes
        Skript direkt hoch — <strong>so lernt Valentin mit jedem Video deinen Geschmack und deine Sprache besser kennen.</strong></p>
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
      <h2 class="section-title">Fragen an Valentin</h2>
      <div id="vdComments" class="komm-list"></div>
      <button class="btn btn--ghost btn--sm" id="kToggle" type="button">✍️ Frage stellen</button>
      <form id="kForm" class="komm-form card card--pad" hidden>
        <div class="field" style="margin:0 0 .75rem">
          <label for="kText">Deine Frage oder Anmerkung</label>
          <textarea id="kText" placeholder="Frage oder Anmerkung an Valentin …"></textarea>
        </div>
        <p class="field-hint muted">Für Änderungswünsche am Entwurf nutze oben die Schaltfläche „Mit Änderungswünschen" — so weiß Valentin, dass er nachbessern soll.</p>
        <div class="notice notice--error" id="kErr" hidden role="alert"></div>
        <button class="btn btn--accent btn--sm" type="submit" id="kSubmit">Frage senden</button>
      </form>
    </section>`;

  const elTitel    = container.querySelector("#vdTitel");
  const elMeta     = container.querySelector("#vdMeta");
  const elFortschr = container.querySelector("#vdFortschritt");
  const elTodo     = container.querySelector("#vdTodo");
  const elMedia    = container.querySelector("#vdMedia");
  const elPlan     = container.querySelector("#vdPlan");
  const elAction   = container.querySelector("#vdAction");
  const elUpload   = container.querySelector(".vd-skript-upload");
  const elAnreiz   = container.querySelector(".vd-upload-anreiz");
  const elKomm     = container.querySelector(".vd-komm");
  const elComments = container.querySelector("#vdComments");
  const kForm      = container.querySelector("#kForm");
  const kToggle    = container.querySelector("#kToggle");
  const kText      = container.querySelector("#kText");
  const kErr       = container.querySelector("#kErr");
  const kSubmit    = container.querySelector("#kSubmit");

  let video = null;
  let uploads = [];      // alle Skript-Dateien dieses Videos (von Valentin + eigene)

  // Medien hängen an BEIDEN Quellen (Video-Doc + Uploads) — deshalb ein
  // gemeinsamer Zeichenpfad, den beide Subscriptions anstoßen.
  function zeichneMedien() {
    if (!video) return;
    elMedia.innerHTML = medienHtml(video, uploads);
    verarbeiteEmbeds(elMedia);          // TikTok/Instagram-Embeds aktivieren
    zeigeSkriptDateien();               // hochgeladene Datei inline rendern
    positioniereUpload(video);
  }

  // Die vom Admin hochgeladene Skript-Datei direkt in der Karte anzeigen
  // (PDF/Text inline, sonst Download) — kein Umweg über Drive nötig.
  function zeigeSkriptDateien() {
    elMedia.querySelectorAll(".vd-datei[data-upload]").forEach((el) => {
      const u = uploads.find((x) => x.id === el.getAttribute("data-upload"));
      if (!u) return;
      const cleanup = zeigeDateiInline(el, { base64: u.base64, typ: u.dateiTyp, name: u.dateiName });
      beiViewWechsel(cleanup);
    });
  }

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
        elMeta.hidden = true;
        elFortschr.innerHTML = "";
        elTodo.innerHTML = "";
        elPlan.innerHTML = "";
        elAction.innerHTML = "";
        elUpload.hidden = true;
        kForm.style.display = "none";
        kToggle.hidden = true;
        return;
      }
      kForm.style.display = "";
      kToggle.hidden = false;
      elTitel.textContent = v.titel || "Unbenanntes Video";
      renderKopf(v);
      zeichneMedien();
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

  // Upload-Sektion je nach Status platzieren. Der DOM-Node wird VERSCHOBEN
  // (nicht neu gerendert), damit die Listener aus initSkriptUpload() und das
  // laufende Upload-Abo intakt bleiben.
  //   - Skript-Freigabe steht an → direkt unter die Ampel, hervorgehoben.
  //   - Format ganz ohne Skript (z. B. wortloses Edit) → ausblenden.
  //   - Noch gar kein Skript da → ausblenden: „Dein überarbeitetes Skript"
  //     ergibt keinen Sinn, solange es nichts zu überarbeiten gibt.
  //   - Sonst → an der Default-Position unten vor den Kommentaren.
  function positioniereUpload(v) {
    const gibtEsEinSkript = uploads.length > 0
      || !!v.skriptLink
      || !!(v.planSnapshot && planHatDetails(v.planSnapshot));
    if (!skriptFreigabeNoetig(v.typ) || !gibtEsEinSkript) { elUpload.hidden = true; return; }
    elUpload.hidden = false;
    const prominent = v.status === STATUS.FREIGABE_SKRIPT;
    elUpload.classList.toggle("vd-skript-upload--prominent", prominent);
    elAnreiz.hidden = !prominent;
    if (prominent) elAction.after(elUpload);
    else elKomm.before(elUpload);
  }

  function initSkriptUpload() {
    const drop  = container.querySelector("#skDrop");
    const input = container.querySelector("#skFile");
    const okB   = container.querySelector("#skOk");
    const errB  = container.querySelector("#skErr");
    const liste = container.querySelector("#skListe");
    if (!drop || !input) return;

    // Alle Skript-Dateien dieses Videos: die von Valentin landen oben in der
    // Medien-Karte, die eigenen hier als Eingangsbestätigung.
    const unsubU = beobachteSkriptUploads(id, (liste_) => {
      uploads = liste_;
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
      zeichneMedien();   // Valentins Skript kann gerade erst dazugekommen sein
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
        okB.textContent = (video && video.status === STATUS.FREIGABE_SKRIPT)
          ? "Dein Skript ist da! Du kannst jetzt oben ‚Mit Änderungswünschen' bestätigen oder direkt freigeben."
          : "Danke! Dein überarbeitetes Skript ist bei Valentin eingegangen.";
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

  // --- Kopf: Eckdaten, Fortschritt, „Du bist dran" --------------------
  // Beantwortet die drei Fragen, die der Kunde beim Öffnen hat: Was ist das?
  // Wie weit ist es? Muss ich etwas tun? Alles vor dem ersten Scrollen.
  function renderKopf(v) {
    // Eckdaten — nur was gesetzt ist (gleiche Regel wie bei den Medien).
    const teile = [];
    if (v.typ) teile.push(escapeHtml(v.typ));
    if (v.geplanterDrehtermin) teile.push(`Dreh ${escapeHtml(formatDatum(v.geplanterDrehtermin))}`);
    if (v.geplantesDatum)      teile.push(`online ab ${escapeHtml(formatDatum(v.geplantesDatum))}`);
    elMeta.innerHTML = teile.join(" · ");
    elMeta.hidden = !teile.length;

    elFortschr.innerHTML = fortschrittHtml(v);

    // Steht eine Freigabe an, ist das die wichtigste Information der Seite.
    if (istFreigabeStufe(v.status)) {
      const istSkript = v.status === STATUS.FREIGABE_SKRIPT;
      elTodo.innerHTML = `
        <div class="vd-todo-karte">
          <span class="vd-todo-icon" aria-hidden="true">⏳</span>
          <span class="vd-todo-text"><strong>Du bist dran:</strong> ${istSkript
            ? "Sieh dir das Skript an und sag uns, ob wir es so umsetzen sollen."
            : "Sieh dir den fertigen Schnitt an und gib ihn frei."}</span>
          <button class="btn btn--sm vd-todo-btn" type="button">Zur Entscheidung ↓</button>
        </div>`;
      elTodo.querySelector(".vd-todo-btn").addEventListener("click", () => {
        elAction.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else {
      elTodo.innerHTML = "";
    }
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

    // Gewichtung statt Gleichrang: die konstruktive Antwort ist der große
    // Primär-Button, „Änderungswünsche" die sichtbare Zweitwahl. Die Absage
    // bleibt möglich, steht aber als ruhiger Textlink darunter (nur beim Skript
    // — bei einem fertigen Schnitt gibt es kein „wird nicht gemacht").
    const buttons = istSkript
      ? `<button class="btn btn--ok btn--gross" id="btnFreigeben" type="button">✓ So umsetzen</button>
         <button class="btn btn--ghost"         id="btnAendern"   type="button">Mit Änderungswünschen</button>`
      : `<button class="btn btn--ok btn--gross" id="btnFreigeben" type="button">✓ Freigeben</button>
         <button class="btn btn--ghost"         id="btnAendern"   type="button">Änderungen anfordern</button>`;

    const verwerfenLink = istSkript
      ? `<button class="vd-verwerfen-link" id="btnVerwerfen" type="button">Dieses Video soll nicht produziert werden</button>`
      : ``;

    elAction.innerHTML = `
      <div class="card card--pad action-card">
        <span class="pill pill--aktion">${escapeHtml(ks.label)}</span>
        ${(v.entwurf || 1) > 1 ? `<p class="entwurf-hinweis">✓ Deine Änderungswünsche wurden umgesetzt – hier ist der neue Entwurf (Nr.&nbsp;${v.entwurf}).</p>` : ""}
        <p class="action-hint muted">Sieh dir ${was} oben an und entscheide:</p>
        <div class="action-btns action-ampel">${buttons}</div>
        ${verwerfenLink}

        <div id="aenderPanel" hidden>
          ${istSkript ? `
          <div class="vd-upload-cta">
            <span>⚡ Am schnellsten: lade dein überarbeitetes Skript direkt hoch —
            Valentin übernimmt deine Formulierungen 1:1 und lernt dabei deinen Stil.</span>
            <button class="btn btn--ok btn--sm" id="btnZumUpload" type="button">📄 Skript hochladen</button>
          </div>
          <p class="muted" style="margin:.6rem 0 0">— oder beschreibe die Änderungen als Text: —</p>` : ``}
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
        btnFreigeben.textContent = istSkript ? "✓ So umsetzen" : "✓ Freigeben";
      }
    });

    // 🟡 Änderungen anfordern (Pflicht-Kommentar)
    btnAendern.addEventListener("click", () => {
      panel.hidden = false;
      if (vPanel) vPanel.hidden = true;
      zeigePrimaer(false);
      aenderText.focus();
    });

    // ⚡ Abkürzung im Änderungs-Panel: direkt zur Upload-Box (nur Skript-Stufe).
    // Öffnet den Datei-Dialog gleich mit; das Panel bleibt offen, damit der
    // Kunde zusätzlich Text senden kann (Statuswechsel läuft weiter über die Ampel).
    const btnZumUpload = elAction.querySelector("#btnZumUpload");
    if (btnZumUpload) btnZumUpload.addEventListener("click", () => {
      const drop = container.querySelector("#skDrop");
      elUpload.scrollIntoView({ behavior: "smooth", block: "center" });
      if (drop) {
        drop.classList.add("is-hinweis");
        setTimeout(() => { if (drop.isConnected) drop.classList.remove("is-hinweis"); }, 2500);
      }
      const input = container.querySelector("#skFile");
      if (input) input.click();
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

  // Formular erst auf Klick — leer und aufgeklappt wäre es nur Rauschen.
  kToggle.addEventListener("click", () => {
    kForm.hidden = !kForm.hidden;
    kToggle.textContent = kForm.hidden ? "✍️ Frage stellen" : "Abbrechen";
    if (!kForm.hidden) kText.focus();
  });

  // --- Kommentar-Thread -----------------------------------------------
  function renderComments(liste) {
    if (!liste.length) {
      elComments.innerHTML = "";   // kein „noch keine Kommentare" — einfach leer
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
      kForm.hidden = true;                       // gesendet → wieder einklappen
      kToggle.textContent = "✍️ Frage stellen";
    } catch (err) {
      console.error(err);
      kErr.textContent = "Kommentar konnte nicht gesendet werden.";
      kErr.hidden = false;
    } finally {
      kSubmit.disabled = false;
      kSubmit.textContent = "Frage senden";
    }
  });
}

// --- Medien: NUR zeigen, was wirklich da ist ---------------------------
// Grundsatz: keine Platzhalter für Fehlendes. Der Kunde sieht ausschließlich
// vorhandene Stände — und wenn Skript UND Schnitt existieren, beide (früher
// verdrängte der Schnitt das Skript).
//
// Skript-Quellen (in dieser Reihenfolge): vom Admin hochgeladene Datei →
// Drive-Link → planSnapshot (der rendert als eigener Block, siehe renderPlan).
// Schnitt: einbettbarer Link → Embed, sonst schlichter Öffnen-Link (z. B. ein
// Google-Drive-Ordner) — der soll ja ebenfalls sichtbar sein.
function medienHtml(v, uploads) {
  const karten = [];

  const vonValentin = adminUploads(uploads);
  const skriptDatei = vonValentin[0] || null;
  const skriptUrl   = v.skriptLink ? drivePreviewUrl(v.skriptLink) : null;

  if (skriptDatei) {
    karten.push(`
      <div class="card media-card">
        <div class="media-label">📝 Dein Skript
          <span class="media-sub muted">${escapeHtml(skriptDatei.dateiName || "Skript")} · ${escapeHtml(formatDatum(skriptDatei.erstelltAm))}</span>
        </div>
        <div class="vd-datei" data-upload="${escapeHtml(skriptDatei.id)}"></div>
      </div>`);
  } else if (skriptUrl) {
    karten.push(`
      <div class="card media-card">
        <div class="media-label">📝 Dein Skript</div>
        <div class="embed-pdf"><iframe src="${escapeHtml(skriptUrl)}" title="Skript" allow="autoplay"></iframe></div>
        <a class="media-extern muted" href="${escapeHtml(v.skriptLink)}" target="_blank" rel="noopener">In Google&nbsp;Drive öffnen ↗</a>
      </div>`);
  } else if (v.skriptLink) {
    // Link vorhanden, aber keine Drive-Vorschau möglich → wenigstens verlinken.
    karten.push(`
      <div class="card card--pad media-card">
        <div class="media-label">📝 Dein Skript</div>
        <a class="media-extern" href="${escapeHtml(v.skriptLink)}" target="_blank" rel="noopener">Skript öffnen ↗</a>
      </div>`);
  }

  if (v.schnittLink) {
    const einbettbar = erkennePlattform(v.schnittLink) !== "andere";
    karten.push(einbettbar
      ? `<div class="card media-card">
           <div class="media-label">🎬 Dein fertiges Video</div>
           ${embedHtml(v.schnittLink)}
         </div>`
      : `<div class="card card--pad media-card">
           <div class="media-label">🎬 Dein fertiges Video</div>
           <a class="media-extern" href="${escapeHtml(v.schnittLink)}" target="_blank" rel="noopener">Video öffnen ↗</a>
         </div>`);
  }

  return karten.join("");
}

// Vier-Schritt-Fortschritt statt der 10 internen Stufen — der Kunde soll auf
// einen Blick sehen, wo sein Video steht.
function fortschrittHtml(v) {
  const idx = kundenSchrittIndex(v.status);
  if (idx < 0) {
    return `<div class="card card--pad vd-verworfen"><p style="margin:0">🚫 Dieses Video wird nicht produziert.</p></div>`;
  }
  const schritte = kundenSchritte(v.typ);
  return `<ol class="vd-schritte" aria-label="Fortschritt">
    ${schritte.map((s, i) => {
      const zustand = i < idx ? " is-fertig" : (i === idx ? " is-aktiv" : "");
      return `<li class="vd-schritt${zustand}">
        <span class="vd-schritt-punkt" aria-hidden="true">${i < idx ? "✓" : ""}</span>
        <span class="vd-schritt-label">${escapeHtml(s)}</span>
      </li>`;
    }).join("")}
  </ol>`;
}

// Uploads von Valentin (= das Skript, das der Kunde bekommt), neueste zuerst.
function adminUploads(uploads) {
  return (uploads || [])
    .filter((u) => rolleVon(u.gemeldetVon) === "admin")
    .sort((a, b) => ((b.erstelltAm && b.erstelltAm.seconds) || 0) - ((a.erstelltAm && a.erstelltAm.seconds) || 0));
}

function kurzname(email) {
  return String(email || "").split("@")[0] || "Kunde";
}

// Kürzt einen Nachrichtentext für die Glocken-Vorschau.
function kurz(t, max = 80) {
  const s = String(t || "").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
