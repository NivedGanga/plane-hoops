import {
  BOOSTER_DURATION_SECONDS, BOOSTER_HOOP_POINTS, BOOSTER_SHARE,
  COURSE_CEILING_Y_M, COURSE_GROUND_Y_M, COURSE_HALF_WIDTH_M,
  FIRST_HOOP_MAX_DISTANCE_M, FIRST_HOOP_MIN_DISTANCE_M, FORWARD_SPEED_CAP_KMH,
  HOOP_CLEANUP_BEHIND_M, HOOP_MINIMUM_CLEARANCE_M, HOOP_RADIUS_END_M,
  HOOP_RADIUS_START_M, HOOP_SPACING_MAX_M, HOOP_SPACING_MIN_M,
  HOST_HOOPS_AHEAD, LATERAL_ACCELERATION_MPS2, MAGNETIC_HOOP_POINTS,
  MAGNETIC_PULL_SECONDS, MAGNETIC_SHARE_END, MAGNETIC_SHARE_START,
  MAX_LATERAL_SPEED_MPS, MAX_SHIP_COLLISION_RADIUS_M, REACHABILITY_FRACTION_MAX,
  REACHABILITY_FRACTION_MIN, ROCK_DECOY_SHARE_END, ROCK_DECOY_SHARE_START,
  ROCK_OUTLINE_POINTS, ROCK_SPACING_REDUCTION_M, ROCK_THICKNESS_MAX_M,
  ROCK_THICKNESS_MIN_M, SIMULATION_HZ, START_Y_M, STANDARD_HOOP_POINTS,
  FIRST_HOOP_LATERAL_OFFSET_M,
  START_FORWARD_SPEED_KMH, HOOP_ROUTE_RADIUS_MIN_M, HOOP_ROUTE_RADIUS_MAX_M,
  HOOP_ROUTE_CENTER_Y_OFFSET_MIN_M, HOOP_ROUTE_CENTER_Y_OFFSET_MAX_M,
} from '../../config/tuning';
import type { Hoop, PlaneState, ReachState, PullDirection, Vector2 } from './types';
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
  const roomX = dx >= 0 ? COURSE_HALF_WIDTH_M - from.x : COURSE_HALF_WIDTH_M + from.x;
  const roomY = dy >= 0 ? COURSE_CEILING_Y_M - from.y : from.y - COURSE_GROUND_Y_M;
  const xRange = Math.min(axisReachEnvelope(from.vx, seconds), roomX);
  const yRange = Math.min(axisReachEnvelope(from.vy, seconds), roomY);
  return Math.abs(dx) <= Math.max(0, xRange) * REACHABILITY_FRACTION_MAX + 0.01
    && Math.abs(dy) <= Math.max(0, yRange) * REACHABILITY_FRACTION_MAX + 0.01;
}

export function requiredHoleRadius(): number {
  return MAX_SHIP_COLLISION_RADIUS_M + HOOP_MINIMUM_CLEARANCE_M;
}

function radiusAt(elapsedSeconds: number): number {
  const difficulty = Math.min(1, elapsedSeconds / 600);
  return HOOP_RADIUS_START_M + (HOOP_RADIUS_END_M - HOOP_RADIUS_START_M) * difficulty;
}

function difficultyAt(elapsedSeconds: number): number { return Math.max(0, Math.min(1, elapsedSeconds / 600)); }

function spacingMaxAt(elapsedSeconds: number): number {
  return Math.max(HOOP_SPACING_MIN_M, HOOP_SPACING_MAX_M - Math.round(ROCK_SPACING_REDUCTION_M * difficultyAt(elapsedSeconds)));
}

function hoopType(random: RandomSource, elapsedSeconds: number): Hoop['type'] {
  const magneticShare = MAGNETIC_SHARE_START + (MAGNETIC_SHARE_END - MAGNETIC_SHARE_START) * difficultyAt(elapsedSeconds);
  const roll = random.next();
  if (roll < magneticShare) return 'magnetic';
  if (roll < magneticShare + BOOSTER_SHARE) return 'booster';
  return 'standard';
}

function createOutline(random: RandomSource, holeRadius: number): Vector2[] {
  const minimumRim = holeRadius + 7;
  return Array.from({ length: ROCK_OUTLINE_POINTS }, (_, index) => {
    const angle = index * Math.PI * 2 / ROCK_OUTLINE_POINTS;
    const outerRadius = minimumRim + random.next() * 5;
    return { x: Math.cos(angle) * outerRadius, y: Math.sin(angle) * outerRadius };
  });
}

function createRock(
  random: RandomSource,
  id: number,
  type: Hoop['type'],
  x: number,
  y: number,
  z: number,
  radius: number,
  arrow: PullDirection | null,
  decoy = false,
): Hoop {
  return {
    id, type, x, y, z, radius,
    thickness: randomInt(random, ROCK_THICKNESS_MIN_M, ROCK_THICKNESS_MAX_M),
    outline: createOutline(random, radius), decoy, arrow, cleared: false,
  };
}

function magneticDirection(dx: number, dy: number): PullDirection {
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'up' : 'down');
}

