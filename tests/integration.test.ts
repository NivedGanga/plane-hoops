import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_NETWORK_TEST_SECONDS, ACCEPTANCE_PACKET_LOSS_FRACTION, ACCEPTANCE_MAX_RTT_MS, CRASH_RESULT_DELAY_MS, HOOP_CLEANUP_BEHIND_M, HOST_HOOPS_AHEAD, ROCK_COLLISION_LOOKAHEAD_M, SIMULATION_HZ, SNAPSHOTS_PER_SECOND, SHUFFLE_WARNING_SECONDS } from '../config/tuning';
import { SeededRandom, createPlaneState, discardHoopsBehind, generateHoopBatch, initialBindings, inputForSeat, shuffledBindings, startRound, stepRound, type BindingSet, type Hoop, type RoundSnapshot } from '../src/sim';
import { snapshotFromState, type GameEvent } from '../src/net/protocol';

type Packet = { dueMs: number; reliable: boolean; to: number; sequence: number; body: unknown };
class SimulatedStar {
  private queue: Packet[] = [];
  private random = new SeededRandom(20261119);
  send(to: number, sequence: number, body: unknown, nowMs: number, reliable: boolean): void {
    if (!reliable && this.random.next() < ACCEPTANCE_PACKET_LOSS_FRACTION) return;
    const oneWayMs = Math.floor(this.random.next() * (ACCEPTANCE_MAX_RTT_MS / 2 + 1));
    this.queue.push({ to, sequence, body, reliable, dueMs: nowMs + oneWayMs });
  }
  deliver(nowMs: number, receive: (packet: Packet) => void): void {
    const ready = this.queue.filter((packet) => packet.dueMs <= nowMs).sort((a, b) => a.dueMs - b.dueMs || a.sequence - b.sequence);
    this.queue = this.queue.filter((packet) => packet.dueMs > nowMs);
    for (const packet of ready) receive(packet);
  }
  flush(receive: (packet: Packet) => void): void { this.queue.sort((a, b) => a.dueMs - b.dueMs); for (const packet of this.queue) receive(packet); this.queue = []; }
}

