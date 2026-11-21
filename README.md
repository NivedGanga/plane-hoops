# Cloudline: Asteroid Corridor

A cooperative browser space-flight game: two or four pilots share one ship, one score, and W/A/S/D. The host runs the simulation and each remote pilot connects directly to the host using WebRTC.

> **Live deployment:** [plane-hoops-supabase.vercel.app](https://plane-hoops-supabase.vercel.app) uses the existing `main` branch and `plane-hoops-production` Supabase project. The latest deployment revision and verification status are recorded in [DECISIONS.md](DECISIONS.md). No multiplayer database migration is needed for the corridor update.

## Local setup

Use Node.js 22 or newer. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and its **publishable or anon** key. Do not put a service-role key in a frontend variable or the repository.

```bash
npm ci
npm run dev
```

Open the Vite URL. A working Supabase project must have anonymous sign-ins enabled, the migration applied, and Realtime enabled on `signals`. The anonymous identity is persisted in the browser; clearing site data changes host identity and forfeits access to the old host's leaderboard rows.

```bash
npm run typecheck
npm test
npm run test:browser    # install Playwright Chromium first: npx playwright install --with-deps chromium
npm run build
```

The Vitest network test models latency and packet loss but is not a real WebRTC or TURN test. An opt-in Playwright smoke test in `tests/integration/` checks that two real browser contexts establish a WebRTC connection and complete a short game using the live project; it suppresses test leaderboard writes. The live security tests are skipped unless `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set; they require anonymous sign-ins and all migrations. Do not run them against an unrelated project.

## Supabase setup

1. For a fresh environment, enable **Authentication → Sign In / Providers → Anonymous sign-ins** and confirm `signInAnonymously()` succeeds before applying migrations. This setting is already enabled on the dedicated `plane-hoops-production` project.
2. Apply all SQL files in `supabase/migrations/` in filename order using Supabase migration tooling. The production project's migration history is aligned with these files. They create `rooms`, `signals`, and `leaderboard`, RLS policies, `get_room`, the ranking index, and the Realtime publication entry. Optional `pg_cron` signal cleanup is enabled only if the extension and permissions exist.
3. Set `VITE_SUPABASE_URL` to the project URL and `VITE_SUPABASE_ANON_KEY` to its public publishable or legacy anon key. All database and Realtime operations require an authenticated anonymous session. RLS, not secrecy of the public key, is the access-control boundary.
4. Run the security advisor and live security tests using the project URL and public key. The dedicated project's full suite passed 22/22 tests. The live suite creates anonymous test users that remain in Auth after sign-out, so remove test accounts after each run if a clean project is desired. Check [Supabase security-advisor guidance](https://supabase.com/docs/guides/database/database-linter) and review its anonymous-access and `get_room` warnings before a broad public launch.

Supabase free-tier projects can pause after inactivity, taking the game offline until the project is restored. The host reports scores; cheating prevention is not provided.

## Vercel and TURN

The existing Vercel project `plane-hoops-supabase` uses the Vite preset, tracks `main` for production, and retains `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for production and previews. The static app is served by Vercel; `api/turn.ts` obtains time-limited TURN credentials server-side when configured. Pull requests should receive preview deployments. This space-scene update leaves Supabase room/signaling tables, leaderboard RLS, and TURN configuration intact.

The selected provider is [Metered Open Relay](https://www.metered.ca/tools/openrelay/), which advertises a free monthly allowance. Set `METERED_DOMAIN` (for example `example.metered.live`) and `METERED_SECRET_KEY` as **server-only** Vercel environment variables. The endpoint requests a four-hour credential using Metered's [expiring-credential API](https://www.metered.ca/docs/turnserver-guides/expiring-turn-credentials/); no provider secret is bundled in the browser. Metered warns that newly minted credentials can take up to two minutes to propagate and expire even in an active session. Rotating them and validating relay-only long games are outstanding production tasks.

If TURN variables are absent or the provider fails, the endpoint returns no TURN servers and clients must fall back to public STUN. Some firewalls and NATs will then prevent connections. A self-hosted [coturn](https://github.com/coturn/coturn) server with time-limited REST credentials is an alternative; implement and secure a compatible credential issuer rather than putting a static TURN secret in a `VITE_` variable.

## Host and join

A host enters a room name and display name, chooses two or four seats and how many share the host keyboard, creates a room, and shares its six-character code. A remote pilot enters that code and a display name. Every seat must be occupied to start. The host can end a run or start another in the same room.

In two-player mode, the initial assignments are P1 W/D (up/left), P2 S/A (down/right). In four-player mode, P1 S is up, P2 W is down, P3 D is left, and P4 A is right. Bindings reshuffle with a warning; the top-center HUD shows each local player's current key-to-direction mapping. W/A/S/D remain typeable in lobby fields. The starship starts at 210 km/h and ramps to 320 km/h over ten minutes. The seeded asteroid field is solid everywhere except one connected, winding corridor; its spawn funnel narrows into scored waypoints, and the same route anchors define both visible rock walls and collision. Scored waypoints retain 10, 20 and 5 point values for standard, booster and magnetic effects. Missing a waypoint does not itself end the run, but touching asteroid does and breaks apart the ship. Synthesized takeoff, clear and impact effects use the HUD sound button to mute or re-enable them.

See [PROTOCOL.md](PROTOCOL.md) for schemas and [DECISIONS.md](DECISIONS.md) for decisions and outstanding verification. The project is [MIT licensed](LICENSE).
