import { DEFAULT_STUN_URL } from '../../config/tuning';
import type { GameEvent, InputPacket, StatePacket } from './protocol';

export interface PeerCallbacks {
  onInput?: (seatId: number, packet: InputPacket) => void;
  onEvent?: (event: GameEvent) => void;
  onState?: (packet: StatePacket) => void;
  onStatus?: (seatId: number, status: RTCPeerConnectionState | 'disconnected') => void;
  onNotice?: (message: string) => void;
  sendSignal: (target: string, data: RTCSessionDescriptionInit | RTCIceCandidateInit) => void;
}
type PeerRecord = { pc: RTCPeerConnection; seatId: number; peerId: string; input?: RTCDataChannel; state?: RTCDataChannel; events?: RTCDataChannel; lastStateSequence: number; restarting: boolean; candidates: RTCIceCandidateInit[] };
const fallbackConfig: RTCConfiguration = {
  iceServers: [{ urls: import.meta.env.VITE_STUN_URL || DEFAULT_STUN_URL }],
};

export class PeerMesh {
  private peers = new Map<string, PeerRecord>();
  private seatToPeer = new Map<number, string>();
  private iceConfig?: Promise<RTCConfiguration>;
  constructor(private readonly isHost: boolean, private readonly callbacks: PeerCallbacks) {}
  private async configure(record: PeerRecord): Promise<void> {
    this.iceConfig ??= fetch('/api/turn').then(async (response) => {
      if (!response.ok) throw new Error(`TURN config HTTP ${response.status}`);
      const data = await response.json() as { iceServers?: RTCIceServer[]; fallback?: string };
      if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) throw new Error('TURN config has no ICE servers');
      if (data.fallback === 'stun-only') this.callbacks.onNotice?.('TURN unavailable — using STUN only; some networks may not connect.');
      return { iceServers: data.iceServers };
    }).catch((error) => { console.warn('TURN configuration unavailable; using STUN only', error); this.callbacks.onNotice?.('TURN unavailable — using STUN only; some networks may not connect.'); return fallbackConfig; });
    record.pc.setConfiguration(await this.iceConfig);
  }
  async addClientPeer(peerId: string, seatId: number): Promise<void> {
    let record = this.peers.get(peerId);
    if (!record) record = this.createRecord(peerId, seatId);
    await this.configure(record);
    this.setSeat(record, seatId);
    record.input = record.pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    record.state = record.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
    record.events = record.pc.createDataChannel('events', { ordered: true });
    this.bindChannels(record);
    const offer = await record.pc.createOffer(); await record.pc.setLocalDescription(offer);
    this.callbacks.sendSignal(peerId, offer);
  }
  async addHostPeer(peerId: string, seatId: number): Promise<void> {
    const record = this.peers.get(peerId) ?? this.createRecord(peerId, seatId);
    this.setSeat(record, seatId);
    await this.configure(record);
  }
  async receiveSignal(from: string, data: RTCSessionDescriptionInit | RTCIceCandidateInit, seatId: number): Promise<void> {
    let record = this.peers.get(from);
    if (!record) record = this.createRecord(from, seatId);
    await this.configure(record);
    if (seatId > 0) this.setSeat(record, seatId);
    const pc = record.pc;
    if ('type' in data && data.type) {
      await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
      for (const candidate of record.candidates.splice(0)) await pc.addIceCandidate(candidate);
      if (data.type === 'offer') {
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        this.callbacks.sendSignal(from, answer);
      }
      record.restarting = false;
    } else if (pc.remoteDescription) {
      await pc.addIceCandidate(data as RTCIceCandidateInit);
    } else record.candidates.push(data as RTCIceCandidateInit);
  }
  private setSeat(record: PeerRecord, seatId: number): void {
    const old = this.seatToPeer.get(record.seatId);
    if (old === record.peerId) this.seatToPeer.delete(record.seatId);
    record.seatId = seatId;
    if (seatId > 0) this.seatToPeer.set(seatId, record.peerId);
  }
  private createRecord(peerId: string, seatId: number): PeerRecord {
    const pc = new RTCPeerConnection(fallbackConfig);
    const record: PeerRecord = { pc, seatId: 0, peerId, lastStateSequence: -1, restarting: false, candidates: [] };
    this.peers.set(peerId, record); this.setSeat(record, seatId);
    pc.onicecandidate = (event) => { if (event.candidate) this.callbacks.sendSignal(peerId, event.candidate.toJSON()); };
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'input') record.input = channel;
      else if (channel.label === 'state') record.state = channel;
      else if (channel.label === 'events') record.events = channel;
      this.bindChannels(record);
    };
    pc.onconnectionstatechange = () => this.notifyStatus(record);
    pc.oniceconnectionstatechange = () => {
      if (!this.isHost && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') && !record.restarting) void this.restart(record);
    };
    return record;
  }
  private notifyStatus(record: PeerRecord): void {
    const status = record.pc.connectionState;
    const channelsReady = record.input?.readyState === 'open' && record.state?.readyState === 'open' && record.events?.readyState === 'open';
    this.callbacks.onStatus?.(record.seatId, status === 'connected' && !channelsReady ? 'connecting' : status);
  }
  private async restart(record: PeerRecord): Promise<void> {
    record.restarting = true;
    try {
      const offer = await record.pc.createOffer({ iceRestart: true });
      await record.pc.setLocalDescription(offer);
      this.callbacks.sendSignal(record.peerId, offer);
    } catch (error) { record.restarting = false; console.warn('ICE restart failed', error); }
  }
  private bindChannels(record: PeerRecord): void {
    for (const channel of [record.input, record.state, record.events]) if (channel) channel.onopen = () => this.notifyStatus(record);
    if (record.input) record.input.onmessage = (event) => {
      try { const packet = JSON.parse(String(event.data)) as InputPacket; if (packet.type === 'input') this.callbacks.onInput?.(record.seatId, packet); } catch { /* invalid packet */ }
    };
    if (record.state) record.state.onmessage = (event) => {
      try { const packet = JSON.parse(String(event.data)) as StatePacket; if (packet.type === 'state' && packet.snapshot.sequence > record.lastStateSequence) { record.lastStateSequence = packet.snapshot.sequence; this.callbacks.onState?.(packet); } } catch { /* invalid packet */ }
    };
    if (record.events) record.events.onmessage = (event) => { try { this.callbacks.onEvent?.(JSON.parse(String(event.data)) as GameEvent); } catch { /* invalid packet */ } };
  }
  sendInput(packet: InputPacket): void { for (const record of this.peers.values()) if (record.input?.readyState === 'open') record.input.send(JSON.stringify(packet)); }
  sendState(packet: StatePacket): void { for (const record of this.peers.values()) if (record.state?.readyState === 'open') record.state.send(JSON.stringify(packet)); }
  broadcastEvent(event: GameEvent): void { for (const record of this.peers.values()) if (record.events?.readyState === 'open') record.events.send(JSON.stringify(event)); }
  closePeer(peerId: string): void { const peer = this.peers.get(peerId); if (peer) { peer.pc.close(); this.seatToPeer.delete(peer.seatId); this.peers.delete(peerId); } }
  peerForSeat(seatId: number): string | undefined { return this.seatToPeer.get(seatId); }
  seatForPeer(peerId: string): number | undefined { return this.peers.get(peerId)?.seatId; }
  close(): void { for (const peer of this.peers.values()) peer.pc.close(); this.peers.clear(); this.seatToPeer.clear(); }
  hasRemoteSeat(seatId: number): boolean { const id = this.seatToPeer.get(seatId); const p = id && this.peers.get(id); return Boolean(p && p.pc.connectionState === 'connected' && p.input?.readyState === 'open' && p.state?.readyState === 'open' && p.events?.readyState === 'open'); }
}
