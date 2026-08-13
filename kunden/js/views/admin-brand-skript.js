// Admin-View: Skript-Werkstatt (Admin-only) — Route #/admin/skript/{id}
//
// Links das Skript, rechts die Takes. Der Ablauf, für den das gebaut ist:
//   runterschreiben → kopieren → von einer KI überarbeiten lassen → zurück
//   einfügen → Passagen markieren und zu Takes machen → Kamera-Infos daneben
//   → Checkliste zuordnen → bei 100 % abschicken → Shoot-Modus.
//
// Kein onSnapshot-Abo: die View arbeitet auf einem lokalen `state` und
// speichert entprellt. Ein Live-Abo würde beim Tippen den eigenen Text
// überschreiben (gleiche Entscheidung wie in admin-plan.js).
import { ladeBrandSkript, aktualisiereBrandSkript, ladeFormate } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum } from "../util.js";
import {
  PLATTFORMEN, STATUS_LABEL, GROESSEN, PERSPEKTIVEN, BEWEGUNGEN, BROLL_QUELLEN,
  STORY_ITEMS, POST_ITEMS, STANDARD_PROMPT, AUFWAND,
  leererTake, leeresBroll, syncTakes, verschiebeTakes, sortierteTakes,
  istLosgeloest, istVerwaist, berechneFortschritt, takeFehlendeFelder,
  gesamtDauer, dauerLabel, labelVon, takeChips, merkmaleVonTake, brollSpanne,
  markiertesHtml, drehplanText, kopiere, istAbgeschickt, takesAusFormat
} from "../brandplan.js";

