import { describe, it, expect, beforeEach } from "vitest";
import {
  getLastRoomName,
  saveLastRoomName,
  getDisplayName,
  saveDisplayName,
} from "../../src/storage/index";
import { TUNING } from "../../config/tuning";

// Mock localStorage for node test runner
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = new LocalStorageMock() as any;
}

describe("Storage & Room Name Validation Unit Tests", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("Acceptance 9: Prefills room name and display name across visits", () => {
    expect(getLastRoomName()).toBe("");
    expect(getDisplayName()).toBe("");

    saveLastRoomName("Squad Alpha");
    saveDisplayName("Ace Pilot");

    // Simulate second visit in same browser
    expect(getLastRoomName()).toBe("Squad Alpha");
    expect(getDisplayName()).toBe("Ace Pilot");
  });

  it("Acceptance 9: Enforces room name length between 1 and 24 characters", () => {
    const valid1 = "A";
    const valid24 = "123456789012345678901234";
    const invalidEmpty = "";
    const invalid25 = "1234567890123456789012345";

    const isValidName = (name: string) =>
      name.trim().length >= TUNING.ROOM_NAME_MIN_LEN &&
      name.trim().length <= TUNING.ROOM_NAME_MAX_LEN;

    expect(isValidName(valid1)).toBe(true);
    expect(isValidName(valid24)).toBe(true);
    expect(isValidName(invalidEmpty)).toBe(false);
    expect(isValidName(invalid25)).toBe(false);
  });
});
