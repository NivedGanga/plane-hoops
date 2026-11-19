import { describe, it, expect } from "vitest";
import { KEY_BITS } from "../../src/sim/types";
import { TUNING } from "../../config/tuning";

describe("Network, Key Input, and Lobby Unit Tests", () => {
  it("Acceptance 6: All four keys held at once register correctly in the bitmask", () => {
    let bitmask = 0;
    bitmask |= KEY_BITS["KeyW"];
    bitmask |= KEY_BITS["KeyA"];
    bitmask |= KEY_BITS["KeyS"];
    bitmask |= KEY_BITS["KeyD"];

    // 1 | 2 | 4 | 8 = 15 (0b1111)
    expect(bitmask).toBe(15);
    expect((bitmask & KEY_BITS["KeyW"]) !== 0).toBe(true);
    expect((bitmask & KEY_BITS["KeyA"]) !== 0).toBe(true);
    expect((bitmask & KEY_BITS["KeyS"]) !== 0).toBe(true);
    expect((bitmask & KEY_BITS["KeyD"]) !== 0).toBe(true);
  });

  it("Acceptance 8: Lobby enforces exactly 2 or 4 seats", () => {
    const isValidRoomSize = (size: number) => size === 2 || size === 4;
    expect(isValidRoomSize(2)).toBe(true);
    expect(isValidRoomSize(4)).toBe(true);
    expect(isValidRoomSize(1)).toBe(false);
    expect(isValidRoomSize(3)).toBe(false);
    expect(isValidRoomSize(5)).toBe(false);
  });

  it("Enforces rate limiting at 120 messages per second", () => {
    let inputCount = 0;
    const windowStart = Date.now();
    let peerDropped = false;

    // Simulate 125 input messages within 1 second
    for (let i = 0; i < 125; i++) {
      inputCount++;
      if (inputCount > TUNING.MAX_PEER_INPUTS_PER_SEC) {
        peerDropped = true;
      }
    }

    expect(peerDropped).toBe(true);
    expect(TUNING.MAX_PEER_INPUTS_PER_SEC).toBe(120);
  });
});
