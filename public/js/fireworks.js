const canvas = document.getElementById('fireworks-canvas');
const ctx = canvas.getContext('2d');

let particles = [];
let rockets = [];
let animId = null;
let running = false;
let soundFn = null;

const COLORS = [
  '#e74c3c', '#f39c12', '#2ecc71', '#3498db',
  '#9b59b6', '#1abc9c', '#e67e22', '#f1c40f',
];

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function launchRocket() {
  const x = Math.random() * window.innerWidth;
  const targetY = window.innerHeight * (0.15 + Math.random() * 0.35);
  rockets.push({
    x, y: window.innerHeight,
    targetY,
    vy: -(4 + Math.random() * 3),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  });
}

function explode(x, y, color) {
  const count = 40 + Math.floor(Math.random() * 30);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.01 + Math.random() * 0.015,
      color,
      size: 1.5 + Math.random() * 2,
    });
  }
  if (soundFn) soundFn();
}

function tick() {
  if (!running) return;
  const w = window.innerWidth;
  const h = window.innerHeight;

  ctx.clearRect(0, 0, w, h);

  // Rockets
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.y += r.vy;
    // Trail
    ctx.fillStyle = r.color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(r.x - 1, r.y, 2, 6);
    if (r.y <= r.targetY) {
      explode(r.x, r.y, r.color);
      rockets.splice(i, 1);
    }
  }

  // Particles
  ctx.globalAlpha = 1;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.04; // gravity
    p.vx *= 0.99;
    p.life -= p.decay;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  // Random launches
  if (Math.random() < 0.06) launchRocket();

  animId = requestAnimationFrame(tick);
}

export function startFireworks(onExplode) {
  resize();
  canvas.style.display = 'block';
  running = true;
  soundFn = onExplode || null;
  particles = [];
  rockets = [];
  // Initial burst
  for (let i = 0; i < 4; i++) {
    setTimeout(() => launchRocket(), i * 200);
  }
  tick();
  window.addEventListener('resize', resize);
}

export function stopFireworks() {
  running = false;
  soundFn = null;
  if (animId) cancelAnimationFrame(animId);
  animId = null;
  canvas.style.display = 'none';
  particles = [];
  rockets = [];
  window.removeEventListener('resize', resize);
}
