import {
  BOOSTER_SPEED_BONUS_KMH, BOUNDARY_RESTORE_GAIN, BOUNDARY_SOFT_ZONE_M,
  BOUNDARY_VELOCITY_DAMPING, CEILING_Y_M, FORWARD_SPEED_CAP_KMH, GROUND_Y_M,
  HALF_WIDTH_M, LATERAL_ACCELERATION_MPS2, MAX_LATERAL_SPEED_MPS,
  MIN_FORWARD_SPEED_KMH, NATURAL_SETTLE_PER_SECOND, SIM_DT_SECONDS, START_Y_M,
  SPEED_RAMP_SECONDS, START_FORWARD_SPEED_KMH,
} from '../../config/tuning';
import type { Direction, PilotInput, PlaneState, PlayBounds } from './types';

export const PLAY_BOUNDS: PlayBounds = {
  minX: -HALF_WIDTH_M, maxX: HALF_WIDTH_M, minY: GROUND_Y_M, maxY: CEILING_Y_M,
};

export function createPlaneState(): PlaneState {
  return {
    x: 0, y: START_Y_M, z: 0, vx: 0, vy: 0, speedKmh: START_FORWARD_SPEED_KMH,
    headingX: 0, headingY: 0, tick: 0, elapsedSeconds: 0, score: 0, phase: 'lobby',
    boosterUntilTick: 0, pullUntilTick: 0, pullDirection: null,
  };
}

export function isOutsideBounds(state: Pick<PlaneState, 'x' | 'y'>, bounds = PLAY_BOUNDS): boolean {
  return state.x < bounds.minX || state.x > bounds.maxX || state.y < bounds.minY || state.y > bounds.maxY;
}

function pullInput(direction: Direction | null): PilotInput {
  return { up: direction === 'up', down: direction === 'down', left: direction === 'left', right: direction === 'right' };
}

function boundaryAcceleration(position: number, velocity: number, min: number, max: number): number {
  const softMin = min + BOUNDARY_SOFT_ZONE_M;
  const softMax = max - BOUNDARY_SOFT_ZONE_M;
  if (position > softMax) return -((position - softMax) * BOUNDARY_RESTORE_GAIN + Math.max(0, velocity) * BOUNDARY_VELOCITY_DAMPING);
  if (position < softMin) return (softMin - position) * BOUNDARY_RESTORE_GAIN + Math.max(0, -velocity) * BOUNDARY_VELOCITY_DAMPING;
  return 0;
}

function clampAxis(position: number, velocity: number, min: number, max: number): [number, number] {
  if (position < min) return [min, Math.max(0, velocity)];
  if (position > max) return [max, Math.min(0, velocity)];
  return [position, velocity];
}

export function tickPhysics(state: PlaneState, playerInput: PilotInput, _bounds = PLAY_BOUNDS): PlaneState {
  const tick = state.tick + 1;
  const elapsedSeconds = state.elapsedSeconds + SIM_DT_SECONDS;
  const ramp = Math.min(1, tick / (SPEED_RAMP_SECONDS * 60));
  const naturalSpeed = START_FORWARD_SPEED_KMH + (FORWARD_SPEED_CAP_KMH - START_FORWARD_SPEED_KMH) * ramp;
  const boosted = tick < state.boosterUntilTick;
  const targetSpeed = Math.min(FORWARD_SPEED_CAP_KMH, naturalSpeed + (boosted ? BOOSTER_SPEED_BONUS_KMH : 0));
  const boosterUntilTick = boosted ? state.boosterUntilTick : 0;
  const activePull = tick < state.pullUntilTick ? state.pullDirection : null;
  const pull = pullInput(activePull);
  const directionX = Number(playerInput.right) - Number(playerInput.left) + Number(pull.right) - Number(pull.left);
  const directionY = Number(playerInput.up) - Number(playerInput.down) + Number(pull.up) - Number(pull.down);
  let vx = state.vx + (directionX * LATERAL_ACCELERATION_MPS2 + boundaryAcceleration(state.x, state.vx, PLAY_BOUNDS.minX, PLAY_BOUNDS.maxX)) * SIM_DT_SECONDS;
  let vy = state.vy + (directionY * LATERAL_ACCELERATION_MPS2 + boundaryAcceleration(state.y, state.vy, PLAY_BOUNDS.minY, PLAY_BOUNDS.maxY)) * SIM_DT_SECONDS;
  const drag = Math.exp(-NATURAL_SETTLE_PER_SECOND * SIM_DT_SECONDS);
  if (directionX === 0) vx *= drag;
  if (directionY === 0) vy *= drag;
  const lateralSpeed = Math.hypot(vx, vy);
  if (lateralSpeed > MAX_LATERAL_SPEED_MPS) {
    vx *= MAX_LATERAL_SPEED_MPS / lateralSpeed;
    vy *= MAX_LATERAL_SPEED_MPS / lateralSpeed;
  }
  const [x, boundedVx] = clampAxis(state.x + vx * SIM_DT_SECONDS, vx, PLAY_BOUNDS.minX, PLAY_BOUNDS.maxX);
  const [y, boundedVy] = clampAxis(state.y + vy * SIM_DT_SECONDS, vy, PLAY_BOUNDS.minY, PLAY_BOUNDS.maxY);
  const speedKmh = Math.max(MIN_FORWARD_SPEED_KMH, targetSpeed);
  const forwardMps = speedKmh / 3.6;
  return {
    ...state,
    x, y, z: state.z + forwardMps * SIM_DT_SECONDS,
    vx: boundedVx, vy: boundedVy, speedKmh,
    headingX: boundedVx / Math.max(forwardMps, 1), headingY: boundedVy / Math.max(forwardMps, 1),
    tick, elapsedSeconds, boosterUntilTick, pullUntilTick: activePull ? state.pullUntilTick : 0,
    pullDirection: activePull,
  };
}
