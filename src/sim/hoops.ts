import {
  BOOSTER_DURATION_SECONDS, BOOSTER_SHARE, CEILING_Y_M, FIRST_HOOP_MAX_DISTANCE_M,
  FIRST_HOOP_MIN_DISTANCE_M, FORWARD_SPEED_CAP_KMH, HOOP_RADIUS_END_M,
  HOOP_RADIUS_START_M, HOOP_SPACING_MAX_M, HOOP_SPACING_MIN_M,
  HOST_HOOPS_AHEAD, MAGNETIC_PULL_SECONDS, MAGNETIC_SHARE_END,
  MAGNETIC_SHARE_START, MAX_LATERAL_SPEED_MPS, LATERAL_ACCELERATION_MPS2,
  REACHABILITY_FRACTION_MAX, REACHABILITY_FRACTION_MIN, SIMULATION_HZ,
  START_Y_M, GROUND_Y_M, HALF_WIDTH_M, FIRST_HOOP_LATERAL_OFFSET_M,
  HOOP_ROUTE_RADIUS_MIN_M, HOOP_ROUTE_RADIUS_MAX_M,
  HOOP_ROUTE_CENTER_Y_OFFSET_MIN_M, HOOP_ROUTE_CENTER_Y_OFFSET_MAX_M, HOOP_CLEANUP_BEHIND_M,
} from '../../config/tuning';
import type { Hoop, PlaneState, ReachState, PullDirection } from './types';
import type { RandomSource } from './random';
import { randomInt } from './random';

export const DIRECTIONS: PullDirection[] = ['up', 'down', 'left', 'right'];
export interface HoopPlacementState {
  lastZ: number; predicted: ReachState; nextId: number;
  routeRadius?: number; routeCenterX?: number; routeCenterY?: number; routePhase?: number; routeDirection?: number;
  nextSpacing?: number;
}

export function travelTimeSeconds(distanceM: number, speedKmh: number): number {
  return distanceM / (speedKmh / 3.6);
}

export function axisReachEnvelope(velocity: number, seconds: number): number {
  const accelerated = Math.abs(velocity) * seconds + 0.5 * LATERAL_ACCELERATION_MPS2 * seconds * seconds;
  return Math.min(accelerated, MAX_LATERAL_SPEED_MPS * seconds);
}

export function hoopReachable(from: ReachState, hoop: Pick<Hoop, 'x' | 'y' | 'z'>, planeZ: number, speedKmh: number): boolean {
  const seconds = travelTimeSeconds(hoop.z - planeZ, speedKmh);
  if (seconds <= 0) return false;
  const dx = hoop.x - from.x; const dy = hoop.y - from.y;
  const roomX = dx >= 0 ? HALF_WIDTH_M - from.x : HALF_WIDTH_M + from.x;
  const roomY = dy >= 0 ? CEILING_Y_M - from.y : from.y - GROUND_Y_M;
  const xRange = Math.min(axisReachEnvelope(from.vx, seconds), roomX);
  const yRange = Math.min(axisReachEnvelope(from.vy, seconds), roomY);
  return Math.abs(dx) <= Math.max(0, xRange) * REACHABILITY_FRACTION_MAX + 0.01
    && Math.abs(dy) <= Math.max(0, yRange) * REACHABILITY_FRACTION_MAX + 0.01;
}

function radiusAt(elapsedSeconds: number): number {
  const difficulty = Math.min(1, elapsedSeconds / 600);
  return HOOP_RADIUS_START_M + (HOOP_RADIUS_END_M - HOOP_RADIUS_START_M) * difficulty;
}

function hoopType(random: RandomSource, elapsedSeconds: number): Hoop['type'] {
  const magneticShare = MAGNETIC_SHARE_START + (MAGNETIC_SHARE_END - MAGNETIC_SHARE_START) * Math.min(1, elapsedSeconds / 600);
  const roll = random.next();
  if (roll < magneticShare) return 'magnetic';
  if (roll < magneticShare + BOOSTER_SHARE) return 'booster';
  return 'standard';
}

