import * as THREE from 'three';

let scene = null;
const particles = [];
const MAX_PARTICLES = 200;

const particleGeo = new THREE.SphereGeometry(0.3, 4, 4);
const particleMaterials = [
  new THREE.MeshBasicMaterial({ color: 0xffaa00 }),
  new THREE.MeshBasicMaterial({ color: 0xffdd44 }),
  new THREE.MeshBasicMaterial({ color: 0xff6600 }),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
];

export function initParticles(sceneRef) {
  scene = sceneRef;
}

export function emitSparks(x, z, force) {
  if (!scene) return;

  const count = Math.min(25, Math.max(5, Math.floor(force / 5)));

  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) {
      const old = particles.shift();
      scene.remove(old.mesh);
    }

    const mat = particleMaterials[Math.floor(Math.random() * particleMaterials.length)];
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.position.set(x, 1 + Math.random() * 2, z);

    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 40;

    const particle = {
      mesh,
      vx: Math.cos(angle) * speed,
      vy: 15 + Math.random() * 25,
      vz: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.2,
      age: 0,
    };

    scene.add(mesh);
    particles.push(particle);
  }
}

export function updateParticles(dt) {
  const gravity = -80;

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;

    if (p.age >= p.life) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
      continue;
    }

    p.vy += gravity * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    if (p.mesh.position.y < 0.2) {
      p.mesh.position.y = 0.2;
      p.vy = 0;
      p.vx *= 0.8;
      p.vz *= 0.8;
    }

    const lifeRatio = 1 - (p.age / p.life);
    p.mesh.scale.setScalar(lifeRatio);
  }
}

export function clearParticles() {
  for (const p of particles) {
    scene.remove(p.mesh);
  }
  particles.length = 0;
}
