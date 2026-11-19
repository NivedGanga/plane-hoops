# Architectural and Design Decisions

- **Firebase Project Selection**: Reused active project `spark-7ca4b` with Firestore Native and Anonymous Authentication enabled because Google Cloud project creation quota was exceeded on the Google account.
- **Signaling Architecture**: WebRTC star topology with host authority; signaling messages exchanged via Firestore `rooms/{code}/signals/{id}` subcollection and deleted immediately upon consumption.
- **Anti-Cheat Scope**: Leaderboard scores are host-reported; anti-cheat verification and Byzantine host mitigation are out of scope for this version.
- **Course Generation**: Mulberry32 32-bit seeded pseudo-random number generator used for deterministic, synchronized course reproduction across peers.
- **Reachability Calculations**: Kinematic reachability envelope formulation incorporates linear aerodynamic drag and terminal steering velocity to guarantee all spawned hoops are feasible for optimal steering.
- **TURN Provider Integration**: Integrated standard RFC 5766 REST API credential generation via Vercel serverless function `api/turn.ts` compatible with OpenRelay, Metered.ca, and Coturn; falls back gracefully to Google public STUN when TURN environment variables are unset.
- **Collision Detection**: Implemented swept-plane segment intersection to prevent fast plane crossings from tunneling through hoop triggers.
- **Control Input Model**: Clients transmit raw held-key bitmasks (W, A, S, D) rather than direction vectors; host translates keys to authoritative directions based on the active shuffle state at the exact simulation tick.
