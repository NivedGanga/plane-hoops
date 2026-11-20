import { MAX_SHIP_COLLISION_RADIUS_M } from '../../config/tuning';
import type { Hoop, PlaneState, Vector2 } from './types';

export interface RockCollision {
  rockId: number;
  time: number;
  impactPoint: { x: number; y: number; z: number };
  sphereIndex: number;
}

interface CollisionSphere { x: number; y: number; z: number; radius: number }
interface Point3 { x: number; y: number; z: number }

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
const COLLISION_DISTANCE_M = 1500;

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

function distancePointSegmentSquared(point: Vector2, a: Vector2, b: Vector2): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const x = point.x - (a.x + ratio * dx); const y = point.y - (a.y + ratio * dy);
  return x * x + y * y;
}

function pointInPolygon(x: number, y: number, outline: readonly Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!; const b = outline[j]!;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function diskOverlapsPolygon(x: number, y: number, radius: number, outline: readonly Vector2[]): boolean {
  if (pointInPolygon(x, y, outline)) return true;
  const center = { x, y };
  const radiusSquared = radius * radius + COLLISION_EPSILON;
  for (let index = 0; index < outline.length; index++) {
    if (distancePointSegmentSquared(center, outline[index]!, outline[(index + 1) % outline.length]!) <= radiusSquared) return true;
  }
  return false;
}

function sphereTouchesSolidSlab(center: Point3, radius: number, rock: Hoop): boolean {
  const distanceOutsideFace = Math.max(0, Math.abs(center.z - rock.z) - rock.thickness / 2);
  if (distanceOutsideFace > radius + COLLISION_EPSILON) return false;
  const crossSectionRadius = Math.sqrt(Math.max(0, radius * radius - distanceOutsideFace * distanceOutsideFace));
  const x = center.x - rock.x; const y = center.y - rock.y;
  if (!diskOverlapsPolygon(x, y, crossSectionRadius, rock.outline)) return false;
  const fitsEntirelyThroughHole = Math.hypot(x, y) + crossSectionRadius < rock.radius - COLLISION_EPSILON;
  return !fitsEntirelyThroughHole;
}

function lerpPoint(a: Point3, b: Point3, ratio: number): Point3 {
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, z: a.z + (b.z - a.z) * ratio };
}

/**
 * Sweeps every ship sphere through each nearby static slab. Uniform substeps are
 * conservatively expanded by half a step, so a thin collision cannot fit between samples.
 */
export function sweptRockCollision(previous: PlaneState, current: PlaneState, rocks: readonly Hoop[]): RockCollision | null {
  let best: RockCollision | null = null;
  const nearbyRocks = rocks.filter((rock) => !rock.cleared
    && Math.abs(rock.z - current.z) <= COLLISION_DISTANCE_M + rock.thickness / 2 + MAX_SHIP_COLLISION_RADIUS_M);
  if (nearbyRocks.length === 0) return null;
  for (let sphereIndex = 0; sphereIndex < SHIP_COLLISION_SPHERES.length; sphereIndex++) {
    const sphere = SHIP_COLLISION_SPHERES[sphereIndex]!;
    const start = sphereCenter(previous, sphere); const end = sphereCenter(current, sphere);
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const steps = Math.max(1, Math.ceil(length / SWEEP_STEP_M));
    const expandedRadius = sphere.radius + length / (2 * steps) + COLLISION_EPSILON;
    for (const rock of nearbyRocks) {
      for (let sample = 0; sample <= steps; sample++) {
        const time = sample / steps;
        if (best && time > best.time + COLLISION_EPSILON) break;
        const center = lerpPoint(start, end, time);
        if (!sphereTouchesSolidSlab(center, expandedRadius, rock)) continue;
        const candidate: RockCollision = { rockId: rock.id, time, impactPoint: center, sphereIndex };
        if (!best || candidate.time < best.time - COLLISION_EPSILON
          || (Math.abs(candidate.time - best.time) <= COLLISION_EPSILON && (candidate.rockId < best.rockId
            || (candidate.rockId === best.rockId && candidate.sphereIndex < best.sphereIndex)))) best = candidate;
        break;
      }
    }
  }
  return best;
}

export function holeExitTime(previous: PlaneState, current: PlaneState, hoop: Hoop): number | null {
  if (hoop.cleared) return null;
  const clearanceZ = hoop.z + hoop.thickness / 2 + MAX_SHIP_COLLISION_RADIUS_M;
  if (!(previous.z < clearanceZ && current.z >= clearanceZ)) return null;
  const ratio = (clearanceZ - previous.z) / Math.max(COLLISION_EPSILON, current.z - previous.z);
  const x = previous.x + (current.x - previous.x) * ratio;
  const y = previous.y + (current.y - previous.y) * ratio;
  return Math.hypot(x - hoop.x, y - hoop.y) <= hoop.radius ? ratio : null;
}

export function holeExitCrossing(previous: PlaneState, current: PlaneState, hoop: Hoop): boolean {
  return holeExitTime(previous, current, hoop) !== null;
}
