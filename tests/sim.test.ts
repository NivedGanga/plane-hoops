import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_SIM_TICKS, ACCEPTANCE_OPTIMAL_CLEAR_FRACTION, ACCEPTANCE_RANDOM_CLEAR_MAX_FRACTION,
  FORWARD_SPEED_CAP_KMH, HALF_WIDTH_M, SIMULATION_HZ, START_FORWARD_SPEED_KMH, HOOP_CLEANUP_BEHIND_M,
  HOOP_MINIMUM_CLEARANCE_M, MAX_SHIP_COLLISION_RADIUS_M, ROCK_OUTLINE_POINTS,
  ROCK_THICKNESS_MIN_M, ROCK_THICKNESS_MAX_M, ROCK_COLLISION_LOOKAHEAD_M, HOOP_SPACING_MIN_M, HOOP_SPACING_MAX_M,
  HOST_HOOPS_AHEAD,
  SHUFFLE_INTERVAL_END_MIN_SECONDS, SHUFFLE_INTERVAL_END_MAX_SECONDS,
  SPEED_RAMP_SECONDS, LATERAL_ACCELERATION_MPS2, MAX_LATERAL_SPEED_MPS,
} from '../config/tuning';
import {
  SeededRandom, activateHoopEffect, createPlaneState, generateHoopBatch, hoopReachable,
  initialBindings, inputForSeat, isOutsideBounds, keysForSeat, controlsForSeat, shuffledBindings,
  startRound, stepRound, sweptHoopCrossing, sweptRockCollision, tickPhysics, discardHoopsBehind,
} from '../src/sim';
import type { Hoop, PilotInput, PlaneState } from '../src/sim';

const neutral: PilotInput = { up: false, down: false, left: false, right: false };
function testHoop(overrides: Partial<Hoop> = {}): Hoop {
  const radius = overrides.radius ?? 2;
  const outline = Array.from({ length: 24 }, (_, index) => {
    const angle = index * Math.PI * 2 / 24;
    return { x: Math.cos(angle) * (radius + 10), y: Math.sin(angle) * (radius + 10) };
  });
  return { id: 1, type: 'standard', x: 0, y: 45, z: 4, radius, thickness: 4, outline, decoy: false, arrow: null, cleared: false, ...overrides };
}

function activeCourseWindow(rocks: Hoop[], state: ReturnType<typeof startRound>, cursor: { index: number }): Hoop[] {
  let start = cursor.index;
  while (start < rocks.length && rocks[start]!.z + rocks[start]!.thickness / 2 + MAX_SHIP_COLLISION_RADIUS_M < state.z - HOOP_CLEANUP_BEHIND_M) start++;
  let end = start;
  const ahead = ROCK_COLLISION_LOOKAHEAD_M + ROCK_THICKNESS_MAX_M / 2 + MAX_SHIP_COLLISION_RADIUS_M;
  while (end < rocks.length && rocks[end]!.z - state.z <= ahead) end++;
  cursor.index = start;
  return rocks.slice(start, end);
}

