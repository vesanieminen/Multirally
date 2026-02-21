// Procedural sound engine using Web Audio API
let ctx = null;
let engineOsc1 = null;
let engineOsc2 = null;
let engineFilter = null;
let engineGain = null;
let skidNoiseSource = null;
let skidFilter = null;
let skidGain = null;
let noiseBuffer = null;
let initialized = false;
let masterGain = null;

function createNoiseBuffer() {
  const length = ctx.sampleRate * 2; // 2 seconds of noise
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function initAudio() {
  if (initialized) return;

  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('Web Audio API not available');
    return;
  }

  noiseBuffer = createNoiseBuffer();

  // Master gain
  masterGain = ctx.createGain();
  masterGain.gain.value = 0; // muted for now
  masterGain.connect(ctx.destination);

  // --- Engine sound: two detuned sawtooth oscillators -> lowpass -> gain ---
  engineOsc1 = ctx.createOscillator();
  engineOsc1.type = 'sawtooth';
  engineOsc1.frequency.value = 80;

  engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'sawtooth';
  engineOsc2.frequency.value = 82; // slightly detuned

  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 300;
  engineFilter.Q.value = 2;

  engineGain = ctx.createGain();
  engineGain.gain.value = 0;

  engineOsc1.connect(engineFilter);
  engineOsc2.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);

  engineOsc1.start();
  engineOsc2.start();

  // --- Skid sound: looping noise -> bandpass -> gain ---
  skidNoiseSource = ctx.createBufferSource();
  skidNoiseSource.buffer = noiseBuffer;
  skidNoiseSource.loop = true;

  skidFilter = ctx.createBiquadFilter();
  skidFilter.type = 'bandpass';
  skidFilter.frequency.value = 3000;
  skidFilter.Q.value = 2;

  skidGain = ctx.createGain();
  skidGain.gain.value = 0;

  skidNoiseSource.connect(skidFilter);
  skidFilter.connect(skidGain);
  skidGain.connect(masterGain);

  skidNoiseSource.start();

  initialized = true;
}

export function updateAudio(myPlayer, phase) {
  if (!initialized || !ctx) return;

  // Resume context if suspended (autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  // Silence everything when not racing
  if (phase !== 'racing' || !myPlayer) {
    if (engineGain) engineGain.gain.value = 0;
    if (skidGain) skidGain.gain.value = 0;
    return;
  }

  const speed = myPlayer.speed || 0;
  const skidIntensity = myPlayer.skidIntensity || 0;

  // --- Engine ---
  // Frequency rises with speed: 80 Hz idle to ~480 Hz at top speed
  const maxSpeed = 450; // approximate max for any car type
  const speedRatio = Math.min(speed / maxSpeed, 1);
  const engineFreq = 80 + speedRatio * 400;
  const filterFreq = 300 + speedRatio * 2000;

  // Smooth parameter changes to avoid clicks
  const now = ctx.currentTime;
  engineOsc1.frequency.setTargetAtTime(engineFreq, now, 0.05);
  engineOsc2.frequency.setTargetAtTime(engineFreq * 1.02, now, 0.05);
  engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);

  // Engine volume: quiet at idle, louder with speed
  const engineVol = 0.08 + speedRatio * 0.15;
  engineGain.gain.setTargetAtTime(engineVol, now, 0.05);

  // --- Skid screech ---
  if (skidIntensity > 0.25) {
    const skidVol = (skidIntensity - 0.25) * 0.5; // ramps up with intensity
    skidGain.gain.setTargetAtTime(skidVol, now, 0.03);
    // Modulate frequency slightly with intensity
    skidFilter.frequency.setTargetAtTime(2500 + skidIntensity * 1500, now, 0.05);
  } else {
    skidGain.gain.setTargetAtTime(0, now, 0.05);
  }
}

export function playCountdownBeep(seconds) {
  if (!initialized || !ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(masterGain);

  if (seconds > 0) {
    // "du" - short low beep for 3, 2, 1
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else {
    // "duuu" - longer higher beep for GO
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.setValueAtTime(0.5, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

export function playCollisionSound(force) {
  if (!initialized || !ctx) return;

  const now = ctx.currentTime;
  // Scale volume by impact force (typical range 10-150)
  const vol = Math.min(0.15 + Math.min(force, 150) / 150 * 0.5, 0.65);

  // Low-frequency "thuck" - short sine burst for body
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(120, now);
  thump.frequency.exponentialRampToValueAtTime(40, now + 0.08);

  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(vol, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  thump.connect(thumpGain);
  thumpGain.connect(masterGain);
  thump.start(now);
  thump.stop(now + 0.12);

  // Noise burst for attack/texture
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 800;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(vol * 0.6, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.08);
}

export function playLapBling() {
  if (!initialized || !ctx) return;

  const now = ctx.currentTime;

  // First tone: 880 Hz
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 880;
  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0.25, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start(now);
  osc1.stop(now + 0.15);

  // Second tone: 1320 Hz (musical fifth), slightly delayed
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 1320;
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.001, now);
  gain2.gain.setValueAtTime(0.25, now + 0.08);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start(now);
  osc2.stop(now + 0.25);
}

export function playApplause() {
  if (!initialized || !ctx) return;

  const now = ctx.currentTime;
  const duration = 3;

  // Noise source for crowd sound
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  // Bandpass filter to shape it like clapping
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 3000;
  filter.Q.value = 0.8;

  // Tremolo LFO for crowd rhythm (~8 Hz)
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 8;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.3; // modulation depth

  // Gain node for envelope and tremolo target
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.3); // fade in
  gain.gain.setValueAtTime(0.3, now + 1.5); // sustain
  gain.gain.linearRampToValueAtTime(0.001, now + duration); // fade out

  // Connect: noise -> filter -> gain -> master
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  // Connect LFO to modulate gain
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  noise.start(now);
  noise.stop(now + duration);
  lfo.start(now);
  lfo.stop(now + duration);
}

export function cleanup() {
  if (!initialized || !ctx) return;

  try {
    engineOsc1.stop();
    engineOsc2.stop();
    skidNoiseSource.stop();
    ctx.close();
  } catch (e) {
    // ignore errors during cleanup
  }

  ctx = null;
  initialized = false;
  engineOsc1 = null;
  engineOsc2 = null;
  engineFilter = null;
  engineGain = null;
  skidNoiseSource = null;
  skidFilter = null;
  skidGain = null;
  masterGain = null;
}
