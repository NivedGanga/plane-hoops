import { initFirebase, ensureSignedIn } from "./net/firebase";
import {
  createRoomInFirestore,
  getRoomData,
  closeAndCleanRoom,
  updateRoomStatus,
} from "./lobby/room";
import {
  getLastRoomName,
  saveLastRoomName,
  getDisplayName,
  saveDisplayName,
} from "./storage/index";
import { SimEngine } from "./sim/engine";
import {
  SeatId,
  KeyBinding,
  InputBitmask,
  RunEndReason,
  PlaneState,
  Hoop,
} from "./sim/types";
import { KeyboardTracker } from "./input/keyboard";
import { WebRTCPeer, fetchTurnServers, IceServerConfig } from "./net/webrtc";
import { FlightRenderer } from "./render/scene";
import {
  submitLeaderboardRecord,
  fetchTopLeaderboard,
  RankedLeaderboardEntry,
} from "./leaderboard/store";
import { formatRecord } from "./leaderboard/keys";
import { TUNING, msToKmh } from "../config/tuning";
import {
  HostStateSnapshotMsg,
  NetEventMsg,
  PeerSeatInfo,
  RunStartEventMsg,
} from "./net/messages";

// Application state machine
type AppScreen = "LOBBY" | "ROOM_HOST" | "ROOM_JOINER" | "PLAYING" | "RESULTS";

interface AppContext {
  currentUserUid: string;
  screen: AppScreen;
  isHost: boolean;
  mySeat: SeatId;
  roomCode: string;
  roomName: string;
  myDisplayName: string;
  roomSize: 2 | 4;
  seats: PeerSeatInfo[];
  turnConfigured: boolean;
  iceServers: IceServerConfig[];

  // Networking & Sim
  simEngine: SimEngine | null;
  remotePeers: Map<string, WebRTCPeer>; // peerUid -> WebRTCPeer
  renderer: FlightRenderer | null;
  keyboard: KeyboardTracker | null;
  currentBindings: KeyBinding[];
  myInputs: InputBitmask;

  // Run stats
  finalPoints: number;
  finalHoops: number;
  finalDistance: number;
  finalReason: RunEndReason | null;
  teamLeaderboardRank: number | null;
}

const state: AppContext = {
  currentUserUid: "",
  screen: "LOBBY",
  isHost: false,
  mySeat: "P1",
  roomCode: "",
  roomName: "",
  myDisplayName: "",
  roomSize: 2,
  seats: [],
  turnConfigured: false,
  iceServers: [],
  simEngine: null,
  remotePeers: new Map(),
  renderer: null,
  keyboard: null,
  currentBindings: [],
  myInputs: 0,
  finalPoints: 0,
  finalHoops: 0,
  finalDistance: 0,
  finalReason: null,
  teamLeaderboardRank: null,
};

// Animation and simulation loop handles
let simIntervalHandle: any = null;
let animFrameHandle: any = null;
let snapshotSeq = 0;

// Root UI Container
const uiContainer = document.getElementById("ui-container")!;
const hudOverlay = document.getElementById("hud-overlay")!;
const canvasContainer = document.getElementById("canvas-container")!;

// Bootstrap App
async function initApp() {
  state.renderer = new FlightRenderer(canvasContainer);
  state.keyboard = new KeyboardTracker((bits, seq) => {
    state.myInputs = bits;
    if (!state.isHost) {
      // Remote client sends input message to host
      for (const peer of state.remotePeers.values()) {
        peer.sendInput({ type: "input", seq, bits });
      }
    }
  });

  // Render loop
  function loop() {
    state.renderer?.render();
    animFrameHandle = requestAnimationFrame(loop);
  }
  loop();

  renderLoading("Connecting to network...");

  try {
    const user = await ensureSignedIn();
    state.currentUserUid = user.uid;

    const turnData = await fetchTurnServers();
    state.iceServers = turnData.iceServers;
    state.turnConfigured = turnData.turnConfigured;

    state.screen = "LOBBY";
    renderLobbyScreen();
  } catch (err: any) {
    renderError(`Failed to initialize: ${err.message}`);
  }
}