function optimalPilotInput(state: PlaneState, target: Hoop, nextTarget: Hoop): PilotInput {
  const secondsToTarget = Math.max(1 / SIMULATION_HZ, (target.z - state.z) / (state.speedKmh / 3.6));
  const secondsBetweenTargets = Math.max(1 / SIMULATION_HZ, (nextTarget.z - target.z) / (state.speedKmh / 3.6));
  const steering = (error: number, velocity: number, nextDisplacement: number): number => {
    const plannedExitVelocity = nextDisplacement / secondsBetweenTargets;
    const desiredVelocity = Math.max(-MAX_LATERAL_SPEED_MPS, Math.min(MAX_LATERAL_SPEED_MPS, 2 * error / secondsToTarget - plannedExitVelocity));
    return desiredVelocity - velocity > 0.7 ? 1 : desiredVelocity - velocity < -0.7 ? -1 : 0;
  };
  const xCommand = steering(target.x - state.x, state.vx, nextTarget.x - target.x);
  const yCommand = steering(target.y - state.y, state.vy, nextTarget.y - target.y);
  const pull = state.tick + 1 < state.pullUntilTick ? state.pullDirection : null;
  const pullX = pull === 'right' ? 1 : pull === 'left' ? -1 : 0;
  const pullY = pull === 'up' ? 1 : pull === 'down' ? -1 : 0;
  const counterSteer = (desired: number, magnetic: number): number => {
    let best = 0; let error = Number.POSITIVE_INFINITY;
    for (const candidate of [-1, 0, 1]) {
      const candidateError = Math.abs(candidate + magnetic - desired);
      if (candidateError < error) { best = candidate; error = candidateError; }
    }
    return best;
  };
  const xInput = counterSteer(xCommand, pullX); const yInput = counterSteer(yCommand, pullY);
  return { right: xInput > 0, left: xInput < 0, up: yInput > 0, down: yInput < 0 };
}

