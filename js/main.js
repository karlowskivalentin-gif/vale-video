// ── YouTube Facade — click to play
function playYT(wrapperId, videoId) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  const iframe = wrap.querySelector('iframe');
  // playsinline: iPhone spielt im Player auf der Seite statt sofort im Vollbild
  iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  wrap.classList.add('active');
}

// ── Portfolio: die Filter-Chips sind entfallen. Das Portfolio gliedert sich
// jetzt in Abschnitte, die Valentin im Portal anlegt (js/portfolio-posts.js) —
// zwei parallele Ordnungssysteme (Chips quer + Abschnitte längs) hätten
// Besucher nur verwirrt.

// ── Hero Video Swap-in Hook
// Sobald der Showreel-Slot ein data-video-src trägt, wird das <video> injiziert
// und das Projekt-Grid durch das Cover-Video ersetzt. No-Op solange leer.
(function initHeroVideo() {
  const slot = document.querySelector('.hero-video-slot');
  const hero = document.getElementById('hero');
  if (!slot || !hero) return;
  const src = slot.getAttribute('data-video-src');
  if (!src) return;
  slot.removeAttribute('hidden');
  if (!slot.querySelector('video')) {
    const video = document.createElement('video');
    video.src = src;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    slot.appendChild(video);
  }
  hero.classList.add('hero--video');
})();

// ── Scroll Reveal
const observer = new IntersectionObserver((entries) => {
  entries.forEach(el => {
    if (el.isIntersecting) {
      el.target.style.opacity = '1';
      el.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.service-item, .work-card, .process-item, .pricing-tier, .cta-band, .about-quote, .about-body').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
  observer.observe(el);
});

// ── Mobil-Menü
// Auf schmalen Screens blendet css/style.css die Textlinks aus; hier entstehen
// Burger-Knopf und Aufklapp-Panel mit Kopien dieser Links. Gebaut per JS,
// damit nicht jede Seite ihr eigenes Menü-Markup braucht.
(function initMobilMenue() {
  const nav = document.querySelector('nav');
  const links = nav && nav.querySelector('.nav-links');
  if (!links) return;                                   // z. B. Impressum mit eigener Nav

  const panel = document.createElement('div');
  panel.className = 'nav-panel';
  panel.id = 'navPanel';
  links.querySelectorAll('a:not(.nav-cta)').forEach((a) => panel.appendChild(a.cloneNode(true)));
  // CTA zusätzlich ins Menü — sichtbar nur auf sehr schmalen Screens (CSS)
  const cta = links.querySelector('.nav-cta');
  if (cta) {
    const kopie = cta.cloneNode(true);
    kopie.className = 'nav-panel-cta';
    panel.appendChild(kopie);
  }

  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.className = 'nav-toggle';
  knopf.setAttribute('aria-controls', 'navPanel');
  knopf.innerHTML = '<span></span><span></span>';

  const setze = (offen) => {
    nav.classList.toggle('ist-offen', offen);
    knopf.setAttribute('aria-expanded', String(offen));
    knopf.setAttribute('aria-label', offen ? 'Menü schließen' : 'Menü öffnen');
  };
  setze(false);
  knopf.addEventListener('click', () => setze(!nav.classList.contains('ist-offen')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setze(false); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) setze(false); });

  nav.appendChild(knopf);
  nav.appendChild(panel);
})();

// ── Navbar: hide/show on scroll
let lastScroll = 0;
const nav = document.querySelector('nav');

window.addEventListener('scroll', () => {
  const current = window.scrollY;
  // Offenes Mobil-Menü nicht wegscrollen — es würde unter dem Finger verschwinden
  if (nav.classList.contains('ist-offen')) { lastScroll = current; return; }
  if (current > lastScroll && current > 100) {
    nav.style.transform = 'translateY(-100%)';
    nav.style.transition = 'transform 0.4s ease';
  } else {
    nav.style.transform = 'translateY(0)';
  }
  lastScroll = current;
});