function predictMagneticallyCompensatedExit(hoop: Hoop): ReachState {
  let x = hoop.x; let y = hoop.y; let vx = 0; let vy = 0;
  if (!hoop.arrow) return { x, y, vx, vy };
  // The authoritative chain check models the cooperative counter-steer across the full two-second pull.
  // Equal opposite input cancels the pull acceleration; lateral inertia and speed remain unchanged.
  const dt = 1 / SIMULATION_HZ;
  const pullX = hoop.arrow === 'right' ? 1 : hoop.arrow === 'left' ? -1 : 0;
  const pullY = hoop.arrow === 'up' ? 1 : hoop.arrow === 'down' ? -1 : 0;
  for (let tick = 0; tick < MAGNETIC_PULL_SECONDS * SIMULATION_HZ; tick++) {
    const netX = pullX - pullX; const netY = pullY - pullY;
    vx += netX * LATERAL_ACCELERATION_MPS2 * dt;
    vy += netY * LATERAL_ACCELERATION_MPS2 * dt;
    x += vx * dt; y += vy * dt;
  }
  return { x, y, vx, vy };
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
  const difficulty = difficultyAt(elapsedSeconds);
  const maxSpacing = spacingMaxAt(elapsedSeconds);
  const speed = Math.min(FORWARD_SPEED_CAP_KMH, Math.max(START_FORWARD_SPEED_KMH, speedKmh));

  for (let i = 0; i < count; i++) {
    const spacing = i === 0 && lastZ === 0
      ? randomInt(random, FIRST_HOOP_MIN_DISTANCE_M, FIRST_HOOP_MAX_DISTANCE_M)
      : nextSpacing ?? randomInt(random, HOOP_SPACING_MIN_M, maxSpacing);
    nextSpacing = undefined;
    const z = lastZ + spacing;
    const seconds = travelTimeSeconds(spacing, speed);
    const envelopeX = axisReachEnvelope(predicted.vx, seconds);
    const envelopeY = axisReachEnvelope(predicted.vy, seconds);
    const fraction = REACHABILITY_FRACTION_MIN + (REACHABILITY_FRACTION_MAX - REACHABILITY_FRACTION_MIN) * 0.35 * difficulty;
    let x: number; let y: number;
    if (lastZ === 0) {
      x = FIRST_HOOP_LATERAL_OFFSET_M; y = routeCenterY;
    } else {
      const roomX = Math.min(COURSE_HALF_WIDTH_M - predicted.x, COURSE_HALF_WIDTH_M + predicted.x);
      const roomY = Math.min(predicted.y - COURSE_GROUND_Y_M, COURSE_CEILING_Y_M - predicted.y);
      const conservativeEnvelope = Math.max(0, Math.min(envelopeX, envelopeY, roomX, roomY));
      const chord = fraction * conservativeEnvelope;
      const phaseStep = 2 * Math.asin(Math.min(1, chord / (2 * routeRadius)));
      routePhase += routeDirection * phaseStep;
      x = routeCenterX + routeRadius * Math.cos(routePhase);
      y = routeCenterY + routeRadius * Math.sin(routePhase);
    }

    const radius = radiusAt(elapsedSeconds);
    const followingSpacing = randomInt(random, HOOP_SPACING_MIN_M, maxSpacing);
    const followingSeconds = travelTimeSeconds(followingSpacing, speed);
    const followingReach = Math.max(0, Math.min(
      axisReachEnvelope(predicted.vx, followingSeconds), axisReachEnvelope(predicted.vy, followingSeconds),
      COURSE_HALF_WIDTH_M - Math.abs(x), y - COURSE_GROUND_Y_M, COURSE_CEILING_Y_M - y,
    ));
    const followingChord = fraction * followingReach;
    const followingPhase = routePhase + routeDirection * 2 * Math.asin(Math.min(1, followingChord / (2 * routeRadius)));
    const followingX = routeCenterX + routeRadius * Math.cos(followingPhase);
    const followingY = routeCenterY + routeRadius * Math.sin(followingPhase);
    const type = hoopType(random, elapsedSeconds);
    const main = createRock(random, nextId++, type, x, y, z, radius, null);
    if (type === 'magnetic') main.arrow = magneticDirection(followingX - x, followingY - y);

    if (!hoopReachable(predicted, main, lastZ, speed)) {
      main.x = predicted.x + (x - predicted.x) * REACHABILITY_FRACTION_MIN;
      main.y = predicted.y + (y - predicted.y) * REACHABILITY_FRACTION_MIN;
    }
    hoops.push(main);

    const decoyShare = ROCK_DECOY_SHARE_START + (ROCK_DECOY_SHARE_END - ROCK_DECOY_SHARE_START) * difficulty;
    if (random.next() < decoyShare) {
      let dx = followingX - x; let dy = followingY - y;
      const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
      const side = random.next() < 0.5 ? -1 : 1;
      const offset = radius + 12 + MAX_SHIP_COLLISION_RADIUS_M + 3;
      hoops.push(createRock(random, nextId++, 'standard', x - dy * side * offset, y + dx * side * offset, z, radius, null, true));
    }

    lastZ = z;
    predicted = predictMagneticallyCompensatedExit(main);
    nextSpacing = followingSpacing;
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
  if (hoop.decoy) return state;
  if (hoop.type === 'booster') return { ...state, score: state.score + BOOSTER_HOOP_POINTS, boosterUntilTick: Math.max(state.boosterUntilTick, state.tick + BOOSTER_DURATION_SECONDS * SIMULATION_HZ + 1) };
  if (hoop.type === 'magnetic') return { ...state, score: state.score + MAGNETIC_HOOP_POINTS, pullUntilTick: state.tick + MAGNETIC_PULL_SECONDS * SIMULATION_HZ + 1, pullDirection: hoop.arrow };
  return { ...state, score: state.score + STANDARD_HOOP_POINTS };
}

/** Discard passed target holes and decoys while retaining the 200 m cleanup window. */
export function discardHoopsBehind(hoops: Hoop[], planeZ: number): Hoop[] {
  const cutoff = planeZ - HOOP_CLEANUP_BEHIND_M;
  return hoops.filter((hoop) => hoop.z >= cutoff);
}
