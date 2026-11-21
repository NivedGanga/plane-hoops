import { CLIENT_INTERPOLATION_MS, CRASH_RESULT_DELAY_MS, HOST_HOOPS_AHEAD, ICE_RESTART_GRACE_SECONDS, INPUT_RATE_LIMIT_PER_SECOND, ROCK_COLLISION_LOOKAHEAD_M, SHUFFLE_INTERVAL_END_MAX_SECONDS, SHUFFLE_INTERVAL_END_MIN_SECONDS, SHUFFLE_INTERVAL_MAX_SECONDS, SHUFFLE_INTERVAL_MIN_SECONDS, SIM_DT_SECONDS, SIMULATION_HZ, SHUFFLE_MIN_GAP_SECONDS, SHUFFLE_WARNING_SECONDS, SNAPSHOTS_PER_SECOND } from '../config/tuning';
import { SeededRandom, createPlaneState, generateHoopBatch, initialBindings, inputForSeat, controlsForSeat, shuffledBindings, sameBindings, startRound, stepRound, type BindingSet, type Direction, type Hoop, discardHoopsBehind, type PlaneState, type RoundSnapshot } from './sim';
import { formatElapsedTime, formatGateProgress } from './hud/format';
import { SoundEffects } from './audio/sfx';
import { KeyboardState } from './input/keyboard';
import { PeerMesh } from './net/peer';
import { SupabaseSignalingClient } from './net/supabase-signaling';
import type { GameEvent, InputPacket, SignalingEvent, SignalingMessage, StatePacket } from './net/protocol';
import { FlightWorld } from './render/world';
import { readRoomName, readDisplayName, saveRoomName, saveDisplayName } from './storage/preferences';
import { authenticateLeaderboard, fetchTop20, submitRun, rankLeaderboard } from './leaderboard';

interface RoomInfo {
  code: string;
  playerCount: 2 | 4;
  localSeats: number;
  isHost: boolean;
  seatId: number | null;
}
type EventWithConnected = SignalingEvent | { type: 'connected'; peerId: string };
interface SignalingTransport {
  onEvent(listener: (event: EventWithConnected) => void): () => void;
  send(message: SignalingMessage): void;
  close(): void;
}
const keyLabel: Record<string, string> = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D' };
const prettyDirection: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' };

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }
function snapshotToPlane(snapshot: RoundSnapshot): PlaneState {
  return {
    x: snapshot.x, y: snapshot.y, z: snapshot.z, vx: snapshot.vx, vy: snapshot.vy,
    speedKmh: snapshot.speedKmh, headingX: snapshot.headingX, headingY: snapshot.headingY,
    tick: snapshot.tick, elapsedSeconds: snapshot.elapsedSeconds, score: snapshot.score,
    phase: snapshot.phase, boosterUntilTick: snapshot.tick + snapshot.boosterRemainingTicks,
    pullUntilTick: snapshot.tick + snapshot.pullRemainingTicks, pullDirection: snapshot.pullDirection,
  };
}
function interpolateSnapshots(a: RoundSnapshot, b: RoundSnapshot, tick: number): PlaneState {
  const span = Math.max(1, b.tick - a.tick);
  const t = Math.max(0, Math.min(1, (tick - a.tick) / span));
  const mix = (key: keyof RoundSnapshot) => Number(a[key]) + (Number(b[key]) - Number(a[key])) * t;
  const discrete = t < 1 ? a : b;
  return {
    x: mix('x'), y: mix('y'), z: mix('z'), vx: mix('vx'), vy: mix('vy'),
    headingX: mix('headingX'), headingY: mix('headingY'), speedKmh: mix('speedKmh'),
    tick: Math.floor(tick), elapsedSeconds: mix('elapsedSeconds'), score: discrete.score,
    phase: discrete.phase, boosterUntilTick: discrete.tick + discrete.boosterRemainingTicks,
    pullUntilTick: discrete.tick + discrete.pullRemainingTicks, pullDirection: discrete.pullDirection,
  };
}

export class PlaneHoopsApp {
  private world: FlightWorld;
  private keyboard = new KeyboardState();
  private sounds = new SoundEffects();
  private signaling?: SignalingTransport;
  private peerMesh?: PeerMesh;
  private room?: RoomInfo;
  private names = new Map<number, string>();
  private localSeatNames: string[] = [];
  private seed = 0;
  private random = new SeededRandom(1);
  private state = createPlaneState();
  private bindings: BindingSet = initialBindings(2);
  private pendingShuffle: { bindings: BindingSet; effectiveTick: number } | null = null;
  private nextShuffleTick = 0;
  private hoops: Hoop[] = [];
  private placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
  private remoteMasks = new Map<number, number>();
  private remoteInputSequences = new Map<number, number>();
  private remoteInputTimes = new Map<number, number[]>();
  private peerStatuses = new Map<number, RTCPeerConnectionState | 'disconnected'>();
  private snapshotSequence = 0;
  private inputSequence = 0;
  private lastInputSentAt = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private latestSnapshot?: RoundSnapshot;
  private previousSnapshot?: RoundSnapshot;
  private shuffleCount = 0;
  private hoopClears = 0;
  private launched = false;
  private recoveryTimer?: number;
  private statusText = 'Signal ready';
  private roomName = '';
  private hostUid?: string;
  private endReason: 'crash' | 'host_ended' | 'connection_lost' = 'crash';
  private crashImpact?: { rockId: number; impactPoint: { x: number; y: number; z: number }; shipPosition: { x: number; y: number; z: number } };
  private crashSequenceStarted = false;
  private crashResultsTimer?: number;
  private roundFinished = false;
  private leaderboardRequestId = 0;

