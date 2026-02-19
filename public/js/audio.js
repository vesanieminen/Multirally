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
  masterGain.gain.value = 0.5;
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
  if (skidIntensity > 0.15) {
    const skidVol = (skidIntensity - 0.15) * 0.5; // ramps up with intensity
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

export function playCollisionSound() {
  if (!initialized || !ctx) return;

  // Short burst of filtered noise
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  source.start();
  source.stop(ctx.currentTime + 0.15);
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
