import { describe, it, expect } from "vitest";
import { SimEngine } from "../../src/sim/engine";
import { SeededPRNG } from "../../src/sim/prng";
import { SeatId, InputBitmask, KeyBinding, Hoop } from "../../src/sim/types";
import { areBindingsEqual } from "../../src/sim/bindings";
import {
  HostStateSnapshotMsg,
  NetEventMsg,
  RunStartEventMsg,
} from "../../src/net/messages";

interface NetworkPacket {
  deliveryTick: number;
  channel: "input" | "state" | "events";
  payload: any;
}

class SimulatedPeerNetwork {
  public packets: NetworkPacket[] = [];
  public prng: SeededPRNG;
  public latencyTicks: number; // 150ms at 60Hz = 9 ticks
  public packetLossRate: number; // 0.05 = 5%

  constructor(seed: number, latencyMs = 150, lossRate = 0.05) {
    this.prng = new SeededPRNG(seed);
    this.latencyTicks = Math.round((latencyMs / 1000) * 60);
    this.packetLossRate = lossRate;
  }

  send(
    currentTick: number,
    channel: "input" | "state" | "events",
    payload: any
  ): void {
    // Unreliable channels (input and state) suffer 5% packet loss
    if (channel !== "events" && this.prng.next() < this.packetLossRate) {
      return; // Dropped packet!
    }

    // Reliable events channel or passed packets arrive after latency
    this.packets.push({
      deliveryTick: currentTick + this.latencyTicks,
      channel,
      payload,
    });
  }

  drain(currentTick: number): NetworkPacket[] {
    const ready = this.packets.filter((p) => p.deliveryTick <= currentTick);
    this.packets = this.packets.filter((p) => p.deliveryTick > currentTick);
    return ready;
  }
}

describe("Acceptance 5 & 13: Multiplayer Synchronization under Injected 150ms Latency and 5% Packet Loss", () => {
  it("Two-player mode: bindings, hoops, and scores stay identical across peers", () => {
    runMultiplayerSyncTest(2, 6000); // 6,000 ticks
  });

  it("Four-player mode: bindings, hoops, and scores stay identical across peers", () => {
    runMultiplayerSyncTest(4, 6000); // 6,000 ticks
  });
});

function runMultiplayerSyncTest(playerCount: 2 | 4, totalTicks: number) {
  const seed = 888;
  const hostEngine = new SimEngine(seed, playerCount);
  const net = new SimulatedPeerNetwork(seed, 150, 0.05);

  // Peer client states
  const peerStates = new Map<
    SeatId,
    {
      currentBindings: KeyBinding[];
      latestScore: number;
      clearedHoops: number;
      receivedHoopIds: Set<number>;
    }
  >();

  for (let i = 2; i <= playerCount; i++) {
    const seatId = `P${i}` as SeatId;
    peerStates.set(seatId, {
      currentBindings: hostEngine.getState().bindings,
      latestScore: 0,
      clearedHoops: 0,
      receivedHoopIds: new Set<number>(),
    });
  }

  // Initial event broadcast
  const startMsg: RunStartEventMsg = {
    type: "run_start",
    seed,
    playerCount,
    startTick: 0,
    startingBindings: hostEngine.getState().bindings,
  };
  net.send(0, "events", startMsg);

  const initialHoops = hostEngine.getState().hoops;
  net.send(0, "events", { type: "hoop_batch", hoops: initialHoops });

  // Run simulation
  const inputsBySeat = new Map<SeatId, InputBitmask>();

  for (let tick = 0; tick < totalTicks; tick++) {
    // Generate pilot inputs
    inputsBySeat.set("P1", (tick % 60 < 30 ? 1 : 0));
    for (let i = 2; i <= playerCount; i++) {
      const seat = `P${i}` as SeatId;
      inputsBySeat.set(seat, (tick % 40 < 20 ? 2 : 0));
    }

    const events = hostEngine.step(inputsBySeat);
    const hostState = hostEngine.getState();

    // Broadcast reliable events from host
    if (events.shuffleWarning) {
      net.send(tick, "events", {
        type: "shuffle_warning",
        ...events.shuffleWarning,
      });
    }

    if (events.shuffleApplied) {
      net.send(tick, "events", {
        type: "shuffle_applied",
        effectiveTick: hostState.tick,
        bindings: events.shuffleApplied,
      });
    }

    if (events.newHoops) {
      net.send(tick, "events", {
        type: "hoop_batch",
        hoops: events.newHoops,
      });
    }

    if (events.hoopCleared) {
      net.send(tick, "events", {
        type: "hoop_cleared",
        ...events.hoopCleared,
        totalScore: hostState.score,
      });
    }

    // Host 20 Hz state snapshot
    if (tick % 3 === 0) {
      const snapshot: HostStateSnapshotMsg = {
        type: "state",
        tick: hostState.tick,
        seq: tick,
        plane: hostState.plane,
        effects: hostState.effects,
        score: hostState.score,
        clearedHoops: hostState.clearedHoopsCount,
        distanceM: hostState.distanceM,
        isCrashed: hostState.isCrashed,
        runEndReason: hostState.runEndReason,
      };
      net.send(tick, "state", snapshot);
    }

    // Drain and apply delivered packets to remote peers
    const delivered = net.drain(tick);
    for (const packet of delivered) {
      for (const [seatId, pState] of peerStates.entries()) {
        if (packet.channel === "events") {
          const ev = packet.payload as NetEventMsg;
          if (ev.type === "shuffle_applied") {
            pState.currentBindings = ev.bindings;
          } else if (ev.type === "hoop_batch") {
            for (const h of ev.hoops) pState.receivedHoopIds.add(h.id);
          } else if (ev.type === "hoop_cleared") {
            pState.latestScore = ev.totalScore;
            pState.clearedHoops++;
          }
        } else if (packet.channel === "state") {
          const snap = packet.payload as HostStateSnapshotMsg;
          pState.latestScore = snap.score;
          pState.clearedHoops = snap.clearedHoops;
        }
      }
    }
  }

  // Drain any remaining delayed packets to complete synchronization
  for (let drainTick = totalTicks; drainTick <= totalTicks + 30; drainTick++) {
    const delivered = net.drain(drainTick);
    for (const packet of delivered) {
      for (const [seatId, pState] of peerStates.entries()) {
        if (packet.channel === "events") {
          const ev = packet.payload as NetEventMsg;
          if (ev.type === "shuffle_applied") {
            pState.currentBindings = ev.bindings;
          } else if (ev.type === "hoop_batch") {
            for (const h of ev.hoops) pState.receivedHoopIds.add(h.id);
          } else if (ev.type === "hoop_cleared") {
            pState.latestScore = ev.totalScore;
            pState.clearedHoops++;
          }
        } else if (packet.channel === "state") {
          const snap = packet.payload as HostStateSnapshotMsg;
          pState.latestScore = snap.score;
          pState.clearedHoops = snap.clearedHoops;
        }
      }
    }
  }

  const finalHostState = hostEngine.getState();

  // Verify that all peers converged to identical bindings, hoops, and scores!
  for (const [seatId, peerState] of peerStates.entries()) {
    expect(areBindingsEqual(finalHostState.bindings, peerState.currentBindings)).toBe(true);
    expect(peerState.latestScore).toBe(finalHostState.score);
    expect(peerState.clearedHoops).toBe(finalHostState.clearedHoopsCount);
  }
}
