// Simulation types and interfaces

export type Direction = "up" | "down" | "left" | "right";

export type HoopType = "standard" | "booster" | "magnetic";

export interface PlaneState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number; // m/s forward speed
  pitch: number; // radians
  yaw: number;
  roll: number;
}

export interface EffectTimers {
  boostRemainingTicks: number;
  magneticRemainingTicks: number;
  magneticDirection: Direction | null;
}

export interface Hoop {
  id: number;
  z: number;
  x: number;
  y: number;
  radius: number;
  type: HoopType;
  magneticDir?: Direction;
  cleared?: boolean;
  missed?: boolean;
}

export type KeyCode = "KeyW" | "KeyA" | "KeyS" | "KeyD";

export const KEY_BITS: Record<KeyCode, number> = {
  KeyW: 1 << 0,
  KeyA: 1 << 1,
  KeyS: 1 << 2,
  KeyD: 1 << 3,
};

// Bit 0: W, Bit 1: A, Bit 2: S, Bit 3: D
export type InputBitmask = number;

export type SeatId = "P1" | "P2" | "P3" | "P4";

export interface KeyBinding {
  key: KeyCode;
  direction: Direction;
  seat: SeatId;
}

export interface RoomBindings {
  bindings: KeyBinding[];
  version: number;
  effectiveTick: number;
}

export interface ShuffleWarning {
  warningTick: number;
  effectiveTick: number;
  nextBindings: KeyBinding[];
}

export type RunEndReason = "crash" | "host_ended" | "connection_lost";

export interface SimState {
  tick: number;
  plane: PlaneState;
  effects: EffectTimers;
  bindings: KeyBinding[];
  nextShuffle?: ShuffleWarning | null;
  lastShuffleTick: number;
  nextShuffleScheduleTick: number;
  hoops: Hoop[];
  clearedHoopsCount: number;
  score: number;
  distanceM: number;
  isCrashed: boolean;
  runEndReason: RunEndReason | null;
  prngSeed: number;
  playerCount: 2 | 4;
}
