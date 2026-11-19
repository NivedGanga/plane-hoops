import { describe, it, expect } from "vitest";
import { SimEngine } from "../../src/sim/engine";
import { TUNING, kmhToMs, msToKmh } from "../../config/tuning";
import { SeatId, InputBitmask, KEY_BITS } from "../../src/sim/types";
import { SeededPRNG } from "../../src/sim/prng";
import { stepPlanePhysics } from "../../src/sim/physics";

describe("Simulation Unit & Acceptance Tests", () => {
  it("Acceptance 1: 30 simulated minutes (108,000 ticks) endless run with autopilot", () => {
    const seed = 42;
    const engine = new SimEngine(seed, 2);

    // Run for 108,000 ticks (30 minutes at 60 Hz)
    const totalTicks = 108000;
    const inputs = new Map<SeatId, InputBitmask>();

    for (let tick = 0; tick < totalTicks; tick++) {
      const s = engine.getState();
      const currentHoop = s.hoops.find((h) => !h.cleared && !h.missed);

      let maskP1 = 0;
      let maskP2 = 0;

      if (currentHoop) {
        // Lead-compensated PD control toward hoop center
        const leadTime = 0.4;
        const predX = s.plane.x + s.plane.vx * leadTime;
        const predY = s.plane.y + s.plane.vy * leadTime;
        const dx = currentHoop.x - predX;
        const dy = currentHoop.y - predY;

        for (const b of s.bindings) {
          if (b.direction === "up" && dy > 0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
          if (b.direction === "down" && dy < -0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
          if (b.direction === "left" && dx < -0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
          if (b.direction === "right" && dx > 0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
        }
      }

      inputs.set("P1", maskP1);
      inputs.set("P2", maskP2);

      engine.step(inputs);

      // Verify hoop list memory stays bounded (discarding hoops > 200m behind)
      if (tick % 1000 === 0) {
        expect(s.hoops.length).toBeLessThan(30);
      }
    }

    const finalState = engine.getState();
    expect(finalState.isCrashed).toBe(false);
    expect(finalState.runEndReason).toBeNull();
    // 30 min at ~300 km/h is ~150,000 meters
    expect(finalState.distanceM).toBeGreaterThan(100_000);
    expect(finalState.clearedHoopsCount).toBeGreaterThan(100);

    // Difficulty holds at max after minute 10 (36,000 ticks)
    const speedAt30Min = msToKmh(finalState.plane.vz);
    expect(speedAt30Min).toBeLessThanOrEqual(TUNING.MAX_SPEED_KMH + 0.1);
  });

  it("Acceptance 2: Over 10,000 simulated ticks, speed never falls below 200 km/h", () => {
    const prng = new SeededPRNG(12345);
    const engine = new SimEngine(999, 4);

    for (let tick = 0; tick < 10000; tick++) {
      const inputs = new Map<SeatId, InputBitmask>();
      // Random input bits (0 to 15)
      inputs.set("P1", prng.nextInt(0, 15));
      inputs.set("P2", prng.nextInt(0, 15));
      inputs.set("P3", prng.nextInt(0, 15));
      inputs.set("P4", prng.nextInt(0, 15));

      engine.step(inputs);

      const s = engine.getState();
      const speedKmh = msToKmh(s.plane.vz);
      expect(speedKmh).toBeGreaterThanOrEqual(TUNING.MIN_SPEED_KMH - 0.001);
      expect(speedKmh).toBeLessThanOrEqual(TUNING.MAX_SPEED_KMH + 0.001);
    }
  });

  it("Acceptance 3: Crash fires exactly when plane leaves play volume, and never otherwise", () => {
    const planeInside = {
      x: 0,
      y: 65,
      z: 0,
      vx: 0,
      vy: 0,
      vz: kmhToMs(210),
      pitch: 0,
      yaw: 0,
      roll: 0,
    };
    const effects = {
      boostRemainingTicks: 0,
      magneticRemainingTicks: 0,
      magneticDirection: null,
    };
    const noCommands = { up: false, down: false, left: false, right: false };

    // Inside volume
    const res1 = stepPlanePhysics(planeInside, effects, noCommands, 0);
    expect(res1.crashed).toBe(false);

    // Left wall breach (x < PLAY_VOLUME_X_MIN)
    const planeLeft = { ...planeInside, x: TUNING.PLAY_VOLUME_X_MIN - 1 };
    expect(stepPlanePhysics(planeLeft, effects, noCommands, 0).crashed).toBe(true);

    // Right wall breach (x > PLAY_VOLUME_X_MAX)
    const planeRight = { ...planeInside, x: TUNING.PLAY_VOLUME_X_MAX + 1 };
    expect(stepPlanePhysics(planeRight, effects, noCommands, 0).crashed).toBe(true);

    // Ground breach (y < PLAY_VOLUME_Y_MIN)
    const planeGround = { ...planeInside, y: TUNING.PLAY_VOLUME_Y_MIN - 1 };
    expect(stepPlanePhysics(planeGround, effects, noCommands, 0).crashed).toBe(true);

    // Ceiling breach (y > PLAY_VOLUME_Y_MAX)
    const planeCeiling = { ...planeInside, y: TUNING.PLAY_VOLUME_Y_MAX + 1 };
    expect(stepPlanePhysics(planeCeiling, effects, noCommands, 0).crashed).toBe(true);
  });

  it("Acceptance 4: Reachability and clearance rates (optimal > 95%, random < 10%)", () => {
    // 1. Scripted pilot using optimal steering input with PD control
    const optimalEngine = new SimEngine(777, 2);
    let hoopsEncountered = 0;
    const inputs = new Map<SeatId, InputBitmask>();

    for (let tick = 0; tick < 50000 && hoopsEncountered < 100; tick++) {
      const s = optimalEngine.getState();
      const currentHoop = s.hoops.find((h) => !h.cleared && !h.missed);

      let maskP1 = 0;
      let maskP2 = 0;

      if (currentHoop) {
        const leadTime = 0.45;
        const predX = s.plane.x + s.plane.vx * leadTime;
        const predY = s.plane.y + s.plane.vy * leadTime;
        const dx = currentHoop.x - predX;
        const dy = currentHoop.y - predY;

        for (const b of s.bindings) {
          if (b.direction === "up" && dy > 0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
          if (b.direction === "down" && dy < -0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
          if (b.direction === "left" && dx < -0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
          if (b.direction === "right" && dx > 0.1) {
            if (b.seat === "P1") maskP1 |= KEY_BITS[b.key];
            if (b.seat === "P2") maskP2 |= KEY_BITS[b.key];
          }
        }
      }

      inputs.set("P1", maskP1);
      inputs.set("P2", maskP2);

      const events = optimalEngine.step(inputs);
      if (events.hoopCleared || events.hoopMissed) {
        hoopsEncountered++;
      }
    }

    const optimalState = optimalEngine.getState();
    const optimalClearRate = optimalState.clearedHoopsCount / hoopsEncountered;
    expect(optimalClearRate).toBeGreaterThanOrEqual(0.95);

    // 2. Random input pilot
    const randomEngine = new SimEngine(777, 2);
    const prng = new SeededPRNG(54321);
    let randomHoopsEncountered = 0;

    for (let tick = 0; tick < 25000 && randomHoopsEncountered < 50; tick++) {
      inputs.set("P1", prng.nextInt(0, 15));
      inputs.set("P2", prng.nextInt(0, 15));

      const events = randomEngine.step(inputs);
      if (events.hoopCleared || events.hoopMissed) {
        randomHoopsEncountered++;
      }
    }

    const randomState = randomEngine.getState();
    const randomClearRate = randomState.clearedHoopsCount / Math.max(1, randomHoopsEncountered);
    expect(randomClearRate).toBeLessThan(0.10);
  });

  it("Acceptance 7: Shuffles show 3s warning, apply at effectiveTick, gap >= 8s", () => {
    const engine = new SimEngine(101, 2);
    const inputs = new Map<SeatId, InputBitmask>();

    let lastShuffleAppliedTick = 0;
    let warningsReceived = 0;
    let shufflesApplied = 0;

    for (let tick = 0; tick < 20000; tick++) {
      const events = engine.step(inputs);

      if (events.shuffleWarning) {
        warningsReceived++;
        expect(events.shuffleWarning.effectiveTick).toBe(
          events.shuffleWarning.warningTick + TUNING.SHUFFLE_WARNING_TICKS
        );
      }

      if (events.shuffleApplied) {
        shufflesApplied++;
        const currentTick = engine.getState().tick;

        if (lastShuffleAppliedTick > 0) {
          const gapTicks = currentTick - lastShuffleAppliedTick;
          expect(gapTicks).toBeGreaterThanOrEqual(TUNING.SHUFFLE_MIN_GAP_TICKS);
        }
        lastShuffleAppliedTick = currentTick;
      }
    }

    expect(warningsReceived).toBeGreaterThan(0);
    expect(shufflesApplied).toBeGreaterThan(0);
    expect(warningsReceived).toBe(shufflesApplied);
  });
});
