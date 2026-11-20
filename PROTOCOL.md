# Ship & Holes protocol

The host is the sole simulation authority. Players use Supabase anonymous authentication and database signaling only to find a room and exchange WebRTC offers, answers and ICE candidates. Game state travels over direct host-to-client WebRTC data channels, not through Supabase. Remote pilots do not connect to one another.

## Database signaling

- `rooms`: `{code, host_uid, name, size, status, run_count, created_at}`. Codes have six characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; size is 2 or 4. Host owns the row; status is `lobby`, `playing`, or `closed`.
- `get_room(p_code)` returns the corresponding non-closed room to authenticated callers. Clients can join only while status is `lobby`.
- `signals`: `{id, room_code, from_uid, to_uid, kind, payload, created_at}`. `kind` is `offer`, `answer` or `ice`. A sender may insert as itself; only the addressed user may select or delete a row. Receivers subscribe to `signals` INSERT events filtered by their UID, backfill after subscribing, deduplicate by ID and delete consumed messages.
- A joiner sends an SDP offer containing its display name. The host assigns a free seat and sends an answer with `{sdp, seatId, maxPlayers, localSeats}`. ICE payloads are `{candidate}`. Candidates may be queued until the remote description is set. Clients initiate ICE-restart offers for interrupted links.
- `leaderboard`: owner UID and normalized team-name key identify a host-owned latest result. All authenticated users may read; only the row owner may modify it. Results are host-reported and not cheat-proof.

Room codes are invitation secrets, not authentication. These policies do not provide membership-based authorization for signal inserts. Live database security and short two-browser multiplayer tests pass, but stronger anti-abuse controls (including CAPTCHA/rate limits for anonymous sign-ins), four-player, ICE recovery, and TURN testing remain before treating the service as production-hardened.

## WebRTC channels

Each joiner creates three data channels on its connection to the host:

- `input`: unordered, `maxRetransmits: 0`; client sends `{type:"input", sequence, heldKeyMask, clientTick}`. Bit values are W=1, A=2, S=4, D=8. The host filters by current seat ownership and drops excess traffic.
- `state`: unordered and unreliable; host sends `{type:"state", snapshot, bindings}`. Snapshots include a sequence and tick, position, velocity, headings, speed, score, phase, elapsed time and remaining effect ticks. Older sequences are discarded. Static rock geometry is never retransmitted in these high-rate snapshots.
- `events`: reliable and ordered; the host sends round start/end/crash, `hoop-batch` geometry, `hoop-cleared` scoring, `rock-removed` retirement, booster and magnetic activations, seat changes, warnings and shuffle commands. A batch carries `Hoop[]` records with stable ID, type, world position, radius, slab thickness, local 24-point outline, decoy flag, and effect direction; this single definition drives rendering and collision. The host streams enough geometry to keep ten scored holes and the 1,500 m collision horizon ahead. A scored hole clears only after the full ship envelope leaves the back of its slab. Passing a hole or missing a rock without touching it does not end the run; the first swept ship-versus-rock contact ends it. The authoritative `crash` event carries the rock ID, impact point, ship position, tick, score, rounded distance, and holes-cleared count so every peer can show the same seeded breakup. Peers start the white flash, expanding shockwave and 0.6 s camera shake on impact, then show results two seconds later; late unreliable snapshots cannot undo the crash state.
- After a successful leaderboard write, the host sends `{type:"leaderboard-updated"}` so clients refresh their results leaderboard.

`BindingSet` contains `playerCount`, `directionSeat`, and `directionKey`, each assigning the four directions to one seat and one W/A/S/D key. The host broadcasts the authoritative values, including future shuffle timing.

A connection interruption pauses the host and attempts ICE restart; after 15 seconds the run ends as connection-lost and is not submitted. Host migration and new joins in a running game are not supported. Actual reconnect, relay-only and four-client behavior still require live verification.
