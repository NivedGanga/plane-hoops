import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { initFirebase } from "../net/firebase";
import { computeLeaderboardDocId, computeNameKey } from "./keys";

export interface LeaderboardEntry {
  ownerUid: string;
  teamName: string;
  nameKey: string;
  members: string[];
  points: number;
  hoopsCleared: number;
  distanceM: number;
  updatedAt: number;
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

export async function submitLeaderboardRecord(params: {
  ownerUid: string;
  teamName: string;
  members: string[];
  points: number;
  hoopsCleared: number;
  distanceM: number;
}): Promise<string> {
  const { db } = initFirebase();
  const nameKey = computeNameKey(params.teamName);
  const docId = computeLeaderboardDocId(params.ownerUid, params.teamName);

  const entry: LeaderboardEntry = {
    ownerUid: params.ownerUid,
    teamName: params.teamName.trim(),
    nameKey,
    members: params.members.map((m) => m.trim().slice(0, 16)),
    points: Math.max(0, Math.round(params.points)),
    hoopsCleared: Math.max(0, Math.round(params.hoopsCleared)),
    distanceM: Math.max(0, Math.round(params.distanceM)),
    updatedAt: Date.now(),
  };

  const entryRef = doc(db, "leaderboard", docId);
  await setDoc(entryRef, entry);
  return docId;
}

export async function fetchTopLeaderboard(topN = 20): Promise<RankedLeaderboardEntry[]> {
  const { db } = initFirebase();
  const leaderboardCol = collection(db, "leaderboard");
  const q = query(
    leaderboardCol,
    orderBy("points", "desc"),
    orderBy("distanceM", "desc"),
    limit(topN)
  );

  const snapshot = await getDocs(q);
  const entries: LeaderboardEntry[] = [];
  snapshot.forEach((docSnap) => {
    entries.push(docSnap.data() as LeaderboardEntry);
  });

  // Secondary tie-breaker in memory: earlier updatedAt
  entries.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.distanceM !== a.distanceM) return b.distanceM - a.distanceM;
    return (a.updatedAt || 0) - (b.updatedAt || 0);
  });

  return entries.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));
}
