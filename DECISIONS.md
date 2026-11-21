# Decisions and current limitations

## Environment and deployment

- The game uses the dedicated `plane-hoops-production` Supabase project in `ap-south-1`. Anonymous sign-ins are enabled, and the existing migrations create the room, signaling, and leaderboard tables and policies.
- The public GitHub repository is `NivedGanga/plane-hoops`; the existing Vercel project is `plane-hoops-supabase` at https://plane-hoops-supabase.vercel.app. Production is intended to track `main`, with the existing Supabase URL and public-key variables retained.
- The earlier Supabase implementation was moved onto `main` without force-pushing; its unrelated Firebase history remains a secondary merge parent. The earlier production revision `e6f7d8e71ace7f6bc5da7cc05521bda443d48216` reached READY. A previous two-local-pilot production run verified the crash-to-leaderboard path; only its unique test row and room were removed.
- Corridor release `28991aa24da4ae82f071eeeff65621c0331554a6` (`Replace asteroid holes with a continuous corridor`) deployed from `main` as Vercel production deployment `dpl_HFupV1khfA34kVLnmUpWRACyYonf`. Vercel reports READY, with `plane-hoops-supabase.vercel.app` assigned as a production alias; the canonical URL returned HTTP 200 after publication.
- The Supabase publishable/anon key is expected in the frontend; row-level security is the access-control boundary. Never expose a service-role key. Leaderboard scores are host-reported and not cheat-proof.
- Supabase free-tier projects can pause after inactivity. The security advisor has flagged the `SECURITY DEFINER` room lookup and anonymous-user abuse exposure; add CAPTCHA/rate limits and review policies before treating the service as hardened.
- Metered Open Relay is the planned TURN provider, but credentials are not configured. Clients fall back to public STUN, so some networks may not connect; four-hour credential rotation and relay-only long sessions remain unverified.
- Supabase Realtime/database inserts are used only for room discovery and WebRTC signaling. The host remains simulation authority; gameplay travels directly over WebRTC data channels.

## Current asteroid corridor design

- The asteroid field is solid everywhere outside one connected, winding flyable corridor. Scored waypoints are anchors along that route, not isolated rings with holes; the legacy `decoy` field remains false and no detached rocks are generated.
- Each route anchor retains its stable ID, waypoint type and position, corridor radius, and a seeded 24-point outline describing the surrounding asteroid-field boundary. Rendering and collision interpolate the same adjacent anchors, including the spawn-to-first-waypoint transition.
- The spawn funnel starts with a 24 m radius and tapers to the first scored waypoint. Waypoint radius narrows from 12.5 m to 8 m over the first ten minutes; waypoint spacing contracts from 120–220 m to 120–170 m. Route centers follow a bounded winding path.
- Seven collision spheres cover the fuselage, nose/tail, wings, and wing tips. Their swept centers are checked against the interpolated safe corridor at 0.25 m maximum sample spacing, with half-step expansion; leaving the passage and touching asteroid ends the run. A missed waypoint alone remains harmless. A waypoint scores only when the full ship envelope clears its station inside its radius.
- The 3 m ship collision envelope leaves at least the configured 1.5 m minimum physical clearance at the narrowest waypoint radius. The starting funnel is intentionally wider to make the approach fair.
- Host-generated route anchors and retirements continue to use reliable ordered WebRTC events. State snapshots remain compact; the 1,500 m collision horizon and 450 m cleanup-behind window bound the active route. Geometry segments are disposed as old route sections retire.
- Existing wire record fields, Supabase tables, leaderboard behavior, and migrations are unchanged. The corridor redesign needs no database migration.
- Ship controls, co-op seat assignments and shuffles, audio, waypoint scoring/effects, leaderboard submission, crash breakup, result delay, and restart remain in place.

## Verification and remaining work

- Current local verification: TypeScript typecheck passed; the production build passed with the existing large-bundle advisory; 25 unit/network/simulation tests passed; all 6 Playwright browser tests passed. Eight optional live Supabase security tests were skipped because credentials were not configured.
- The long-course tests now include a corridor-following optimal pilot that clears at least 95% of a seeded 1,000-waypoint course, a random-input comparison under the existing threshold, 10,000 seeded wall-contact sweeps, 128 seeded corridor-clearance courses, and a 30-minute collision-free run with bounded active geometry.
- Earlier two-browser and live RLS checks predate this corridor redesign. Current remote-peer, four-player, ICE recovery, relay-only, reconnect, and long-running live network acceptance still need fresh verification.
- Production redeployment for the corridor redesign is complete: release commit `28991aa24da4ae82f071eeeff65621c0331554a6` reached READY as deployment `dpl_HFupV1khfA34kVLnmUpWRACyYonf`, and the canonical production alias returned HTTP 200.

## Historical design notes

- Superseded: the earlier flight scene used irregular asteroid slabs with circular apertures, slab thickness, and detached decoys. These are replaced by the single continuous corridor and surrounding solid asteroid field described above.
- Superseded: the earlier waypoint radius range was 9 m to 5.5 m, and collision tested the ship against slab cross-sections. Current waypoint radii and continuous-corridor collision are described above.
- Superseded: earlier visible copy called the goals “holes”; the current HUD identifies “Waypoints passed” and tells pilots to stay inside the open asteroid corridor.
- Superseded: the earlier browser test inspected one extruded slab bore. Current browser coverage verifies corridor meshes, waypoint markers, impact breakup and restart, HUD layout/copy, and bounded geometry disposal.
- The earlier GitHub Actions CI run for `e6f7d8e71ace7f6bc5da7cc05521bda443d48216` passed. Vercel production branch tracking was switched to `main` before this redesign.