export function renderAdminBrandSkript(container, ctx) {
  const id = ctx.id;

  container.innerHTML = `
    <a class="back-link" href="#/admin/brand">← Zurück zu den Skripten</a>
    <div id="bsBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;
  const body = container.querySelector("#bsBody");

  // Zweispaltig braucht Platz — die Standard-Breite der .view (1040 px) wird
  // nur für diese Route aufgehoben.
  document.body.classList.add("is-werkstatt");
  beiViewWechsel(() => document.body.classList.remove("is-werkstatt"));

  (async function init() {
    let skript = null;
    try { skript = await ladeBrandSkript(id); }
    catch (e) { console.warn("Skript laden fehlgeschlagen:", e); }
    if (!skript) {
      body.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Skript nicht gefunden. <a href="#/admin/brand">Zurück zur Übersicht</a>.</p></div>`;
      return;
    }

    let formate = [];
    try { formate = await ladeFormate(); } catch (e) { console.warn("Formate laden fehlgeschlagen:", e); }

    // --- Arbeitszustand ------------------------------------------------
    const state = {
      titel:      skript.titel || "",
      plattform:  skript.plattform || "reel",
      status:     skript.status || "idee",
      text:       skript.text || "",
      kiPrompt:   skript.kiPrompt || "",
      formatId:   skript.formatId || null,
      formatName: skript.formatName || "",
      fassungen:  Array.isArray(skript.fassungen) ? skript.fassungen.slice() : [],
      takes:      Array.isArray(skript.takes) ? skript.takes.map((t) => ({ ...t })) : [],
      broll:      Array.isArray(skript.broll) ? skript.broll.map((b) => ({ ...b })) : [],
      checkliste: Object.assign({}, skript.checkliste || {}),
      notiz:      skript.notiz || ""
    };
    // Beim Laden mit Suche nachführen: der Text kann auf einem anderen Gerät
    // umgeschrieben worden sein.
    state.takes = syncTakes(state.text, state.takes);

    const offeneTakes = new Set();     // aufgeklappte Take-Karten
    const auswahl     = new Set();     // für „+ B-Roll über Auswahl"
    let offenesBroll  = null;          // aufgeklapptes B-Roll-Band
    let aktivesPanel  = null;          // 'einfuegen' | 'fassungen' | 'prompt'
    let hinweisText   = "";
    const ro = () => istAbgeschickt(state);

    // --- Speichern (entprellt) -----------------------------------------
    let timer = null;
    let schmutzig = false;
    let speicherStand = "";

    function felder() {
      return {
        titel: state.titel, plattform: state.plattform, status: state.status,
        text: state.text, kiPrompt: state.kiPrompt,
        formatId: state.formatId, formatName: state.formatName,
        fassungen: state.fassungen, takes: state.takes, broll: state.broll,
        checkliste: state.checkliste, notiz: state.notiz
      };
    }

    async function jetztSpeichern() {
      clearTimeout(timer);
      if (!schmutzig) return;
      // Titel nachziehen, damit die Übersicht nicht voller „Ohne Titel" steht.
      if (!state.titel.trim() && state.text.trim()) {
        state.titel = state.text.trim().split("\n")[0].slice(0, 60);
        const inp = body.querySelector("#bsTitel");
        if (inp && document.activeElement !== inp) inp.value = state.titel;
      }
      schmutzig = false;
      setzeStand("Speichert …");
      try {
        await aktualisiereBrandSkript(id, felder());
        setzeStand("Gespeichert " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        console.warn("Speichern fehlgeschlagen:", e);
        schmutzig = true;
        setzeStand("Nicht gespeichert!");
      }
    }

    function speichere() {
      schmutzig = true;
      setzeStand("Ungespeichert …");
      clearTimeout(timer);
      timer = setTimeout(jetztSpeichern, 700);
    }

    function setzeStand(txt) {
      speicherStand = txt;
      const el = body.querySelector("#bsStand");
      if (el) el.textContent = txt;
    }

    // Beim Verlassen der View den letzten Stand sichern.
    beiViewWechsel(() => { if (schmutzig) jetztSpeichern(); });

    // --- Grundgerüst ----------------------------------------------------
    body.innerHTML = `
      <section class="card card--pad bs-kopf" id="bsKopf"></section>
      <div class="bs-grid">
        <section class="card bs-editor-karte">
          <div class="bs-werkzeuge" id="bsWerkzeuge"></div>
          <div class="bs-editor" id="bsEditorBox">
            <div class="bs-hl" id="bsHl" aria-hidden="true"></div>
            <textarea id="bsText" class="bs-textarea" spellcheck="true"
              placeholder="Schreib erstmal alles runter, wie du es sagen würdest. Aufräumen kommt später — dafür gibt es den Kopier-Knopf und deine KI."></textarea>
            <button class="btn btn--accent btn--sm bs-take-btn" id="bsTakeBtn" type="button" hidden>→ Take</button>
          </div>
          <div class="bs-hinweis" id="bsHinweis" hidden></div>
          <div class="bs-panel" id="bsPanel" hidden></div>
        </section>
        <section class="bs-rechts">
          <div class="card card--pad bs-check" id="bsCheck"></div>
          <div class="bs-takes-kopf" id="bsTakesKopf"></div>
          <div class="bs-takes-wrap" id="bsTakesWrap">
            <div class="bs-takes" id="bsTakes"></div>
            <div class="bs-spur" id="bsSpur" aria-hidden="true"></div>
          </div>
          <div class="bs-broll-liste" id="bsBroll"></div>
        </section>
      </div>`;

    const ta    = body.querySelector("#bsText");
    const hl    = body.querySelector("#bsHl");
    const takeBtn = body.querySelector("#bsTakeBtn");
    ta.value = state.text;

    // =====================================================================
    // Editor
    // =====================================================================
    function zeichneOverlay() {
      hl.innerHTML = markiertesHtml(state.text, state.takes, null);
      hl.scrollTop = ta.scrollTop;
    }

    function melde(txt) {
      hinweisText = txt;
      const el = body.querySelector("#bsHinweis");
      el.textContent = txt;
      el.hidden = !txt;
      if (txt) setTimeout(() => { if (hinweisText === txt) { el.hidden = true; hinweisText = ""; } }, 4000);
    }

    // Die Take-Liste vermisst beim Zeichnen die B-Roll-Spur am echten DOM.
    // Das bei jedem Tastendruck zu tun, würde bei langen Skripten hakeln —
    // die Liste darf der Tipperei ruhig ein paar Hundertstel nachlaufen.
    let takesTimer = null;
    function zeichneTakesGedrosselt() {
      clearTimeout(takesTimer);
      takesTimer = setTimeout(zeichneTakes, 300);
    }
    beiViewWechsel(() => clearTimeout(takesTimer));

    ta.addEventListener("input", () => {
      const alt = state.text;
      state.text = ta.value;
      // Beim Tippen die Offsets mitziehen (nicht suchen — sonst würde ein
      // Take, in dessen Passage man gerade schreibt, sich selbst lösen).
      state.takes = verschiebeTakes(alt, state.text, state.takes);
      if (state.status === "idee" && state.text.trim()) state.status = "rohfassung";
      zeichneOverlay();
      zeichneKopf();
      zeichneTakesGedrosselt();
      speichere();
    });

    // Der Knopf wird pro Frame höchstens einmal neu gesetzt — selectionchange
    // feuert sonst mehrfach je Tastendruck und baut jedes Mal das Overlay um.
    let btnFrame = null;
    function planeTakeBtn() {
      if (btnFrame) return;
      btnFrame = requestAnimationFrame(() => { btnFrame = null; positioniereTakeBtn(); });
    }

    ta.addEventListener("scroll", () => { hl.scrollTop = ta.scrollTop; planeTakeBtn(); });
    ta.addEventListener("keyup", planeTakeBtn);
    ta.addEventListener("mouseup", planeTakeBtn);
    ta.addEventListener("blur", () => setTimeout(planeTakeBtn, 120));
    document.addEventListener("selectionchange", planeTakeBtn);
    beiViewWechsel(() => {
      document.removeEventListener("selectionchange", planeTakeBtn);
      if (btnFrame) cancelAnimationFrame(btnFrame);
    });

    // Der „→ Take"-Knopf schwebt an der Markierung. Gemessen wird im Overlay:
    // Es spiegelt die Textarea zeichengenau, also liefert ein temporär
    // eingehängter Marker exakt die Bildschirmposition des Selektionsendes.
    function positioniereTakeBtn() {
      if (!body.contains(ta)) return;
      if (ro() || ta.selectionEnd <= ta.selectionStart || document.activeElement !== ta) {
        takeBtn.hidden = true;
        return;
      }
      const marker = document.createElement("span");
      marker.textContent = "​";
      hl.innerHTML = escapeHtml(state.text.slice(0, ta.selectionEnd));
      hl.appendChild(marker);
      const top  = marker.offsetTop - ta.scrollTop;
      const left = marker.offsetLeft;
      const hoehe = hl.clientHeight;
      zeichneOverlay();
      // Außerhalb des sichtbaren Bereichs → Knopf weg, sonst klebt er am Rand.
      if (top < -20 || top > hoehe + 20) { takeBtn.hidden = true; return; }
      takeBtn.hidden = false;
      takeBtn.style.top  = Math.max(2, Math.min(top + 4, hoehe - 30)) + "px";
      takeBtn.style.left = Math.max(6, Math.min(left, hl.clientWidth - 90)) + "px";
    }

    // Markierung → Take. Mit zielTid hängt sie an einen bestehenden Take
    // (Format-Gerüst füllen oder verwaisten Take neu zuordnen).
    function takeAusMarkierung(zielTid) {
      let von = ta.selectionStart;
      let bis = ta.selectionEnd;
      const roh = state.text.slice(von, bis);
      if (!roh.trim()) { melde("Markiere zuerst eine Passage im Skript."); return; }
      von += roh.length - roh.replace(/^\s+/, "").length;      // Leerraum an den
      bis -= roh.length - roh.replace(/\s+$/, "").length;      // Rändern abschneiden
      const kollision = state.takes.some((t) =>
        t.tid !== zielTid && !istLosgeloest(t) && von < t.bis && bis > t.von);
      if (kollision) { melde("Diese Stelle gehört schon zu einem Take."); return; }

      const passage = state.text.slice(von, bis);
      if (zielTid) {
        const t = state.takes.find((x) => x.tid === zielTid);
        if (!t) return;
        t.von = von; t.bis = bis; t.text = passage;
      } else {
        const neu = leererTake(passage, von, bis);
        state.takes.push(neu);
        offeneTakes.add(neu.tid);
      }
      takeBtn.hidden = true;
      zeichneOverlay(); zeichneTakes(); zeichneKopf();
      speichere();
    }

    takeBtn.addEventListener("mousedown", (e) => e.preventDefault());   // Selektion behalten
    takeBtn.addEventListener("click", () => takeAusMarkierung(null));
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); takeAusMarkierung(null); }
    });

    // =====================================================================
    // Kopf: Titel, Format, Fortschritt, Abschicken
    // =====================================================================
    function zeichneKopf() {
      const kopf = body.querySelector("#bsKopf");
      const f = berechneFortschritt(state);
      const st = STATUS_LABEL[state.status] || STATUS_LABEL.idee;
      const fertig = f.gesamt >= 100;
      const format = formate.find((x) => x.id === state.formatId) || null;

      kopf.innerHTML = `
        <div class="bs-kopf-zeile">
          <input id="bsTitel" class="bs-titel-input" type="text" placeholder="Titel des Videos"
            value="${escapeHtml(state.titel)}" ${ro() ? "disabled" : ""} />
          <span class="bs-badge bs-badge--${st.cls}">${st.txt}</span>
          <span class="bs-stand muted" id="bsStand">${escapeHtml(speicherStand)}</span>
        </div>
        <div class="bs-kopf-meta">
          <label class="bs-mini-feld">Plattform
            <select id="bsPlattform" ${ro() ? "disabled" : ""}>
              ${PLATTFORMEN.map((p) => `<option value="${p.id}"${p.id === state.plattform ? " selected" : ""}>${p.label}</option>`).join("")}
            </select>
          </label>
          <label class="bs-mini-feld">Format
            <select id="bsFormat" ${ro() ? "disabled" : ""}>
              <option value="">— frei, ohne Format —</option>
              ${formate.map((x) => `<option value="${escapeHtml(x.id)}"${x.id === state.formatId ? " selected" : ""}>${escapeHtml(x.name || "Ohne Namen")}</option>`).join("")}
            </select>
          </label>
          <span class="bs-kopf-zahlen muted">
            ${state.takes.length} Take${state.takes.length === 1 ? "" : "s"} ·
            ca. ${dauerLabel(gesamtDauer(state.takes))}
          </span>
        </div>

        ${format ? formatPanelHtml(format) : ""}

        <div class="bs-fortschritt">
          <div class="bs-balken bs-balken--gross" title="${f.gesamt} % geplant">
            <div class="bs-balken-fuell" style="width:${f.gesamt}%"></div>
          </div>
          <div class="bs-fortschritt-zahl">${f.gesamt} %</div>
        </div>
        <div class="bs-teilbalken">
          <span>Checkliste <strong>${f.checkliste.erledigt}/${f.checkliste.gesamt}</strong></span>
          <span>Takes fertig geplant <strong>${f.technik.erledigt}/${f.technik.gesamt}</strong></span>
        </div>
        ${f.fehlt.length ? `
        <details class="bs-fehlt">
          <summary>Das fehlt noch (${f.fehlt.length})</summary>
          <ul>${f.fehlt.map((z) => `<li>${escapeHtml(z)}</li>`).join("")}</ul>
        </details>`
        : `<p class="bs-fertig-hinweis">${ro()
            ? "Abgeschickt — der Plan steht. Zum Ändern erst wieder öffnen."
            : "Alles geplant — du kannst abschicken."}</p>`}

        <div class="action-btns bs-kopf-aktionen">
          ${ro() ? `
            <a class="btn btn--accent btn--sm" href="#/admin/shoot/${encodeURIComponent(id)}">🎬 Shoot-Modus starten</a>
            <button class="btn btn--ghost btn--sm" id="bsOeffnen" type="button">✎ Wieder öffnen</button>
          ` : `
            <button class="btn btn--accent btn--sm" id="bsAbschicken" type="button" ${fertig ? "" : "disabled"}
              title="${fertig ? "Plan festzurren und Shoot-Modus freischalten" : "Erst bei 100 % möglich"}">✓ Abschicken</button>
          `}
          <button class="btn btn--ghost btn--sm" id="bsDrehplan" type="button">📋 Drehplan kopieren</button>
        </div>`;

      const titelInp = kopf.querySelector("#bsTitel");
      if (titelInp) titelInp.addEventListener("input", () => { state.titel = titelInp.value; speichere(); });

      const plat = kopf.querySelector("#bsPlattform");
      if (plat) plat.addEventListener("change", () => { state.plattform = plat.value; speichere(); });

      const fmt = kopf.querySelector("#bsFormat");
      if (fmt) fmt.addEventListener("change", () => waehleFormat(fmt.value));

      const ab = kopf.querySelector("#bsAbschicken");
      if (ab) ab.addEventListener("click", async () => {
        state.status = "drehreif";
        speichere();
        await jetztSpeichern();
        alleNeu();
      });

      const auf = kopf.querySelector("#bsOeffnen");
      if (auf) auf.addEventListener("click", () => {
        state.status = state.takes.some((t) => t.gedreht) ? "gedreht" : "rohfassung";
        // „Wieder öffnen" heißt: weiterplanen. Bleibt der Status auf gedreht,
        // wäre der Editor sofort wieder gesperrt.
        if (state.status === "gedreht") state.status = "rohfassung";
        speichere();
        alleNeu();
      });

      const dp = kopf.querySelector("#bsDrehplan");
      if (dp) dp.addEventListener("click", async () => {
        const ok = await kopiere(drehplanText({ ...state, id }));
        dp.textContent = ok ? "✓ Kopiert" : "Kopieren ging nicht";
        setTimeout(() => { dp.textContent = "📋 Drehplan kopieren"; }, 1800);
      });

      // Hook-Vorlagen des Formats übernehmen
      kopf.querySelectorAll(".bs-hook").forEach((b) => b.addEventListener("click", () => {
        if (ro()) return;
        const txt = b.getAttribute("data-hook") || "";
        const pos = Number.isFinite(ta.selectionStart) ? ta.selectionStart : state.text.length;
        const alt = state.text;
        state.text = alt.slice(0, pos) + txt + alt.slice(pos);
        state.takes = verschiebeTakes(alt, state.text, state.takes);
        ta.value = state.text;
        ta.focus();
        ta.setSelectionRange(pos + txt.length, pos + txt.length);
        zeichneOverlay(); zeichneTakes(); zeichneKopf();
        speichere();
      }));
    }

    function formatPanelHtml(format) {
      const hooks = Array.isArray(format.hooks) ? format.hooks : [];
      const teile = [
        format.talkingHead === false ? "Kein Talking Head nötig" : "Talking Head",
        labelVon(AUFWAND, format.aufwand),
        format.materialBedarf ? `Material: ${format.materialBedarf}` : ""
      ].filter(Boolean);
      return `
        <div class="bs-formatbox">
          <div class="bs-formatbox-kopf">
            <strong>Format: ${escapeHtml(format.name || "Ohne Namen")}</strong>
            <a class="bs-formatbox-link" href="#/admin/formate?f=${encodeURIComponent(format.id)}">ansehen</a>
          </div>
          ${format.beschreibung ? `<p class="muted bs-formatbox-text">${escapeHtml(format.beschreibung)}</p>` : ""}
          <div class="bs-chips">${teile.map((t) => `<span class="bs-chip">${escapeHtml(t)}</span>`).join("")}</div>
          ${hooks.length && !ro() ? `
            <div class="bs-hooks">
              <span class="muted">Hook-Vorlagen (klicken = einfügen):</span>
              ${hooks.map((h) => `<button class="bs-hook" type="button" data-hook="${escapeHtml(h.text || "")}">${escapeHtml(h.text || "")}</button>`).join("")}
            </div>` : ""}
        </div>`;
    }

    // Format wechseln: das Gerüst wird nur erzeugt, wenn noch keine Takes da
    // sind — sonst würde ein Wechsel die bestehende Planung zumüllen.
    function waehleFormat(neueId) {
      const format = formate.find((x) => x.id === neueId) || null;
      state.formatId   = format ? format.id : null;
      state.formatName = format ? (format.name || "") : "";
      if (format && !state.takes.length) {
        state.takes = takesAusFormat(format);
        melde(`Gerüst aus „${format.name}" angelegt — markiere im Skript die Passagen und ordne sie den Takes zu.`);
      }
      alleNeu();
      speichere();
    }

    // =====================================================================
    // Werkzeugleiste + Panels (Kopieren, KI-Fassung, Verlauf)
    // =====================================================================
    function zeichneWerkzeuge() {
      const wz = body.querySelector("#bsWerkzeuge");
      wz.innerHTML = `
        <button class="btn btn--ghost btn--sm" id="wzKopieren" type="button">📋 Skript kopieren</button>
        <button class="btn btn--ghost btn--sm" id="wzKI" type="button">🤖 Mit KI-Prompt kopieren</button>
        ${ro() ? "" : `<button class="btn btn--ghost btn--sm" id="wzEinfuegen" type="button">📥 Neue Fassung einfügen</button>`}
        <button class="btn btn--ghost btn--sm" id="wzFassungen" type="button">🕘 Fassungen${state.fassungen.length ? ` (${state.fassungen.length})` : ""}</button>
        ${ro() ? "" : `<button class="btn btn--ghost btn--sm" id="wzPrompt" type="button">⚙︎ Prompt</button>`}
        <span class="bs-wz-hinweis muted">Markieren + <kbd>Strg</kbd>+<kbd>Enter</kbd> = Take</span>`;

      const kop = wz.querySelector("#wzKopieren");
      kop.addEventListener("click", async () => {
        const ok = await kopiere(state.text);
        kop.textContent = ok ? "✓ Kopiert" : "Ging nicht";
        setTimeout(() => { kop.textContent = "📋 Skript kopieren"; }, 1600);
      });

      const ki = wz.querySelector("#wzKI");
      ki.addEventListener("click", async () => {
        const prompt = (state.kiPrompt || "").trim() || STANDARD_PROMPT;
        const ok = await kopiere(`${prompt}\n\n---\n\n${state.text}`);
        ki.textContent = ok ? "✓ Prompt + Skript kopiert" : "Ging nicht";
        setTimeout(() => { ki.textContent = "🤖 Mit KI-Prompt kopieren"; }, 2000);
      });

      const ein = wz.querySelector("#wzEinfuegen");
      if (ein) ein.addEventListener("click", () => oeffnePanel(aktivesPanel === "einfuegen" ? null : "einfuegen"));
      wz.querySelector("#wzFassungen").addEventListener("click", () => oeffnePanel(aktivesPanel === "fassungen" ? null : "fassungen"));
      const pr = wz.querySelector("#wzPrompt");
      if (pr) pr.addEventListener("click", () => oeffnePanel(aktivesPanel === "prompt" ? null : "prompt"));
    }

    function oeffnePanel(welches) {
      aktivesPanel = welches;
      const p = body.querySelector("#bsPanel");
      if (!welches) { p.hidden = true; p.innerHTML = ""; return; }
      p.hidden = false;

      if (welches === "einfuegen") {
        p.innerHTML = `
          <h3 class="bs-panel-titel">Überarbeitete Fassung einfügen</h3>
          <p class="muted">Der aktuelle Text wandert in den Verlauf, deine Takes werden automatisch
            an den neuen Text nachgeführt. Passagen, die es nicht mehr gibt, bleiben als Take erhalten
            und können neu zugeordnet werden.</p>
          <textarea id="bsNeuText" class="bs-panel-text" placeholder="Antwort der KI hier einfügen …"></textarea>
          <div class="action-btns">
            <button class="btn btn--accent btn--sm" id="bsUebernehmen" type="button">Übernehmen</button>
            <button class="btn btn--ghost btn--sm" id="bsPanelZu" type="button">Abbrechen</button>
          </div>`;
        p.querySelector("#bsPanelZu").addEventListener("click", () => oeffnePanel(null));
        p.querySelector("#bsUebernehmen").addEventListener("click", () => {
          const neu = p.querySelector("#bsNeuText").value;
          if (!neu.trim()) return;
          neueFassung(neu);
          oeffnePanel(null);
        });
        p.querySelector("#bsNeuText").focus();
        return;
      }

      if (welches === "fassungen") {
        p.innerHTML = `
          <h3 class="bs-panel-titel">Frühere Fassungen</h3>
          ${state.fassungen.length ? `
            <ul class="bs-fassungen">
              ${state.fassungen.map((f, i) => `
                <li class="bs-fassung">
                  <div class="bs-fassung-kopf">
                    <strong>${escapeHtml(formatDatum(f.erstelltAm, true))}</strong>
                    <span class="muted">${String(f.text || "").trim().split(/\s+/).filter(Boolean).length} Wörter${f.notiz ? " · " + escapeHtml(f.notiz) : ""}</span>
                  </div>
                  <p class="bs-fassung-vor muted">${escapeHtml(String(f.text || "").slice(0, 180))}${String(f.text || "").length > 180 ? " …" : ""}</p>
                  ${ro() ? "" : `<button class="btn btn--ghost btn--sm bs-wiederher" type="button" data-i="${i}">Wiederherstellen</button>`}
                </li>`).join("")}
            </ul>` : `<p class="muted">Noch keine — sobald du eine überarbeitete Fassung einfügst, landet die alte hier.</p>`}
          <div class="action-btns"><button class="btn btn--ghost btn--sm" id="bsPanelZu" type="button">Schließen</button></div>`;
        p.querySelector("#bsPanelZu").addEventListener("click", () => oeffnePanel(null));
        p.querySelectorAll(".bs-wiederher").forEach((b) => b.addEventListener("click", () => {
          const f = state.fassungen[Number(b.getAttribute("data-i"))];
          if (!f) return;
          neueFassung(f.text, "vor Wiederherstellung");
          oeffnePanel(null);
        }));
        return;
      }

      if (welches === "prompt") {
        p.innerHTML = `
          <h3 class="bs-panel-titel">Dein KI-Prompt</h3>
          <p class="muted">Wird beim Kopieren vor das Skript gesetzt. Leer lassen = Standard-Prompt.</p>
          <textarea id="bsPromptText" class="bs-panel-text" placeholder="${escapeHtml(STANDARD_PROMPT)}">${escapeHtml(state.kiPrompt)}</textarea>
          <div class="action-btns"><button class="btn btn--ghost btn--sm" id="bsPanelZu" type="button">Schließen</button></div>`;
        p.querySelector("#bsPanelZu").addEventListener("click", () => oeffnePanel(null));
        p.querySelector("#bsPromptText").addEventListener("input", (e) => { state.kiPrompt = e.target.value; speichere(); });
      }
    }

    function neueFassung(neuerText, notiz) {
      state.fassungen.unshift({
        text: state.text,
        notiz: notiz || "vor Überarbeitung",
        erstelltAm: new Date().toISOString()
      });
      // Deckel gegen das 1-MB-Dokumentlimit von Firestore.
      if (state.fassungen.length > 20) state.fassungen.length = 20;
      state.text = neuerText;
      // Hier wird gesucht statt verschoben: der Text ist komplett ausgetauscht.
      state.takes = syncTakes(state.text, state.takes);
      ta.value = state.text;
      const verwaist = state.takes.filter(istVerwaist).length;
      if (verwaist) melde(`${verwaist} Take${verwaist === 1 ? "" : "s"} ${verwaist === 1 ? "findet" : "finden"} ${verwaist === 1 ? "seine" : "ihre"} Passage nicht mehr — unten neu zuordnen.`);
      alleNeu();
      speichere();
    }

    // =====================================================================
    // Checkliste
    // =====================================================================
    function zeichneCheck() {
      const box = body.querySelector("#bsCheck");
      const sortiert = sortierteTakes(state.takes);
      const cl = state.checkliste;
      const optionen = (aktiv) => `
        <option value="">— nicht zugeordnet —</option>
        ${sortiert.map((t, i) => {
          const name = `Take ${i + 1}${t.label ? " · " + t.label : ""}`;
          return `<option value="${escapeHtml(t.tid)}"${t.tid === aktiv ? " selected" : ""}>${escapeHtml(name)}</option>`;
        }).join("")}`;

      box.innerHTML = `
        <h2 class="section-title" style="margin-top:0">Checkliste</h2>
        <p class="muted" style="margin-top:-.4rem">Ordne jedes Merkmal der Stelle im Skript zu, an der es passiert.</p>
        ${STORY_ITEMS.map((item) => {
          const gesetzt = cl[item.id] && sortiert.some((t) => t.tid === cl[item.id]);
          return `
            <div class="bs-check-zeile${gesetzt ? " is-ok" : ""}">
              <span class="bs-check-haken">${gesetzt ? "✓" : "○"}</span>
              <label class="bs-check-label">
                <span class="bs-check-name">${escapeHtml(item.label)}</span>
                <span class="muted bs-check-hinweis">${escapeHtml(item.hinweis)}</span>
              </label>
              <select class="bs-check-sel" data-item="${item.id}" ${ro() ? "disabled" : ""}>${optionen(cl[item.id])}</select>
            </div>`;
        }).join("")}
        <div class="bs-check-post">
          ${POST_ITEMS.map((item) => {
            const wert = cl[item.id] || "";
            const ok = String(wert).trim();
            if (item.id === "postDatum") {
              return `<label class="bs-feld bs-check-feld${ok ? " is-ok" : ""}">${item.label}
                <input type="date" data-post="${item.id}" value="${escapeHtml(wert)}" ${ro() ? "disabled" : ""} /></label>`;
            }
            if (item.id === "caption") {
              return `<label class="bs-feld bs-check-feld${ok ? " is-ok" : ""}">${item.label}
                <textarea data-post="${item.id}" rows="2" placeholder="Was steht unter dem Video?" ${ro() ? "disabled" : ""}>${escapeHtml(wert)}</textarea></label>`;
            }
            return `<label class="bs-feld bs-check-feld${ok ? " is-ok" : ""}">${item.label}
              <input type="text" data-post="${item.id}" value="${escapeHtml(wert)}" placeholder="#immobilien #videografie" ${ro() ? "disabled" : ""} /></label>`;
          }).join("")}
        </div>`;

      box.querySelectorAll(".bs-check-sel").forEach((sel) => sel.addEventListener("change", () => {
        state.checkliste[sel.getAttribute("data-item")] = sel.value || null;
        zeichneCheck(); zeichneTakes(); zeichneKopf();
        speichere();
      }));
      box.querySelectorAll("[data-post]").forEach((el) => el.addEventListener("input", () => {
        state.checkliste[el.getAttribute("data-post")] = el.value;
        zeichneKopf();
        el.closest(".bs-check-feld").classList.toggle("is-ok", !!el.value.trim());
        speichere();
      }));
    }

    // =====================================================================
    // Takes
    // =====================================================================
    function zeichneTakesKopf() {
      const k = body.querySelector("#bsTakesKopf");
      k.innerHTML = `
        <h2 class="section-title" style="margin:0">Takes</h2>
        ${ro() ? "" : `
          <button class="btn btn--ghost btn--sm" id="bsBrollNeu" type="button" ${auswahl.size ? "" : "disabled"}
            title="Takes links anhaken, dann hier klicken">+ B-Roll über Auswahl${auswahl.size ? ` (${auswahl.size})` : ""}</button>`}`;
      const b = k.querySelector("#bsBrollNeu");
      if (b) b.addEventListener("click", brollAusAuswahl);
    }

    function feldSelect(take, feld, liste, label) {
      return `
        <label class="bs-feld">${label}
          <select data-tid="${escapeHtml(take.tid)}" data-feld="${feld}" ${ro() ? "disabled" : ""}>
            <option value="">—</option>
            ${liste.map((o) => `<option value="${o.id}"${take[feld] === o.id ? " selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </label>`;
    }

    function feldText(take, feld, label, platzhalter, typ) {
      const wert = take[feld] == null ? "" : take[feld];
      return `
        <label class="bs-feld">${label}
          <input type="${typ || "text"}" data-tid="${escapeHtml(take.tid)}" data-feld="${feld}"
            value="${escapeHtml(wert)}" placeholder="${escapeHtml(platzhalter || "")}" ${ro() ? "disabled" : ""} />
        </label>`;
    }

    function takeKarteHtml(take, i) {
      const offen = offeneTakes.has(take.tid);
      const chips = takeChips(take);
      const merkmale = merkmaleVonTake(state, take.tid);
      const fehlt = takeFehlendeFelder(take);
      const verwaist = istVerwaist(take);
      const geruest = istLosgeloest(take) && !verwaist;

      return `
        <article class="card bs-take${offen ? " is-offen" : ""}${take.gedreht ? " is-gedreht" : ""}${verwaist ? " is-verwaist" : ""}"
                 data-tid="${escapeHtml(take.tid)}">
          <div class="bs-take-kopf">
            ${ro() ? "" : `<input type="checkbox" class="bs-take-pick" ${auswahl.has(take.tid) ? "checked" : ""}
              title="Für B-Roll auswählen" aria-label="Take ${i + 1} für B-Roll auswählen" />`}
            <span class="bs-take-nr">${i + 1}</span>
            <button class="bs-take-titel" type="button">
              ${escapeHtml(take.label || (take.text ? take.text.slice(0, 40) : "Ohne Textstelle"))}
            </button>
            ${merkmale.map((m) => `<span class="bs-merkmal">${escapeHtml(m.label.replace(/\s*\(.*\)$/, ""))}</span>`).join("")}
            ${fehlt.length ? `<span class="bs-take-offen" title="${escapeHtml(fehlt.map((f) => f.label).join(", "))} fehlt">${fehlt.length} offen</span>` : `<span class="bs-take-fertig" title="fertig geplant">✓</span>`}
            ${ro() ? "" : `<button class="gd-del bs-take-del" type="button" title="Take löschen">✕</button>`}
          </div>

          ${verwaist ? `<p class="bs-take-warnung">Die Textstelle gibt es nicht mehr.
            <em>„${escapeHtml(take.text.slice(0, 60))}${take.text.length > 60 ? " …" : ""}"</em>
            ${ro() ? "" : `<button class="bs-zuordnen" type="button">Markierung zuordnen</button>`}</p>` : ""}
          ${geruest ? `<p class="bs-take-hinweis">Noch keine Passage.
            ${ro() ? "" : `<button class="bs-zuordnen" type="button">Markierung zuordnen</button>`}</p>` : ""}
          ${!istLosgeloest(take) ? `<p class="bs-take-text">${escapeHtml(take.text)}</p>` : ""}
          ${chips.length ? `<div class="bs-chips">${chips.map((c) => `<span class="bs-chip">${escapeHtml(c)}</span>`).join("")}</div>` : ""}

          ${offen ? `
            <div class="bs-take-felder">
              <div class="bs-feld-gruppe">
                <span class="bs-feld-titel">Kamera</span>
                ${feldText(take, "label", "Take-Name", "z. B. HOOK")}
                ${feldSelect(take, "groesse", GROESSEN, "Einstellungsgröße")}
                ${feldSelect(take, "perspektive", PERSPEKTIVEN, "Perspektive")}
                ${feldSelect(take, "bewegung", BEWEGUNGEN, "Bewegung")}
              </div>
              <div class="bs-feld-gruppe">
                <span class="bs-feld-titel">Ort &amp; Zeit</span>
                ${feldText(take, "location", "Location", "Büro, Balkon …")}
                ${feldText(take, "tageszeit", "Tageszeit / Licht", "golden hour")}
                ${feldText(take, "dauer", "Dauer (Sek.)", "6", "number")}
              </div>
              <div class="bs-feld-gruppe">
                <span class="bs-feld-titel">Look &amp; Ton</span>
                ${feldText(take, "brennweite", "Objektiv", "35 mm")}
                ${feldText(take, "licht", "Lichtsetup", "Fenster links")}
                ${feldText(take, "ton", "Musik / SFX", "ruhiger Beat")}
                ${feldText(take, "overlay", "Text-Overlay", "„Teil 2 →\"")}
              </div>
              <div class="bs-feld-gruppe">
                <span class="bs-feld-titel">Produktion</span>
                ${feldText(take, "requisiten", "Requisiten", "Kaffeetasse")}
                ${feldText(take, "notiz", "Notiz", "worauf achten?")}
                <label class="bs-feld bs-feld--haken">
                  <input type="checkbox" data-tid="${escapeHtml(take.tid)}" data-feld="gedreht"
                    ${take.gedreht ? "checked" : ""} /> gedreht
                </label>
              </div>
            </div>` : ""}
        </article>`;
    }

    function zeichneTakes() {
      zeichneTakesKopf();
      const box = body.querySelector("#bsTakes");
      const sortiert = sortierteTakes(state.takes);
      if (!sortiert.length) {
        box.innerHTML = `<div class="card card--pad empty-card">
          <div class="empty-emoji">✂️</div>
          <p class="empty-title">Noch keine Takes</p>
          <p class="muted">Markiere links eine Passage im Skript und klick auf „→ Take".
            Oder wähle oben ein Format — dann steht das Gerüst schon da.</p>
        </div>`;
        zeichneSpur();
        return;
      }
      box.innerHTML = sortiert.map(takeKarteHtml).join("");

      box.querySelectorAll(".bs-take").forEach((karte) => {
        const tid = karte.getAttribute("data-tid");
        const take = state.takes.find((t) => t.tid === tid);
        if (!take) return;

        // Auf-/Zuklappen + zugehörige Passage im Editor markieren
        karte.querySelector(".bs-take-titel").addEventListener("click", () => {
          if (offeneTakes.has(tid)) offeneTakes.delete(tid); else offeneTakes.add(tid);
          zeichneTakes();
          if (!istLosgeloest(take)) {
            ta.focus();
            ta.setSelectionRange(take.von, take.bis);
            hl.scrollTop = ta.scrollTop;
          }
        });

        const del = karte.querySelector(".bs-take-del");
        if (del) del.addEventListener("click", () => {
          if (!del.classList.contains("is-bestaetigen")) {
            del.classList.add("is-bestaetigen"); del.textContent = "Löschen?";
            return;
          }
          loescheTake(tid);
        });

        const pick = karte.querySelector(".bs-take-pick");
        if (pick) pick.addEventListener("change", () => {
          if (pick.checked) auswahl.add(tid); else auswahl.delete(tid);
          zeichneTakesKopf();
        });

        const zu = karte.querySelector(".bs-zuordnen");
        if (zu) zu.addEventListener("click", () => takeAusMarkierung(tid));

        // Feld-Eingaben: NICHT neu zeichnen (der Fokus soll bleiben) —
        // nur Zustand, Fortschritt und die Chip-Zeile der Karte nachziehen.
        karte.querySelectorAll("[data-feld]").forEach((el) => {
          const feld = el.getAttribute("data-feld");
          const ereignis = (el.type === "checkbox" || el.tagName === "SELECT") ? "change" : "input";
          el.addEventListener(ereignis, () => {
            if (feld === "gedreht") take.gedreht = el.checked;
            else if (feld === "dauer") take.dauer = el.value === "" ? null : Number(el.value);
            else take[feld] = el.value;
            const chipZeile = karte.querySelector(".bs-chips");
            const chips = takeChips(take);
            if (chipZeile) chipZeile.innerHTML = chips.map((c) => `<span class="bs-chip">${escapeHtml(c)}</span>`).join("");
            const offen = takeFehlendeFelder(take);
            const marke = karte.querySelector(".bs-take-offen, .bs-take-fertig");
            if (marke) {
              marke.className = offen.length ? "bs-take-offen" : "bs-take-fertig";
              marke.textContent = offen.length ? `${offen.length} offen` : "✓";
              marke.title = offen.length ? `${offen.map((f) => f.label).join(", ")} fehlt` : "fertig geplant";
            }
            karte.classList.toggle("is-gedreht", !!take.gedreht);
            zeichneKopf();
            speichere();
          });
        });
      });

      zeichneSpur();
    }

    function loescheTake(tid) {
      state.takes = state.takes.filter((t) => t.tid !== tid);
      offeneTakes.delete(tid);
      auswahl.delete(tid);
      // Verweise aufräumen: Checkliste …
      STORY_ITEMS.forEach((item) => {
        if (state.checkliste[item.id] === tid) state.checkliste[item.id] = null;
      });
      // … und B-Roll-Bänder (verlieren sie beide Enden, sind sie sinnlos).
      state.broll = state.broll.filter((b) => {
        if (b.vonTid === tid) b.vonTid = null;
        if (b.bisTid === tid) b.bisTid = null;
        return b.vonTid || b.bisTid;
      });
      alleNeu();
      speichere();
    }

    // =====================================================================
    // B-Roll: Spur (visuelle Klammer) + Karten mit den Feldern
    // =====================================================================
    function brollAusAuswahl() {
      const sortiert = sortierteTakes(state.takes);
      const gewaehlt = sortiert.filter((t) => auswahl.has(t.tid));
      if (!gewaehlt.length) return;
      const band = leeresBroll(gewaehlt[0].tid, gewaehlt[gewaehlt.length - 1].tid);
      state.broll.push(band);
      offenesBroll = band.bid;
      auswahl.clear();
      alleNeu();
      speichere();
    }

    // Die Spur zeichnet pro Band einen Balken, der exakt so hoch ist wie die
    // Karten, über die er läuft — dafür werden die echten DOM-Maße gemessen.
    // Überlappende Bänder rücken in eigene Spalten, sonst lägen sie übereinander.
    function zeichneSpur() {
      const spur = body.querySelector("#bsSpur");
      const wrap = body.querySelector("#bsTakesWrap");
      const sortiert = sortierteTakes(state.takes);
      if (!spur || !wrap) return;
      if (!state.broll.length || !sortiert.length) { spur.innerHTML = ""; spur.classList.remove("has-baender"); return; }

      const spalten = [];   // je Spalte die bisher belegten Index-Bereiche
      const stuecke = [];

      state.broll.forEach((band) => {
        const sp = brollSpanne(band, sortiert);
        if (!sp) return;
        const vonEl = wrap.querySelector(`.bs-take[data-tid="${CSS.escape(sortiert[sp.von].tid)}"]`);
        const bisEl = wrap.querySelector(`.bs-take[data-tid="${CSS.escape(sortiert[sp.bis].tid)}"]`);
        if (!vonEl || !bisEl) return;
        let spalte = spalten.findIndex((belegt) => !belegt.some((b) => sp.von <= b.bis && sp.bis >= b.von));
        if (spalte === -1) { spalten.push([]); spalte = spalten.length - 1; }
        spalten[spalte].push(sp);
        const top = vonEl.offsetTop;
        const hoehe = bisEl.offsetTop + bisEl.offsetHeight - top;
        stuecke.push(`
          <button class="bs-band${offenesBroll === band.bid ? " is-offen" : ""}${band.gedreht ? " is-gedreht" : ""}"
                  type="button" data-bid="${escapeHtml(band.bid)}"
                  style="top:${top}px;height:${Math.max(hoehe, 24)}px;left:${spalte * 22}px"
                  title="${escapeHtml(band.beschreibung || "B-Roll")} — über Take ${sp.von + 1}${sp.bis !== sp.von ? "–" + (sp.bis + 1) : ""}">
            <span class="bs-band-text">${escapeHtml(band.beschreibung || "B-Roll")}</span>
          </button>`);
      });

      spur.innerHTML = stuecke.join("");
      spur.classList.toggle("has-baender", stuecke.length > 0);
      spur.style.width = (spalten.length * 22 + 6) + "px";
      spur.querySelectorAll(".bs-band").forEach((b) => b.addEventListener("click", () => {
        const bid = b.getAttribute("data-bid");
        offenesBroll = offenesBroll === bid ? null : bid;
        zeichneBroll(); zeichneSpur();
        const karte = body.querySelector(`.bs-broll-karte[data-bid="${CSS.escape(bid)}"]`);
        if (karte) karte.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }));
    }

    function zeichneBroll() {
      const box = body.querySelector("#bsBroll");
      const sortiert = sortierteTakes(state.takes);
      if (!state.broll.length) {
        box.innerHTML = ro() ? "" : `<p class="muted bs-broll-leer">B-Roll: Takes oben anhaken und
          „+ B-Roll über Auswahl" klicken — ein Band kann über mehrere Takes laufen.</p>`;
        return;
      }
      box.innerHTML = `
        <h2 class="section-title">B-Roll</h2>
        ${state.broll.map((band) => {
          const sp = brollSpanne(band, sortiert);
          const ueber = sp
            ? (sp.von === sp.bis ? `über Take ${sp.von + 1}` : `über Take ${sp.von + 1}–${sp.bis + 1}`)
            : "ohne Zuordnung";
          const offen = offenesBroll === band.bid;
          return `
            <article class="card bs-broll-karte${offen ? " is-offen" : ""}${band.gedreht ? " is-gedreht" : ""}" data-bid="${escapeHtml(band.bid)}">
              <div class="bs-broll-kopf">
                <button class="bs-broll-titel" type="button">${escapeHtml(band.beschreibung || "B-Roll ohne Beschreibung")}</button>
                <span class="muted bs-broll-span">${escapeHtml(ueber)}</span>
                ${ro() ? "" : `<button class="gd-del bs-broll-del" type="button" title="B-Roll löschen">✕</button>`}
              </div>
              ${offen ? `
                <div class="bs-take-felder">
                  <div class="bs-feld-gruppe">
                    <label class="bs-feld">Was ist zu sehen?
                      <input type="text" data-bid="${escapeHtml(band.bid)}" data-feld="beschreibung"
                        value="${escapeHtml(band.beschreibung || "")}" placeholder="Hände am Schnittpult" ${ro() ? "disabled" : ""} /></label>
                    <label class="bs-feld">Einstellungsgröße
                      <select data-bid="${escapeHtml(band.bid)}" data-feld="groesse" ${ro() ? "disabled" : ""}>
                        <option value="">—</option>
                        ${GROESSEN.map((o) => `<option value="${o.id}"${band.groesse === o.id ? " selected" : ""}>${o.label}</option>`).join("")}
                      </select></label>
                    <label class="bs-feld">Bewegung
                      <select data-bid="${escapeHtml(band.bid)}" data-feld="bewegung" ${ro() ? "disabled" : ""}>
                        <option value="">—</option>
                        ${BEWEGUNGEN.map((o) => `<option value="${o.id}"${band.bewegung === o.id ? " selected" : ""}>${o.label}</option>`).join("")}
                      </select></label>
                    <label class="bs-feld">Quelle
                      <select data-bid="${escapeHtml(band.bid)}" data-feld="quelle" ${ro() ? "disabled" : ""}>
                        ${BROLL_QUELLEN.map((o) => `<option value="${o.id}"${band.quelle === o.id ? " selected" : ""}>${o.label}</option>`).join("")}
                      </select></label>
                  </div>
                  <div class="bs-feld-gruppe">
                    <label class="bs-feld">Läuft ab Take
                      <select data-bid="${escapeHtml(band.bid)}" data-feld="vonTid" ${ro() ? "disabled" : ""}>
                        ${sortiert.map((t, i) => `<option value="${escapeHtml(t.tid)}"${band.vonTid === t.tid ? " selected" : ""}>Take ${i + 1}${t.label ? " · " + escapeHtml(t.label) : ""}</option>`).join("")}
                      </select></label>
                    <label class="bs-feld">bis Take
                      <select data-bid="${escapeHtml(band.bid)}" data-feld="bisTid" ${ro() ? "disabled" : ""}>
                        ${sortiert.map((t, i) => `<option value="${escapeHtml(t.tid)}"${band.bisTid === t.tid ? " selected" : ""}>Take ${i + 1}${t.label ? " · " + escapeHtml(t.label) : ""}</option>`).join("")}
                      </select></label>
                    <label class="bs-feld">Notiz
                      <input type="text" data-bid="${escapeHtml(band.bid)}" data-feld="notiz" value="${escapeHtml(band.notiz || "")}" ${ro() ? "disabled" : ""} /></label>
                    <label class="bs-feld bs-feld--haken">
                      <input type="checkbox" data-bid="${escapeHtml(band.bid)}" data-feld="gedreht" ${band.gedreht ? "checked" : ""} /> gedreht
                    </label>
                  </div>
                </div>` : ""}
            </article>`;
        }).join("")}`;

      box.querySelectorAll(".bs-broll-karte").forEach((karte) => {
        const bid = karte.getAttribute("data-bid");
        const band = state.broll.find((b) => b.bid === bid);
        if (!band) return;

        karte.querySelector(".bs-broll-titel").addEventListener("click", () => {
          offenesBroll = offenesBroll === bid ? null : bid;
          zeichneBroll(); zeichneSpur();
        });

        const del = karte.querySelector(".bs-broll-del");
        if (del) del.addEventListener("click", () => {
          if (!del.classList.contains("is-bestaetigen")) {
            del.classList.add("is-bestaetigen"); del.textContent = "Löschen?";
            return;
          }
          state.broll = state.broll.filter((b) => b.bid !== bid);
          if (offenesBroll === bid) offenesBroll = null;
          zeichneBroll(); zeichneSpur();
          speichere();
        });

        karte.querySelectorAll("[data-feld]").forEach((el) => {
          const feld = el.getAttribute("data-feld");
          const ereignis = (el.type === "checkbox" || el.tagName === "SELECT") ? "change" : "input";
          el.addEventListener(ereignis, () => {
            if (feld === "gedreht") band.gedreht = el.checked;
            else band[feld] = el.value;
            if (feld === "beschreibung" || feld === "vonTid" || feld === "bisTid" || feld === "gedreht") {
              const titel = karte.querySelector(".bs-broll-titel");
              if (titel) titel.textContent = band.beschreibung || "B-Roll ohne Beschreibung";
              karte.classList.toggle("is-gedreht", !!band.gedreht);
              zeichneSpur();
            }
            speichere();
          });
        });
      });
    }

    // --- Alles neu (nach strukturellen Änderungen) ----------------------
    function alleNeu() {
      zeichneWerkzeuge();
      zeichneKopf();
      zeichneCheck();
      zeichneTakes();
      zeichneBroll();
      zeichneOverlay();
      zeichneSpur();
      ta.disabled = ro();
    }

    alleNeu();

    // Die Spur hängt an den gemessenen Kartenhöhen — bei Größenänderungen neu.
    const beiResize = () => zeichneSpur();
    window.addEventListener("resize", beiResize);
    beiViewWechsel(() => window.removeEventListener("resize", beiResize));
  })();
}
