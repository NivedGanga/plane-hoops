import { activateHoopEffect, sweptHoopCrossing } from './hoops';
import { createPlaneState, tickPhysics } from './physics';
import type { Hoop, PilotInput, PlaneState } from './types';

export interface TickResult { state: PlaneState; cleared: Hoop[]; missed: Hoop[] }
export function startRound(seedState = createPlaneState()): PlaneState {
  return { ...seedState, phase: 'playing', score: 0, tick: 0, elapsedSeconds: 0, speedKmh: 210, boosterUntilTick: 0, pullUntilTick: 0, pullDirection: null };
}

export function stepRound(state: PlaneState, input: PilotInput, hoops: Hoop[]): TickResult {
  if (state.phase !== 'playing') return { state, cleared: [], missed: [] };
  const previous = state;
  let next = tickPhysics(state, input);
  if (next.phase === 'ended') return { state: next, cleared: [], missed: [] };
  const cleared: Hoop[] = [];
  const missed: Hoop[] = [];
  for (const hoop of hoops) {
    if (!hoop.cleared && sweptHoopCrossing(previous.z, next.z, previous, next, hoop)) {
      hoop.cleared = true;
      next = activateHoopEffect(next, hoop);
      cleared.push(hoop);
    } else if (!hoop.cleared && previous.z < hoop.z && next.z >= hoop.z) {
      hoop.cleared = true;
      missed.push(hoop);
    }
  }
  return { state: next, cleared, missed };
}
