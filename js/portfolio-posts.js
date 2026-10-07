// Portfolio: gliedert die Seite in die Abschnitte, die Valentin im Portal
// angelegt hat. Zwei Quellen fließen zusammen:
//
//   - die handgebauten Projektkarten, die als statisches HTML im
//     Markup stehen (SEO-Basis — ohne JS sieht ein Crawler sie weiterhin alle)
//   - die Video-Posts aus Firestore
//
// Wichtig: Die statischen Karten werden UMGEHÄNGT (appendChild), nicht neu
// gebaut. So bleiben ihre Links, Bilder und Texte exakt erhalten.
//
// Schlägt das Laden fehl (offline, Firestore weg), passiert schlicht nichts:
// die Seite bleibt das eine Grid mit allen statischen Projekten.
import { ladeWebvideos, ladeOrdner, ladeStatischZuordnung, postBild, escapeHtml } from "./web-daten.js";

const grid = document.getElementById("workGrid");
const sektion = grid && grid.closest(".work-section");

if (grid && sektion) {
  aufbauen().catch((e) => console.warn("[vale-video] Portfolio-Gliederung übersprungen:", e));
}

async function aufbauen() {
  const [posts, ordner, zuordnung] = await Promise.all([
    ladeWebvideos(), ladeOrdner(), ladeStatischZuordnung()
  ]);
  if (!ordner.length && !posts.length) return;   // nichts zu gliedern

  // Bilder der Posts parallel auflösen (TikTok/Instagram liegen in webthumbs).
  const postsMitBild = await Promise.all(posts.map(async (p) => ({ p, bild: await postBild(p) })));

  // Für jeden Abschnitt ein eigenes Grid anlegen, in der gesetzten Reihenfolge
  // hinter dem Grid „ohne Abschnitt".
  const gridVon = new Map();   // ordnerId → Grid-Element
  ordner.forEach((o) => {
    const sec = document.createElement("section");
    sec.className = "work-abschnitt";
    sec.innerHTML = `
      <div class="work-abschnitt-kopf">
        <h2 class="work-abschnitt-titel">${escapeHtml(o.name || "")}</h2>
        ${o.beschreibung ? `<p class="work-abschnitt-text">${escapeHtml(o.beschreibung)}</p>` : ""}
      </div>
      <div class="work-grid"></div>`;
    sektion.appendChild(sec);
    gridVon.set(o.id, sec.querySelector(".work-grid"));
  });

  // 1) Statische Karten in ihren Abschnitt umhängen. Ohne Zuordnung bleiben
  //    sie, wo sie sind — im obersten Grid.
  grid.querySelectorAll(".work-card").forEach((karte) => {
    const ref = (karte.getAttribute("href") || "").split("/").pop();
    const z = zuordnung.get(ref);
    const ziel = z && z.ordnerId && gridVon.get(z.ordnerId);
    if (ziel) ziel.appendChild(karte);
  });

  // 2) Posts einfügen — neueste zuerst, deshalb vorne ins jeweilige Grid.
  postsMitBild.forEach(({ p, bild }) => {
    const ziel = (p.ordnerId && gridVon.get(p.ordnerId)) || grid;
    ziel.insertAdjacentHTML("afterbegin", `
      <a href="projekt.html?id=${encodeURIComponent(p.id)}" class="work-card">
        ${bild ? `<img loading="lazy" src="${escapeHtml(bild)}" alt="${escapeHtml(p.titel || "")}" />` : ""}
        <div class="work-card-overlay">
          <p class="work-card-tag">${escapeHtml(p.untertitel || "")}</p>
          <p class="work-card-name">${escapeHtml(p.titel || "")}</p>
        </div>
      </a>`);
  });

  // 3) Leer gewordene Abschnitte wieder entfernen — eine Überschrift ohne
  //    Inhalt sieht auf der öffentlichen Seite nach Fehler aus.
  gridVon.forEach((g) => {
    if (!g.children.length) g.closest(".work-abschnitt").remove();
  });
  // Dasselbe für das obere Grid: ist alles einsortiert, bleibt kein Loch.
  grid.hidden = !grid.children.length;

  // Scroll-Reveal aus main.js kennt die neuen Karten nicht — sie stünden
  // sonst dauerhaft auf opacity:0.
  sektion.querySelectorAll(".work-card").forEach((c) => {
    c.style.opacity = "1";
    c.style.transform = "translateY(0)";
  });
}
