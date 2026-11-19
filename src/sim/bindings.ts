import { KeyBinding, KeyCode, Direction, SeatId } from "./types";
import { SeededPRNG } from "./prng";
import { TUNING } from "../../config/tuning";

export function getInitialBindings(playerCount: 2 | 4): KeyBinding[] {
  if (playerCount === 2) {
    return [
      { key: "KeyW", direction: "up", seat: "P1" },
      { key: "KeyD", direction: "left", seat: "P1" },
      { key: "KeyS", direction: "down", seat: "P2" },
      { key: "KeyA", direction: "right", seat: "P2" },
    ];
  } else {
    return [
      { key: "KeyS", direction: "up", seat: "P1" },
      { key: "KeyW", direction: "down", seat: "P2" },
      { key: "KeyD", direction: "left", seat: "P3" },
      { key: "KeyA", direction: "right", seat: "P4" },
    ];
  }
}

// Check if two binding sets are identical
export function areBindingsEqual(a: KeyBinding[], b: KeyBinding[]): boolean {
  if (a.length !== b.length) return false;
  for (const b1 of a) {
    const match = b.find(
      (b2) => b2.key === b1.key && b2.direction === b1.direction && b2.seat === b1.seat
    );
    if (!match) return false;
  }
  return true;
}

// Generate new shuffled bindings that differ from the current bindings
export function generateNextBindings(
  current: KeyBinding[],
  playerCount: 2 | 4,
  prng: SeededPRNG
): KeyBinding[] {
  const directions: Direction[] = ["up", "down", "left", "right"];
  const keys: KeyCode[] = ["KeyW", "KeyA", "KeyS", "KeyD"];

  let attempts = 0;
  while (attempts++ < 100) {
    const shuffledKeys = prng.shuffle([...keys]);
    let candidate: KeyBinding[];

    if (playerCount === 2) {
      // 2 players: P1 gets 2 directions, P2 gets 2 directions
      const shuffledDirs = prng.shuffle([...directions]);
      candidate = [
        { key: shuffledKeys[0], direction: shuffledDirs[0], seat: "P1" },
        { key: shuffledKeys[1], direction: shuffledDirs[1], seat: "P1" },
        { key: shuffledKeys[2], direction: shuffledDirs[2], seat: "P2" },
        { key: shuffledKeys[3], direction: shuffledDirs[3], seat: "P2" },
      ];
    } else {
      // 4 players: P1, P2, P3, P4 each get 1 direction
      const shuffledDirs = prng.shuffle([...directions]);
      candidate = [
        { key: shuffledKeys[0], direction: shuffledDirs[0], seat: "P1" },
        { key: shuffledKeys[1], direction: shuffledDirs[1], seat: "P2" },
        { key: shuffledKeys[2], direction: shuffledDirs[2], seat: "P3" },
        { key: shuffledKeys[3], direction: shuffledDirs[3], seat: "P4" },
      ];
    }

    if (!areBindingsEqual(current, candidate)) {
      return candidate;
    }
  }

  // Fallback permutation if loop finishes
  return current.map((b, i) => ({
    ...b,
    direction: directions[(directions.indexOf(b.direction) + 1) % 4],
  }));
}

// Calculate the interval in ticks until the next shuffle warning
export function calculateNextShuffleIntervalTicks(
  currentTick: number,
  prng: SeededPRNG
): number {
  const elapsedSec = currentTick / TUNING.SIM_TICK_RATE;
  const progress = Math.min(1.0, elapsedSec / TUNING.SPEED_RAMP_DURATION_SEC);

  // Start interval: 12 to 20 s; End interval: 10 to 14 s
  const minSec =
    TUNING.SHUFFLE_START_MIN_SEC +
    (TUNING.SHUFFLE_END_MIN_SEC - TUNING.SHUFFLE_START_MIN_SEC) * progress;
  const maxSec =
    TUNING.SHUFFLE_START_MAX_SEC +
    (TUNING.SHUFFLE_END_MAX_SEC - TUNING.SHUFFLE_START_MAX_SEC) * progress;

  const intervalSec = prng.nextRange(minSec, maxSec);
  // Guarantee never within 8 seconds of each other
  const clampedSec = Math.max(TUNING.SHUFFLE_MIN_GAP_SEC, intervalSec);
  return Math.round(clampedSec * TUNING.SIM_TICK_RATE);
}
