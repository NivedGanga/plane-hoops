# Plane & Hoops Protocol Specification

## 1. Firestore Data Model

### Rooms Collection: `rooms/{code}`
- `code`: string (6 uppercase alphanumeric characters excluding ambiguous letters)
- `hostUid`: string (anonymous auth UID of host)
- `name`: string (1 to 24 characters)
- `size`: number (2 or 4)
- `status`: "lobby" | "playing" | "closed"
- `runCount`: number (non-negative integer)
- `createdAt`: number (Unix epoch timestamp)

### WebRTC Signals Subcollection: `rooms/{code}/signals/{id}`
- `from`: string (sender user UID)
- `to`: string (recipient user UID)
- `kind`: "offer" | "answer" | "ice"
- `payload`: string (serialized JSON description or candidate)
- `createdAt`: number (Unix epoch timestamp)
Signals older than 10 minutes are ignored. Recipients delete signals upon consumption.

### Leaderboard Collection: `leaderboard/{ownerUid}__{nameKey}`
- Document ID: `${ownerUid}__${nameKey}`
- `ownerUid`: string (host UID)
- `teamName`: string (1 to 24 characters)
- `nameKey`: string (whitespace-collapsed, trimmed, lowercased room name)
- `members`: string[] (1 to 4 items, each 1 to 16 characters)
- `points`: number (>= 0)
- `hoopsCleared`: number (>= 0)
- `distanceM`: number (>= 0)
- `updatedAt`: number (timestamp)

---

## 2. WebRTC Data Channels

### `input` Channel (Unordered, Unreliable, maxRetransmits: 0)
Sent by remote clients to host on keydown/keyup:
```json
{
  "type": "input",
  "seq": 104,
  "bits": 5
}
```
Bitmask flags:
- Bit 0 (1): KeyW
- Bit 1 (2): KeyA
- Bit 2 (4): KeyS
- Bit 3 (8): KeyD

### `state` Channel (Unordered, Unreliable, 20 Hz)
Broadcast by host to remote clients:
```json
{
  "type": "state",
  "tick": 720,
  "seq": 240,
  "plane": {
    "x": 12.4,
    "y": 68.2,
    "z": 1540.0,
    "vx": 4.1,
    "vy": 1.2,
    "vz": 65.5,
    "pitch": 0.018,
    "yaw": 0.062,
    "roll": -0.128
  },
  "effects": {
    "boostRemainingTicks": 0,
    "magneticRemainingTicks": 60,
    "magneticDirection": "left"
  },
  "score": 145,
  "clearedHoops": 12,
  "distanceM": 1540,
  "isCrashed": false,
  "runEndReason": null
}
```

### `events` Channel (Ordered, Reliable)
Host authoritative lifecycle and course events:
- `run_start`: `{ type: "run_start", seed: number, playerCount: 2 | 4, startTick: number, startingBindings: KeyBinding[] }`
- `hoop_batch`: `{ type: "hoop_batch", hoops: Hoop[] }`
- `shuffle_warning`: `{ type: "shuffle_warning", warningTick: number, effectiveTick: number, nextBindings: KeyBinding[] }`
- `shuffle_applied`: `{ type: "shuffle_applied", effectiveTick: number, bindings: KeyBinding[] }`
- `hoop_cleared`: `{ type: "hoop_cleared", hoopId: number, hoopType: string, points: number, totalScore: number }`
- `hoop_missed`: `{ type: "hoop_missed", hoopId: number }`
- `crash`: `{ type: "crash", tick: number, distanceM: number, score: number, hoopsCleared: number }`
- `run_end`: `{ type: "run_end", reason: "crash" | "host_ended" | "connection_lost" }`
- `peer_state`: `{ type: "peer_state", seats: PeerSeatInfo[] }`
