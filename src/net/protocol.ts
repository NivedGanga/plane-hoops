import type { BindingSet, Hoop, PlaneState, RoundPhase, RoundSnapshot } from '../sim/types';

export type SignalData = RTCSessionDescriptionInit | RTCIceCandidateInit;
export type SignalingMessage =
  | { type: 'create-room'; maxPlayers: 2 | 4; localSeats: number; name: string }
  | { type: 'join-room'; roomCode: string; name: string }
  | { type: 'signal'; target: string; data: SignalData }
  | { type: 'room-status'; phase: RoundPhase }
  | { type: 'leave-room' };
export type SignalingEvent =
  | { type: 'room-created'; roomCode: string; maxPlayers: 2 | 4; localSeats: number; peerId: string }
  | { type: 'joined-room'; roomCode: string; seatId: number; maxPlayers: 2 | 4; localSeats: number; hostPeerId: string }
  | { type: 'peer-joined'; peerId: string; seatId: number; name: string }
  | { type: 'peer-left'; peerId: string; seatId: number }
  | { type: 'signal'; from: string; data: SignalData }
  | { type: 'room-closed' }
  | { type: 'error'; message: string };

export type GameEvent =
  | { type: 'round-start'; seed: number; bindings: BindingSet; tick: number }
  | { type: 'hoop-batch'; hoops: Hoop[] }
  | { type: 'shuffle-command'; bindings: BindingSet; effectiveTick: number; warningSeconds: number }
  | { type: 'hoop-cleared'; hoopId: number; hoopType: Hoop['type']; score: number; tick: number }
  | { type: 'booster-activated'; untilTick: number; score: number; tick: number }
  | { type: 'magnetic-activated'; direction: NonNullable<Hoop['arrow']>; untilTick: number; score: number; tick: number }
  | { type: 'crash'; tick: number; score: number; reason: 'crash' | 'missed_hoop'; distance: number; hoopsCleared: number }
  | { type: 'round-end'; score: number; tick: number; reason: 'host_ended' | 'connection_lost'; distance: number; hoopsCleared: number }
  | { type: 'leaderboard-updated' }
  | { type: 'seat-joined'; seatId: number; name: string }
  | { type: 'seat-left'; seatId: number }
  | { type: 'warning'; message: string; untilTick: number };

export interface InputPacket { type: 'input'; sequence: number; heldKeyMask: number; clientTick: number }
export interface StatePacket { type: 'state'; snapshot: RoundSnapshot; bindings: BindingSet; hoops: Hoop[] }
export function snapshotFromState(state: PlaneState, sequence: number): RoundSnapshot {
  return {
    tick: state.tick, sequence, x: state.x, y: state.y, z: state.z, vx: state.vx, vy: state.vy,
    headingX: state.headingX, headingY: state.headingY, speedKmh: state.speedKmh, score: state.score,
    phase: state.phase, elapsedSeconds: state.elapsedSeconds,
    boosterRemainingTicks: Math.max(0, state.boosterUntilTick - state.tick),
    pullRemainingTicks: Math.max(0, state.pullUntilTick - state.tick), pullDirection: state.pullDirection,
  };
}
