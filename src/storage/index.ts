export const STORAGE_KEYS = {
  LAST_ROOM_NAME: "planeHoops.lastRoomName",
  DISPLAY_NAME: "planeHoops.displayName",
} as const;

export function getLastRoomName(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_ROOM_NAME) || "";
  } catch {
    return "";
  }
}

export function saveLastRoomName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_ROOM_NAME, name);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export function getDisplayName(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME) || "";
  } catch {
    return "";
  }
}

export function saveDisplayName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, name);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}
