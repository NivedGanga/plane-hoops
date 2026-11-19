export const ROOM_NAME_KEY = 'planeHoops.lastRoomName';
export const DISPLAY_NAME_KEY = 'planeHoops.displayName';
export function readPreference(key: string, fallback = ''): string {
  try { return globalThis.localStorage?.getItem(key) ?? fallback; } catch { return fallback; }
}
export function savePreference(key: string, value: string): void {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* Storage may be disabled. */ }
}
export function readRoomName(): string { return readPreference(ROOM_NAME_KEY); }
export function readDisplayName(): string { return readPreference(DISPLAY_NAME_KEY); }
export function saveRoomName(name: string): void { savePreference(ROOM_NAME_KEY, name); }
export function saveDisplayName(name: string): void { savePreference(DISPLAY_NAME_KEY, name); }
