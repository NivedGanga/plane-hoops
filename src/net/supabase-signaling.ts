import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../config/tuning';
import type { SignalingEvent, SignalingMessage, SignalData } from './protocol';
type ClientEvent = SignalingEvent | { type: 'connected'; peerId: string };
type Peer = { id: string; name: string; seatId: number };
type Room = { code: string; uid: string; role: 'host' | 'client'; name: string; maxPlayers: 2 | 4; localSeats: number; phase: string; peers: Map<string, Peer>; hostUid?: string; seatId?: number };
type Row = { id: number; room_code: string; from_uid: string; to_uid: string; kind: 'offer' | 'answer' | 'ice'; payload: Record<string, unknown>; created_at: string };
const MAX_AGE = 600_000;
function code(): string { const b = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH)); return [...b].map(x => ROOM_CODE_ALPHABET[x % ROOM_CODE_ALPHABET.length]).join(''); }
function kindOf(d: SignalData): Row['kind'] | undefined { if ('type' in d && (d.type === 'offer' || d.type === 'answer')) return d.type; if (!('type' in d) || !d.type) return 'ice'; return undefined; }
export class SupabaseSignalingClient {
  private client: SupabaseClient; private channel?: RealtimeChannel; private room?: Room; private uid?: string;
  private listeners = new Set<(e: ClientEvent) => void>(); private queue: SignalingMessage[] = []; private seen = new Set<number>(); private closed = false; private serial: Promise<void> = Promise.resolve();
  constructor(url: string, key: string) { this.client = createClient(url, key); }
  onEvent(fn: (e: ClientEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: ClientEvent): void { for (const fn of this.listeners) fn(e); }
  send(m: SignalingMessage): void {
    if (m.type === 'create-room') { void this.create(m); return; }
    if (m.type === 'join-room') { void this.join(m.roomCode, m.name); return; }
    if (!this.room || !this.uid) { this.queue.push(m); return; }
    if (m.type === 'signal') { const kind = kindOf(m.data); if (kind) void this.insert(m.target, kind, m.data); }
    else if (m.type === 'room-status' && this.room.role === 'host') {
      this.room.phase = m.phase === 'ended' ? 'lobby' : m.phase === 'paused' ? 'playing' : m.phase;
      void this.client.from('rooms').update({ status: this.room.phase }).eq('code', this.room.code).eq('host_uid', this.uid).then(({ error }) => { if (error) this.emit({ type: 'error', message: `Could not update room status: ${error.message}` }); });
    } else if (m.type === 'leave-room') void this.leave();
  }
  private async auth(): Promise<string> {
    const s = await this.client.auth.getSession(); if (s.data.session?.user) return this.uid = s.data.session.user.id;
    const r = await this.client.auth.signInAnonymously(); if (r.error || !r.data.user) throw r.error ?? new Error('Anonymous sign-in failed'); return this.uid = r.data.user.id;
  }
  private async activate(r: Room): Promise<void> {
    this.room = r; this.closed = false; this.seen.clear();
    const c = this.client.channel(`signals-${r.uid}`); this.channel = c;
    c.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals', filter: `to_uid=eq.${r.uid}` }, p => { this.serial = this.serial.then(() => this.consume(p.new as Row)).catch(e => this.emit({ type: 'error', message: String(e) })); });
    await new Promise<void>((ok, no) => c.subscribe((s, e) => { if (s === 'SUBSCRIBED') ok(); if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) no(e ?? Error(`Realtime ${s}`)); }));
    const q = await this.client.from('signals').select('id,room_code,from_uid,to_uid,kind,payload,created_at').eq('to_uid', r.uid).eq('room_code', r.code).order('id').limit(500);
    if (q.error) throw q.error; for (const row of (q.data ?? []) as Row[]) await this.consume(row);
    for (const m of this.queue.splice(0)) this.send(m);
  }
  private async consume(row: Row): Promise<void> {
    const r = this.room; if (!r || this.closed || this.seen.has(row.id)) return; this.seen.add(row.id);
    try {
      if (row.room_code !== r.code || Date.now() - Date.parse(row.created_at) > MAX_AGE) return;
      const p = row.payload ?? {};
      if (r.role === 'host' && row.kind === 'offer') {
        let peer = r.peers.get(row.from_uid);
        if (!peer) {
          if (r.phase !== 'lobby') return;
          const used = new Set([...r.peers.values()].map(v => v.seatId));
          const seatId = Array.from({ length: r.maxPlayers - r.localSeats }, (_, i) => r.localSeats + i + 1).find(s => !used.has(s));
          if (seatId === undefined) return;
          peer = { id: row.from_uid, seatId, name: String(p.name ?? `Pilot ${seatId}`).slice(0, 16) }; r.peers.set(row.from_uid, peer);
          this.emit({ type: 'peer-joined', peerId: row.from_uid, seatId, name: peer.name });
        }
        this.emit({ type: 'signal', from: row.from_uid, data: { type: 'offer', sdp: String(p.sdp ?? '') } });
      } else if (r.role === 'client' && row.from_uid === r.hostUid && row.kind === 'answer') {
        const assigned = Number(p.seatId); if (!Number.isInteger(assigned) || assigned < 1 || assigned > r.maxPlayers) throw Error('Host returned invalid seat metadata.');
        r.seatId = assigned; r.maxPlayers = Number(p.maxPlayers) as 2 | 4; r.localSeats = Number(p.localSeats ?? 1);
        this.emit({ type: 'joined-room', roomCode: r.code, seatId: assigned, maxPlayers: r.maxPlayers, localSeats: r.localSeats, hostPeerId: row.from_uid });
        this.emit({ type: 'signal', from: row.from_uid, data: { type: 'answer', sdp: String(p.sdp ?? '') } });
      } else if (row.kind === 'ice') {
        const candidate = p.candidate as RTCIceCandidateInit;
        if (candidate && (r.role === 'client' ? row.from_uid === r.hostUid : row.from_uid !== r.uid)) this.emit({ type: 'signal', from: row.from_uid, data: candidate });
      }
    } finally {
      const q = await this.client.from('signals').delete().eq('id', row.id).eq('to_uid', r.uid);
      if (q.error) this.emit({ type: 'error', message: `Could not clean up signaling row: ${q.error.message}` });
    }
  }
  private async insert(to: string, kind: Row['kind'], data: SignalData): Promise<void> {
    const r = this.room; if (!r || !this.uid) return;
    const peer = r.role === 'host' ? r.peers.get(to) : undefined;
    const payload = kind === 'ice' ? { candidate: data } : {
      sdp: (data as RTCSessionDescriptionInit).sdp ?? '',
      ...(kind === 'offer' ? { name: r.name } : { seatId: peer?.seatId ?? r.seatId, maxPlayers: r.maxPlayers, localSeats: r.localSeats }),
    };
    const q = await this.client.from('signals').insert({ room_code: r.code, from_uid: this.uid, to_uid: to, kind, payload });
    if (q.error) this.emit({ type: 'error', message: `Could not send ${kind}: ${q.error.message}` });
  }
  private async create(m: Extract<SignalingMessage, { type: 'create-room' }>): Promise<void> {
    try {
      const uid = await this.auth(); if (this.room) throw Error('Leave the current room first.');
      if (![2, 4].includes(m.maxPlayers) || m.localSeats < 1 || m.localSeats > m.maxPlayers || m.name.length < 1 || m.name.length > 24) throw Error('Choose a valid room name and 2- or 4-seat room.');
      for (let i = 0; i < 10; i++) {
        const c = code(), q = await this.client.from('rooms').insert({ code: c, host_uid: uid, name: m.name, size: m.maxPlayers, status: 'lobby' });
        if (!q.error) { await this.activate({ code: c, uid, role: 'host', name: m.name, maxPlayers: m.maxPlayers, localSeats: m.localSeats, phase: 'lobby', peers: new Map() }); this.emit({ type: 'connected', peerId: uid }); this.emit({ type: 'room-created', roomCode: c, maxPlayers: m.maxPlayers, localSeats: m.localSeats, peerId: uid }); return; }
        if (q.error.code !== '23505' || i === 9) throw q.error;
      }
    } catch (e) { this.emit({ type: 'error', message: String(e) }); }
  }
  private async join(c: string, name: string): Promise<void> {
    try {
      const uid = await this.auth(), roomCode = c.toUpperCase();
      if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(roomCode) || name.length < 1 || name.length > 16) throw Error('Enter a valid room code and display name (1–16 characters).');
      const q = await this.client.rpc('get_room', { p_code: roomCode }); if (q.error) throw q.error;
      const row = Array.isArray(q.data) ? q.data[0] : q.data;
      if (!row || row.status !== 'lobby') throw Error('Room not found or not accepting new pilots.');
      const hostUid = String(row.host_uid), phase = String(row.status);
      await this.activate({ code: roomCode, uid, role: 'client', name, maxPlayers: Number(row.size) as 2 | 4, localSeats: 1, phase, peers: new Map(), hostUid });
      this.emit({ type: 'connected', peerId: uid });
      // Seat assignment is authoritative in the host's answer; zero is the explicit placeholder.
      this.emit({ type: 'joined-room', roomCode, seatId: 0, maxPlayers: Number(row.size) as 2 | 4, localSeats: 1, hostPeerId: hostUid });
    } catch (e) { this.emit({ type: 'error', message: String(e) }); }
  }
  private async leave(): Promise<void> {
    const r = this.room; if (!r) return; this.closed = true;
    try { if (r.role === 'host') { const u = await this.client.from('rooms').update({ status: 'closed' }).eq('code', r.code).eq('host_uid', r.uid); if (u.error) this.emit({ type: 'error', message: u.error.message }); const d = await this.client.from('rooms').delete().eq('code', r.code).eq('host_uid', r.uid); if (d.error) this.emit({ type: 'error', message: d.error.message }); } }
    finally { await this.shutdown(); }
  }
  private async shutdown(): Promise<void> { this.closed = true; try { await this.channel?.unsubscribe(); } catch { /* best effort */ } if (this.channel) await this.client.removeChannel(this.channel); this.channel = undefined; this.room = undefined; this.seen.clear(); this.queue = []; }
  close(): void { void this.leave(); }
}