function renderLoading(msg: string) {
  uiContainer.innerHTML = `
    <div class="overlay-screen">
      <div class="card" style="text-align: center;">
        <div class="title">Plane & Hoops</div>
        <div class="subtitle">${msg}</div>
      </div>
    </div>
  `;
}

function renderError(msg: string) {
  uiContainer.innerHTML = `
    <div class="overlay-screen">
      <div class="card" style="text-align: center;">
        <div class="title" style="color: #ef4444;">Connection Error</div>
        <div class="subtitle">${msg}</div>
        <button onclick="location.reload()">Reload</button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// LOBBY SCREEN
// -------------------------------------------------------------
async function renderLobbyScreen() {
  hudOverlay.style.display = "none";
  const defaultRoomName = getLastRoomName() || "Acrobatic Flight";
  const defaultDisplayName = getDisplayName() || "Pilot " + state.currentUserUid.slice(0, 4);

  uiContainer.innerHTML = `
    <div class="overlay-screen">
      <div class="card">
        <div class="title">Plane & Hoops</div>
        <div class="subtitle">Real-time cooperative 2 or 4 player flight</div>

        ${
          !state.turnConfigured
            ? `<div class="notice-box">
                ℹ Running on STUN fallback; some restricted networks may fail to connect.
               </div>`
            : ""
        }

        <div style="display: flex; gap: 8px; margin: 18px 0;">
          <button id="tab-host-btn" class="btn-success" style="flex: 1;">Host New Room</button>
          <button id="tab-join-btn" style="flex: 1; background: #1e293b;">Join Room</button>
        </div>

        <div id="lobby-panel-content"></div>

        <div style="margin-top: 28px;">
          <div style="font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-size: 0.85rem; margin-bottom: 8px;">
            🏆 Global Leaderboard (Top 20)
          </div>
          <div id="lobby-leaderboard-table">Loading scores...</div>
        </div>
      </div>
    </div>
  `;

  renderHostPanel(defaultRoomName, defaultDisplayName);

  document.getElementById("tab-host-btn")?.addEventListener("click", () => {
    document.getElementById("tab-host-btn")!.className = "btn-success";
    document.getElementById("tab-join-btn")!.className = "";
    document.getElementById("tab-join-btn")!.style.background = "#1e293b";
    renderHostPanel(defaultRoomName, defaultDisplayName);
  });

  document.getElementById("tab-join-btn")?.addEventListener("click", () => {
    document.getElementById("tab-join-btn")!.className = "btn-success";
    document.getElementById("tab-host-btn")!.className = "";
    document.getElementById("tab-host-btn")!.style.background = "#1e293b";
    renderJoinPanel(defaultDisplayName);
  });

  loadLeaderboardTable("lobby-leaderboard-table");
}

function renderHostPanel(prefillRoomName: string, prefillDisplayName: string) {
  const panel = document.getElementById("lobby-panel-content")!;
  panel.innerHTML = `
    <form id="create-room-form">
      <div class="form-group">
        <label>Room / Team Name (1-24 chars)</label>
        <input type="text" id="host-room-name" maxlength="24" required value="${prefillRoomName}" />
      </div>

      <div class="form-group">
        <label>Your Display Name (1-16 chars)</label>
        <input type="text" id="host-display-name" maxlength="16" required value="${prefillDisplayName}" />
      </div>

      <div class="form-group">
        <label>Room Size</label>
        <div class="btn-group">
          <button type="button" id="size-2-btn" class="btn-accent" style="flex: 1;">2 Players</button>
          <button type="button" id="size-4-btn" style="flex: 1; background: #1e293b;">4 Players</button>
        </div>
      </div>

      <button type="submit" class="btn-success" style="width: 100%; margin-top: 12px; font-size: 1.1rem;">
        Create Room
      </button>
    </form>
  `;

  let selectedSize: 2 | 4 = 2;
  const btn2 = document.getElementById("size-2-btn")!;
  const btn4 = document.getElementById("size-4-btn")!;

  btn2.onclick = () => {
    selectedSize = 2;
    btn2.className = "btn-accent";
    btn2.style.background = "";
    btn4.className = "";
    btn4.style.background = "#1e293b";
  };

  btn4.onclick = () => {
    selectedSize = 4;
    btn4.className = "btn-accent";
    btn4.style.background = "";
    btn2.className = "";
    btn2.style.background = "#1e293b";
  };

  document.getElementById("create-room-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const roomName = (document.getElementById("host-room-name") as HTMLInputElement).value.trim();
    const displayName = (document.getElementById("host-display-name") as HTMLInputElement).value.trim();

    if (!roomName || roomName.length > 24) return;
    if (!displayName || displayName.length > 16) return;

    saveLastRoomName(roomName);
    saveDisplayName(displayName);

    state.isHost = true;
    state.roomName = roomName;
    state.myDisplayName = displayName;
    state.roomSize = selectedSize;

    renderLoading("Allocating room code...");

    try {
      const code = await createRoomInFirestore(state.currentUserUid, roomName, selectedSize);
      state.roomCode = code;
      setupHostSeats(selectedSize, displayName);
      renderHostLobby();
    } catch (err: any) {
      renderError(`Could not create room: ${err.message}`);
    }
  });
}

function renderJoinPanel(prefillDisplayName: string) {
  const panel = document.getElementById("lobby-panel-content")!;
  panel.innerHTML = `
    <form id="join-room-form">
      <div class="form-group">
        <label>Room Code (6 characters)</label>
        <input type="text" id="join-room-code" maxlength="6" placeholder="e.g. 7XKM8B" required style="text-transform: uppercase; letter-spacing: 2px;" />
      </div>

      <div class="form-group">
        <label>Your Display Name (1-16 chars)</label>
        <input type="text" id="join-display-name" maxlength="16" required value="${prefillDisplayName}" />
      </div>

      <button type="submit" class="btn-success" style="width: 100%; margin-top: 12px; font-size: 1.1rem;">
        Join Flight
      </button>
    </form>
  `;

  document.getElementById("join-room-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = (document.getElementById("join-room-code") as HTMLInputElement).value.trim().toUpperCase();
    const displayName = (document.getElementById("join-display-name") as HTMLInputElement).value.trim();

    if (code.length !== 6 || !displayName || displayName.length > 16) return;

    saveDisplayName(displayName);
    state.isHost = false;
    state.roomCode = code;
    state.myDisplayName = displayName;

    renderLoading(`Joining room ${code}...`);

    try {
      const room = await getRoomData(code);
      if (!room) {
        throw new Error("Room not found or expired");
      }
      if (room.status !== "lobby") {
        throw new Error("Run is already in progress or room is closed");
      }

      state.roomName = room.name;
      state.roomSize = room.size;

      // Connect to host via WebRTC
      connectClientToHost(room.hostUid);
      renderJoinerWaiting();
    } catch (err: any) {
      renderError(`Could not join room: ${err.message}`);
    }
  });
}

function setupHostSeats(size: 2 | 4, hostDisplayName: string) {
  state.seats = [
    {
      seat: "P1",
      displayName: hostDisplayName,
      isLocal: true,
      connected: true,
      uid: state.currentUserUid,
    },
  ];

  for (let i = 2; i <= size; i++) {
    const seatId = `P${i}` as SeatId;
    state.seats.push({
      seat: seatId,
      displayName: `Player ${i}`,
      isLocal: false,
      connected: false,
    });
  }
}

// -------------------------------------------------------------
// HOST ROOM LOBBY
// -------------------------------------------------------------
function renderHostLobby() {
  state.screen = "ROOM_HOST";
  hudOverlay.style.display = "none";

  const seatedCount = state.seats.filter((s) => s.connected || s.isLocal).length;
  const canStart = seatedCount === state.roomSize;

  uiContainer.innerHTML = `
    <div class="overlay-screen">
      <div class="card">
        <div class="title">${state.roomName}</div>
        <div class="subtitle">Room Code for others to join:</div>
        <div style="text-align: center;">
          <div class="room-code-badge">${state.roomCode}</div>
        </div>

        <div style="font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 14px;">
          Flight Roster (${seatedCount} / ${state.roomSize} seated)
        </div>

        <div class="roster-grid">
          ${state.seats
            .map(
              (s) => `
            <div class="seat-card ${s.connected || s.isLocal ? "active" : ""}">
              <div class="seat-label">${s.seat} ${s.seat === "P1" ? "(Host)" : ""}</div>
              <div style="font-weight: 700; color: #fff;">${s.displayName}</div>
              <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px;">
                ${
                  s.isLocal
                    ? "Local Keyboard"
                    : s.connected
                    ? "Connected (Remote)"
                    : "Waiting for player..."
                }
              </div>
              ${
                s.seat !== "P1" && !s.connected
                  ? `<button type="button" class="btn-toggle-local" data-seat="${s.seat}" style="font-size: 0.75rem; padding: 4px 8px; margin-top: 6px;">
                      ${s.isLocal ? "Switch to Remote" : "Make Local Seat"}
                     </button>`
                  : ""
              }
            </div>
          `
            )
            .join("")}
        </div>

        <button id="start-run-btn" class="btn-success" style="width: 100%; margin-top: 16px; font-size: 1.15rem;" ${
          canStart ? "" : "disabled"
        }>
          ${canStart ? "Start Flight" : `Waiting for ${state.roomSize - seatedCount} more player(s)...`}
        </button>

        <button id="close-room-btn" style="width: 100%; margin-top: 10px; background: #334155;">
          Close Room
        </button>
      </div>
    </div>
  `;

  // Toggle local seat
  document.querySelectorAll(".btn-toggle-local").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const seatId = (e.target as HTMLElement).getAttribute("data-seat");
      const seat = state.seats.find((s) => s.seat === seatId);
      if (seat) {
        seat.isLocal = !seat.isLocal;
        if (seat.isLocal) {
          seat.connected = true;
          seat.displayName = `Local ${seat.seat}`;
        } else {
          seat.connected = false;
          seat.displayName = `Player ${seat.seat.slice(1)}`;
        }
        renderHostLobby();
        broadcastPeerState();
      }
    });
  });

  document.getElementById("start-run-btn")?.addEventListener("click", () => {
    if (canStart) {
      startFlightRun();
    }
  });

  document.getElementById("close-room-btn")?.addEventListener("click", async () => {
    await closeAndCleanRoom(state.roomCode);
    location.reload();
  });
}

// -------------------------------------------------------------
// JOINER WAITING LOBBY
// -------------------------------------------------------------
function renderJoinerWaiting() {
  state.screen = "ROOM_JOINER";
  hudOverlay.style.display = "none";

  uiContainer.innerHTML = `
    <div class="overlay-screen">
      <div class="card" style="text-align: center;">
        <div class="title">${state.roomName}</div>
        <div class="subtitle">Room Code: <span style="color: var(--accent-cyan); font-family: monospace;">${state.roomCode}</span></div>

        <div style="margin: 24px 0;">
          <div style="font-size: 1.1rem; color: #00ff88; font-weight: 700;">
            ✓ Connected to Room!
          </div>
          <div style="color: #94a3b8; font-size: 0.9rem; margin-top: 8px;">
            Assigned Seat: <strong style="color: #fff;">${state.mySeat}</strong> (${state.myDisplayName})
          </div>
          <div style="color: #94a3b8; font-size: 0.9rem; margin-top: 14px;">
            Waiting for the host to start the flight...
          </div>
        </div>

        <button onclick="location.reload()" style="background: #334155;">Leave Room</button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// WEBRTC CONNECTION HANDLING
// -------------------------------------------------------------
function broadcastPeerState() {
  const msg: NetEventMsg = {
    type: "peer_state",
    seats: state.seats,
  };
  for (const peer of state.remotePeers.values()) {
    peer.sendEvent(msg);
  }
}

function connectClientToHost(hostUid: string) {
  const peer = new WebRTCPeer(
    state.roomCode,
    state.currentUserUid,
    hostUid,
    false,
    {
      onConnected: () => {
        console.log("Client connected to host WebRTC!");
      },
      onEvent: (msg) => {
        handleClientEvent(msg);
      },
      onState: (snapshot) => {
        handleClientSnapshot(snapshot);
      },
      onConnectionLost: () => {
        handleRunEnd("connection_lost");
      },
    }
  );

  state.remotePeers.set(hostUid, peer);
  peer.init(state.iceServers);
}

// -------------------------------------------------------------
// HOST RUN LOOP & SIMULATION
// -------------------------------------------------------------
async function startFlightRun() {
  state.screen = "PLAYING";
  uiContainer.innerHTML = "";
  hudOverlay.style.display = "flex";

  await updateRoomStatus(state.roomCode, "playing", 1);

  const seed = Math.floor(Math.random() * 1_000_000);
  state.simEngine = new SimEngine(seed, state.roomSize);
  const startBindings = state.simEngine.getState().bindings;
  state.currentBindings = startBindings;
  updateHudSeatKeys();

  // Send run_start event to all remote peers
  const startMsg: RunStartEventMsg = {
    type: "run_start",
    seed,
    playerCount: state.roomSize,
    startTick: 0,
    startingBindings: startBindings,
  };

  const initialHoopsMsg: NetEventMsg = {
    type: "hoop_batch",
    hoops: [...state.simEngine.getState().hoops],
  };

  for (const peer of state.remotePeers.values()) {
    peer.sendEvent(startMsg);
    peer.sendEvent(initialHoopsMsg);
  }

  // Host 60 Hz simulation loop
  simIntervalHandle = setInterval(() => {
    if (!state.simEngine) return;

    // Build inputs map for all seats
    const inputsBySeat = new Map<SeatId, InputBitmask>();

    // Local seats (including host P1 and any other local seat)
    for (const seat of state.seats) {
      if (seat.isLocal) {
        inputsBySeat.set(seat.seat, state.myInputs);
      }
    }

    // Remote seats: inputs are delivered via onInput callback directly

    const tickEvents = state.simEngine.step(inputsBySeat);
    const simState = state.simEngine.getState();

    // Broadcast reliable events
    if (tickEvents.shuffleWarning) {
      const msg: NetEventMsg = {
        type: "shuffle_warning",
        warningTick: tickEvents.shuffleWarning.warningTick,
        effectiveTick: tickEvents.shuffleWarning.effectiveTick,
        nextBindings: tickEvents.shuffleWarning.nextBindings,
      };
      for (const p of state.remotePeers.values()) p.sendEvent(msg);
      showShuffleWarning(tickEvents.shuffleWarning.effectiveTick);
    }

    if (tickEvents.shuffleApplied) {
      const msg: NetEventMsg = {
        type: "shuffle_applied",
        effectiveTick: simState.tick,
        bindings: tickEvents.shuffleApplied,
      };
      for (const p of state.remotePeers.values()) p.sendEvent(msg);
      state.currentBindings = tickEvents.shuffleApplied;
      updateHudSeatKeys();
      hideShuffleWarning();
    }

    if (tickEvents.newHoops) {
      const msg: NetEventMsg = {
        type: "hoop_batch",
        hoops: tickEvents.newHoops,
      };
      for (const p of state.remotePeers.values()) p.sendEvent(msg);
    }

    if (tickEvents.hoopCleared) {
      const msg: NetEventMsg = {
        type: "hoop_cleared",
        hoopId: tickEvents.hoopCleared.hoopId,
        hoopType: tickEvents.hoopCleared.type,
        points: tickEvents.hoopCleared.pointsAwarded,
        totalScore: simState.score,
      };
      for (const p of state.remotePeers.values()) p.sendEvent(msg);
    }

    // Host 20 Hz snapshot broadcast (every 3 ticks at 60 Hz)
    if (simState.tick % TUNING.NETWORK_SNAPSHOT_INTERVAL_TICKS === 0) {
      const snapshot: HostStateSnapshotMsg = {
        type: "state",
        tick: simState.tick,
        seq: ++snapshotSeq,
        plane: simState.plane,
        effects: simState.effects,
        score: simState.score,
        clearedHoops: simState.clearedHoopsCount,
        distanceM: simState.distanceM,
        isCrashed: simState.isCrashed,
        runEndReason: simState.runEndReason,
      };

      for (const p of state.remotePeers.values()) {
        p.sendState(snapshot);
      }
    }

    // Update 3D scene & HUD on host
    state.renderer?.updatePlane(simState.plane);
    state.renderer?.updateCourseHoops(simState.hoops);
    updateHud(simState);

    // Check if run crashed
    if (simState.isCrashed) {
      clearInterval(simIntervalHandle);
      simIntervalHandle = null;

      const crashMsg: NetEventMsg = {
        type: "crash",
        tick: simState.tick,
        distanceM: simState.distanceM,
        score: simState.score,
        hoopsCleared: simState.clearedHoopsCount,
      };
      for (const p of state.remotePeers.values()) p.sendEvent(crashMsg);

      handleRunEnd("crash");
    }
  }, 1000 / TUNING.SIM_TICK_RATE);
}

// -------------------------------------------------------------
// CLIENT EVENT & SNAPSHOT HANDLERS
// -------------------------------------------------------------
let latestAppliedSnapshotTick = 0;

function handleClientSnapshot(snapshot: HostStateSnapshotMsg) {
  if (snapshot.tick <= latestAppliedSnapshotTick) return;
  latestAppliedSnapshotTick = snapshot.tick;

  state.renderer?.updatePlane(snapshot.plane);

  // Update client HUD
  document.getElementById("hud-speed")!.textContent = Math.round(
    msToKmh(snapshot.plane.vz)
  ).toString();
  document.getElementById("hud-score")!.textContent = snapshot.score.toString();
  document.getElementById("hud-hoops")!.textContent = snapshot.clearedHoops.toString();
  document.getElementById("hud-distance")!.textContent = snapshot.distanceM.toLocaleString();

  // Effects
  const boostBadge = document.getElementById("boost-badge")!;
  const magBadge = document.getElementById("magnetic-badge")!;
  boostBadge.style.display = snapshot.effects.boostRemainingTicks > 0 ? "block" : "none";
  if (snapshot.effects.magneticRemainingTicks > 0 && snapshot.effects.magneticDirection) {
    magBadge.style.display = "block";
    document.getElementById("magnetic-dir")!.textContent =
      snapshot.effects.magneticDirection.toUpperCase();
  } else {
    magBadge.style.display = "none";
  }

  if (snapshot.isCrashed && snapshot.runEndReason) {
    handleRunEnd(snapshot.runEndReason);
  }
}

function handleClientEvent(msg: NetEventMsg) {
  switch (msg.type) {
    case "run_start":
      state.screen = "PLAYING";
      uiContainer.innerHTML = "";
      hudOverlay.style.display = "flex";
      state.currentBindings = msg.startingBindings;
      updateHudSeatKeys();
      break;

    case "hoop_batch":
      state.renderer?.updateCourseHoops(msg.hoops);
      break;

    case "shuffle_warning":
      showShuffleWarning(msg.effectiveTick);
      break;

    case "shuffle_applied":
      state.currentBindings = msg.bindings;
      updateHudSeatKeys();
      hideShuffleWarning();
      break;

    case "crash":
      handleRunEnd("crash");
      break;

    case "run_end":
      handleRunEnd(msg.reason);
      break;

    case "peer_state":
      state.seats = msg.seats;
      // Determine my seat assignment
      const found = state.seats.find((s) => s.uid === state.currentUserUid);
      if (found) state.mySeat = found.seat;
      if (state.screen === "ROOM_JOINER") renderJoinerWaiting();
      break;
  }
}

// -------------------------------------------------------------
// HUD DISPLAY UPDATES
// -------------------------------------------------------------
let warningCountdownTimer: any = null;

function showShuffleWarning(effectiveTick: number) {
  const banner = document.getElementById("shuffle-warning-banner");
  const countEl = document.getElementById("shuffle-countdown");
  if (!banner || !countEl) return;

  banner.style.display = "inline-block";
  let secondsLeft = 3;
  countEl.textContent = secondsLeft.toString();

  if (warningCountdownTimer) clearInterval(warningCountdownTimer);
  warningCountdownTimer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(warningCountdownTimer);
    } else {
      countEl.textContent = secondsLeft.toString();
    }
  }, 1000);
}

