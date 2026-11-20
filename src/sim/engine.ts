import { sweptRockCollision, holeExitTime, type RockCollision } from './collision';
import { activateHoopEffect } from './hoops';
import { createPlaneState, tickPhysics } from './physics';
import type { Hoop, PilotInput, PlaneState } from './types';

export interface TickResult { state: PlaneState; cleared: Hoop[]; missed: Hoop[]; collision: RockCollision | null }

export function startRound(seedState = createPlaneState()): PlaneState {
  return { ...seedState, phase: 'playing', score: 0, tick: 0, elapsedSeconds: 0, speedKmh: 210, boosterUntilTick: 0, pullUntilTick: 0, pullDirection: null };
}

export function stepRound(state: PlaneState, input: PilotInput, hoops: Hoop[]): TickResult {
  if (state.phase !== 'playing') return { state, cleared: [], missed: [], collision: null };
  const previous = state;
  let next = tickPhysics(state, input);
  const collision = sweptRockCollision(previous, next, hoops);
  const cleared: Hoop[] = [];
  for (const hoop of hoops) {
    const exitTime = holeExitTime(previous, next, hoop);
    if (exitTime === null || (collision && collision.time <= exitTime)) continue;
    hoop.cleared = true;
    if (hoop.decoy) continue;
    next = activateHoopEffect(next, hoop);
    cleared.push(hoop);
  }
  if (collision) next = { ...next, phase: 'ended' };
  // Passing the opening is not a crash; only solid-rock contact ends the run.
  return { state: next, cleared, missed: [], collision };
}
