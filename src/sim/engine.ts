import {
  SimState,
  PlaneState,
  EffectTimers,
  KeyBinding,
  ShuffleWarning,
  SeatId,
  InputBitmask,
  KEY_BITS,
  Direction,
  Hoop,
  RunEndReason,
  HoopType,
} from "./types";
import { SeededPRNG } from "./prng";
import { TUNING, kmhToMs } from "../../config/tuning";
import {
  getInitialBindings,
  generateNextBindings,
  calculateNextShuffleIntervalTicks,
} from "./bindings";
import { stepPlanePhysics, SteeringCommands, computeForwardSpeedKmh } from "./physics";
import { CourseGenerator, checkSweptHoop } from "./hoops";

export interface TickEvents {
  shuffleWarning?: ShuffleWarning;
  shuffleApplied?: KeyBinding[];
  hoopCleared?: { hoopId: number; type: HoopType; pointsAwarded: number };
  hoopMissed?: { hoopId: number };
  crashed?: boolean;
  newHoops?: Hoop[];
}

export class SimEngine {
  private prng: SeededPRNG;
  private courseGenerator: CourseGenerator;
  private state: SimState;

  constructor(seed: number, playerCount: 2 | 4) {
    this.prng = new SeededPRNG(seed);
    this.courseGenerator = new CourseGenerator(new SeededPRNG(seed + 1000));

    const initialBindings = getInitialBindings(playerCount);
    const startSpeedMs = kmhToMs(TUNING.START_SPEED_KMH);

    const initialPlane: PlaneState = {
      x: 0,
      y: (TUNING.PLAY_VOLUME_Y_MIN + TUNING.PLAY_VOLUME_Y_MAX) / 2,
      z: 0,
      vx: 0,
      vy: 0,
      vz: startSpeedMs,
      pitch: 0,
      yaw: 0,
      roll: 0,
    };

    const initialEffects: EffectTimers = {
      boostRemainingTicks: 0,
      magneticRemainingTicks: 0,
      magneticDirection: null,
    };

    const firstShuffleInterval = calculateNextShuffleIntervalTicks(0, this.prng);

    this.state = {
      tick: 0,
      plane: initialPlane,
      effects: initialEffects,
      bindings: initialBindings,
      nextShuffle: null,
      lastShuffleTick: 0,
      nextShuffleScheduleTick: firstShuffleInterval,
      hoops: [],
      clearedHoopsCount: 0,
      score: 0,
      distanceM: 0,
      isCrashed: false,
      runEndReason: null,
      prngSeed: seed,
      playerCount,
    };

    // Pre-populate initial course hoops ahead
    this.ensureHoopsAhead();
  }

  getState(): Readonly<SimState> {
    return this.state;
  }

  endRun(reason: RunEndReason): void {
    if (!this.state.runEndReason) {
      this.state.runEndReason = reason;
      if (reason === "crash") {
        this.state.isCrashed = true;
      }
    }
  }

  // Ensure hoops exist ahead of the plane
  private ensureHoopsAhead(): Hoop[] {
    const spawned: Hoop[] = [];
    const targetZ = this.state.plane.z + TUNING.HOOP_SPAWN_AHEAD_MAX_M;

    let maxZ = 0;
    if (this.state.hoops.length > 0) {
      maxZ = this.state.hoops[this.state.hoops.length - 1].z;
    }

    while (maxZ < targetZ) {
      const hoop = this.courseGenerator.generateNextHoop(this.state.tick);
      this.state.hoops.push(hoop);
      spawned.push(hoop);
      maxZ = hoop.z;
    }

    return spawned;
  }

  // Convert client input bitmasks into authoritative steering commands
  public resolveCommands(inputsBySeat: Map<SeatId, InputBitmask>): SteeringCommands {
    const commands: SteeringCommands = {
      up: false,
      down: false,
      left: false,
      right: false,
    };

    for (const binding of this.state.bindings) {
      const seatMask = inputsBySeat.get(binding.seat) ?? 0;
      const keyBit = KEY_BITS[binding.key];
      if ((seatMask & keyBit) !== 0) {
        commands[binding.direction] = true;
      }
    }

    return commands;
  }

