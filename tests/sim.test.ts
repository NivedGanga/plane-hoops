import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_SIM_TICKS, ACCEPTANCE_OPTIMAL_CLEAR_FRACTION, ACCEPTANCE_RANDOM_CLEAR_MAX_FRACTION,
  FORWARD_SPEED_CAP_KMH, HALF_WIDTH_M, SIMULATION_HZ, START_FORWARD_SPEED_KMH, HOOP_CLEANUP_BEHIND_M,
  SHUFFLE_INTERVAL_END_MIN_SECONDS, SHUFFLE_INTERVAL_END_MAX_SECONDS,
  SPEED_RAMP_SECONDS, LATERAL_ACCELERATION_MPS2, MAX_LATERAL_SPEED_MPS,
} from '../config/tuning';
import {
  SeededRandom, activateHoopEffect, createPlaneState, generateHoopBatch, hoopReachable,
  initialBindings, inputForSeat, isOutsideBounds, keysForSeat, shuffledBindings,
  startRound, stepRound, sweptHoopCrossing, tickPhysics, discardHoopsBehind,
} from '../src/sim';
import type { Hoop, PilotInput } from '../src/sim';

const neutral: PilotInput = { up: false, down: false, left: false, right: false };

describe('flight simulation', () => {
  it('holds difficulty progression to the 10-minute endpoint and tunes shuffle intervals to 10-14s', () => {
    const early = generateHoopBatch(new SeededRandom(17), { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 }, 0, 210, 1).hoops[0]!;
    const late = generateHoopBatch(new SeededRandom(17), { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 }, 600, 320, 1).hoops[0]!;
    expect(early.radius).toBe(10); expect(late.radius).toBe(6);
    expect(SHUFFLE_INTERVAL_END_MIN_SECONDS).toBe(10); expect(SHUFFLE_INTERVAL_END_MAX_SECONDS).toBe(14);
    let state = startRound();
    for (let i = 0; i < 600 * SIMULATION_HZ; i++) state = tickPhysics(state, neutral);
    expect(state.speedKmh).toBeCloseTo(FORWARD_SPEED_CAP_KMH, 8);
    expect(tickPhysics(state, neutral).speedKmh).toBeCloseTo(FORWARD_SPEED_CAP_KMH, 8);
  });

  it('runs a deterministic 30-minute bounded course and removes hoops over 200m behind', () => {
    const simulate = (seed: number) => {
      let state = startRound();
      let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
      let random = new SeededRandom(seed); let hoops: Hoop[] = []; let generated = 0;
      for (let t = 0; t < 30 * 60 * SIMULATION_HZ; t++) {
        if (hoops.length < 12) {
          const batch = generateHoopBatch(random, placement, state.elapsedSeconds, state.speedKmh, 10);
          hoops.push(...batch.hoops); placement = batch.placement; generated += batch.hoops.length;
        }
        state = stepRound(state, neutral, hoops).state;
        hoops = discardHoopsBehind(hoops, state.z);
        if (state.phase !== 'playing') break;
      }
      return { state, hoops, generated };
    };
    const a = simulate(0x102030); const b = simulate(0x102030);
    expect(a.state.phase).toBe('playing'); expect(a.state.tick).toBe(108_000);
    expect(a.generated).toBeGreaterThan(800); expect(a.hoops.length).toBeLessThanOrEqual(20);
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
      if (tick % 900 === 0) state = activateHoopEffect(state, { id: tick, type: 'magnetic', x: 0, y: 45, z: 0, radius: 10, arrow: 'left', cleared: false });
      state = tickPhysics(state, input);
      expect(state.speedKmh).toBeGreaterThanOrEqual(200);
      expect(state.speedKmh).toBeLessThanOrEqual(FORWARD_SPEED_CAP_KMH);
      expect(bindings.playerCount).toBe(4);
    }
  });

  it('crashes only after crossing any play-volume boundary', () => {
    expect(isOutsideBounds({ x: -HALF_WIDTH_M, y: 45 })).toBe(false);
    expect(isOutsideBounds({ x: HALF_WIDTH_M, y: 45 })).toBe(false);
    expect(isOutsideBounds({ x: 0, y: 10 })).toBe(false);
    expect(isOutsideBounds({ x: 0, y: 90 })).toBe(false);
    for (const point of [{ x: -80.001, y: 45 }, { x: 80.001, y: 45 }, { x: 0, y: 9.999 }, { x: 0, y: 90.001 }]) {
      expect(isOutsideBounds(point)).toBe(true);
    }
    const state = { ...startRound(), x: 79.9, vx: 16, phase: 'playing' as const };
    expect(tickPhysics(state, neutral).phase).toBe('ended');
    expect(tickPhysics({ ...state, x: 79.5, vx: 0 }, neutral).phase).toBe('playing');
  });

  it('uses a swept segment check so a fast plane cannot skip a hoop', () => {
    const hoop: Hoop = { id: 1, type: 'standard', x: 2, y: 48, z: 4, radius: 2, arrow: null, cleared: false };
    expect(sweptHoopCrossing(0, 8, { x: 0, y: 45, z: 0 }, { x: 4, y: 51, z: 8 }, hoop)).toBe(true);
    expect(sweptHoopCrossing(0, 8, { x: 0, y: 45, z: 0 }, { x: 12, y: 45, z: 8 }, hoop)).toBe(false);
  });

  it('applies cooperative team scoring and booster/magnetic effects without changing forward speed', () => {
    const hoop: Hoop = { id: 1, type: 'booster', x: 0, y: 45, z: 0, radius: 10, arrow: null, cleared: false };
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

  it('generates 1,000 hoops that pass the placement and chain reachability test', () => {
    const random = new SeededRandom(0xc0ffee);
    let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    let checked = 0;
    while (checked < 1000) {
      const batch = generateHoopBatch(random, placement, 95, 260, Math.min(10, 1000 - checked));
      let previousZ = placement.lastZ; let previous = placement.predicted;
      for (const hoop of batch.hoops) {
        expect(hoopReachable(previous, hoop, previousZ, 260)).toBe(true);
        expect(hoop.radius).toBeGreaterThanOrEqual(6);
        expect(hoop.radius).toBeLessThanOrEqual(10);
        if (hoop.type === 'magnetic') expect(['up', 'down', 'left', 'right']).toContain(hoop.arrow);
        previousZ = hoop.z; previous = { x: hoop.x, y: hoop.y, vx: 0, vy: 0 };
        checked++;
      }
      placement = batch.placement;
    }
  });

  it('optimal lookahead clears at least 95% while random held keys clear under 10% of a seeded 1,000-hoop course', () => {
    const courseRandom = new SeededRandom(941);
    let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    const course: Hoop[] = [];
    let courseElapsed = 0; let courseSpeed = START_FORWARD_SPEED_KMH;
    while (course.length < 1000) {
      const batch = generateHoopBatch(courseRandom, placement, courseElapsed, courseSpeed, 1);
      course.push(...batch.hoops);
      const segmentDistance = batch.placement.lastZ - placement.lastZ;
      courseElapsed += segmentDistance / (courseSpeed / 3.6);
      courseSpeed = Math.min(FORWARD_SPEED_CAP_KMH, START_FORWARD_SPEED_KMH + (FORWARD_SPEED_CAP_KMH - START_FORWARD_SPEED_KMH) * Math.min(1, courseElapsed / SPEED_RAMP_SECONDS));
      placement = batch.placement;
    }
    // The optimal pilot brakes toward each center while following the speed-ramped route.
    let optimal = startRound(); let optimalHoops = course.map((hoop) => ({ ...hoop, cleared: false }));
    let targetIndex = 0; const optimalCleared = new Set<number>();
    while (targetIndex < optimalHoops.length && optimal.phase === 'playing') {
      const target = optimalHoops[targetIndex];
      if (!target) break;
      const nextTarget = optimalHoops[Math.min(targetIndex + 1, optimalHoops.length - 1)];
      if (!nextTarget) break;
      const secondsToTarget = Math.max(1 / SIMULATION_HZ, (target.z - optimal.z) / (optimal.speedKmh / 3.6));
      const secondsBetweenTargets = Math.max(1 / SIMULATION_HZ, (nextTarget.z - target.z) / (optimal.speedKmh / 3.6));
      const steering = (error: number, velocity: number, nextDisplacement: number): number => {
        const plannedExitVelocity = nextDisplacement / secondsBetweenTargets;
        const desiredVelocity = Math.max(-MAX_LATERAL_SPEED_MPS, Math.min(MAX_LATERAL_SPEED_MPS, 2 * error / secondsToTarget - plannedExitVelocity));
        return desiredVelocity - velocity > 0.7 ? 1 : desiredVelocity - velocity < -0.7 ? -1 : 0;
      };
      const xCommand = steering(target.x - optimal.x, optimal.vx, nextTarget.x - target.x);
      const yCommand = steering(target.y - optimal.y, optimal.vy, nextTarget.y - target.y);
      const pullActive = optimal.tick + 1 < optimal.pullUntilTick ? optimal.pullDirection : null;
      const pullX = pullActive === 'right' ? 1 : pullActive === 'left' ? -1 : 0;
      const pullY = pullActive === 'up' ? 1 : pullActive === 'down' ? -1 : 0;
      const counterSteer = (desired: number, pull: number): number => {
        let best = 0; let error = Number.POSITIVE_INFINITY;
        for (const candidate of [-1, 0, 1]) {
          const candidateError = Math.abs(candidate + pull - desired);
          if (candidateError < error) { best = candidate; error = candidateError; }
        }
        return best;
      };
      const xInput = counterSteer(xCommand, pullX); const yInput = counterSteer(yCommand, pullY);
      const input: PilotInput = {
        right: xInput > 0, left: xInput < 0, up: yInput > 0, down: yInput < 0,
      };
      const result = stepRound(optimal, input, optimalHoops);
      for (const hoop of result.cleared) optimalCleared.add(hoop.id);
      optimal = result.state;
      while (targetIndex < optimalHoops.length && optimalHoops[targetIndex].cleared) targetIndex++;
      if (optimal.tick > 200_000) break;
    }
    const optimalRate = optimalCleared.size / 1000;
    let randomPilot = startRound(); const randomHoops = course.map((hoop) => ({ ...hoop, cleared: false })); const random = new SeededRandom(1941);
    const randomCleared = new Set<number>();
    for (let tick = 0; tick < 28_000 && randomPilot.phase === 'playing'; tick++) {
      const result = stepRound(randomPilot, { up: random.next() < 0.5, down: random.next() < 0.5, left: random.next() < 0.5, right: random.next() < 0.5 }, randomHoops);
      for (const hoop of result.cleared) randomCleared.add(hoop.id);
      randomPilot = result.state;
    }
    const randomRate = randomCleared.size / 1000;
    expect(optimalRate).toBeGreaterThanOrEqual(ACCEPTANCE_OPTIMAL_CLEAR_FRACTION);
    expect(randomRate).toBeLessThan(ACCEPTANCE_RANDOM_CLEAR_MAX_FRACTION);
  });
});
