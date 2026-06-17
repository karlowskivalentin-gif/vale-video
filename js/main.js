// ── YouTube Facade — click to play
function playYT(wrapperId, videoId) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  const iframe = wrap.querySelector('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
  wrap.classList.add('active');
}

// ── Portfolio / Work Filter
document.querySelectorAll('[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    const group = chip.closest('.work-filter');
    const filter = chip.getAttribute('data-filter');
    if (group) {
      group.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
    }
    chip.classList.add('is-active');
    document.querySelectorAll('.work-card').forEach(card => {
      const cat = card.getAttribute('data-category');
      const show = filter === 'all' || cat === filter;
      card.classList.toggle('is-hidden', !show);
    });
  });
});

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

// ── Navbar: hide/show on scroll
let lastScroll = 0;
const nav = document.querySelector('nav');

window.addEventListener('scroll', () => {
  const current = window.scrollY;
  if (current > lastScroll && current > 100) {
    nav.style.transform = 'translateY(-100%)';
    nav.style.transition = 'transform 0.4s ease';
  } else {
    nav.style.transform = 'translateY(0)';
  }
  lastScroll = current;
});
