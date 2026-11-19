import { Hoop, HoopType, Direction, PlaneState } from "./types";
import { SeededPRNG } from "./prng";
import { TUNING, kmhToMs } from "../../config/tuning";
import { computeForwardSpeedKmh } from "./physics";

export function computeHoopRadius(tick: number): number {
  const elapsedSec = tick / TUNING.SIM_TICK_RATE;
  const progress = Math.min(1.0, elapsedSec / TUNING.HOOP_RADIUS_RAMP_SEC);
  return (
    TUNING.HOOP_RADIUS_START_M -
    (TUNING.HOOP_RADIUS_START_M - TUNING.HOOP_RADIUS_END_M) * progress
  );
}

export function computeMagneticShare(tick: number): number {
  const elapsedSec = tick / TUNING.SIM_TICK_RATE;
  const progress = Math.min(1.0, elapsedSec / TUNING.SPEED_RAMP_DURATION_SEC);
  return (
    TUNING.MAGNETIC_SHARE_START +
    (TUNING.MAGNETIC_SHARE_END - TUNING.MAGNETIC_SHARE_START) * progress
  );
}

// Check swept intersection of plane trajectory with hoop ring plane
export function checkSweptHoop(
  hoop: Hoop,
  prevPlane: PlaneState,
  currPlane: PlaneState
): { crossed: boolean; cleared: boolean } {
  // Check if plane crossed hoop's Z plane in this step
  if (prevPlane.z < hoop.z && currPlane.z >= hoop.z) {
    const dz = currPlane.z - prevPlane.z;
    const t = dz > 0.0001 ? (hoop.z - prevPlane.z) / dz : 0;
    const xCross = prevPlane.x + t * (currPlane.x - prevPlane.x);
    const yCross = prevPlane.y + t * (currPlane.y - prevPlane.y);

    const dx = xCross - hoop.x;
    const dy = yCross - hoop.y;
    const distSq = dx * dx + dy * dy;
    const cleared = distSq <= hoop.radius * hoop.radius;

    return { crossed: true, cleared };
  }

  return { crossed: false, cleared: false };
}

export class CourseGenerator {
  private prng: SeededPRNG;
  private nextHoopId: number = 1;
  private lastHoop: Hoop | null = null;

  constructor(prng: SeededPRNG) {
    this.prng = prng;
  }

  // Generate the next hoop in the chain
  generateNextHoop(currentTick: number): Hoop {
    const id = this.nextHoopId++;
    const radius = computeHoopRadius(currentTick);

    // Spacing 120m to 220m
    const spacing = this.prng.nextRange(
      TUNING.HOOP_SPACING_MIN_M,
      TUNING.HOOP_SPACING_MAX_M
    );
    const prevZ = this.lastHoop ? this.lastHoop.z : 0;
    const prevX = this.lastHoop ? this.lastHoop.x : 0;
    const prevY = this.lastHoop
      ? this.lastHoop.y
      : (TUNING.PLAY_VOLUME_Y_MIN + TUNING.PLAY_VOLUME_Y_MAX) / 2;
    const hoopZ = prevZ + spacing;

    // Determine type
    const magShare = computeMagneticShare(currentTick);
    const roll = this.prng.next();
    let type: HoopType = "standard";
    let magneticDir: Direction | undefined = undefined;

    if (roll < magShare) {
      type = "magnetic";
      const dirs: Direction[] = ["up", "down", "left", "right"];
      magneticDir = dirs[this.prng.nextInt(0, 3)];
    } else if (roll < magShare + 0.2) {
      type = "booster";
    } else {
      type = "standard";
    }

    // Reachability calculation: exact kinematic envelope given STEER_ACCEL, STEER_DRAG, and STEER_MAX_VEL
    const currentSpeedMs = kmhToMs(computeForwardSpeedKmh(currentTick, 0));
    const arrivalTimeSec = spacing / currentSpeedMs;

    // Terminal velocity v_term = a / drag, clamped by STEER_MAX_VEL
    const vTerm = Math.min(
      TUNING.STEER_MAX_VEL,
      TUNING.STEER_ACCEL / TUNING.STEER_DRAG
    );
    // Analytic integral of dv/dt = a - k*v:
    // x(t) = vTerm * t - (vTerm / k) * (1 - exp(-k * t))
    const exactMaxDisp =
      vTerm * arrivalTimeSec -
      (vTerm / TUNING.STEER_DRAG) *
        (1 - Math.exp(-TUNING.STEER_DRAG * arrivalTimeSec));
    const maxDisplacement = Math.max(8.0, exactMaxDisp);

    // Chain feasibility: if previous hoop was magnetic, account for forced pull drift
    let driftX = 0;
    let driftY = 0;
    if (this.lastHoop?.type === "magnetic" && this.lastHoop.magneticDir) {
      const pullTime = Math.min(arrivalTimeSec, TUNING.MAGNETIC_PULL_DURATION_SEC);
      const pullDisp = 0.5 * TUNING.MAGNETIC_PULL_ACCEL * pullTime * pullTime;
      switch (this.lastHoop.magneticDir) {
        case "up":
          driftY += pullDisp;
          break;
        case "down":
          driftY -= pullDisp;
          break;
        case "left":
          driftX -= pullDisp;
          break;
        case "right":
          driftX += pullDisp;
          break;
      }
    }

    // Safety margins within volume
    const margin = radius + 2.0;
    const minX = TUNING.PLAY_VOLUME_X_MIN + margin;
    const maxX = TUNING.PLAY_VOLUME_X_MAX - margin;
    const minY = TUNING.PLAY_VOLUME_Y_MIN + margin;
    const maxY = TUNING.PLAY_VOLUME_Y_MAX - margin;

    // Attempt placement within 60% to 85% of envelope
    let bestX = prevX;
    let bestY = prevY;
    let found = false;

    for (let attempt = 0; attempt < 50; attempt++) {
      const envelopeFraction = this.prng.nextRange(
        TUNING.HOOP_REACHABILITY_ENVELOPE_MIN,
        TUNING.HOOP_REACHABILITY_ENVELOPE_MAX
      );
      const targetDisp = maxDisplacement * envelopeFraction;
      const angle = this.prng.nextRange(0, 2 * Math.PI);

      const candidateX = prevX + driftX + Math.cos(angle) * targetDisp;
      const candidateY = prevY + driftY + Math.sin(angle) * targetDisp;

      if (
        candidateX >= minX &&
        candidateX <= maxX &&
        candidateY >= minY &&
        candidateY <= maxY
      ) {
        bestX = candidateX;
        bestY = candidateY;
        found = true;
        break;
      }
    }

    // If no candidate fit within boundary margins, clamp safely
    if (!found) {
      bestX = Math.max(minX, Math.min(maxX, prevX + driftX));
      bestY = Math.max(minY, Math.min(maxY, prevY + driftY));
    }

    const hoop: Hoop = {
      id,
      z: hoopZ,
      x: bestX,
      y: bestY,
      radius,
      type,
      magneticDir,
    };

    this.lastHoop = hoop;
    return hoop;
  }
}
