import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const enabled = Boolean(url && anonKey);
const suite = enabled ? describe : describe.skip;

type User = { client: SupabaseClient; uid: string };
let a: User;
let b: User;
let roomCode: string;
let boardId: string;

async function newAnonymousUser(): Promise<User> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('Anonymous sign-in returned no user');
  return { client, uid: data.user.id };
}

function code(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

suite('Plane Hoops live database security', () => {
  beforeAll(async () => {
    a = await newAnonymousUser();
    b = await newAnonymousUser();
    roomCode = code();
    boardId = `${a.uid}__security test`;
    const { error } = await a.client.from('rooms').insert({
      code: roomCode, host_uid: a.uid, name: 'RLS test room', size: 2, status: 'lobby',
    });
    if (error) throw error;
    const { error: boardError } = await a.client.from('leaderboard').insert({
      id: boardId, owner_uid: a.uid, team_name: 'Security Test', name_key: 'security test',
      members: ['Test'], points: 10, hoops_cleared: 1, distance_m: 2,
    });
    if (boardError) throw boardError;
    const { error: signalError } = await a.client.from('signals').insert({
      room_code: roomCode, from_uid: a.uid, to_uid: b.uid, kind: 'offer', payload: { test: true },
    });
    if (signalError) throw signalError;
  });

  afterAll(async () => {
    if (a) {
      if (roomCode) await a.client.from('rooms').delete().eq('code', roomCode);
      if (boardId) await a.client.from('leaderboard').delete().eq('id', boardId);
      await a.client.auth.signOut();
    }
    if (b) await b.client.auth.signOut();
  });

  it('rejects a forged leaderboard owner with SQLSTATE 42501', async () => {
    const { error } = await b.client.from('leaderboard').insert({
      id: `${a.uid}__forged`, owner_uid: a.uid, team_name: 'Forged', name_key: 'forged',
      members: ['Test'], points: 1, hoops_cleared: 0, distance_m: 0,
    });
    expect(error?.code).toBe('42501');
  });

  it('prevents modifying or deleting another owner’s leaderboard row', async () => {
    const update = await b.client.from('leaderboard').update({ points: 999 }).eq('id', boardId).select('id');
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);
    const deletion = await b.client.from('leaderboard').delete().eq('id', boardId).select('id');
    expect(deletion.error).toBeNull();
    expect(deletion.data).toEqual([]);
    const row = await a.client.from('leaderboard').select('points').eq('id', boardId).single();
    expect(row.data?.points).toBe(10);
  });

  it('prevents another user from modifying or deleting the host room', async () => {
    const update = await b.client.from('rooms').update({ name: 'stolen' }).eq('code', roomCode).select('code');
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);
    const deletion = await b.client.from('rooms').delete().eq('code', roomCode).select('code');
    expect(deletion.error).toBeNull();
    expect(deletion.data).toEqual([]);
    const row = await a.client.from('rooms').select('name').eq('code', roomCode).single();
    expect(row.data?.name).toBe('RLS test room');
  });

  it('restricts signal reads to the addressed recipient', async () => {
    const notRecipient = await a.client.from('signals').select('id').eq('room_code', roomCode);
    expect(notRecipient.error).toBeNull();
    expect(notRecipient.data).toEqual([]);
    const recipient = await b.client.from('signals').select('id').eq('room_code', roomCode);
    expect(recipient.error).toBeNull();
    expect(recipient.data).toHaveLength(1);
  });

  it('does not let a user list rooms belonging to another host', async () => {
    const ownHostRows = await b.client.from('rooms').select('code').eq('code', roomCode);
    expect(ownHostRows.error).toBeNull();
    expect(ownHostRows.data).toEqual([]);
    const hostRows = await a.client.from('rooms').select('code').eq('code', roomCode);
    expect(hostRows.data).toHaveLength(1);
  });

  it('denies unauthenticated table reads and get_room execution', async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const table of ['rooms', 'signals', 'leaderboard'] as const) {
      const { data, error } = await client.from(table).select('*');
      if (error) expect(data).toBeNull();
      else expect(data).toEqual([]);
    }
    const { error } = await client.rpc('get_room', { p_code: roomCode });
    expect(error).not.toBeNull();
    await client.auth.signOut();
  });

  it('returns open rooms, but not closed or unknown rooms, through get_room', async () => {
    const open = await b.client.rpc('get_room', { p_code: roomCode });
    expect(open.error).toBeNull();
    expect(open.data).toHaveLength(1);
    expect(open.data[0].code).toBe(roomCode);
    const closedCode = code();
    const { error: insertError } = await a.client.from('rooms').insert({
      code: closedCode, host_uid: a.uid, name: 'Closed test', size: 2, status: 'lobby',
    });
    expect(insertError).toBeNull();
    const { error: closeError } = await a.client.from('rooms').update({ status: 'closed' }).eq('code', closedCode);
    expect(closeError).toBeNull();
    const closed = await b.client.rpc('get_room', { p_code: closedCode });
    const unknown = await b.client.rpc('get_room', { p_code: code() });
    expect(closed.data).toEqual([]);
    expect(unknown.data).toEqual([]);
    await a.client.from('rooms').delete().eq('code', closedCode);
  });
});

if (!enabled) {
  describe('Plane Hoops live database security', () => {
    it.skip('requires SUPABASE_URL and SUPABASE_ANON_KEY; no database was contacted', () => {});
  });
}
