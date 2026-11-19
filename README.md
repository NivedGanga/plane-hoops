# Plane & Hoops

A real-time multiplayer flight game where 2 or 4 players cooperatively steer a single airplane through an endless course of rings over WebRTC.

## Features
- **Cooperative Airplane Flight**: Players steer the plane together using W, A, S, and D.
- **Dynamic Control Reshuffling**: Key bindings reshuffle periodically with a 3-second synchronized advance warning.
- **Endless Procedural Course**: Ring generation with swept collision checks, energy speed boosters, and magnetic steering anomalies.
- **WebRTC Star Architecture**: Host-authoritative physics simulation running at 60 Hz with 20 Hz state snapshot broadcasts and client interpolation.
- **Signaling via Firebase**: Automatic WebRTC negotiation via Cloud Firestore signals and Anonymous Authentication.
- **Persistent Leaderboard**: Top 20 scores sorted by points and distance with host-keyed overwrite rules.

## Local Setup
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env` with Firebase credentials:
   ```bash
   cp .env.example .env
   ```
3. Start the Vite local development server:
   ```bash
   npm run dev
   ```
4. Run unit and integration tests:
   ```bash
   npm test
   ```

## Firebase Setup
1. Enable Cloud Firestore in Native mode and Anonymous Authentication in the Firebase Console.
2. Deploy Firestore security rules and composite indexes:
   ```bash
   npx firebase-tools deploy --only firestore
   ```

## Vercel Deployment & Environment Variables
Set the following environment variables in your Vercel project:
- `VITE_FIREBASE_API_KEY`: Firebase web API key
- `VITE_FIREBASE_AUTH_DOMAIN`: Firebase auth domain
- `VITE_FIREBASE_PROJECT_ID`: Firebase project ID
- `VITE_FIREBASE_STORAGE_BUCKET`: Firebase storage bucket
- `VITE_FIREBASE_MESSAGING_SENDER_ID`: Firebase messaging sender ID
- `VITE_FIREBASE_APP_ID`: Firebase web application ID
- `TURN_URL`: Optional TURN server URL (e.g. `turn:openrelay.metered.ca:80`)
- `TURN_SECRET`: Optional TURN HMAC authentication secret
- `TURN_USERNAME_PREFIX`: Optional TURN username prefix

### STUN Fallback & Coturn Alternative
If TURN environment variables are not supplied, the game automatically falls back to Google public STUN servers (`stun.l.google.com:19302`). For self-hosted deployments, coturn can be run with standard static HMAC authentication (`use-auth-secret` and `static-auth-secret`).

## How to Play
- **Host a Room**: Enter a room name (1-24 characters), select 2 or 4 players, enter your display name, and click "Create Room". Share the 6-character room code with teammates.
- **Join a Room**: Enter the 6-character room code and your display name, then click "Join Flight".
- **Controls**: Look at the bottom HUD to see your assigned keys (W, A, S, D) and directions (Up, Down, Left, Right). When a shuffle countdown triggers, prepare for your controls to swap!