  constructor(private root: HTMLElement) {
    const canvasHost = root.querySelector<HTMLElement>('#world');
    if (!canvasHost) throw new Error('World canvas mount is missing.');
    this.world = new FlightWorld(canvasHost);
  }

  start(): void {
    this.bindLobby();
    const roomName = this.root.querySelector<HTMLInputElement>('#room-name-input'); if (roomName) roomName.value = readRoomName();
    const hostName = this.root.querySelector<HTMLInputElement>('#host-name-input'); if (hostName) hostName.value = readDisplayName();
    const joinName = this.root.querySelector<HTMLInputElement>('#join-name-input'); if (joinName) joinName.value = readDisplayName();
    this.launched = true;
    this.keyboard.attach();
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private bindLobby(): void {
    const tabs = [...this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((button) => button.classList.toggle('active', button === tab));
      this.root.querySelector('#create-form')?.classList.toggle('hidden', tab.dataset.tab !== 'create');
      this.root.querySelector('#join-form')?.classList.toggle('hidden', tab.dataset.tab !== 'join');
      this.clearError();
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((choice) => choice.addEventListener('click', () => {
      this.root.querySelectorAll('[data-count]').forEach((node) => node.classList.toggle('selected', node === choice));
      const count = Number(choice.dataset.count);
      const local = this.root.querySelector<HTMLSelectElement>('#local-seats');
      if (local) local.innerHTML = count === 2
        ? '<option value="1">1 local pilot · others join online</option><option value="2">2 local pilots · shared keyboard</option>'
        : '<option value="1">1 local pilot · others join online</option><option value="2">2 local pilots · shared keyboard</option><option value="3">3 local pilots · shared keyboard</option><option value="4">4 local pilots · shared keyboard</option>';
      this.renderLocalSeatInputs();
    }));
    this.root.querySelector<HTMLSelectElement>('#local-seats')?.addEventListener('change', () => this.renderLocalSeatInputs());
    this.root.querySelector<HTMLButtonElement>('#create-room')?.addEventListener('click', () => this.createRoom());
    this.root.querySelector<HTMLButtonElement>('#join-room')?.addEventListener('click', () => this.joinRoom());
    this.root.querySelector<HTMLButtonElement>('#sound-toggle')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const enabled = this.sounds.toggle();
      button.textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound');
    });
    this.root.querySelector<HTMLInputElement>('#room-code-input')?.addEventListener('input', (event) => {
      const input = event.currentTarget as HTMLInputElement; input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
    this.root.querySelector<HTMLButtonElement>('#restart-button')?.addEventListener('click', () => { if (this.room?.isHost) this.beginRound(); });
    this.root.querySelector<HTMLButtonElement>('#return-lobby-button')?.addEventListener('click', () => this.returnToLobby());
    this.root.querySelector<HTMLButtonElement>('#end-run-button')?.addEventListener('click', () => { if (this.room?.isHost && this.state.phase === 'playing') { this.endReason='host_ended'; this.state={...this.state,phase:'ended'}; this.finishRound(false); } });
    this.root.querySelector<HTMLButtonElement>('#leave-button')?.addEventListener('click', () => this.leaveRoom());
  }

  private renderLocalSeatInputs(): void {
    const count = Number(this.root.querySelector<HTMLSelectElement>('#local-seats')?.value ?? 1);
    const target = this.root.querySelector<HTMLElement>('#local-seat-names');
    if (target) target.innerHTML = Array.from({ length: count - 1 }, (_, i) => `<label class="field-label" for="local-name-${i + 2}">Pilot ${i + 2} display name</label><input class="field" id="local-name-${i + 2}" maxlength="16" value="Pilot ${i + 2}" />`).join('');
  }

  private async createRoom(): Promise<void> {
    this.sounds.unlock();
    this.clearError();
    const roomName = this.root.querySelector<HTMLInputElement>('#room-name-input')?.value.trim() ?? '';
    const hostName = this.root.querySelector<HTMLInputElement>('#host-name-input')?.value.trim() ?? '';
    if (roomName.length < 1 || roomName.length > 24) { this.showError('Room name must be 1–24 characters.'); return; }
    if (hostName.length < 1 || hostName.length > 16) { this.showError('Display name must be 1–16 characters.'); return; }
    this.roomName = roomName; saveRoomName(roomName); saveDisplayName(hostName); this.names.set(1, hostName);
    try { this.hostUid = await authenticateLeaderboard(); } catch (error) { console.warn('Leaderboard authentication failed', error); }
    const selected = Number(this.root.querySelector<HTMLElement>('[data-count].selected')?.dataset.count ?? 2) as 2 | 4;
    const localSeats = Number(this.root.querySelector<HTMLSelectElement>('#local-seats')?.value ?? 1);
    this.localSeatNames = [hostName, ...Array.from({ length: localSeats - 1 }, (_, i) => this.root.querySelector<HTMLInputElement>(`#local-name-${i + 2}`)?.value.trim() ?? '')];
    if (this.localSeatNames.some(name => name.length < 1 || name.length > 16)) { this.showError('Every local pilot name must be 1–16 characters.'); return; }
    if (!this.prepareSignaling()) return;
    this.signaling?.send({ type: 'create-room', maxPlayers: selected, localSeats, name: roomName });
    this.statusText = 'Creating room…'; this.showToast('Connecting to the room service…');
  }

  private joinRoom(): void {
    this.sounds.unlock();
    this.clearError();
    const displayName = this.root.querySelector<HTMLInputElement>('#join-name-input')?.value.trim() ?? '';
    if (displayName.length < 1 || displayName.length > 16) { this.showError('Display name must be 1–16 characters.'); return; }
    saveDisplayName(displayName);
    const roomCode = this.root.querySelector<HTMLInputElement>('#room-code-input')?.value.trim().toUpperCase() ?? '';
    if (roomCode.length !== 6) { this.showError('Enter the six-character room code from your host.'); return; }
    if (!this.prepareSignaling()) return;
    this.signaling?.send({ type: 'join-room', roomCode, name: displayName });
    this.statusText = 'Joining room…'; this.showToast('Finding your flight crew…');
  }

  private prepareSignaling(): boolean {
    if (this.signaling) this.signaling.close();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) { this.signaling = undefined; this.hideToast(); this.showError('Room networking is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'); return false; }
    this.signaling = new SupabaseSignalingClient(supabaseUrl, supabaseKey);
    this.signaling.onEvent((event) => this.onSignalingEvent(event));
    return true;
  }

  private makePeerMesh(isHost: boolean): PeerMesh {
    return new PeerMesh(isHost, {
      sendSignal: (target, data) => this.signaling?.send({ type: 'signal', target, data }),
      onInput: (seatId, packet) => this.receiveInput(seatId, packet),
      onState: (packet) => this.receiveState(packet),
      onEvent: (event) => this.receiveGameEvent(event),
      onStatus: (seatId, status) => this.peerStatus(seatId, status),
      onNotice: (message) => this.showToast(message),
    });
  }

  private onSignalingEvent(event: EventWithConnected): void {
    if (event.type === 'error') { this.showError(event.message); this.hideToast(); return; }
    if (event.type === 'room-created') {
      this.room = { code: event.roomCode, playerCount: event.maxPlayers, localSeats: event.localSeats, isHost: true, seatId: null };
      this.names.clear(); for (let seat = 1; seat <= event.localSeats; seat++) this.names.set(seat, this.localSeatNames[seat - 1] ?? `Pilot ${seat}`);
      this.peerMesh = this.makePeerMesh(true); this.statusText = 'Room open'; this.updateLobbyRoom(); this.hideToast(); return;
    }
    if (event.type === 'joined-room') {
      const firstJoin = !this.room || this.room.code !== event.roomCode;
      this.room = { code: event.roomCode, playerCount: event.maxPlayers, localSeats: event.localSeats, isHost: false, seatId: event.seatId };
      if (event.seatId > 0) this.names.set(event.seatId, readDisplayName() || 'You'); this.hostUid = event.hostPeerId;
      if (firstJoin) { this.peerMesh = this.makePeerMesh(false); void this.peerMesh.addClientPeer(event.hostPeerId, event.seatId).catch((error) => this.showError(`Could not connect to host: ${String(error)}`)); }
      this.statusText = 'Waiting for host'; this.updateLobbyRoom(); this.hideToast(); return;
    }
    if (event.type === 'peer-joined' && this.room?.isHost) {
      this.names.set(event.seatId, event.name); this.remoteMasks.set(event.seatId, 0); this.updateLobbyRoom();
      void this.peerMesh?.addHostPeer(event.peerId, event.seatId).catch((error) => this.showError(`Could not connect seat ${event.seatId}: ${String(error)}`));
      this.broadcastEvent({ type: 'seat-joined', seatId: event.seatId, name: event.name }); return;
    }
    if (event.type === 'peer-left' && this.room?.isHost) {
      this.peerMesh?.closePeer(event.peerId); this.names.delete(event.seatId); this.remoteMasks.delete(event.seatId); this.peerStatuses.delete(event.seatId); this.updateLobbyRoom();
      this.broadcastEvent({ type: 'seat-left', seatId: event.seatId });
      if (this.state.phase === 'playing') this.pauseForRecovery(event.seatId);
      return;
    }
    if (event.type === 'signal' && this.room) {
      const seatId = this.room.isHost ? (this.peerMesh?.seatForPeer(event.from) ?? 0) : (this.room.seatId ?? 0);
      void this.peerMesh?.receiveSignal(event.from, event.data, seatId).catch((error) => console.warn('Signaling failed', error));
      return;
    }
    if (event.type === 'room-closed') {
      this.endSession(true); this.showToast('The host closed the room.'); return;
    }
    if (event.type === 'connected') return;
  }

  private updateLobbyRoom(): void {
    if (!this.room) return;
    const view = this.root.querySelector<HTMLElement>('#room-view');
    if (!view) return;
    this.root.querySelector('#create-form')?.classList.add('hidden');
    this.root.querySelector('#join-form')?.classList.add('hidden');
    view.classList.remove('hidden');
    const seats = Array.from({ length: this.room.playerCount }, (_, index) => {
      const seat = index + 1;
      const isLocal = this.room!.isHost && seat <= this.room!.localSeats;
      const name = this.names.get(seat);
      const ready = isLocal || Boolean(name && (!this.room!.isHost || this.peerStatuses.get(seat) === 'connected'));
      const label = isLocal ? `Local keyboard · ${escapeHtml(name ?? `Pilot ${seat}`)}` : name ? escapeHtml(name) : 'Open pilot seat';
      return `<div class="seat-row"><div class="seat-num">${String(seat).padStart(2, '0')}</div><div class="seat-info"><div class="seat-title">Pilot ${seat}</div><div class="seat-note">${label}</div></div><div class="seat-status ${ready ? '' : 'waiting'}">${ready ? (isLocal ? 'Ready' : 'Connected') : name ? 'Connecting' : 'Waiting'}</div></div>`;
    }).join('');
    const connectedCount = this.room.isHost ? this.room.localSeats + [...this.names.keys()].filter((seat) => seat > this.room!.localSeats && this.peerStatuses.get(seat) === 'connected').length : 1;
    const isFull = connectedCount === this.room.playerCount;
    view.innerHTML = this.room.isHost
      ? `<div class="eyebrow">Flight room created</div><h1>Bring the crew in.</h1><p class="intro">Share this room code with your pilots. The flight starts when every seat is ready.</p><div class="room-code-box"><div class="field-label" style="margin:0 0 5px">Room code</div><div class="room-code">${this.room.code}</div><div class="small-note">${connectedCount} / ${this.room.playerCount} seats ready · WebRTC star room</div></div><div class="seat-list">${seats}</div><div class="legend"><span><i class="l1"></i> Standard +10</span><span><i class="l2"></i> Booster +20</span><span><i class="l3"></i> Magnetic +5</span></div><button class="button" id="lobby-start" ${isFull ? '' : 'disabled'}>Start the flight</button><button class="button secondary" id="lobby-leave">Close room</button>`
      : `<div class="eyebrow">Connected to ${this.room.code}</div><h1>Seat ${this.room.seatId}<br>is yours.</h1><p class="intro">You're in the flight deck. Wait for the host to fill the remaining seats and start the round.</p><div class="seat-list">${seats}</div><div class="badge"><span class="dot"></span>${escapeHtml(this.statusText)}</div><button class="button secondary" id="lobby-leave">Leave room</button>`;
    this.root.querySelector<HTMLButtonElement>('#lobby-start')?.addEventListener('click', () => this.beginRound());
    this.root.querySelector<HTMLButtonElement>('#lobby-leave')?.addEventListener('click', () => this.leaveRoom());
    this.root.querySelector('#lobby-card')?.classList.add('room-open');
    this.root.querySelector('#lobby-wrap')?.classList.remove('hidden');
  }

  private beginRound(): void {
    if (!this.room?.isHost) return;
    const remoteSeats = [...this.names.keys()].filter((seat) => seat > this.room!.localSeats);
    if (this.room.localSeats + remoteSeats.length !== this.room.playerCount || remoteSeats.some((seat) => this.peerStatuses.get(seat) !== 'connected' || !this.peerMesh?.hasRemoteSeat(seat))) { this.showError('Every remote pilot must be connected before the round can start.'); return; }
    this.seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    this.random = new SeededRandom(this.seed);
    this.state = startRound(createPlaneState());
    this.roundFinished = false;
    this.endReason = 'crash';
    if (this.crashResultsTimer) window.clearTimeout(this.crashResultsTimer);
    this.crashResultsTimer = undefined; this.crashSequenceStarted = false;
    this.crashImpact = undefined; this.world.reset();
    this.bindings = initialBindings(this.room.playerCount);
    this.pendingShuffle = null;
    this.nextShuffleTick = Math.round(this.nextShuffleInterval() * SIMULATION_HZ);
    this.shuffleCount = 0; this.hoopClears = 0;
    this.hoops = []; this.placement = { lastZ: 0, predicted: { x: 0, y: 45, vx: 0, vy: 0 }, nextId: 1 };
    this.remoteMasks.clear(); this.remoteInputSequences.clear(); this.remoteInputTimes.clear(); this.inputSequence = 0; this.lastInputSentAt = 0; this.accumulator = 0;
    this.root.querySelector('#lobby-wrap')?.classList.add('hidden');
    this.root.querySelector('#result-overlay')?.classList.add('hidden');
    this.root.querySelector('#game-hud')?.classList.remove('hidden');
    this.root.querySelector('.shell')?.classList.add('game-active');
    this.root.querySelector<HTMLButtonElement>('#restart-button')?.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('#end-run-button')?.classList.toggle('hidden', !this.room.isHost);
    this.signaling?.send({ type: 'room-status', phase: 'playing' });
    this.updateLobbyHud();
    const firstBatch = generateHoopBatch(this.random, this.placement, 0, this.state.speedKmh, HOST_HOOPS_AHEAD);
    this.hoops.push(...firstBatch.hoops); this.placement = firstBatch.placement;
    this.broadcastEvent({ type: 'round-start', seed: this.seed, bindings: this.bindings, tick: 0 });
    this.broadcastEvent({ type: 'hoop-batch', hoops: firstBatch.hoops });
    this.sounds.roundStart();
    this.statusText = 'In flight'; this.lastFrame = performance.now();
  }

  private nextShuffleInterval(): number {
    const difficulty = Math.min(1, this.state.elapsedSeconds / 600);
    const min = SHUFFLE_INTERVAL_MIN_SECONDS + (SHUFFLE_INTERVAL_END_MIN_SECONDS - SHUFFLE_INTERVAL_MIN_SECONDS) * difficulty;
    const max = SHUFFLE_INTERVAL_MAX_SECONDS + (SHUFFLE_INTERVAL_END_MAX_SECONDS - SHUFFLE_INTERVAL_MAX_SECONDS) * difficulty;
    return Math.max(SHUFFLE_MIN_GAP_SECONDS, min + this.random.next() * (max - min));
  }

  private frame = (now: number): void => {
    if (!this.launched) return;
    const delta = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.room?.isHost && this.state.phase === 'playing') {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= SIM_DT_SECONDS && steps < 8) {
        this.tickHost(); this.accumulator -= SIM_DT_SECONDS; steps++;
      }
    } else if (this.room && !this.room.isHost && this.room.seatId && this.state.phase === 'playing') {
      if (now - this.lastInputSentAt < 1000 / 60) {
        const shownState = this.interpolatedClientState(now);
        this.world.render(shownState, this.hoops, now / 1000); this.updateHud(shownState); requestAnimationFrame(this.frame); return;
      }
      this.lastInputSentAt = now;
      this.inputSequence++;
      const packet: InputPacket = { type: 'input', sequence: this.inputSequence, heldKeyMask: this.keyboard.mask, clientTick: this.latestSnapshot?.tick ?? 0 };
      this.peerMesh?.sendInput(packet);
    }
    const shownState = this.room && !this.room.isHost ? this.interpolatedClientState(now) : this.state;
    this.world.render(shownState, this.hoops, now / 1000);
    this.updateHud(shownState);
    requestAnimationFrame(this.frame);
  };

  private tickHost(): void {
    if (this.pendingShuffle && this.state.tick + 1 >= this.pendingShuffle.effectiveTick) {
      this.bindings = this.pendingShuffle.bindings; this.pendingShuffle = null; this.shuffleCount++;
    }
    if (!this.pendingShuffle && this.state.tick >= this.nextShuffleTick - SHUFFLE_WARNING_SECONDS * SIMULATION_HZ) {
      const bindings = shuffledBindings(this.room!.playerCount, this.random, this.bindings);
      const effectiveTick = this.state.tick + SHUFFLE_WARNING_SECONDS * SIMULATION_HZ;
      this.pendingShuffle = { bindings, effectiveTick };
      this.nextShuffleTick = effectiveTick + Math.max(SHUFFLE_MIN_GAP_SECONDS, Math.round(this.nextShuffleInterval() * SIMULATION_HZ));
      this.broadcastEvent({ type: 'shuffle-command', bindings, effectiveTick, warningSeconds: SHUFFLE_WARNING_SECONDS });
    }
    let combined = { up: false, down: false, left: false, right: false };
    for (let seat = 1; seat <= this.room!.playerCount; seat++) {
      const local = seat <= this.room!.localSeats;
      const mask = local ? this.keyboard.mask : this.remoteMasks.get(seat) ?? 0;
      const input = inputForSeat(this.bindings, seat, mask);
      combined = { up: combined.up || input.up, down: combined.down || input.down, left: combined.left || input.left, right: combined.right || input.right };
    }
    const result = stepRound(this.state, combined, this.hoops);
    this.state = result.state;
    if (result.collision) {
      this.endReason = 'crash';
      this.crashImpact = { rockId: result.collision.rockId, impactPoint: result.collision.impactPoint, shipPosition: { x: this.state.x, y: this.state.y, z: this.state.z } };
      this.world.explode(result.collision.impactPoint, result.collision.rockId, this.state);
    }
    for (const hoop of result.cleared) {
      this.hoopClears++;
      this.broadcastEvent({ type: 'hoop-cleared', hoopId: hoop.id, hoopType: hoop.type, score: this.state.score, tick: this.state.tick });
      this.sounds.hoopCleared(hoop.type);
      if (hoop.type === 'booster') this.broadcastEvent({ type: 'booster-activated', untilTick: this.state.boosterUntilTick, score: this.state.score, tick: this.state.tick });
      if (hoop.type === 'magnetic' && hoop.arrow) this.broadcastEvent({ type: 'magnetic-activated', direction: hoop.arrow, untilTick: this.state.pullUntilTick, score: this.state.score, tick: this.state.tick });
    }
    for (const rock of result.passed) if (rock.decoy) this.broadcastEvent({ type: 'rock-removed', rockId: rock.id, tick: this.state.tick });
    // Cleared scoring points remain as route anchors until they pass out of the
    // interpolation window; clients receive a separate reliable removal later.
    const retained = discardHoopsBehind(this.hoops, this.state.z);
    const retainedIds = new Set(retained.map((rock) => rock.id));
    for (const rock of this.hoops) if (!retainedIds.has(rock.id)) this.broadcastEvent({ type: 'rock-removed', rockId: rock.id, tick: this.state.tick });
    this.hoops = retained;
    const primaryRocks = this.hoops.filter((rock) => !rock.decoy && !rock.cleared);
    const farthestPrimaryZ = primaryRocks.at(-1)?.z ?? this.state.z;
    if (this.state.phase !== 'ended' && (primaryRocks.length < HOST_HOOPS_AHEAD || farthestPrimaryZ - this.state.z < ROCK_COLLISION_LOOKAHEAD_M)) {
      const missing = Math.max(1, HOST_HOOPS_AHEAD - primaryRocks.length);
      const batch = generateHoopBatch(this.random, this.placement, this.state.elapsedSeconds, this.state.speedKmh, missing);
      this.hoops.push(...batch.hoops); this.placement = batch.placement;
      this.broadcastEvent({ type: 'hoop-batch', hoops: batch.hoops });
    }
    if (this.state.tick % Math.max(1, Math.round(SIMULATION_HZ / SNAPSHOTS_PER_SECOND)) === 0) this.sendSnapshot();
    if (this.state.phase === 'ended') this.beginCrashSequence();
  }

  private sendSnapshot(): void {
    const packet: StatePacket = {
      type: 'state',
      snapshot: {
        tick: this.state.tick, sequence: ++this.snapshotSequence, x: this.state.x, y: this.state.y, z: this.state.z,
        vx: this.state.vx, vy: this.state.vy, headingX: this.state.headingX, headingY: this.state.headingY,
        speedKmh: this.state.speedKmh, score: this.state.score, phase: this.state.phase,
        elapsedSeconds: this.state.elapsedSeconds, boosterRemainingTicks: Math.max(0, this.state.boosterUntilTick - this.state.tick),
        pullRemainingTicks: Math.max(0, this.state.pullUntilTick - this.state.tick), pullDirection: this.state.pullDirection,
      }, bindings: this.bindings,
    };
    this.peerMesh?.sendState(packet);
  }

  private receiveInput(seatId: number, packet: InputPacket): void {
    if (!this.room?.isHost || this.state.phase !== 'playing' || seatId <= this.room.localSeats) return;
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence <= (this.remoteInputSequences.get(seatId) ?? -1)) return;
    this.remoteInputSequences.set(seatId, packet.sequence);
    const now = performance.now();
    const times = (this.remoteInputTimes.get(seatId) ?? []).filter((time) => now - time < 1000);
    times.push(now); this.remoteInputTimes.set(seatId, times);
    if (times.length > INPUT_RATE_LIMIT_PER_SECOND) {
      const peerId = this.peerMesh?.peerForSeat(seatId); if (peerId) this.peerMesh?.closePeer(peerId);
      this.showToast(`Seat ${seatId} was dropped for excessive input traffic.`); return;
    }
    this.remoteMasks.set(seatId, packet.heldKeyMask & 0x0f);
  }

  private receiveState(packet: StatePacket): void {
    if (!this.room || this.room.isHost) return;
    if (this.roundFinished || this.crashSequenceStarted) return;
    this.previousSnapshot = this.latestSnapshot; this.latestSnapshot = packet.snapshot;
    if (packet.snapshot.tick >= (this.pendingShuffle?.effectiveTick ?? Number.MAX_SAFE_INTEGER)) {
      if (this.pendingShuffle) { this.bindings = this.pendingShuffle.bindings; this.pendingShuffle = null; }
    }
    if (packet.snapshot.phase === 'ended') {
      // State is unreliable; the ordered terminal event owns final results.
      if (!this.roundFinished) this.state = snapshotToPlane(packet.snapshot);
    } else if (packet.snapshot.phase !== 'paused' && !this.roundFinished) this.state = snapshotToPlane(packet.snapshot);
    else this.state = { ...this.state, phase: 'paused' };
    this.bindings = packet.snapshot.tick === 0 ? packet.bindings : this.bindings;
  }

  private receiveGameEvent(event: GameEvent): void {
    if (this.room?.isHost) return;
    if (event.type === 'round-start') {
      if (this.crashResultsTimer) window.clearTimeout(this.crashResultsTimer);
      this.crashResultsTimer = undefined; this.crashSequenceStarted = false;
      this.seed = event.seed; this.bindings = event.bindings; this.state = startRound(createPlaneState()); this.roundFinished = false; this.endReason = 'crash'; this.crashImpact = undefined; this.world.reset();
      this.pendingShuffle = null; this.hoops = []; this.hoopClears = 0; this.shuffleCount = 0; this.remoteInputSequences.clear(); this.remoteInputTimes.clear();
      this.root.querySelector('#lobby-wrap')?.classList.add('hidden'); this.root.querySelector('#result-overlay')?.classList.add('hidden');
      this.root.querySelector('.shell')?.classList.add('game-active');
      this.root.querySelector('#game-hud')?.classList.remove('hidden'); this.statusText = 'In flight';
      this.sounds.roundStart(); this.updateControlMap();
    } else if (event.type === 'hoop-cleared') {
      this.hoopClears++;
      this.hoops = this.hoops.map((rock) => rock.id === event.hoopId ? { ...rock, cleared: true } : rock);
      this.sounds.hoopCleared(event.hoopType);
    } else if (event.type === 'rock-removed') {
      this.hoops = this.hoops.filter((rock) => rock.id !== event.rockId);
    } else if (event.type === 'hoop-batch') {
      const ids = new Set(this.hoops.map((hoop) => hoop.id)); this.hoops.push(...event.hoops.filter((hoop) => !ids.has(hoop.id)));
    } else if (event.type === 'shuffle-command') {
      this.pendingShuffle = { bindings: event.bindings, effectiveTick: event.effectiveTick };
    } else if (event.type === 'crash') {
      if (this.roundFinished || this.crashSequenceStarted) return;
      this.endReason = 'crash'; this.hoopClears = event.hoopsCleared;
      this.state = { ...this.state, ...event.shipPosition, phase: 'ended', score: event.score, tick: event.tick };
      this.crashImpact = { rockId: event.rockId, impactPoint: event.impactPoint, shipPosition: event.shipPosition };
      this.world.explode(event.impactPoint, event.rockId, this.state);
      this.beginCrashSequence();
    } else if (event.type === 'round-end') {
      if (this.roundFinished) return;
      this.endReason = event.reason; this.hoopClears = event.hoopsCleared;
      this.state = { ...this.state, phase: 'ended', score: event.score, tick: event.tick, z: event.distance };
      this.finishRound(false);
    } else if (event.type === 'leaderboard-updated') {
      void this.renderLeaderboard();
    } else if (event.type === 'seat-joined') { this.names.set(event.seatId, event.name); this.updateControlMap(); }
    else if (event.type === 'seat-left') { this.names.delete(event.seatId); this.updateControlMap(); }
  }

  private interpolatedClientState(now: number): PlaneState {
    if (!this.latestSnapshot) return this.state;
    if (!this.previousSnapshot) return snapshotToPlane(this.latestSnapshot);
    const targetTick = this.latestSnapshot.tick - CLIENT_INTERPOLATION_MS * SIMULATION_HZ / 1000;
    return interpolateSnapshots(this.previousSnapshot, this.latestSnapshot, Math.max(this.previousSnapshot.tick, targetTick));
  }

  private pauseForRecovery(seatId: number): void {
    if (this.state.phase !== 'playing') return;
    this.state = { ...this.state, phase: 'paused' };
    this.signaling?.send({ type: 'room-status', phase: 'paused' });
    this.sendSnapshot(); this.showToast(`Pilot ${seatId} disconnected — pausing for up to ${ICE_RESTART_GRACE_SECONDS}s.`);
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = window.setTimeout(() => {
      if (this.state.phase === 'paused') {
        this.endReason = 'connection_lost'; this.state = { ...this.state, phase: 'ended' }; this.finishRound(false);
      }
    }, ICE_RESTART_GRACE_SECONDS * 1000);
  }

  private peerStatus(seatId: number, status: RTCPeerConnectionState | 'disconnected'): void {
    if (!this.room?.isHost) return;
    this.peerStatuses.set(seatId, status); if (this.state.phase === 'lobby') this.updateLobbyRoom();
    if (status === 'connected' && this.state.phase === 'paused') {
      if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
      this.state = { ...this.state, phase: 'playing' }; this.signaling?.send({ type: 'room-status', phase: 'playing' });
      this.showToast(`Pilot ${seatId} reconnected — back in the air.`); this.lastFrame = performance.now(); return;
    }
    if (status === 'disconnected' || status === 'failed' || status === 'closed') this.pauseForRecovery(seatId);
  }

  private beginCrashSequence(): void {
    if (this.crashSequenceStarted || this.roundFinished) return;
    this.crashSequenceStarted = true;
    if (this.room?.isHost) {
      const impact = this.crashImpact;
      if (!impact) { this.endReason = 'host_ended'; this.finishRound(false); return; }
      this.broadcastEvent({
        type: 'crash', reason: 'crash', tick: this.state.tick, score: this.state.score,
        distance: Math.max(0, Math.round(this.state.z)), hoopsCleared: this.hoopClears, ...impact,
      });
      this.signaling?.send({ type: 'room-status', phase: 'ended' });
    }
    this.sounds.crash();
    this.root.querySelector('#end-run-button')?.classList.add('hidden');
    this.crashResultsTimer = window.setTimeout(() => {
      this.crashResultsTimer = undefined;
      this.finishRound(true);
    }, CRASH_RESULT_DELAY_MS);
  }

  private finishRound(crashed: boolean): void {
    if (this.roundFinished) return;
    this.roundFinished = true;
    const score = this.state.score;
    if (this.room?.isHost) {
      const distance = Math.max(0, Math.round(this.state.z));
      const hoopsCleared = this.hoopClears;
      if (!crashed) {
        this.broadcastEvent({ type: 'round-end', tick: this.state.tick, score, reason: this.endReason === 'connection_lost' ? 'connection_lost' : 'host_ended', distance, hoopsCleared });
        this.signaling?.send({ type: 'room-status', phase: 'ended' });
      }
    }
    this.state = { ...this.state, phase: 'ended' };
    this.remoteInputSequences.clear(); this.remoteInputTimes.clear(); this.remoteMasks.clear();
    this.root.querySelector('#result-score')!.textContent = String(score);
    this.root.querySelector('#result-title')!.textContent = this.endReason === 'connection_lost' ? 'Crew link lost.' : crashed ? 'Asteroid impact.' : 'Nice flying, crew.';
    this.root.querySelector('#result-eyebrow')!.textContent = this.endReason === 'connection_lost' ? 'Connection lost · not submitted' : crashed ? 'SHIP DESTROYED · ASTEROID CONTACT' : 'Host ended the run';
    const distance = Math.max(0, Math.round(this.state.z));
    this.root.querySelector('#leaderboard')!.innerHTML = `<div class="leader-row"><span>Team score</span><strong>${score} pts</strong></div><div class="leader-row"><span>Waypoints passed</span><strong>${this.hoopClears}</strong></div><div class="leader-row"><span>Distance</span><strong>${distance.toLocaleString()} m</strong></div><div class="leader-row"><span>Team</span><strong>${escapeHtml(this.roomName)}</strong></div>`;
    if (this.room?.isHost && this.endReason !== 'connection_lost' && this.hostUid) {
      void submitRun(this.hostUid, this.roomName, [...this.names.values()].slice(0,4), score, this.hoopClears, distance)
        .then(() => { this.showToast('Leaderboard record saved.'); this.broadcastEvent({ type: 'leaderboard-updated' }); })
        .catch(e => console.warn('Leaderboard write failed', e))
        .finally(() => { void this.renderLeaderboard(); });
    } else void this.renderLeaderboard();
    this.root.querySelector('#restart-button')?.classList.toggle('hidden', !this.room?.isHost);
    this.root.querySelector('#return-lobby-button')?.classList.toggle('hidden', !this.room?.isHost);
    this.root.querySelector('#end-run-button')?.classList.add('hidden');
    this.root.querySelector('#result-overlay')?.classList.remove('hidden');
  }

  private returnToLobby(): void {
    if (!this.room?.isHost || !this.roundFinished) return;
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
    this.state = { ...this.state, phase: 'lobby' };
    this.signaling?.send({ type: 'room-status', phase: 'lobby' });
    this.root.querySelector('#result-overlay')?.classList.add('hidden');
    this.root.querySelector('#game-hud')?.classList.add('hidden');
    this.root.querySelector('#lobby-wrap')?.classList.remove('hidden');
    this.root.querySelector('.shell')?.classList.remove('game-active');
    this.root.querySelector('#restart-button')?.classList.add('hidden');
    this.roundFinished = false;
    this.updateLobbyRoom();
  }

  private async renderLeaderboard(): Promise<void> { const node=this.root.querySelector<HTMLElement>('#top-leaderboard'); if(!node)return; const requestId=++this.leaderboardRequestId; try { const uid=await authenticateLeaderboard(); if(!uid){if(requestId===this.leaderboardRequestId)node.textContent='Sign in to view the leaderboard.';return;} const rows=rankLeaderboard(await fetchTop20()); if(requestId!==this.leaderboardRequestId)return; node.innerHTML='<div class="leader-row"><strong>Rank · Team name</strong><strong>Record</strong></div>'+rows.map((row,i)=>`<div class="leader-row"><span>${i+1}. ${escapeHtml(row.team_name)} · ${escapeHtml(row.members.join(', '))}</span><strong>${row.points.toLocaleString()} pts (${row.hoops_cleared} waypoints)</strong></div>`).join(''); } catch { if(requestId===this.leaderboardRequestId)node.textContent='Leaderboard unavailable.'; } }

  private updateHud(state: PlaneState): void {
    if (!this.room) return;
    const time = this.root.querySelector<HTMLElement>('#hud-time'); if (time) time.textContent = formatElapsedTime(state.elapsedSeconds);
    const speed = this.root.querySelector<HTMLElement>('#hud-speed'); if (speed) speed.textContent = String(Math.round(state.speedKmh));
    const gates = this.root.querySelector<HTMLElement>('#hud-gates'); if (gates) gates.textContent = formatGateProgress(this.hoopClears);
    const room = this.root.querySelector<HTMLElement>('#hud-room'); if (room) room.textContent = `ROOM ${this.room.code}`;
    const effect = this.root.querySelector<HTMLElement>('#hud-effect');
    if (effect) {
      const ticks = state.boosterUntilTick - state.tick;
      const pullTicks = state.pullUntilTick - state.tick;
      effect.classList.toggle('hidden', ticks <= 0 && pullTicks <= 0);
      effect.textContent = ticks > 0 ? `✦ BOOST ${Math.ceil(ticks / SIMULATION_HZ)}s` : pullTicks > 0 ? `↗ MAGNET ${state.pullDirection?.toUpperCase()} · ${Math.ceil(pullTicks / SIMULATION_HZ)}s` : '';
    }
    const alert = this.root.querySelector<HTMLElement>('#shuffle-alert');
    const tick = this.room.isHost ? this.state.tick : this.latestSnapshot?.tick ?? state.tick;
    if (alert && this.pendingShuffle && tick <= this.pendingShuffle.effectiveTick) {
      const seconds = Math.max(0, Math.ceil((this.pendingShuffle.effectiveTick - tick) / SIMULATION_HZ));
      alert.classList.toggle('hidden', seconds <= 0); alert.textContent = seconds > 0 ? `KEY SHUFFLE IN ${seconds} · NEW KEYS ${this.room.isHost ? 'LOCKED' : 'LOADED'}` : '';
    } else alert?.classList.add('hidden');
    this.updateControlMap();
    if (state.phase === 'paused') this.showToast('Crew link interrupted — attempting to reconnect…');
  }

  private updateControlMap(): void {
    if (!this.room) return;
    const hostLocalSeats = this.room.isHost ? Array.from({ length: this.room.localSeats }, (_, index) => index + 1) : [this.room.seatId!];
    const node = this.root.querySelector<HTMLElement>('#control-map'); if (!node) return;
    const keyBits: Record<string, number> = { KeyW: 1, KeyA: 2, KeyS: 4, KeyD: 8 };
    node.innerHTML = `<div class="control-map-seats">${hostLocalSeats.map((seat, index) => {
      const entries = controlsForSeat(this.bindings, seat).map(({ direction, key }) => {
        const down = (this.keyboard.mask & (keyBits[key] ?? 0)) !== 0;
        return `<span class="control-item"><kbd class="${down ? 'down' : ''}">${keyLabel[key]}</kbd><span class="control-direction">${prettyDirection[direction]} ${direction.toUpperCase()}</span></span>`;
      }).join('');
      const seatLabel = hostLocalSeats.length > 1 ? `<span class="control-seat-name">P${seat}</span>` : '';
      const separator = index < hostLocalSeats.length - 1 ? '<span class="control-separator" aria-hidden="true"></span>' : '';
      return `<div class="control-map-seat">${seatLabel}<span class="control-list">${entries || '—'}</span></div>${separator}`;
    }).join('')}</div>`;
  }

  private updateLobbyHud(): void { this.updateControlMap(); }
  private broadcastEvent(event: GameEvent): void { this.peerMesh?.broadcastEvent(event); }
  private showToast(message: string): void {
    const toast = this.root.querySelector<HTMLElement>('#toast'); if (toast) { toast.textContent = message; toast.classList.remove('hidden'); window.setTimeout(() => toast.classList.add('hidden'), 2800); }
  }
  private hideToast(): void { this.root.querySelector('#toast')?.classList.add('hidden'); }
  private showError(message: string): void { const node = this.root.querySelector<HTMLElement>('#error-message'); if (node) { node.textContent = message; node.classList.remove('hidden'); } }
  private clearError(): void { const node = this.root.querySelector<HTMLElement>('#error-message'); if (node) { node.textContent = ''; node.classList.add('hidden'); } }

  private leaveRoom(): void {
    if (this.room?.isHost) this.signaling?.send({ type: 'leave-room' });
    this.endSession(true);
  }
  private endSession(showLobby: boolean): void {
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
    this.peerMesh?.close(); this.peerMesh = undefined;
    this.signaling?.close(); this.signaling = undefined;
    this.room = undefined; this.names.clear(); this.hoops = []; this.remoteMasks.clear(); this.remoteInputSequences.clear(); this.remoteInputTimes.clear(); this.snapshotSequence = 0; this.inputSequence = 0; this.pendingShuffle = null;
    this.state = createPlaneState(); this.latestSnapshot = undefined; this.previousSnapshot = undefined;
    this.root.querySelector('#game-hud')?.classList.add('hidden'); this.root.querySelector('#result-overlay')?.classList.add('hidden');
    this.root.querySelector('.shell')?.classList.remove('game-active');
    const roomView = this.root.querySelector('#room-view'); roomView?.classList.add('hidden'); if (roomView) roomView.innerHTML = '';
    this.root.querySelector('#create-form')?.classList.remove('hidden');
    this.root.querySelector('#join-form')?.classList.add('hidden');
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'create'));
    this.root.querySelector('.tabs')?.classList.remove('hidden');
    this.root.querySelector('#lobby-wrap')?.classList.toggle('hidden', !showLobby);
    this.hideToast(); this.clearError();
  }
}