export function generateHoopBatch(
  random: RandomSource,
  placement: HoopPlacementState,
  elapsedSeconds: number,
  speedKmh: number,
  count = HOST_HOOPS_AHEAD,
): { hoops: Hoop[]; placement: HoopPlacementState } {
  const hoops: Hoop[] = [];
  let { lastZ, predicted, nextId, routePhase = 0 } = placement;
  let nextSpacing = placement.nextSpacing;
  const routeRadius = placement.routeRadius ?? randomInt(random, HOOP_ROUTE_RADIUS_MIN_M, HOOP_ROUTE_RADIUS_MAX_M);
  const routeCenterX = placement.routeCenterX ?? FIRST_HOOP_LATERAL_OFFSET_M - routeRadius;
  const routeCenterY = placement.routeCenterY ?? START_Y_M + randomInt(random, HOOP_ROUTE_CENTER_Y_OFFSET_MIN_M, HOOP_ROUTE_CENTER_Y_OFFSET_MAX_M);
  const routeDirection = placement.routeDirection ?? (random.next() < 0.5 ? -1 : 1);
  for (let i = 0; i < count; i++) {
    const spacing = i === 0 && lastZ === 0
      ? randomInt(random, FIRST_HOOP_MIN_DISTANCE_M, FIRST_HOOP_MAX_DISTANCE_M)
      : nextSpacing ?? randomInt(random, HOOP_SPACING_MIN_M, HOOP_SPACING_MAX_M);
    nextSpacing = undefined;
    const z = lastZ + spacing;
    const seconds = travelTimeSeconds(spacing, Math.min(FORWARD_SPEED_CAP_KMH, Math.max(200, speedKmh)));
    const envelopeX = axisReachEnvelope(predicted.vx, seconds);
    const envelopeY = axisReachEnvelope(predicted.vy, seconds);
    const fraction = REACHABILITY_FRACTION_MIN;
    let x: number; let y: number;
    if (lastZ === 0) {
      // The opening gate is 50 m to the right: about 60% of the bounded lateral envelope.
      x = FIRST_HOOP_LATERAL_OFFSET_M; y = routeCenterY;
    } else {
      // One circular corridor step is 60% of the smaller axis envelope at that arrival time.
      const roomX = Math.min(HALF_WIDTH_M - predicted.x, HALF_WIDTH_M + predicted.x);
      const roomY = Math.min(predicted.y - GROUND_Y_M, CEILING_Y_M - predicted.y);
      const conservativeEnvelope = Math.min(envelopeX, envelopeY, roomX, roomY);
      const chord = fraction * conservativeEnvelope;
      const phaseStep = 2 * Math.asin(Math.min(1, chord / (2 * routeRadius)));
      routePhase += routeDirection * phaseStep;
      x = routeCenterX + routeRadius * Math.cos(routePhase);
      y = routeCenterY + routeRadius * Math.sin(routePhase);
    }
    const hoop: Hoop = {
      id: nextId++, type: hoopType(random, elapsedSeconds), x, y, z,
      radius: radiusAt(elapsedSeconds), arrow: null, cleared: false,
    };
    const followingSpacing = randomInt(random, HOOP_SPACING_MIN_M, HOOP_SPACING_MAX_M);
    const followingSeconds = travelTimeSeconds(followingSpacing, Math.min(FORWARD_SPEED_CAP_KMH, Math.max(200, speedKmh)));
    const followingReach = Math.min(
      axisReachEnvelope(0, followingSeconds),
      axisReachEnvelope(0, followingSeconds),
      HALF_WIDTH_M - Math.abs(x),
      y - GROUND_Y_M,
      CEILING_Y_M - y,
    );
    const followingChord = fraction * followingReach;
    const followingPhase = routePhase + routeDirection * 2 * Math.asin(Math.min(1, followingChord / (2 * routeRadius)));
    const followingX = routeCenterX + routeRadius * Math.cos(followingPhase);
    const followingY = routeCenterY + routeRadius * Math.sin(followingPhase);
    if (hoop.type === 'magnetic') {
      const dx = followingX - hoop.x; const dy = followingY - hoop.y;
      hoop.arrow = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'up' : 'down');
    }
    nextSpacing = followingSpacing;
    if (!hoopReachable(predicted, hoop, lastZ, speedKmh)) {
      // Stay on the corridor if rounding or a boundary-constrained segment needs a conservative correction.
      hoop.x = predicted.x + (x - predicted.x) * REACHABILITY_FRACTION_MIN;
      hoop.y = predicted.y + (y - predicted.y) * REACHABILITY_FRACTION_MIN;
    }
    hoops.push(hoop);
    lastZ = z;
    // Chain check assumes a competent pilot reaches the prior center and counter-steers any magnetic pull,
    // cancelling its directional acceleration before the next segment without changing forward speed.
    predicted = { x: hoop.x, y: hoop.y, vx: 0, vy: 0 };
  }
  return { hoops, placement: { lastZ, predicted, nextId, routeRadius, routeCenterX, routeCenterY, routePhase, routeDirection, nextSpacing } };
}

export function sweptHoopCrossing(previousZ: number, nextZ: number, previous: Pick<PlaneState, 'x' | 'y' | 'z'>, current: Pick<PlaneState, 'x' | 'y' | 'z'>, hoop: Hoop): boolean {
  if (hoop.cleared || !(previousZ < hoop.z && nextZ >= hoop.z)) return false;
  const ratio = (hoop.z - previous.z) / Math.max(0.000001, current.z - previous.z);
  const x = previous.x + (current.x - previous.x) * ratio;
  const y = previous.y + (current.y - previous.y) * ratio;
  return Math.hypot(x - hoop.x, y - hoop.y) <= hoop.radius;
}

export function activateHoopEffect(state: PlaneState, hoop: Hoop): PlaneState {
  if (hoop.type === 'booster') return { ...state, score: state.score + 20, boosterUntilTick: Math.max(state.boosterUntilTick, state.tick + BOOSTER_DURATION_SECONDS * SIMULATION_HZ + 1) };
  if (hoop.type === 'magnetic') return { ...state, score: state.score + 5, pullUntilTick: state.tick + MAGNETIC_PULL_SECONDS * SIMULATION_HZ + 1, pullDirection: hoop.arrow };
  return { ...state, score: state.score + 10 };
}

/** Discard passed hoops while retaining any hoop at or ahead of the cleanup boundary. */
export function discardHoopsBehind(hoops: Hoop[], planeZ: number): Hoop[] {
  const cutoff = planeZ - HOOP_CLEANUP_BEHIND_M;
  return hoops.filter((hoop) => hoop.z >= cutoff);
}
