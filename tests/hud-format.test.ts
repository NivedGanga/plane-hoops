import { describe, expect, it } from 'vitest';
import { formatElapsedTime, formatGateProgress } from '../src/hud/format';

describe('flight HUD formatting', () => {
  it('shows progress through repeating groups of eight gates during an endless run', () => {
    expect(formatGateProgress(0)).toBe('0 / 8');
    expect(formatGateProgress(1)).toBe('1 / 8');
    expect(formatGateProgress(7)).toBe('7 / 8');
    expect(formatGateProgress(8)).toBe('8 / 8');
    expect(formatGateProgress(9)).toBe('1 / 8');
    expect(formatGateProgress(16)).toBe('8 / 8');
  });

  it('formats elapsed time as MM:SS.hh and clamps negative values to zero', () => {
    expect(formatElapsedTime(0)).toBe('00:00.00');
    expect(formatElapsedTime(18.37)).toBe('00:18.37');
    expect(formatElapsedTime(125.09)).toBe('02:05.09');
    expect(formatElapsedTime(-4)).toBe('00:00.00');
  });
});
