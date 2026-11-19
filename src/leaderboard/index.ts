import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export interface LeaderboardEntry { id: string; owner_uid: string; team_name: string; name_key: string; members: string[]; points: number; hoops_cleared: number; distance_m: number; updated_at?: string }
export function normalizeTeamName(name: string): string { return name.trim().replace(/\s+/g, ' ').toLowerCase(); }
export function leaderboardId(ownerUid: string, teamName: string): string { return `${ownerUid}__${normalizeTeamName(teamName)}`; }
export function rankLeaderboard<T extends Pick<LeaderboardEntry, 'points'|'distance_m'|'updated_at'>>(entries: T[]): T[] {
  return [...entries].sort((a,b) => b.points-a.points || b.distance_m-a.distance_m || Date.parse(a.updated_at ?? '')-Date.parse(b.updated_at ?? '')).slice(0,20);
}
let client: SupabaseClient | undefined;
export function getLeaderboardClient(): SupabaseClient | undefined {
  const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return undefined;
  return client ??= createClient(url,key);
}
export async function authenticateLeaderboard(): Promise<string | undefined> {
  const db = getLeaderboardClient(); if (!db) return undefined;
  const { data: { session } } = await db.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await db.auth.signInAnonymously(); if (error) throw error;
  return data.user?.id;
}
export async function submitRun(ownerUid: string, teamName: string, members: string[], points: number, hoops: number, distance: number): Promise<void> {
  const db=getLeaderboardClient(); if (!db) return;
  const nameKey=normalizeTeamName(teamName);
  const row: LeaderboardEntry={id:leaderboardId(ownerUid,teamName),owner_uid:ownerUid,team_name:teamName,name_key:nameKey,members,points,hoops_cleared:hoops,distance_m:distance,updated_at:new Date().toISOString()};
  const {error}=await db.from('leaderboard').upsert(row,{onConflict:'id'}); if(error) throw error;
}
export async function fetchTop20(): Promise<LeaderboardEntry[]> {
  const db=getLeaderboardClient(); if(!db) return [];
  const {data,error}=await db.from('leaderboard').select('id,owner_uid,team_name,name_key,members,points,hoops_cleared,distance_m,updated_at').order('points',{ascending:false}).order('distance_m',{ascending:false}).order('updated_at',{ascending:true}).limit(20);
  if(error) throw error; return (data ?? []) as LeaderboardEntry[];
}
