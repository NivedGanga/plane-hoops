import {
  InputBitmask,
  PlaneState,
  EffectTimers,
  KeyBinding,
  Hoop,
  RunEndReason,
  SeatId,
  HoopType,
} from "../sim/types";

// Input channel message (unreliable, unordered)
export interface ClientInputMsg {
  type: "input";
  seq: number;
  bits: InputBitmask;
}

// State snapshot channel message (20 Hz, unreliable, unordered)
export interface HostStateSnapshotMsg {
  type: "state";
  tick: number;
  seq: number;
  plane: PlaneState;
  effects: EffectTimers;
  score: number;
  clearedHoops: number;
  distanceM: number;
  isCrashed: boolean;
  runEndReason: RunEndReason | null;
}

// Events channel messages (reliable, ordered)
export interface RunStartEventMsg {
  type: "run_start";
  seed: number;
  playerCount: 2 | 4;
  startTick: number;
  startingBindings: KeyBinding[];
}

export interface HoopBatchEventMsg {
  type: "hoop_batch";
  hoops: Hoop[];
}

export interface ShuffleWarningEventMsg {
  type: "shuffle_warning";
  warningTick: number;
  effectiveTick: number;
  nextBindings: KeyBinding[];
}

export interface ShuffleAppliedEventMsg {
  type: "shuffle_applied";
  effectiveTick: number;
  bindings: KeyBinding[];
}

export interface HoopClearedEventMsg {
  type: "hoop_cleared";
  hoopId: number;
  hoopType: HoopType;
  points: number;
  totalScore: number;
}

export interface HoopMissedEventMsg {
  type: "hoop_missed";
  hoopId: number;
}

export interface CrashEventMsg {
  type: "crash";
  tick: number;
  distanceM: number;
  score: number;
  hoopsCleared: number;
}

export interface RunEndEventMsg {
  type: "run_end";
  reason: RunEndReason;
}

export interface PeerSeatInfo {
  seat: SeatId;
  displayName: string;
  isLocal: boolean;
  connected: boolean;
  uid?: string;
}

export interface PeerStateEventMsg {
  type: "peer_state";
  seats: PeerSeatInfo[];
}

export type NetEventMsg =
  | RunStartEventMsg
  | HoopBatchEventMsg
  | ShuffleWarningEventMsg
  | ShuffleAppliedEventMsg
  | HoopClearedEventMsg
  | HoopMissedEventMsg
  | CrashEventMsg
  | RunEndEventMsg
  | PeerStateEventMsg;
