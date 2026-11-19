# Decisions and current limitations

- Project is dedicated to this game in the only connected Supabase organization, in `ap-south-1`; the connector quoted $0/month.
- Supabase anonymous sign-in is required for the requested security model; it is currently disabled and could not be enabled through the available connector or an unauthenticated dashboard session. Migrations were not applied because the specification requires confirming this setting first.
- The public GitHub repository is `NivedGanga/plane-hoops`; the Vercel connector reported no stored authentication and no unattended deployment credential was available, so no production deployment is claimed.
- The GitHub Actions CI job did not start: GitHub reported the account is locked due to a billing issue. Local typecheck, tests and build passed, but this is not a passing remote CI run.
- Metered Open Relay is the planned free-tier TURN provider, with server-only `METERED_DOMAIN` and `METERED_SECRET_KEY`; its published free allowance is 20 GB/month. No credentials were available, so STUN-only is the fallback and some networks cannot connect.
- Metered notes that fresh credentials can take up to two minutes to propagate and expire during ongoing sessions; production TURN rotation and long-session behavior need validation before relying on the fallback-resistant relay.
- The public Supabase publishable/anon key is expected in the frontend; row-level security is the security boundary. Never expose a service-role key.
- Leaderboard scores are host-reported and anti-cheat is out of scope.
- Supabase free-tier projects may pause after inactivity, making the game unavailable until restored.
- Existing deterministic simulation tests run 30 virtual minutes and a separate 150 ms/5% loss model; these do not prove real browser WebRTC or TURN behavior.
- Live database RLS, room creation/joining, leaderboard writes, two-/four-client gameplay, ICE recovery and relay-only tests have not run; the two passing Playwright cases are lobby smoke tests only.
- Supabase signaling uses database inserts and Realtime rather than a custom signaling server, to match the requested infrastructure.
- Migration files are prepared for the connected Supabase migration tool, but are not yet applied or verified against the live project.
- A maximum of ten future hoops is used for a compact reliable buffer; booster share is 18% and generated course geometry is seeded for repeatable play.
- The default STUN server is `stun:stun.l.google.com:19302`; no static TURN secret is put in frontend variables.
