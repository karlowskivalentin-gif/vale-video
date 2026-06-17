// ── YouTube Facade — click to play
function playYT(wrapperId, videoId) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  const iframe = wrap.querySelector('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
  wrap.classList.add('active');
}


const cursor = document.getElementById('cursor');
const follower = document.getElementById('cursorFollower');

let mouseX = 0, mouseY = 0;
let followerX = 0, followerY = 0;

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursor.style.left = mouseX + 'px';
  cursor.style.top  = mouseY + 'px';
});

function animateFollower() {
  followerX += (mouseX - followerX) * 0.12;
  followerY += (mouseY - followerY) * 0.12;
  follower.style.left = followerX + 'px';
  follower.style.top  = followerY + 'px';
  requestAnimationFrame(animateFollower);
}
animateFollower();

// ── Accordion Toggle
function toggleBlock(id) {
  const block = document.getElementById(id);
  if (!block) return;
  const isOpen = block.classList.contains('open');
  // Schließe alle
  document.querySelectorAll('.work-block').forEach(b => b.classList.remove('open'));
  // Öffne angeklickten wenn er vorher zu war
  if (!isOpen) block.classList.add('open');
}

// ── Scroll Reveal
const observer = new IntersectionObserver((entries) => {
  entries.forEach(el => {
    if (el.isIntersecting) {
      el.target.style.opacity = '1';
      el.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.work-block, .about-quote, .about-body').forEach(el => {
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
