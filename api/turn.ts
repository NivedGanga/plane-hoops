import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TurnApiResponse {
  iceServers: IceServerConfig[];
  turnConfigured: boolean;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const defaultStunServers: IceServerConfig[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ],
    },
  ];

  const turnSecret = process.env.TURN_SECRET;
  const turnUrl = process.env.TURN_URL; // e.g. turn:turn.example.com:3478 or turns:turn.example.com:5349
  const turnUsernamePrefix = process.env.TURN_USERNAME_PREFIX || "plane-hoops";

  if (!turnSecret || !turnUrl) {
    // Fallback: public STUN only
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        iceServers: defaultStunServers,
        turnConfigured: false,
      })
    );
    return;
  }

  try {
    // Generate standard RFC 5766 time-limited credentials (24-hour expiration)
    const expirySeconds = Math.floor(Date.now() / 1000) + 24 * 3600;
    const username = `${expirySeconds}:${turnUsernamePrefix}`;
    const hmac = crypto.createHmac("sha1", turnSecret);
    hmac.update(username);
    const credential = hmac.digest("base64");

    const turnUrls = [
      `${turnUrl}?transport=udp`,
      `${turnUrl}?transport=tcp`,
    ];

    const response: TurnApiResponse = {
      iceServers: [
        ...defaultStunServers,
        {
          urls: turnUrls,
          username,
          credential,
        },
      ],
      turnConfigured: true,
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(response));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Failed to generate TURN credentials",
        iceServers: defaultStunServers,
        turnConfigured: false,
      })
    );
  }
}