function hideShuffleWarning() {
  if (warningCountdownTimer) {
    clearInterval(warningCountdownTimer);
    warningCountdownTimer = null;
  }
  const banner = document.getElementById("shuffle-warning-banner");
  if (banner) banner.style.display = "none";
}

function updateHud(simState: any) {
  const speedKmh = Math.round(msToKmh(simState.plane.vz));
  document.getElementById("hud-speed")!.textContent = speedKmh.toString();
  document.getElementById("hud-score")!.textContent = simState.score.toString();
  document.getElementById("hud-hoops")!.textContent = simState.clearedHoopsCount.toString();
  document.getElementById("hud-distance")!.textContent = simState.distanceM.toLocaleString();

  // Effects
  const boostBadge = document.getElementById("boost-badge")!;
  const magBadge = document.getElementById("magnetic-badge")!;
  boostBadge.style.display = simState.effects.boostRemainingTicks > 0 ? "block" : "none";
  if (simState.effects.magneticRemainingTicks > 0 && simState.effects.magneticDirection) {
    magBadge.style.display = "block";
    document.getElementById("magnetic-dir")!.textContent =
      simState.effects.magneticDirection.toUpperCase();
  } else {
    magBadge.style.display = "none";
  }
}

function updateHudSeatKeys() {
  const seatLabel = document.getElementById("hud-seat-label");
  const keysContainer = document.getElementById("hud-keys-container");
  if (!seatLabel || !keysContainer) return;

  seatLabel.textContent = `${state.mySeat} CONTROLS:`;

  const myBindings = state.currentBindings.filter((b) => b.seat === state.mySeat);
  keysContainer.innerHTML = myBindings
    .map((b) => {
      const keyLetter = b.key.replace("Key", "");
      return `
        <div class="key-pill">
          <div class="key-badge">${keyLetter}</div>
          <div class="key-dir">${b.direction}</div>
        </div>
      `;
    })
    .join("");
}

