// Startseite: befüllt das Kachel-Raster (.hero-grid) aus dem Baukasten im
// Portal. Zwei Betriebsarten:
//
//   normal        → liest die veröffentlichte Anordnung aus Firestore
//   ?vorschau=1   → liest NICHTS, sondern wartet auf ein postMessage aus dem
//                   Portal. So kann der Baukasten einen unveröffentlichten
//                   Entwurf zeigen, ohne dass der öffentlich lesbar sein muss.
//
// Die sieben Kacheln im HTML bleiben als Fallback stehen: Solange nichts
// geladen ist (oder Firestore nicht antwortet), sieht die Seite genau so aus
// wie bisher. Ersetzt wird erst, wenn wirklich eine Anordnung vorliegt.
import { ladeStartseite, ladeWebvideo, postBild, STATISCHE_PROJEKTE, escapeHtml } from "./web-daten.js";

const grid = document.querySelector(".hero-grid");
const istVorschau = new URLSearchParams(location.search).get("vorschau") === "1";

function kachelHtml(k) {
  return `
    <a href="${escapeHtml(k.href)}" class="hero-tile${k.breit ? " is-wide" : ""}">
      ${k.bild ? `<img src="${escapeHtml(k.bild)}" alt="${escapeHtml(k.titel || "")}" />` : ""}
      <div class="hero-tile-cap">
        <p class="hero-tile-tag">${escapeHtml(k.tag || "")}</p>
        <p class="hero-tile-name">${escapeHtml(k.titel || "")}</p>
      </div>
    </a>`;
}

function zeichne(kacheln) {
  if (!grid || !Array.isArray(kacheln) || !kacheln.length) return;
  grid.innerHTML = kacheln.map(kachelHtml).join("");
  // Scroll-Reveal in main.js kennt diese Kacheln nicht — ohne das blieben
  // sie unsichtbar, falls sie je in die Reveal-Liste aufgenommen werden.
  grid.querySelectorAll(".hero-tile").forEach((t) => { t.style.opacity = "1"; });
}

// Referenzen ({quelle, ref, breit}) zu anzeigbaren Kacheln auflösen.
async function aufloesen(kacheln) {
  const out = await Promise.all(kacheln.map(async (k) => {
    if (k.quelle === "statisch") {
      const p = STATISCHE_PROJEKTE[k.ref];
      return p ? { href: k.ref, titel: p.titel, tag: p.tag, bild: p.thumb, breit: !!k.breit } : null;
    }
    const v = await ladeWebvideo(k.ref);
    if (!v || v.veroeffentlicht !== true) return null;
    return {
      href: `projekt.html?id=${encodeURIComponent(v.id)}`,
      titel: v.titel, tag: v.untertitel || "",
      bild: await postBild(v), breit: !!k.breit
    };
  }));
  return out.filter(Boolean);
}

if (grid) {
  if (istVorschau) {
    // Das Portal schickt bereits fertig aufgelöste Kacheln — die Vorschau
    // muss (und darf) selbst nichts nachschlagen.
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin) return;               // fremde Absender ignorieren
      const d = e.data;
      if (!d || d.typ !== "vv-startseite-vorschau") return;
      zeichne(d.kacheln);
    });
    document.body.classList.add("ist-vorschau");
  } else {
    ladeStartseite().then(async (kacheln) => {
      if (kacheln.length) zeichne(await aufloesen(kacheln));
    });
  }
}
