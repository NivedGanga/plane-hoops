import type { BindingSet, Direction, KeyCode, PilotInput } from './types';
import type { RandomSource } from './random';

export const ALL_KEYS: KeyCode[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
export const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
export const KEY_BIT: Record<KeyCode, number> = { KeyW: 1, KeyA: 2, KeyS: 4, KeyD: 8 };

export function initialBindings(playerCount: 2 | 4): BindingSet {
  if (playerCount === 2) return {
    playerCount,
    directionSeat: { up: 1, down: 2, left: 1, right: 2 },
    directionKey: { up: 'KeyW', left: 'KeyD', down: 'KeyS', right: 'KeyA' },
  };
  return {
    playerCount,
    directionSeat: { up: 1, down: 2, left: 3, right: 4 },
    directionKey: { up: 'KeyS', down: 'KeyW', left: 'KeyD', right: 'KeyA' },
  };
}

export function keysForSeat(bindings: BindingSet, seat: number): KeyCode[] {
  return ALL_DIRECTIONS.filter((direction) => bindings.directionSeat[direction] === seat)
    .map((direction) => bindings.directionKey[direction]);
}

export function controlsForSeat(bindings: BindingSet, seat: number): { direction: Direction; key: KeyCode }[] {
  return ALL_DIRECTIONS.filter((direction) => bindings.directionSeat[direction] === seat)
    .map((direction) => ({ direction, key: bindings.directionKey[direction] }));
}

export function inputForSeat(bindings: BindingSet, seat: number, heldKeyMask: number): PilotInput {
  const input: PilotInput = { up: false, down: false, left: false, right: false };
  for (const direction of ALL_DIRECTIONS) {
    const code = bindings.directionKey[direction];
    if (bindings.directionSeat[direction] === seat && (heldKeyMask & KEY_BIT[code]) !== 0) input[direction] = true;
  }
  return input;
}

function shuffle<T>(items: T[], random: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function shuffledBindings(playerCount: 2 | 4, random: RandomSource, current: BindingSet): BindingSet {
  const seats: number[] = [];
  for (let seat = 1; seat <= playerCount; seat++) seats.push(seat);
  let next = current;
  for (let attempt = 0; attempt < 32 && sameBindings(next, current); attempt++) {
    const shuffledDirections = shuffle(ALL_DIRECTIONS, random);
    const shuffledKeys = shuffle(ALL_KEYS, random);
    const directionSeat = {} as Record<Direction, number>;
    const directionKey = {} as Record<Direction, KeyCode>;
    shuffledDirections.forEach((direction, index) => {
      directionSeat[direction] = playerCount === 2 ? seats[Math.floor(index / 2)] : seats[index];
      directionKey[direction] = shuffledKeys[index];
    });
    next = { playerCount, directionSeat, directionKey };
  }
  if (sameBindings(next, current)) {
    const directionSeat = { ...current.directionSeat };
    const directionKey = { ...current.directionKey };
    [directionKey.up, directionKey.down] = [directionKey.down, directionKey.up];
    next = { playerCount, directionSeat, directionKey };
  }
  return next;
}

export function sameBindings(a: BindingSet, b: BindingSet): boolean {
  return ALL_DIRECTIONS.every((direction) => a.directionSeat[direction] === b.directionSeat[direction] && a.directionKey[direction] === b.directionKey[direction]);
}

export function maskFromCodes(codes: Set<string>): number {
  let mask = 0;
  for (const key of ALL_KEYS) if (codes.has(key)) mask |= KEY_BIT[key];
  return mask;
}