// -------------------------------------------------------------
// RESULTS & LEADERBOARD SCREEN
// -------------------------------------------------------------
async function handleRunEnd(reason: RunEndReason) {
  state.screen = "RESULTS";
  hudOverlay.style.display = "none";
  hideShuffleWarning();

  if (simIntervalHandle) {
    clearInterval(simIntervalHandle);
    simIntervalHandle = null;
  }

  if (state.simEngine) {
    const s = state.simEngine.getState();
    state.finalPoints = s.score;
    state.finalHoops = s.clearedHoopsCount;
    state.finalDistance = s.distanceM;
  }

  state.finalReason = reason;

  // Leaderboard submission rules:
  // Submitted on crash or host_ended. Never submitted on connection_lost!
  if (state.isHost && (reason === "crash" || reason === "host_ended")) {
    try {
      const memberNames = state.seats.map((s) => s.displayName || s.seat);
      await submitLeaderboardRecord({
        ownerUid: state.currentUserUid,
        teamName: state.roomName,
        members: memberNames,
        points: state.finalPoints,
        hoopsCleared: state.finalHoops,
        distanceM: state.finalDistance,
      });
    } catch (err) {
      console.error("Leaderboard submit error:", err);
    }
  }

  renderResultsScreen();
}

async function renderResultsScreen() {
  const isConnectionLost = state.finalReason === "connection_lost";

  uiContainer.innerHTML = `
    <div class="overlay-screen">
      <div class="card" style="text-align: center;">
        <div class="title" style="color: ${isConnectionLost ? "#fbbf24" : "#ef4444"};">
          ${isConnectionLost ? "Connection Lost" : "Flight Ended"}
        </div>
        <div class="subtitle">
          ${
            isConnectionLost
              ? "A peer disconnected and could not recover via ICE restart."
              : "Airplane exited flight boundaries or crashed."
          }
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0;">
          <div class="hud-stat-box">
            <div class="hud-lbl">Points</div>
            <div class="hud-val" style="color: #00f0ff;">${state.finalPoints}</div>
          </div>
          <div class="hud-stat-box">
            <div class="hud-lbl">Hoops Cleared</div>
            <div class="hud-val" style="color: #00ff88;">${state.finalHoops}</div>
          </div>
          <div class="hud-stat-box">
            <div class="hud-lbl">Distance</div>
            <div class="hud-val">${state.finalDistance.toLocaleString()} m</div>
          </div>
        </div>

        ${
          state.isHost
            ? `<button id="btn-new-run" class="btn-success" style="width: 100%; font-size: 1.1rem; margin-top: 10px;">
                Start New Run
               </button>`
            : `<div style="color: #94a3b8; font-size: 0.95rem; margin: 12px 0;">
                Waiting for host to start a new run...
               </div>`
        }

        <button id="btn-return-lobby" style="width: 100%; margin-top: 10px; background: #334155;">
          Return to Lobby
        </button>

        <div style="margin-top: 24px; text-align: left;">
          <div style="font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-size: 0.85rem; margin-bottom: 8px;">
            🏆 Leaderboard
          </div>
          <div id="results-leaderboard-table">Loading...</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-new-run")?.addEventListener("click", () => {
    startFlightRun();
  });

  document.getElementById("btn-return-lobby")?.addEventListener("click", () => {
    state.screen = "LOBBY";
    renderLobbyScreen();
  });

  loadLeaderboardTable("results-leaderboard-table");
}

async function loadLeaderboardTable(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const list = await fetchTopLeaderboard(20);
    if (list.length === 0) {
      container.innerHTML = `<div style="color: #64748b; font-size: 0.9rem;">No records logged yet. Be the first!</div>`;
      return;
    }

    container.innerHTML = `
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team Name</th>
            <th>Members</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (e) => `
            <tr>
              <td class="rank-${e.rank}">#${e.rank}</td>
              <td style="font-weight: 600; color: #fff;">${escapeHtml(e.teamName)}</td>
              <td style="color: #cbd5e1;">${escapeHtml(e.members.join(", "))}</td>
              <td style="color: #00f0ff; font-family: monospace;">${formatRecord(e.points, e.hoopsCleared)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  } catch (err: any) {
    container.innerHTML = `<div style="color: #ef4444; font-size: 0.85rem;">Failed to load leaderboard: ${err.message}</div>`;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Start
initApp();
