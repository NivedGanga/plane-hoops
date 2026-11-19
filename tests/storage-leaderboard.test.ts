import { beforeEach, describe, expect, it } from 'vitest';
import { DISPLAY_NAME_KEY, ROOM_NAME_KEY, readDisplayName, readRoomName, saveDisplayName, saveRoomName } from '../src/storage/preferences';
import { leaderboardId, normalizeTeamName, rankLeaderboard } from '../src/leaderboard';
const memory = new Map<string,string>();
const storage = { getItem:(k:string)=>memory.get(k) ?? null, setItem:(k:string,v:string)=>memory.set(k,String(v)), removeItem:(k:string)=>memory.delete(k), clear:()=>memory.clear() };
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
beforeEach(()=>storage.clear());
describe('local preferences',()=>{
 it('persists room and display names in the stable keys',()=>{saveRoomName('Cloudline crew');saveDisplayName('Aviator');expect(storage.getItem(ROOM_NAME_KEY)).toBe('Cloudline crew');expect(storage.getItem(DISPLAY_NAME_KEY)).toBe('Aviator');expect(readRoomName()).toBe('Cloudline crew');expect(readDisplayName()).toBe('Aviator');});
});
describe('leaderboard keys and ordering',()=>{
 it('collapses whitespace and normalizes team names',()=>{expect(normalizeTeamName('  Cloudline   Crew ')).toBe('cloudline crew');expect(leaderboardId('uid-1',' Cloudline  Crew ')).toBe('uid-1__cloudline crew');});
 it('ranks points, then distance, then earliest update, capped at 20',()=>{const rows=[{points:10,distance_m:2,updated_at:'2025-01-02'},{points:10,distance_m:2,updated_at:'2025-01-01'},{points:11,distance_m:0,updated_at:'2025-01-03'}];expect(rankLeaderboard(rows)).toEqual([rows[2],rows[1],rows[0]]);expect(rankLeaderboard(Array.from({length:25},(_,i)=>({points:i,distance_m:0,updated_at:''}))).length).toBe(20);});
});
