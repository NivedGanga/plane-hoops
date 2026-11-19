// Configuration constants for Plane-and-Hoops
// All tunable numeric constants specified in the prompt and physics tuning

export const TUNING = {
  // Timing & Network
  SIM_TICK_RATE: 60, // 60 Hz simulation
  SIM_DT: 1 / 60, // 0.016667 s per tick
  NETWORK_SNAPSHOT_RATE: 20, // 20 Hz host state snapshots
  NETWORK_SNAPSHOT_INTERVAL_TICKS: 3, // 60 / 20 = every 3 ticks
  CLIENT_RENDER_DELAY_MS: 100, // Client interpolation buffer: 100 ms
  MAX_PEER_INPUTS_PER_SEC: 120, // Rate limit for client input messages
  ICE_RESTART_TIMEOUT_MS: 15_000, // 15 seconds to recover connection before ending run
  SIGNAL_EXPIRY_MS: 10 * 60 * 1000, // 10 minutes signal freshness

  // Speeds (forward velocity)
  MIN_SPEED_KMH: 200, // Never drops below 200 km/h (55.55 m/s)
  START_SPEED_KMH: 210, // Starts at 210 km/h (58.33 m/s)
  MAX_SPEED_KMH: 320, // Hard speed cap at 320 km/h (88.89 m/s)
  SPEED_RAMP_DURATION_SEC: 600, // 10 minutes to reach max difficulty & speed cap

  // Boosters & Effects
  BOOST_SPEED_KMH: 40, // +40 km/h speed burst
  BOOST_DURATION_SEC: 3.0, // 3 seconds speed boost
  MAGNETIC_PULL_DURATION_SEC: 2.0, // 2 seconds magnetic pull
  MAGNETIC_PULL_ACCEL: 24.0, // m/s^2 lateral/vertical acceleration applied by magnetic hoop

  // Scoring
  HOOP_POINTS_STANDARD: 10,
  HOOP_POINTS_BOOSTER: 20,
  HOOP_POINTS_MAGNETIC: 5,

  // Course generation & placement
  HOOP_SPAWN_AHEAD_MIN_M: 300,
  HOOP_SPAWN_AHEAD_MAX_M: 800,
  HOOP_SPACING_MIN_M: 120,
  HOOP_SPACING_MAX_M: 220,
  HOOP_RADIUS_START_M: 10.0,
  HOOP_RADIUS_END_M: 6.0,
  HOOP_RADIUS_RAMP_SEC: 600,
  HOOP_REACHABILITY_ENVELOPE_MIN: 0.60,
  HOOP_REACHABILITY_ENVELOPE_MAX: 0.85,
  MAGNETIC_SHARE_START: 0.10, // 10% magnetic at start
  MAGNETIC_SHARE_END: 0.25, // 25% magnetic at 10 minutes
  HOOP_DISCARD_BEHIND_M: 200, // Discard hoops >200m behind plane
  HOOP_BATCH_AHEAD_COUNT: 10, // Keep clients fed ~10 hoops ahead

  // Play volume bounds
  // Plane moves along Z-axis (forward = +Z)
  PLAY_VOLUME_X_MIN: -80,
  PLAY_VOLUME_X_MAX: 80,
  PLAY_VOLUME_Y_MIN: 10, // Ground
  PLAY_VOLUME_Y_MAX: 120, // Ceiling

  // Plane physics (lateral & vertical steering)
  // Acceleration-based with inertia, settle-back to neutral
  STEER_ACCEL: 28.0, // m/s^2 steering acceleration
  STEER_DRAG: 2.2, // Linear drag returning velocity to 0
  STEER_MAX_VEL: 32.0, // Maximum lateral / vertical velocity m/s
  MAX_TURN_RATE: 2.0, // radians/sec angular response

  // Controls & Shuffling
  SHUFFLE_WARNING_SEC: 3.0, // 3 seconds warning
  SHUFFLE_WARNING_TICKS: 180, // 3 * 60 ticks
  SHUFFLE_MIN_GAP_SEC: 8.0, // Minimum 8 seconds between shuffles
  SHUFFLE_MIN_GAP_TICKS: 480, // 8 * 60 ticks
  SHUFFLE_START_MIN_SEC: 12.0,
  SHUFFLE_START_MAX_SEC: 20.0,
  SHUFFLE_END_MIN_SEC: 10.0,
  SHUFFLE_END_MAX_SEC: 14.0,

  // Room & Identity
  ROOM_NAME_MIN_LEN: 1,
  ROOM_NAME_MAX_LEN: 24,
  DISPLAY_NAME_MIN_LEN: 1,
  DISPLAY_NAME_MAX_LEN: 16,
  ROOM_CODE_LEN: 6,
  ROOM_CODE_CHARSET: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  LEADERBOARD_TOP_N: 20,
} as const;

export function kmhToMs(kmh: number): number {
  return (kmh * 1000) / 3600;
}

export function msToKmh(ms: number): number {
  return (ms * 3600) / 1000;
}