  step(inputsBySeat: Map<SeatId, InputBitmask>): TickEvents {
    const events: TickEvents = {};

    if (this.state.isCrashed || this.state.runEndReason) {
      return events;
    }

    this.state.tick++;
    const currentTick = this.state.tick;

    // 1. Check if scheduled shuffle warning should trigger
    const warningTick =
      this.state.nextShuffleScheduleTick - TUNING.SHUFFLE_WARNING_TICKS;
    if (
      !this.state.nextShuffle &&
      currentTick >= warningTick &&
      currentTick - this.state.lastShuffleTick >= TUNING.SHUFFLE_MIN_GAP_TICKS
    ) {
      const nextBindings = generateNextBindings(
        this.state.bindings,
        this.state.playerCount,
        this.prng
      );
      this.state.nextShuffle = {
        warningTick: currentTick,
        effectiveTick: currentTick + TUNING.SHUFFLE_WARNING_TICKS,
        nextBindings,
      };
      events.shuffleWarning = this.state.nextShuffle;
    }

    // 2. Check if pending shuffle becomes effective
    if (
      this.state.nextShuffle &&
      currentTick >= this.state.nextShuffle.effectiveTick
    ) {
      this.state.bindings = this.state.nextShuffle.nextBindings;
      this.state.lastShuffleTick = currentTick;
      events.shuffleApplied = this.state.bindings;
      this.state.nextShuffle = null;

      // Schedule next shuffle interval
      const nextInterval = calculateNextShuffleIntervalTicks(currentTick, this.prng);
      this.state.nextShuffleScheduleTick = currentTick + nextInterval;
    }

    // 3. Resolve steering commands using authoritative bindings
    const commands = this.resolveCommands(inputsBySeat);

    // 4. Step physics
    const prevPlane = { ...this.state.plane };
    const stepResult = stepPlanePhysics(
      prevPlane,
      this.state.effects,
      commands,
      currentTick
    );

    this.state.plane = stepResult.plane;
    this.state.effects = stepResult.effects;
    this.state.distanceM = Math.round(this.state.plane.z);

    if (stepResult.crashed) {
      this.state.isCrashed = true;
      this.state.runEndReason = "crash";
      events.crashed = true;
      return events;
    }

    // 5. Check swept collisions for active hoops
    for (const hoop of this.state.hoops) {
      if (hoop.cleared || hoop.missed) continue;

      const swept = checkSweptHoop(hoop, prevPlane, this.state.plane);
      if (swept.crossed) {
        if (swept.cleared) {
          hoop.cleared = true;
          this.state.clearedHoopsCount++;

          let points: number = TUNING.HOOP_POINTS_STANDARD;
          if (hoop.type === "standard") {
            points = TUNING.HOOP_POINTS_STANDARD;
          } else if (hoop.type === "booster") {
            points = TUNING.HOOP_POINTS_BOOSTER;
            this.state.effects.boostRemainingTicks = Math.round(
              TUNING.BOOST_DURATION_SEC * TUNING.SIM_TICK_RATE
            );
          } else if (hoop.type === "magnetic") {
            points = TUNING.HOOP_POINTS_MAGNETIC;
            this.state.effects.magneticRemainingTicks = Math.round(
              TUNING.MAGNETIC_PULL_DURATION_SEC * TUNING.SIM_TICK_RATE
            );
            this.state.effects.magneticDirection = hoop.magneticDir || "left";
          }

          this.state.score += points;
          events.hoopCleared = {
            hoopId: hoop.id,
            type: hoop.type,
            pointsAwarded: points,
          };
        } else {
          hoop.missed = true;
          events.hoopMissed = { hoopId: hoop.id };
        }
      }
    }

    // 6. Discard hoops more than 200m behind plane
    const discardThresholdZ = this.state.plane.z - TUNING.HOOP_DISCARD_BEHIND_M;
    this.state.hoops = this.state.hoops.filter((h) => h.z >= discardThresholdZ);

    // 7. Ensure course generation ahead
    const newHoops = this.ensureHoopsAhead();
    if (newHoops.length > 0) {
      events.newHoops = newHoops;
    }

    return events;
  }
}
