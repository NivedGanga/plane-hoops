// Leaderboard key normalization and document ID generator

export function computeNameKey(roomName: string): string {
  return roomName.trim().replace(/\s+/g, " ").toLowerCase();
}

export function computeLeaderboardDocId(ownerUid: string, roomName: string): string {
  const nameKey = computeNameKey(roomName);
  return `${ownerUid}__${nameKey}`;
}

export function formatRecord(points: number, hoopsCleared: number): string {
  return `${points.toLocaleString()} pts (${hoopsCleared} hoops)`;
}