describe('simulated host-authoritative multiplayer link', () => {
  it('keeps bindings, hoops, and score convergent over five virtual minutes under 150 ms RTT and 5% loss', () => {
    const link = new SimulatedStar();
    const clients = [1, 2].map(() => ({ lastSequence: -1, lastInputSequence: -1, inputMask: 0, snapshot: undefined as RoundSnapshot | undefined, bindings: initialBindings(4) as BindingSet, hoops: [] as Hoop[], pending: undefined as { bindings: BindingSet; tick: number } | undefined }));
    let state = startRound(createPlaneState());
    let bindings = initialBindings(4);
    const random = new SeededRandom(8881);
    let placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    const initial = generateHoopBatch(random, placement, 0, state.speedKmh, 10);
    let hoops = initial.hoops; placement = initial.placement;
    for (const client of clients) client.hoops = initial.hoops.map((hoop) => ({ ...hoop }));
    let nextShuffleTick = 15 * SIMULATION_HZ;
    let pending: { bindings: BindingSet; effectiveTick: number } | undefined;
    let packetSequence = 0;
    let nowMs = 0;
    const ticks = ACCEPTANCE_NETWORK_TEST_SECONDS * SIMULATION_HZ;
    const receivePacket = (packet: Packet): void => {
      const body = packet.body as any;
      if (packet.to === -1) {
        const client = clients[body.seat - 3];
        if (body.sequence > client.lastInputSequence) { client.lastInputSequence = body.sequence; client.inputMask = body.mask; }
        return;
      }
      const client = clients[packet.to];
      if (body.type === 'shuffle') client.pending = { bindings: body.bindings, tick: body.effectiveTick };
      if (body.type === 'hoop-batch') { const ids = new Set(client.hoops.map((hoop) => hoop.id)); client.hoops.push(...body.hoops.filter((hoop: Hoop) => !ids.has(hoop.id))); }
      if (body.type === 'rock-removed' || body.type === 'hoop-cleared') client.hoops = client.hoops.filter((hoop) => hoop.id !== body.rockId && hoop.id !== body.hoopId);
      if (body.type === 'snapshot' && body.snapshot.sequence > client.lastSequence) {
        client.lastSequence = body.snapshot.sequence; client.snapshot = body.snapshot;
        if (client.pending && body.snapshot.tick >= client.pending.tick) { client.bindings = client.pending.bindings; client.pending = undefined; }
      }
    };
    for (let tick = 0; tick < ticks; tick++) {
      if (!pending && state.tick >= nextShuffleTick - SHUFFLE_WARNING_SECONDS * SIMULATION_HZ) {
        const next = shuffledBindings(4, random, bindings);
        const effectiveTick = state.tick + SHUFFLE_WARNING_SECONDS * SIMULATION_HZ;
        pending = { bindings: next, effectiveTick };
        for (let index = 0; index < clients.length; index++) link.send(index, ++packetSequence, { type: 'shuffle', bindings: next, effectiveTick }, nowMs, true);
        nextShuffleTick = effectiveTick + 15 * SIMULATION_HZ;
      }
      if (pending && state.tick + 1 >= pending.effectiveTick) { bindings = pending.bindings; pending = undefined; }
      const remoteMasks = [0b1111, 0b1111];
      remoteMasks.forEach((mask, index) => link.send(-1, ++packetSequence, { type: 'input', seat: index + 3, mask, sequence: packetSequence }, nowMs, false));
      let combined = { up: false, down: false, left: false, right: false };
      for (const seat of [1, 2, 3, 4]) {
        const mask = seat <= 2 ? 0b1111 : clients[seat - 3].inputMask;
        const input = inputForSeat(bindings, seat, mask);
        combined.up ||= input.up; combined.down ||= input.down; combined.left ||= input.left; combined.right ||= input.right;
      }
      // Isolate channel convergence from piloting; missed-hoop game-over is tested in sim.test.ts.
      const result = stepRound(state, combined, []); state = result.state;
      const expired = hoops.filter((hoop) => hoop.z < state.z - HOOP_CLEANUP_BEHIND_M);
      for (const rock of expired) for (let index = 0; index < clients.length; index++) link.send(index, ++packetSequence, { type: 'rock-removed', rockId: rock.id, tick: state.tick }, nowMs, true);
      hoops = discardHoopsBehind(hoops, state.z);
      const primary = hoops.filter((hoop) => !hoop.decoy);
      const farthestZ = primary.at(-1)?.z ?? state.z;
      if (primary.length < HOST_HOOPS_AHEAD || farthestZ - state.z < ROCK_COLLISION_LOOKAHEAD_M) {
        const missing = Math.max(1, HOST_HOOPS_AHEAD - primary.length);
        const batch = generateHoopBatch(random, placement, state.elapsedSeconds, state.speedKmh, missing); placement = batch.placement; hoops.push(...batch.hoops);
        for (let index = 0; index < clients.length; index++) link.send(index, ++packetSequence, { type: 'hoop-batch', hoops: batch.hoops }, nowMs, true);
      }
      if (tick % (SIMULATION_HZ / SNAPSHOTS_PER_SECOND) === 0) {
        const snapshot = snapshotFromState(state, ++packetSequence);
        for (let index = 0; index < clients.length; index++) link.send(index, snapshot.sequence, { type: 'snapshot', snapshot, bindings }, nowMs, false);
      }
      link.deliver(nowMs, receivePacket);
      nowMs += 1000 / SIMULATION_HZ;
      if (state.phase !== 'playing') break;
    }
    // Continue for a short drain window so the final unreliable snapshot can be retransmitted by a later tick.
    for (let drain = 0; drain < SIMULATION_HZ / 2; drain++) {
      const result = stepRound(state, { up: false, down: false, left: false, right: false }, []); state = result.state;
      if (state.tick % (SIMULATION_HZ / SNAPSHOTS_PER_SECOND) === 0) {
        const snapshot = snapshotFromState(state, ++packetSequence);
        for (let index = 0; index < clients.length; index++) link.send(index, snapshot.sequence, { type: 'snapshot', snapshot, bindings }, nowMs, false);
      }
      link.deliver(nowMs, receivePacket);
      nowMs += 1000 / SIMULATION_HZ;
    }
    link.flush(receivePacket);
    expect(state.tick).toBeGreaterThanOrEqual(ticks);
    for (const client of clients) {
      expect(client.snapshot?.score).toBe(state.score);
      expect(client.snapshot?.tick).toBe(state.tick - state.tick % Math.round(SIMULATION_HZ / SNAPSHOTS_PER_SECOND));
      expect(client.hoops.map((hoop) => hoop.id)).toEqual(hoops.map((hoop) => hoop.id));
      expect(client.bindings).toEqual(bindings);
    }
  }, 20_000);

  it('delivers one authoritative impact and shows results in the same 100 ms window for 2- and 4-player rooms', () => {
    const crash: GameEvent = {
      type: 'crash', reason: 'crash', tick: 18_240, score: 310, distance: 24_880, hoopsCleared: 31,
      rockId: 901, impactPoint: { x: 4.2, y: 46.1, z: 24_880.7 }, shipPosition: { x: 4.1, y: 46, z: 24_881 },
    };
    for (const remoteCount of [1, 3]) {
      const link = new SimulatedStar();
      const clients = Array.from({ length: remoteCount }, () => ({ crash: undefined as Extract<GameEvent, { type: 'crash' }> | undefined, visibleAt: 0, latestScore: 0 }));
      let sequence = 0;
      const startMs = 50_000;
      for (let index = 0; index < remoteCount; index++) {
        link.send(index, ++sequence, { type: 'snapshot', snapshot: { tick: crash.tick - 3, score: 300 } }, startMs, false);
        link.send(index, ++sequence, crash, startMs, true);
      }
      const receive = (packet: Packet): void => {
        const client = clients[packet.to]!; const body = packet.body as { type?: string; score?: number; tick?: number };
        if (body.type === 'crash') { client.crash = packet.body as Extract<GameEvent, { type: 'crash' }>; client.latestScore = body.score ?? 0; client.visibleAt = packet.dueMs + CRASH_RESULT_DELAY_MS; }
        else if (body.type === 'snapshot' && !client.crash) client.latestScore = body.score ?? 0;
      };
      for (let now = startMs; now <= startMs + ACCEPTANCE_MAX_RTT_MS; now++) link.deliver(now, receive);
      link.flush(receive);
      // Model a late unreliable pre-crash snapshot arriving after the reliable terminal event.
      receive({ to: 0, sequence: ++sequence, body: { type: 'snapshot', snapshot: { tick: crash.tick - 6, score: 280 } }, dueMs: startMs + ACCEPTANCE_MAX_RTT_MS, reliable: false });
      expect(clients.every((client) => client.crash?.type === 'crash' && client.latestScore === crash.score)).toBe(true);
      expect(clients.map((client) => client.crash?.tick)).toEqual(Array(remoteCount).fill(crash.tick));
      expect(Math.max(...clients.map((client) => client.visibleAt)) - Math.min(...clients.map((client) => client.visibleAt))).toBeLessThan(100);
      expect(clients.every((client) => client.visibleAt >= startMs + CRASH_RESULT_DELAY_MS)).toBe(true);
    }
  });
});