describe('flight simulation', () => {
  it('holds difficulty progression to the 10-minute endpoint and tunes shuffle intervals to 10-14s', () => {
    const early = generateHoopBatch(new SeededRandom(17), { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 }, 0, 210, 1).hoops[0]!;
    const late = generateHoopBatch(new SeededRandom(17), { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 }, 600, 320, 1).hoops[0]!;
    expect(early.radius).toBe(9); expect(late.radius).toBe(5.5);
    expect(SHUFFLE_INTERVAL_END_MIN_SECONDS).toBe(10); expect(SHUFFLE_INTERVAL_END_MAX_SECONDS).toBe(14);
    let state = startRound();
    for (let i = 0; i < 600 * SIMULATION_HZ; i++) state = tickPhysics(state, neutral);
    expect(state.speedKmh).toBeCloseTo(FORWARD_SPEED_CAP_KMH, 8);
    expect(tickPhysics(state, neutral).speedKmh).toBeCloseTo(FORWARD_SPEED_CAP_KMH, 8);
  });

  it('runs a deterministic 30-minute bounded flight while maintaining a compact hoop buffer', () => {
    const simulate = (seed: number) => {
      let state = startRound();
      let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
      let random = new SeededRandom(seed); let hoops: Hoop[] = []; let generated = 0;
      for (let t = 0; t < 30 * 60 * SIMULATION_HZ; t++) {
        if (hoops.filter((hoop) => !hoop.decoy).length < 12) {
          const batch = generateHoopBatch(random, placement, state.elapsedSeconds, state.speedKmh, 10);
          hoops.push(...batch.hoops); placement = batch.placement;
          generated += batch.hoops.filter((hoop) => !hoop.decoy).length;
        }
        // This long run exercises flight physics and hoop cleanup; collision outcomes are tested separately.
        state = stepRound(state, neutral, []).state;
        hoops = discardHoopsBehind(hoops, state.z);
        if (state.phase !== 'playing') break;
      }
      return { state, hoops, generated };
    };
    const a = simulate(0x102030); const b = simulate(0x102030);
    expect(a.state.phase).toBe('playing'); expect(a.state.tick).toBe(108_000);
    expect(a.generated).toBeGreaterThan(800); expect(a.hoops.length).toBeLessThanOrEqual(32);
    expect(a.hoops.every((h) => h.z >= a.state.z - HOOP_CLEANUP_BEHIND_M)).toBe(true);
    expect(a.state).toEqual(b.state); expect(a.hoops).toEqual(b.hoops);
    expect(a.state.speedKmh).toBeCloseTo(FORWARD_SPEED_CAP_KMH, 8);
  });

  it('registers all four controls held simultaneously and ignores keys not owned by the seat', () => {
    for (const count of [2, 4] as const) {
      const bindings = initialBindings(count);
      for (let seat = 1; seat <= count; seat++) {
        const input = inputForSeat(bindings, seat, 0b1111);
        expect(Object.values(input).filter(Boolean)).toHaveLength(count === 2 ? 2 : 1);
      }
    }
  });

  it('keeps forward speed at or above 200 km/h for 10,000 ticks through pulls and shuffled controls', () => {
    let state = startRound(createPlaneState());
    let bindings = initialBindings(4);
    const random = new SeededRandom(0x51a7);
    for (let tick = 0; tick < ACCEPTANCE_SIM_TICKS; tick++) {
      if (tick % (SIMULATION_HZ * 13) === 0) bindings = shuffledBindings(4, random, bindings);
      const input = {
        up: random.next() < 0.2, down: random.next() < 0.2,
        left: random.next() < 0.2, right: random.next() < 0.2,
      };
      if (tick % 900 === 0) state = activateHoopEffect(state, testHoop({ id: tick, type: 'magnetic', radius: 10, arrow: 'left' }));
      state = tickPhysics(state, input);
      expect(state.speedKmh).toBeGreaterThanOrEqual(200);
      expect(state.speedKmh).toBeLessThanOrEqual(FORWARD_SPEED_CAP_KMH);
      expect(bindings.playerCount).toBe(4);
    }
  });

  it('treats the 300 by 200 metre outer envelope as a soft limit, never a crash boundary', () => {
    expect(isOutsideBounds({ x: -HALF_WIDTH_M, y: 45 })).toBe(false);
    expect(isOutsideBounds({ x: HALF_WIDTH_M, y: 45 })).toBe(false);
    expect(isOutsideBounds({ x: 0, y: -55 })).toBe(false);
    expect(isOutsideBounds({ x: 0, y: 145 })).toBe(false);
    expect(isOutsideBounds({ x: -150.001, y: 45 })).toBe(true);
    expect(isOutsideBounds({ x: 0, y: 145.001 })).toBe(true);
    let state: ReturnType<typeof startRound> = { ...startRound(), x: 149.5, vx: 21, phase: 'playing' };
    for (let tick = 0; tick < 900; tick++) {
      state = tickPhysics(state, { up: true, down: false, left: false, right: true });
      expect(state.phase).toBe('playing');
      expect(state.x).toBeLessThanOrEqual(HALF_WIDTH_M);
      expect(state.y).toBeLessThanOrEqual(145);
    }
    expect(state.x).toBeGreaterThan(120);
  });

  it('uses a swept segment check so a fast plane cannot skip a hoop', () => {
    const hoop = testHoop({ id: 1, x: 2, y: 48, z: 4 });
    expect(sweptHoopCrossing(0, 8, { x: 0, y: 45, z: 0 }, { x: 4, y: 51, z: 8 }, hoop)).toBe(true);
    expect(sweptHoopCrossing(0, 8, { x: 0, y: 45, z: 0 }, { x: 12, y: 45, z: 8 }, hoop)).toBe(false);
  });

  it('crashes only on rock contact, scores after a safe hole exit, and ignores a fully missed rock', () => {
    const rock = testHoop({ id: 1, z: 0.5, radius: 5.5 });
    let safeState = startRound(); let clearEvents = 0;
    for (let tick = 0; tick < 20 && !rock.cleared; tick++) {
      const result = stepRound(safeState, neutral, [rock]);
      expect(result.state.phase).toBe('playing');
      expect(result.collision).toBeNull();
      clearEvents += result.cleared.length; safeState = result.state;
    }
    expect(clearEvents).toBe(1);
    expect(safeState.score).toBe(10);

    const contactRock = testHoop({ id: 2, z: 0.5, radius: 5.5 });
    const contact = stepRound({ ...startRound(), x: 5.7 }, neutral, [contactRock]);
    expect(contact.collision?.rockId).toBe(contactRock.id);
    expect(contact.state.phase).toBe('ended');
    expect(contact.state.score).toBe(0);
    expect(contact.missed).toEqual([]);

    const farAwayRock = testHoop({ id: 3, z: 0.5, radius: 5.5 });
    const miss = stepRound({ ...startRound(), x: 40 }, neutral, [farAwayRock]);
    expect(miss.collision).toBeNull();
    expect(miss.state.phase).toBe('playing');
    expect(miss.state.score).toBe(0);
    expect(miss.missed).toEqual([]);
  });

  it('sweeps the compound hull continuously through thick slabs and picks the earliest stable rock id', () => {
    const from = { ...startRound(), z: -6, x: 5.7 };
    const to = { ...from, z: 6 };
    const safeFrom = { ...from, x: 0 };
    const safeTo = { ...to, x: 0 };
    const rock = testHoop({ id: 9, z: 0, radius: 5.5, thickness: 4 });
    expect(sweptRockCollision(from, to, [rock])?.time).toBeDefined();
    expect(sweptRockCollision(safeFrom, safeTo, [rock])).toBeNull();
    expect(sweptRockCollision(from, to, [rock, { ...rock, id: 2 }])?.rockId).toBe(2);
    expect(sweptRockCollision(from, to, [testHoop({ id: 10, z: 2000, radius: 5.5 })])).toBeNull();
  });

  it('detects all 10,000 random 320 km/h approaches to minimum-thickness solid rock faces', () => {
    const random = new SeededRandom(0x3204);
    const rock = testHoop({ id: 42, z: 100, radius: 5.5, thickness: ROCK_THICKNESS_MIN_M });
    const tickDistance = FORWARD_SPEED_CAP_KMH / 3.6 / SIMULATION_HZ;
    for (let approach = 0; approach < 10_000; approach++) {
      const from = { ...startRound(), x: 8.2 + random.next() * 0.3, y: 44.8 + random.next() * 0.4, z: rock.z - 4, speedKmh: FORWARD_SPEED_CAP_KMH };
      const to = { ...from, x: from.x + (random.next() - 0.5) * 0.12, y: from.y + (random.next() - 0.5) * 0.12, z: from.z + tickDistance, tick: 1 };
      expect(sweptRockCollision(from, to, [rock])?.rockId).toBe(rock.id);
    }
  });

  it('applies cooperative team scoring and booster/magnetic effects without changing forward speed', () => {
    const hoop = testHoop({ id: 1, type: 'booster', z: 0, radius: 10 });
    const boosted = activateHoopEffect(startRound(), hoop);
    expect(boosted.score).toBe(20);
    expect(boosted.boosterUntilTick).toBeGreaterThan(boosted.tick);
    const magnetic = activateHoopEffect(boosted, { ...hoop, type: 'magnetic', arrow: 'up' });
    expect(magnetic.score).toBe(25);
    expect(magnetic.pullDirection).toBe('up');
    expect(magnetic.speedKmh).toBe(boosted.speedKmh);
  });

  it('matches the specified initial seat key assignments and gives every key one owner', () => {
    const two = initialBindings(2);
    expect(keysForSeat(two, 1).sort()).toEqual(['KeyD', 'KeyW']);
    expect(keysForSeat(two, 2).sort()).toEqual(['KeyA', 'KeyS']);
    expect(inputForSeat(two, 1, 1 | 2 | 4 | 8)).toEqual({ up: true, down: false, left: true, right: false });
    const four = initialBindings(4);
    expect(keysForSeat(four, 1)).toEqual(['KeyS']);
    expect(keysForSeat(four, 2)).toEqual(['KeyW']);
    expect(keysForSeat(four, 3)).toEqual(['KeyD']);
    expect(keysForSeat(four, 4)).toEqual(['KeyA']);
    for (const seat of [1, 2, 3, 4]) expect(Object.values(inputForSeat(four, seat, 0b1111)).filter(Boolean)).toHaveLength(1);
  });

  it('provides the current direction-to-key mapping for each seat', () => {
    const two = initialBindings(2);
    expect(controlsForSeat(two, 1)).toEqual([{ direction: 'up', key: 'KeyW' }, { direction: 'left', key: 'KeyD' }]);
    expect(controlsForSeat(two, 2)).toEqual([{ direction: 'down', key: 'KeyS' }, { direction: 'right', key: 'KeyA' }]);
    const shuffled = shuffledBindings(2, new SeededRandom(23), two);
    for (const seat of [1, 2]) {
      const mapping = controlsForSeat(shuffled, seat);
      expect(mapping).toHaveLength(2);
      for (const { direction, key } of mapping) {
        expect(shuffled.directionSeat[direction]).toBe(seat);
        expect(shuffled.directionKey[direction]).toBe(key);
      }
    }
  });

  it('keeps shuffles different, seat-balanced, and based on a reproducible seed', () => {
    const aRandom = new SeededRandom(7123); const bRandom = new SeededRandom(7123);
    let a = initialBindings(2); let b = initialBindings(2);
    for (let i = 0; i < 12; i++) {
      const previous = a;
      a = shuffledBindings(2, aRandom, a); b = shuffledBindings(2, bRandom, b);
      expect(a).toEqual(b);
      expect(a).not.toEqual(previous);
      expect(keysForSeat(a, 1)).toHaveLength(2); expect(keysForSeat(a, 2)).toHaveLength(2);
      expect(new Set(Object.values(a.directionKey)).size).toBe(4);
    }
  });

  it('generates 1,000 primary holes with legal rock geometry and chain reachability', () => {
    const random = new SeededRandom(0xc0ffee);
    let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    let checked = 0;
    while (checked < 1000) {
      const batch = generateHoopBatch(random, placement, 95, 260, Math.min(10, 1000 - checked));
      let previousZ = placement.lastZ; let previous = placement.predicted;
      for (const hoop of batch.hoops.filter((item) => !item.decoy)) {
        expect(hoopReachable(previous, hoop, previousZ, 260)).toBe(true);
        expect(hoop.radius).toBeGreaterThanOrEqual(5.5);
        expect(hoop.radius).toBeLessThanOrEqual(9);
        expect(hoop.radius - MAX_SHIP_COLLISION_RADIUS_M).toBeGreaterThanOrEqual(HOOP_MINIMUM_CLEARANCE_M);
        expect(hoop.thickness).toBeGreaterThanOrEqual(ROCK_THICKNESS_MIN_M);
        expect(hoop.thickness).toBeLessThanOrEqual(ROCK_THICKNESS_MAX_M);
        expect(hoop.outline).toHaveLength(ROCK_OUTLINE_POINTS);
        expect(hoop.outline.every((point) => Math.hypot(point.x, point.y) > hoop.radius + 6)).toBe(true);
        if (previousZ > 0) expect(hoop.z - previousZ).toBeGreaterThanOrEqual(HOOP_SPACING_MIN_M);
        if (previousZ > 0) expect(hoop.z - previousZ).toBeLessThanOrEqual(HOOP_SPACING_MAX_M);
        if (hoop.type === 'magnetic') expect(['up', 'down', 'left', 'right']).toContain(hoop.arrow);
        previousZ = hoop.z; previous = { x: hoop.x, y: hoop.y, vx: 0, vy: 0 };
        checked++;
      }
      placement = batch.placement;
    }
  });

  it('increases side-rock density and shortens primary spacing across the first ten minutes', () => {
    const collect = (elapsedSeconds: number, speed: number) => {
      const random = new SeededRandom(0xdecafbad);
      let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
      const main: Hoop[] = []; const decoys: Hoop[] = [];
      while (main.length < 80) {
        const batch = generateHoopBatch(random, placement, elapsedSeconds, speed, Math.min(10, 80 - main.length));
        main.push(...batch.hoops.filter((hoop) => !hoop.decoy));
        decoys.push(...batch.hoops.filter((hoop) => hoop.decoy));
        placement = batch.placement;
      }
      return { main, decoys };
    };
    const early = collect(0, 210); const late = collect(600, 320);
    const averageSpacing = (course: Hoop[]) => course.slice(1).reduce((sum, hoop, index) => sum + hoop.z - course[index]!.z, 0) / (course.length - 1);
    expect(late.decoys.length).toBeGreaterThan(early.decoys.length * 2);
    expect(averageSpacing(late.main)).toBeLessThan(averageSpacing(early.main));
    for (const { main, decoys } of [early, late]) for (const decoy of decoys) {
      const target = main.find((hoop) => hoop.z === decoy.z)!;
      const centerSeparation = Math.hypot(decoy.x - target.x, decoy.y - target.y);
      const outerBound = Math.max(...decoy.outline.map((point) => Math.hypot(point.x, point.y)));
      expect(centerSeparation - outerBound - MAX_SHIP_COLLISION_RADIUS_M).toBeGreaterThan(0);
    }
  });

  it('keeps every reachable centerline clear of side-rock solids across 128 seeded layouts', () => {
    let checkedDecoys = 0;
    for (let seed = 1; seed <= 128; seed++) {
      const random = new SeededRandom(seed * 7919);
      const placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
      const batch = generateHoopBatch(random, placement, 600, 320, HOST_HOOPS_AHEAD);
      const primary = batch.hoops.filter((rock) => !rock.decoy);
      const decoys = batch.hoops.filter((rock) => rock.decoy);
      expect(primary).toHaveLength(HOST_HOOPS_AHEAD);
      let previous = placement.predicted; let previousZ = placement.lastZ;
      for (const target of primary) {
        expect(hoopReachable(previous, target, previousZ, 320)).toBe(true);
        previous = { x: target.x, y: target.y, vx: 0, vy: 0 }; previousZ = target.z;
      }
      for (const decoy of decoys) {
        const target = primary.find((rock) => rock.z === decoy.z)!;
        const outerBound = Math.max(...decoy.outline.map((point) => Math.hypot(point.x, point.y)));
        const closestCenterlineClearance = Math.hypot(decoy.x - target.x, decoy.y - target.y) - outerBound - MAX_SHIP_COLLISION_RADIUS_M;
        expect(closestCenterlineClearance).toBeGreaterThan(0);
        checkedDecoys++;
      }
    }
    expect(checkedDecoys).toBeGreaterThan(500);
  });

  it('optimal lookahead clears at least 95% while random held keys clear under 10% of a seeded 1,000-hoop course', () => {
    const courseRandom = new SeededRandom(941);
    let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    const course: Hoop[] = [];
    let courseElapsed = 0; let courseSpeed = START_FORWARD_SPEED_KMH;
    let mainCount = 0;
    while (mainCount < 1000) {
      const batch = generateHoopBatch(courseRandom, placement, courseElapsed, courseSpeed, 1);
      course.push(...batch.hoops);
      mainCount += batch.hoops.filter((hoop) => !hoop.decoy).length;
      const segmentDistance = batch.placement.lastZ - placement.lastZ;
      courseElapsed += segmentDistance / (courseSpeed / 3.6);
      courseSpeed = Math.min(FORWARD_SPEED_CAP_KMH, START_FORWARD_SPEED_KMH + (FORWARD_SPEED_CAP_KMH - START_FORWARD_SPEED_KMH) * Math.min(1, courseElapsed / SPEED_RAMP_SECONDS));
      placement = batch.placement;
    }
    // The optimal pilot brakes toward each center while following the speed-ramped route through main and decoy rocks.
    const optimalRocks = course.map((hoop) => ({ ...hoop, cleared: false }));
    let optimal = startRound(); let optimalHoops = optimalRocks.filter((hoop) => !hoop.decoy);
    const optimalWindow = { index: 0 };
    let targetIndex = 0; const optimalCleared = new Set<number>();
    while (targetIndex < optimalHoops.length && optimal.phase === 'playing') {
      const target = optimalHoops[targetIndex];
      if (!target) break;
      const nextTarget = optimalHoops[Math.min(targetIndex + 1, optimalHoops.length - 1)];
      if (!nextTarget) break;
      const input = optimalPilotInput(optimal, target, nextTarget);
      const result = stepRound(optimal, input, activeCourseWindow(optimalRocks, optimal, optimalWindow));
      for (const hoop of result.cleared) optimalCleared.add(hoop.id);
      optimal = result.state;
      while (targetIndex < optimalHoops.length && optimalHoops[targetIndex].cleared) targetIndex++;
      if (optimal.tick > 200_000) break;
    }
    const optimalRate = optimalCleared.size / 1000;
    const randomRocks = course.map((hoop) => ({ ...hoop, cleared: false }));
    let randomPilot = startRound(); const randomWindow = { index: 0 }; const random = new SeededRandom(1941);
    const randomCleared = new Set<number>();
    for (let tick = 0; tick < 28_000 && randomPilot.phase === 'playing'; tick++) {
      const result = stepRound(randomPilot, { up: random.next() < 0.5, down: random.next() < 0.5, left: random.next() < 0.5, right: random.next() < 0.5 }, activeCourseWindow(randomRocks, randomPilot, randomWindow));
      for (const hoop of result.cleared) randomCleared.add(hoop.id);
      randomPilot = result.state;
    }
    const randomRate = randomCleared.size / 1000;
    expect(optimalRate).toBeGreaterThanOrEqual(ACCEPTANCE_OPTIMAL_CLEAR_FRACTION);
    expect(randomRate).toBeLessThan(ACCEPTANCE_RANDOM_CLEAR_MAX_FRACTION);
  });

  it('flies an optimal generated course for 30 minutes without impact and keeps the collision window bounded', () => {
    const random = new SeededRandom(0x30f1);
    let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    let elapsed = 0; let speed = START_FORWARD_SPEED_KMH;
    const generated: Hoop[] = [];
    while (placement.lastZ < 210_000) {
      const previousZ = placement.lastZ;
      const batch = generateHoopBatch(random, placement, elapsed, speed, HOST_HOOPS_AHEAD);
      generated.push(...batch.hoops);
      const distance = batch.placement.lastZ - previousZ;
      elapsed += distance / (speed / 3.6);
      speed = Math.min(FORWARD_SPEED_CAP_KMH, START_FORWARD_SPEED_KMH + (FORWARD_SPEED_CAP_KMH - START_FORWARD_SPEED_KMH) * Math.min(1, elapsed / SPEED_RAMP_SECONDS));
      placement = batch.placement;
    }
    const rocks = generated.map((rock) => ({ ...rock, cleared: false }));
    const targets = rocks.filter((rock) => !rock.decoy);
    const cursor = { index: 0 }; let state = startRound(); let targetIndex = 0; let maximumActiveRocks = 0;
    for (let tick = 0; tick < 30 * 60 * SIMULATION_HZ; tick++) {
      while (targetIndex < targets.length && targets[targetIndex]!.cleared) targetIndex++;
      const target = targets[targetIndex]; const next = targets[Math.min(targetIndex + 1, targets.length - 1)];
      if (!target || !next) break;
      const active = activeCourseWindow(rocks, state, cursor);
      maximumActiveRocks = Math.max(maximumActiveRocks, active.length);
      state = stepRound(state, optimalPilotInput(state, target, next), active).state;
      if (state.phase !== 'playing') break;
    }
    const retiredRockCount = generated.filter((rock) => rock.z + rock.thickness / 2 + MAX_SHIP_COLLISION_RADIUS_M < state.z - HOOP_CLEANUP_BEHIND_M).length;
    expect(state.tick).toBe(30 * 60 * SIMULATION_HZ);
    expect(state.phase).toBe('playing');
    expect(maximumActiveRocks).toBeLessThan(32);
    expect(retiredRockCount).toBeGreaterThan(0);
  }, 20_000);
});
