// WebRTC connection manager with Firestore signaling

import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  Unsubscribe,
} from "firebase/firestore";
import { initFirebase } from "./firebase";
import { TUNING } from "../../config/tuning";
import {
  ClientInputMsg,
  HostStateSnapshotMsg,
  NetEventMsg,
} from "./messages";

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export async function fetchTurnServers(): Promise<{
  iceServers: IceServerConfig[];
  turnConfigured: boolean;
}> {
  try {
    const res = await fetch("/api/turn");
    if (res.ok) {
      const data = await res.json();
      if (data.iceServers && data.iceServers.length > 0) {
        return {
          iceServers: data.iceServers,
          turnConfigured: Boolean(data.turnConfigured),
        };
      }
    }
  } catch (err) {
    // API not reachable in local test mode; fallback to STUN
  }

  return {
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
        ],
      },
    ],
    turnConfigured: false,
  };
}

export interface PeerCallbacks {
  onInput?: (msg: ClientInputMsg) => void;
  onState?: (msg: HostStateSnapshotMsg) => void;
  onEvent?: (msg: NetEventMsg) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onConnectionLost?: () => void;
}

export class WebRTCPeer {
  public pc: RTCPeerConnection | null = null;
  public inputChannel: RTCDataChannel | null = null;
  public stateChannel: RTCDataChannel | null = null;
  public eventsChannel: RTCDataChannel | null = null;

  public peerUid: string;
  public localUid: string;
  public roomCode: string;
  public isHost: boolean;
  public callbacks: PeerCallbacks;

  private unsubSignals: Unsubscribe | null = null;
  private iceRestartTimer: any = null;
  private inputCountWindow = 0;
  private inputWindowStart = Date.now();
  private isDestroyed = false;

  constructor(
    roomCode: string,
    localUid: string,
    peerUid: string,
    isHost: boolean,
    callbacks: PeerCallbacks
  ) {
    this.roomCode = roomCode;
    this.localUid = localUid;
    this.peerUid = peerUid;
    this.isHost = isHost;
    this.callbacks = callbacks;
  }

