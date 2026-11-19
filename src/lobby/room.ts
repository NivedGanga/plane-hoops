import {
  doc,
  runTransaction,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  Unsubscribe,
  updateDoc,
} from "firebase/firestore";
import { initFirebase } from "../net/firebase";
import { TUNING } from "../../config/tuning";

export interface RoomData {
  hostUid: string;
  name: string;
  size: 2 | 4;
  status: "lobby" | "playing" | "closed";
  runCount?: number;
  createdAt: number;
}

export function generateRoomCode(): string {
  const chars = TUNING.ROOM_CODE_CHARSET;
  let code = "";
  for (let i = 0; i < TUNING.ROOM_CODE_LEN; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function createRoomInFirestore(
  hostUid: string,
  roomName: string,
  size: 2 | 4
): Promise<string> {
  const { db } = initFirebase();
  const trimmedName = roomName.trim();
  if (
    trimmedName.length < TUNING.ROOM_NAME_MIN_LEN ||
    trimmedName.length > TUNING.ROOM_NAME_MAX_LEN
  ) {
    throw new Error(
      `Room name must be between ${TUNING.ROOM_NAME_MIN_LEN} and ${TUNING.ROOM_NAME_MAX_LEN} characters`
    );
  }

  let attempts = 0;
  while (attempts++ < 10) {
    const code = generateRoomCode();
    const roomRef = doc(db, "rooms", code);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(roomRef);
        if (snap.exists()) {
          throw new Error("COLLISION");
        }
        const roomData: RoomData = {
          hostUid,
          name: trimmedName,
          size,
          status: "lobby",
          runCount: 0,
          createdAt: Date.now(),
        };
        tx.set(roomRef, roomData);
      });

      return code;
    } catch (err: any) {
      if (err.message === "COLLISION") {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to allocate unique room code after 10 attempts");
}

export async function getRoomData(code: string): Promise<RoomData | null> {
  const { db } = initFirebase();
  const roomRef = doc(db, "rooms", code);
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(
      roomRef,
      (snap) => {
        unsub();
        if (snap.exists()) {
          resolve(snap.data() as RoomData);
        } else {
          resolve(null);
        }
      },
      (err) => {
        unsub();
        reject(err);
      }
    );
  });
}

export async function updateRoomStatus(
  code: string,
  status: "lobby" | "playing" | "closed",
  runCountIncrement = 0
): Promise<void> {
  const { db } = initFirebase();
  const roomRef = doc(db, "rooms", code);
  await updateDoc(roomRef, {
    status,
    ...(runCountIncrement > 0 ? { runCount: runCountIncrement } : {}),
  });
}

export async function closeAndCleanRoom(code: string): Promise<void> {
  const { db } = initFirebase();
  try {
    const signalsRef = collection(db, "rooms", code, "signals");
    const sigSnaps = await getDocs(signalsRef);
    const deletePromises = sigSnaps.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  } catch {}

  try {
    const roomRef = doc(db, "rooms", code);
    await deleteDoc(roomRef);
  } catch {}
}
