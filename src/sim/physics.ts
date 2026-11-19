import { PlaneState, EffectTimers } from "./types";
import { TUNING, kmhToMs } from "../../config/tuning";

export function computeForwardSpeedKmh(
  tick: number,
  boostRemainingTicks: number
): number {
  const elapsedSec = tick / TUNING.SIM_TICK_RATE;
  const rampProgress = Math.min(1.0, elapsedSec / TUNING.SPEED_RAMP_DURATION_SEC);
  let speedKmh =
    TUNING.START_SPEED_KMH +
    (TUNING.MAX_SPEED_KMH - TUNING.START_SPEED_KMH) * rampProgress;

  if (boostRemainingTicks > 0) {
    speedKmh += TUNING.BOOST_SPEED_KMH;
  }

  // Speed never drops below 200 km/h, capped at 320 km/h
  speedKmh = Math.max(TUNING.MIN_SPEED_KMH, Math.min(TUNING.MAX_SPEED_KMH, speedKmh));
  return speedKmh;
}

export interface SteeringCommands {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export function stepPlanePhysics(
  plane: PlaneState,
  effects: EffectTimers,
  commands: SteeringCommands,
  tick: number
): { plane: PlaneState; effects: EffectTimers; crashed: boolean } {
  const dt = TUNING.SIM_DT;

  // 1. Forward speed
  const speedKmh = computeForwardSpeedKmh(tick, effects.boostRemainingTicks);
  const vz = kmhToMs(speedKmh);

  // 2. Lateral & Vertical steering acceleration
  let ax = 0;
  let ay = 0;

  if (commands.left) ax -= TUNING.STEER_ACCEL;
  if (commands.right) ax += TUNING.STEER_ACCEL;
  if (commands.up) ay += TUNING.STEER_ACCEL;
  if (commands.down) ay -= TUNING.STEER_ACCEL;

  // 3. Magnetic pull effect
  if (effects.magneticRemainingTicks > 0 && effects.magneticDirection) {
    switch (effects.magneticDirection) {
      case "up":
        ay += TUNING.MAGNETIC_PULL_ACCEL;
        break;
      case "down":
        ay -= TUNING.MAGNETIC_PULL_ACCEL;
        break;
      case "left":
        ax -= TUNING.MAGNETIC_PULL_ACCEL;
        break;
      case "right":
        ax += TUNING.MAGNETIC_PULL_ACCEL;
        break;
    }
  }

  // 4. Inertia and settle-back drag
  let vx = plane.vx + (ax - plane.vx * TUNING.STEER_DRAG) * dt;
  let vy = plane.vy + (ay - plane.vy * TUNING.STEER_DRAG) * dt;

  // Clamp velocity
  vx = Math.max(-TUNING.STEER_MAX_VEL, Math.min(TUNING.STEER_MAX_VEL, vx));
  vy = Math.max(-TUNING.STEER_MAX_VEL, Math.min(TUNING.STEER_MAX_VEL, vy));

  // 5. Position integration
  const x = plane.x + vx * dt;
  const y = plane.y + vy * dt;
  const z = plane.z + vz * dt;

  // 6. Angular attitude / banking
  const pitch = Math.max(-0.4, Math.min(0.4, vy / vz));
  const yaw = Math.max(-0.35, Math.min(0.35, vx / vz));
  const roll = Math.max(-0.6, Math.min(0.6, -vx / TUNING.STEER_MAX_VEL));

  // 7. Decrement effect timers
  const nextBoostTicks = Math.max(0, effects.boostRemainingTicks - 1);
  const nextMagneticTicks = Math.max(0, effects.magneticRemainingTicks - 1);
  const nextMagneticDir = nextMagneticTicks > 0 ? effects.magneticDirection : null;

  // 8. Bounded play volume check
  const crashed =
    x < TUNING.PLAY_VOLUME_X_MIN ||
    x > TUNING.PLAY_VOLUME_X_MAX ||
    y < TUNING.PLAY_VOLUME_Y_MIN ||
    y > TUNING.PLAY_VOLUME_Y_MAX;

  return {
    plane: {
      x,
      y,
      z,
      vx,
      vy,
      vz,
      pitch,
      yaw,
      roll,
    },
    effects: {
      boostRemainingTicks: nextBoostTicks,
      magneticRemainingTicks: nextMagneticTicks,
      magneticDirection: nextMagneticDir,
    },
    crashed,
  };
}
