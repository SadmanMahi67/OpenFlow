let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.2, startDelay = 0): void {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gn = ctx.createGain();
  osc.type = type;
  osc.connect(gn);
  gn.connect(ctx.destination);
  const t = ctx.currentTime + startDelay;
  osc.frequency.value = freq;
  gn.gain.setValueAtTime(gain, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function sweep(fromFreq: number, toFreq: number, duration: number, type: OscillatorType = 'sine', gain = 0.2): void {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gn = ctx.createGain();
  osc.type = type;
  osc.connect(gn);
  gn.connect(ctx.destination);
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(fromFreq, t);
  osc.frequency.exponentialRampToValueAtTime(toFreq, t + duration);
  gn.gain.setValueAtTime(gain, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export function playPop(): void {
  tone(800, 0.08, 'sine', 0.25);
}

export function playClick(): void {
  tone(1000, 0.04, 'sine', 0.2);
}

export function playRising(): void {
  sweep(400, 1200, 0.15, 'sine', 0.2);
}

export function playBlip(): void {
  tone(1500, 0.06, 'square', 0.1);
}

export function playTap(): void {
  tone(600, 0.05, 'sine', 0.15);
}

export function playWhoosh(): void {
  sweep(200, 800, 0.2, 'sine', 0.08);
}

export function playPulse(): void {
  tone(500, 0.08, 'sine', 0.2, 0);
  tone(700, 0.08, 'sine', 0.2, 0.12);
}

export function playChime(): void {
  tone(523, 0.18, 'sine', 0.2, 0);
  tone(659, 0.18, 'sine', 0.2, 0.1);
}

export function playDing(): void {
  tone(880, 0.3, 'sine', 0.2);
}

export function playAscend(): void {
  tone(523, 0.12, 'sine', 0.18, 0);
  tone(659, 0.12, 'sine', 0.18, 0.1);
  tone(784, 0.12, 'sine', 0.18, 0.2);
}

export function playDescend(): void {
  tone(659, 0.15, 'sine', 0.2, 0);
  tone(523, 0.15, 'sine', 0.2, 0.12);
}

export function playSparkle(): void {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gn = ctx.createGain();
  const tremolo = ctx.createGain();
  osc.type = 'sine';
  osc.connect(gn);
  gn.connect(tremolo);
  tremolo.connect(ctx.destination);
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(2000, t);
  osc.frequency.exponentialRampToValueAtTime(4000, t + 0.15);
  gn.gain.setValueAtTime(0.15, t);
  gn.gain.linearRampToValueAtTime(0.15, t + 0.15);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  tremolo.gain.setValueAtTime(0.5, t);
  tremolo.gain.setValueAtTime(1, t + 0.04);
  tremolo.gain.setValueAtTime(0.5, t + 0.08);
  tremolo.gain.setValueAtTime(1, t + 0.12);
  osc.start(t);
  osc.stop(t + 0.25);
}

export function playChord(): void {
  tone(523, 0.35, 'sine', 0.12, 0);
  tone(659, 0.35, 'sine', 0.12, 0);
  tone(784, 0.35, 'sine', 0.08, 0);
}

export function playConfirm(): void {
  sweep(800, 400, 0.3, 'sine', 0.2);
}
