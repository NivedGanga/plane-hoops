import type { HoopType } from '../sim/types';

type Note = {
  from: number;
  to: number;
  duration: number;
  delay?: number;
  waveform?: OscillatorType;
  volume?: number;
};

/** Small synthesized effects keep the game self-contained and need no downloaded audio assets. */
export class SoundEffects {
  private context?: AudioContext;
  private enabled = true;

  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  get isEnabled(): boolean { return this.enabled; }

  /** Call from a user gesture so browsers allow audio playback. */
  unlock(): void {
    if (!this.enabled) return;
    try {
      this.context ??= this.createContext();
      void this.context.resume().catch(() => undefined);
    } catch {
      // Audio is an enhancement: unsupported or blocked Web Audio must not interrupt play.
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  roundStart(): void {
    this.play([
      { from: 330, to: 440, duration: 0.12, delay: 0, waveform: 'triangle', volume: 0.045 },
      { from: 440, to: 660, duration: 0.16, delay: 0.1, waveform: 'sine', volume: 0.05 },
    ]);
  }

  hoopCleared(type: HoopType): void {
    if (type === 'booster') {
      this.play([
        { from: 480, to: 820, duration: 0.13, delay: 0, waveform: 'triangle', volume: 0.05 },
        { from: 820, to: 1380, duration: 0.18, delay: 0.11, waveform: 'sine', volume: 0.06 },
      ]);
    } else if (type === 'magnetic') {
      this.play([
        { from: 530, to: 410, duration: 0.1, delay: 0, waveform: 'sine', volume: 0.04 },
        { from: 690, to: 900, duration: 0.17, delay: 0.09, waveform: 'triangle', volume: 0.05 },
      ]);
    } else {
      this.play([
        { from: 650, to: 900, duration: 0.1, delay: 0, waveform: 'sine', volume: 0.045 },
        { from: 900, to: 1220, duration: 0.12, delay: 0.09, waveform: 'sine', volume: 0.05 },
      ]);
    }
  }

  crash(): void {
    this.play([
      { from: 220, to: 70, duration: 0.38, delay: 0, waveform: 'sawtooth', volume: 0.055 },
      { from: 120, to: 45, duration: 0.42, delay: 0.08, waveform: 'triangle', volume: 0.05 },
    ]);
  }

  private play(notes: Note[]): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running') return;
    const baseTime = context.currentTime;
    for (const note of notes) {
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = baseTime + (note.delay ?? 0);
        const end = start + note.duration;
        oscillator.type = note.waveform ?? 'sine';
        oscillator.frequency.setValueAtTime(note.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, note.to), end);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(note.volume ?? 0.05, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
      } catch {
        // A transient browser audio failure must not interrupt the simulation.
      }
    }
  }
}
