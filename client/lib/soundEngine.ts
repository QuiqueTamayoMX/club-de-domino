const MUTE_STORAGE_KEY = 'domino_mx_muted';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    this.muted = this.readMutedFromStorage();
  }

  private readMutedFromStorage(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  public toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private vibrate(pattern: number | number[]): void {
    if (this.muted || typeof navigator === 'undefined') return;
    try {
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore vibration errors
    }
  }

  private triggerClickBurst(ctx: AudioContext, when: number, pitchHz: number, gainPeak: number): void {
    // Short filtered noise burst for bone-on-wood impact
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * 0.025);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.0045));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(pitchHz, when);
    filter.Q.setValueAtTime(2.8, when);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(gainPeak, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, when + 0.024);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(when);

    // Resonant bone click overtone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitchHz * 0.85, when);
    osc.frequency.exponentialRampToValueAtTime(pitchHz * 0.42, when + 0.022);
    oscGain.gain.setValueAtTime(gainPeak * 0.55, when);
    oscGain.gain.exponentialRampToValueAtTime(0.001, when + 0.024);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.026);
  }

  /** Crisp bone-on-wood double click when placing a domino tile */
  public playTileClack(): void {
    this.vibrate(14);
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    this.triggerClickBurst(ctx, now, 1850, 0.34);
    this.triggerClickBurst(ctx, now + 0.024, 1280, 0.24);
  }

  /** Realistic wooden table knock-knock ("tocar mesa") when passing */
  public playKnock(): void {
    this.vibrate([25, 65, 25]);
    const ctx = this.getContext();
    if (!ctx) return;

    const knockAt = (when: number, baseFreq: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, when);
      osc.frequency.exponentialRampToValueAtTime(68, when + 0.075);

      gain.gain.setValueAtTime(0.001, when);
      gain.gain.linearRampToValueAtTime(peak, when + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.095);

      this.triggerClickBurst(ctx, when, 620, peak * 0.45);
    };

    const now = ctx.currentTime;
    knockAt(now, 165, 0.42);
    knockAt(now + 0.14, 152, 0.36);
  }

  /** Brief domino shuffle rattle when dealing a new hand */
  public playShuffle(): void {
    this.vibrate(18);
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const count = 8;
    for (let i = 0; i < count; i++) {
      const offset = i * 0.044 + Math.random() * 0.015;
      const pitch = 1150 + Math.random() * 900;
      const gain = 0.12 + Math.random() * 0.08;
      this.triggerClickBurst(ctx, now + offset, pitch, gain);
    }
  }

  /** Warm celebratory chord on winning a hand or match */
  public playVictory(): void {
    this.vibrate([30, 50, 65]);
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66]; // C5 E5 G5 B5 D6
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.62);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  }

  /** Subtle soft chime when it becomes the player's turn */
  public playTurnPing(): void {
    this.vibrate(18);
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const tones = [783.99, 1046.5]; // G5 -> C6
    tones.forEach((freq, idx) => {
      const start = now + idx * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.11, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.26);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.28);
    });
  }
}

export const soundEngine = new SoundEngine();

export const isMuted = (): boolean => soundEngine.isMuted();
export const setMuted = (muted: boolean): void => soundEngine.setMuted(muted);
export const toggleMuted = (): boolean => soundEngine.toggleMuted();
export const playTileClack = (): void => soundEngine.playTileClack();
export const playKnock = (): void => soundEngine.playKnock();
export const playShuffle = (): void => soundEngine.playShuffle();
export const playVictory = (): void => soundEngine.playVictory();
export const playTurnPing = (): void => soundEngine.playTurnPing();
