import { MAX_SHIP_COLLISION_RADIUS_M, SPAWN_CORRIDOR_RADIUS_M, START_Y_M } from '../../config/tuning';
import type { Hoop, PlaneState } from './types';

export interface RockCollision {
  rockId: number;
  time: number;
  impactPoint: { x: number; y: number; z: number };
  sphereIndex: number;
}

interface CollisionSphere { x: number; y: number; z: number; radius: number }
interface Point3 { x: number; y: number; z: number }
export interface CorridorSample { x: number; y: number; radius: number; segmentId: number }

/** Compound spheres cover fuselage, nose/tail, broad wings, and wing tips. */
export const SHIP_COLLISION_SPHERES: readonly CollisionSphere[] = [
  { x: 0, y: 0, z: 0, radius: 1.42 },
  { x: 0, y: 0.1, z: -1.05, radius: 0.68 },
  { x: 0, y: 0, z: 1.12, radius: 0.62 },
  { x: -1.35, y: 0, z: 0.04, radius: 0.88 },
  { x: 1.35, y: 0, z: 0.04, radius: 0.88 },
  { x: -2.12, y: 0, z: 0.24, radius: 0.62 },
  { x: 2.12, y: 0, z: 0.24, radius: 0.62 },
];

const SWEEP_STEP_M = 0.25;
const COLLISION_EPSILON = 1e-7;
const START_ROUTE_ID = 0;

function normalize(x: number, y: number, z: number): Point3 {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function cross(a: Point3, b: Point3): Point3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function sphereCenter(state: PlaneState, sphere: CollisionSphere): Point3 {
  const right = normalize(1, 0, state.headingX);
  const longitudinal = normalize(-state.headingX, -state.headingY, 1);
  const rawUp = cross(longitudinal, right);
  const up = normalize(rawUp.x, rawUp.y, rawUp.z);
  return {
    x: state.x + right.x * sphere.x + up.x * sphere.y + longitudinal.x * sphere.z,
    y: state.y + right.y * sphere.x + up.y * sphere.y + longitudinal.y * sphere.z,
    z: state.z + right.z * sphere.x + up.z * sphere.y + longitudinal.z * sphere.z,
  };
}

function lerpPoint(a: Point3, b: Point3, ratio: number): Point3 {
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, z: a.z + (b.z - a.z) * ratio };
}

function routeAnchors(hoops: readonly Hoop[]): Hoop[] {
  const route = hoops.filter((hoop) => !hoop.decoy).slice().sort((a, b) => a.z - b.z || a.id - b.id);
  const first = route[0];
  if (first?.id === 1 && first.z > 0) {
    route.unshift({
      id: START_ROUTE_ID, type: 'standard', x: 0, y: START_Y_M, z: 0,
      radius: SPAWN_CORRIDOR_RADIUS_M, outline: first.outline, decoy: false,
      arrow: null, cleared: true,
    });
  }
  return route;
}

function sampleSortedRoute(route: readonly Hoop[], z: number): CorridorSample | null {
  if (route.length < 2) return null;
  for (let index = 0; index < route.length - 1; index++) {
    const from = route[index]!; const to = route[index + 1]!;
    if (z < from.z) return null;
    if (z > to.z) continue;
    const ratio = Math.max(0, Math.min(1, (z - from.z) / Math.max(COLLISION_EPSILON, to.z - from.z)));
    return {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
      radius: from.radius + (to.radius - from.radius) * ratio,
      segmentId: to.id,
    };
  }
  return null;
}

/** Interpolate the shared safe passage centerline and width at any longitudinal position. */
export function corridorAtZ(hoops: readonly Hoop[], z: number): CorridorSample | null {
  return sampleSortedRoute(routeAnchors(hoops), z);
}

/**
 * Sweeps each ship sphere through the continuous asteroid field. The interpolated
 * corridor is the only empty space; every point outside it is solid rock.
 */
export function sweptRockCollision(previous: PlaneState, current: PlaneState, hoops: readonly Hoop[]): RockCollision | null {
  const route = routeAnchors(hoops);
  if (route.length < 2) return null;
  let best: RockCollision | null = null;
  for (let sphereIndex = 0; sphereIndex < SHIP_COLLISION_SPHERES.length; sphereIndex++) {
    const sphere = SHIP_COLLISION_SPHERES[sphereIndex]!;
    const start = sphereCenter(previous, sphere); const end = sphereCenter(current, sphere);
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const steps = Math.max(1, Math.ceil(length / SWEEP_STEP_M));
    const expandedRadius = sphere.radius + length / (2 * steps) + COLLISION_EPSILON;
    for (let sampleIndex = 0; sampleIndex <= steps; sampleIndex++) {
      const time = sampleIndex / steps;
      if (best && time > best.time + COLLISION_EPSILON) break;
      const center = lerpPoint(start, end, time);
      const corridor = sampleSortedRoute(route, center.z);
      if (!corridor) continue;
      const reachesRock = Math.hypot(center.x - corridor.x, center.y - corridor.y) + expandedRadius >= corridor.radius - COLLISION_EPSILON;
      if (!reachesRock) continue;
      const candidate: RockCollision = { rockId: corridor.segmentId, time, impactPoint: center, sphereIndex };
      if (!best || candidate.time < best.time - COLLISION_EPSILON
        || (Math.abs(candidate.time - best.time) <= COLLISION_EPSILON && (candidate.rockId < best.rockId
          || (candidate.rockId === best.rockId && candidate.sphereIndex < best.sphereIndex)))) best = candidate;
      break;
    }
  }
  return best;
}

/** A checkpoint scores only after the full ship envelope has crossed its route station. */
export function holeExitTime(previous: PlaneState, current: PlaneState, hoop: Hoop): number | null {
  if (hoop.cleared) return null;
  const clearanceZ = hoop.z + MAX_SHIP_COLLISION_RADIUS_M;
  if (!(previous.z < clearanceZ && current.z >= clearanceZ)) return null;
  const ratio = (clearanceZ - previous.z) / Math.max(COLLISION_EPSILON, current.z - previous.z);
  const x = previous.x + (current.x - previous.x) * ratio;
  const y = previous.y + (current.y - previous.y) * ratio;
  return Math.hypot(x - hoop.x, y - hoop.y) + MAX_SHIP_COLLISION_RADIUS_M <= hoop.radius ? ratio : null;
}

export function holeExitCrossing(previous: PlaneState, current: PlaneState, hoop: Hoop): boolean {
  return holeExitTime(previous, current, hoop) !== null;
}
