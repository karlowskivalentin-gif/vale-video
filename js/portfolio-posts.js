// Portfolio: hängt die im Portal angelegten Video-Posts VOR die sieben
// statischen Projektkarten. Läuft nach dem Rendern der Seite — schlägt es
// fehl (offline, Firestore weg), bleibt das Portfolio mit seinen statischen
// Karten voll funktionsfähig.
import { ladeWebvideos, postBild, escapeHtml } from "./web-daten.js";

const grid = document.getElementById("workGrid");

if (grid) {
  ladeWebvideos().then(async (posts) => {
    if (!posts.length) return;

    // Bilder parallel auflösen (bei TikTok/Instagram liegt das Vorschaubild
    // als eigenes Dokument in webthumbs).
    const mitBild = await Promise.all(posts.map(async (p) => ({ p, bild: await postBild(p) })));

    const html = mitBild.map(({ p, bild }) => `
      <a href="projekt.html?id=${encodeURIComponent(p.id)}" class="work-card" data-category="${escapeHtml(p.kategorie || "reels")}">
        ${bild ? `<img loading="lazy" src="${escapeHtml(bild)}" alt="${escapeHtml(p.titel || "")}" />` : ""}
        <div class="work-card-overlay">
          <p class="work-card-tag">${escapeHtml(p.untertitel || "")}</p>
          <p class="work-card-name">${escapeHtml(p.titel || "")}</p>
        </div>
      </a>`).join("");

    grid.insertAdjacentHTML("afterbegin", html);

    // Die neuen Karten sind erst nach dem Filter-Wiring von main.js im DOM.
    // Steht gerade ein Filter aktiv, sofort darauf anwenden.
    const aktiv = document.querySelector(".work-filter .filter-chip.is-active");
    const f = aktiv ? aktiv.getAttribute("data-filter") : "all";
    if (f && f !== "all") {
      grid.querySelectorAll(".work-card").forEach((c) => {
        c.classList.toggle("is-hidden", c.getAttribute("data-category") !== f);
      });
    }

    // Scroll-Reveal aus main.js hat diese Karten nicht gesehen — sie würden
    // sonst dauerhaft auf opacity:0 stehen bleiben. Direkt sichtbar setzen.
    grid.querySelectorAll(".work-card").forEach((c) => {
      if (c.style.opacity === "0") { c.style.opacity = "1"; c.style.transform = "translateY(0)"; }
    });
  });
}
