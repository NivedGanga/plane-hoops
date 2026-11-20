import { describe, expect, it } from 'vitest';
import { SoundEffects } from '../src/audio/sfx';

class FakeParam {
  setValueAtTime(_value: number, _time: number): void {}
  exponentialRampToValueAtTime(_value: number, _time: number): void {}
}
class FakeOscillator {
  frequency = new FakeParam();
  type: OscillatorType = 'sine';
  started = false;
  connect(_node: unknown): void {}
  start(_time?: number): void { this.started = true; }
  stop(_time?: number): void {}
}
class FakeGain {
  gain = new FakeParam();
  connect(_node: unknown): void {}
}
class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = {};
  oscillators: FakeOscillator[] = [];
  createOscillator(): OscillatorNode {
    const node = new FakeOscillator(); this.oscillators.push(node);
    return node as unknown as OscillatorNode;
  }
  createGain(): GainNode { return new FakeGain() as unknown as GainNode; }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
}

describe('game sound effects', () => {
  it('plays a hoop-clear cue after audio is unlocked and suppresses effects when muted', async () => {
    const context = new FakeContext();
    const sounds = new SoundEffects(() => context as unknown as AudioContext);
    sounds.unlock();
    await Promise.resolve();
    sounds.hoopCleared('standard');
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators.every((oscillator) => oscillator.started)).toBe(true);
    expect(sounds.toggle()).toBe(false);
    sounds.crash();
    expect(context.oscillators).toHaveLength(2);
  });

  it('emits a distinct two-note cue on rock impact when enabled', async () => {
    const context = new FakeContext();
    const sounds = new SoundEffects(() => context as unknown as AudioContext);
    sounds.unlock();
    await Promise.resolve();
    sounds.crash();
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators.map((oscillator) => oscillator.type)).toEqual(['sawtooth', 'triangle']);
  });
});
