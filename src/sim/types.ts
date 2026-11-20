export type Direction = 'up' | 'down' | 'left' | 'right';
export type KeyCode = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';
export type HoopType = 'standard' | 'booster' | 'magnetic';
export type PullDirection = Direction;
export type RoundPhase = 'lobby' | 'playing' | 'paused' | 'ended';

export interface Vector2 { x: number; y: number }
export interface PlaneState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  speedKmh: number;
  headingX: number;
  headingY: number;
  tick: number;
  elapsedSeconds: number;
  score: number;
  phase: RoundPhase;
  boosterUntilTick: number;
  pullUntilTick: number;
  pullDirection: PullDirection | null;
}
export interface Hoop {
  id: number;
  type: HoopType;
  x: number;
  y: number;
  z: number;
  radius: number;
  thickness: number;
  outline: Vector2[];
  decoy: boolean;
  arrow: PullDirection | null;
  cleared: boolean;
}
export interface BindingSet {
  playerCount: 2 | 4;
  directionSeat: Record<Direction, number>;
  directionKey: Record<Direction, KeyCode>;
}
export interface PilotInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface ReachState extends Vector2 { vx: number; vy: number }
export interface PlayBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface RoundSnapshot {
  tick: number;
  sequence: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  headingX: number;
  headingY: number;
  speedKmh: number;
  score: number;
  phase: RoundPhase;
  elapsedSeconds: number;
  boosterRemainingTicks: number;
  pullRemainingTicks: number;
  pullDirection: PullDirection | null;
}