  async init(iceServers: IceServerConfig[]): Promise<void> {
    this.pc = new RTCPeerConnection({ iceServers });

    // Handle ICE candidates
    this.pc.onicecandidate = async (event) => {
      if (event.candidate && !this.isDestroyed) {
        await this.sendSignal("ice", event.candidate.toJSON());
      }
    };

    // Connection state monitoring
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === "connected") {
        if (this.iceRestartTimer) {
          clearTimeout(this.iceRestartTimer);
          this.iceRestartTimer = null;
        }
        this.callbacks.onConnected?.();
      } else if (state === "disconnected" || state === "failed") {
        this.callbacks.onDisconnected?.();
        this.handleConnectionDrop();
      }
    };

    if (this.isHost) {
      // Host creates the data channels
      this.inputChannel = this.pc.createDataChannel("input", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.stateChannel = this.pc.createDataChannel("state", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.eventsChannel = this.pc.createDataChannel("events", {
        ordered: true,
      });

      this.setupChannelHandlers();
    } else {
      // Client receives data channels from host
      this.pc.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label === "input") this.inputChannel = channel;
        if (channel.label === "state") this.stateChannel = channel;
        if (channel.label === "events") this.eventsChannel = channel;
        this.setupChannel(channel);
      };
    }

    // Subscribe to Firestore signals for this peer
    this.listenSignals();

    // Client creates the initial SDP offer
    if (!this.isHost) {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.sendSignal("offer", {
        type: offer.type,
        sdp: offer.sdp,
      });
    }
  }

  private setupChannelHandlers(): void {
    if (this.inputChannel) this.setupChannel(this.inputChannel);
    if (this.stateChannel) this.setupChannel(this.stateChannel);
    if (this.eventsChannel) this.setupChannel(this.eventsChannel);
  }

  private setupChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (channel.label === "input") {
          // Rate limit check: drop peer if > 120 input msgs/sec
          if (this.isHost) {
            const now = Date.now();
            if (now - this.inputWindowStart > 1000) {
              this.inputCountWindow = 0;
              this.inputWindowStart = now;
            }
            this.inputCountWindow++;
            if (this.inputCountWindow > TUNING.MAX_PEER_INPUTS_PER_SEC) {
              console.warn(
                `Dropping peer ${this.peerUid} for exceeding input rate limit (${this.inputCountWindow} msgs/s)`
              );
              this.destroy();
              return;
            }
          }
          this.callbacks.onInput?.(data as ClientInputMsg);
        } else if (channel.label === "state") {
          this.callbacks.onState?.(data as HostStateSnapshotMsg);
        } else if (channel.label === "events") {
          this.callbacks.onEvent?.(data as NetEventMsg);
        }
      } catch (err) {
        console.error("Failed to parse data channel message:", err);
      }
    };
  }

  private handleConnectionDrop(): void {
    if (this.iceRestartTimer) return;

    // Start 15s ICE restart timeout
    this.iceRestartTimer = setTimeout(() => {
      console.warn(`ICE restart failed after 15s for peer ${this.peerUid}`);
      this.callbacks.onConnectionLost?.();
    }, TUNING.ICE_RESTART_TIMEOUT_MS);

    // If client, initiate ICE restart offer
    if (!this.isHost && this.pc) {
      this.pc
        .createOffer({ iceRestart: true })
        .then((offer) => this.pc?.setLocalDescription(offer))
        .then(() => {
          if (this.pc?.localDescription) {
            return this.sendSignal("offer", {
              type: this.pc.localDescription.type,
              sdp: this.pc.localDescription.sdp,
            });
          }
        })
        .catch((err) => console.error("ICE restart offer failed:", err));
    }
  }

  private async sendSignal(
    kind: "offer" | "answer" | "ice",
    payload: any
  ): Promise<void> {
    if (this.isDestroyed) return;
    try {
      const { db } = initFirebase();
      const signalsCol = collection(db, "rooms", this.roomCode, "signals");
      await addDoc(signalsCol, {
        from: this.localUid,
        to: this.peerUid,
        kind,
        payload: JSON.stringify(payload),
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error("Error sending signal:", err);
    }
  }

  private listenSignals(): void {
    const { db } = initFirebase();
    const signalsCol = collection(db, "rooms", this.roomCode, "signals");
    const q = query(signalsCol, where("to", "==", this.localUid));

    this.unsubSignals = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === "added") {
          const docData = change.doc.data();
          const docId = change.doc.id;

          // Ignore signals from other peers
          if (docData.from !== this.peerUid) continue;

          // Delete signal immediately upon receipt
          deleteDoc(change.doc.ref).catch(() => {});

          // Ignore signals older than 10 minutes
          const ageMs = Date.now() - (docData.createdAt || 0);
          if (ageMs > TUNING.SIGNAL_EXPIRY_MS) continue;

          await this.handleIncomingSignal(docData.kind, docData.payload);
        }
      }
    });
  }

  private async handleIncomingSignal(kind: string, payloadStr: string): Promise<void> {
    if (!this.pc || this.isDestroyed) return;

    try {
      const payload = JSON.parse(payloadStr);

      if (kind === "offer") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.sendSignal("answer", {
          type: answer.type,
          sdp: answer.sdp,
        });
      } else if (kind === "answer") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload));
      } else if (kind === "ice") {
        if (payload) {
          await this.pc.addIceCandidate(new RTCIceCandidate(payload));
        }
      }
    } catch (err) {
      console.error("Error handling signal:", err);
    }
  }

  sendInput(msg: ClientInputMsg): void {
    if (this.inputChannel?.readyState === "open") {
      this.inputChannel.send(JSON.stringify(msg));
    }
  }

  sendState(msg: HostStateSnapshotMsg): void {
    if (this.stateChannel?.readyState === "open") {
      this.stateChannel.send(JSON.stringify(msg));
    }
  }

  sendEvent(msg: NetEventMsg): void {
    if (this.eventsChannel?.readyState === "open") {
      this.eventsChannel.send(JSON.stringify(msg));
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
    if (this.unsubSignals) {
      this.unsubSignals();
      this.unsubSignals = null;
    }
    try {
      this.inputChannel?.close();
      this.stateChannel?.close();
      this.eventsChannel?.close();
      this.pc?.close();
    } catch {}
  }
}
