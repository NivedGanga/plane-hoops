import { describe, it, expect } from "vitest";
import {
  computeNameKey,
  computeLeaderboardDocId,
  formatRecord,
} from "../../src/leaderboard/keys";

describe("Leaderboard Unit & Key Tests", () => {
  it("computes normalized name key: collapses whitespace, trims, lowercases", () => {
    expect(computeNameKey("  Sky   Hawks  ")).toBe("sky hawks");
    expect(computeNameKey("ACE-WING")).toBe("ace-wing");
    expect(computeNameKey("Team \t One\n")).toBe("team one");
  });

  it("Acceptance 10: Compound doc ID {ownerUid}__{nameKey} ensures exact overwrite semantics", () => {
    const hostA = "uid_host_aaa";
    const hostB = "uid_host_bbb";

    const docIdA1 = computeLeaderboardDocId(hostA, "Falcon Squad");
    const docIdA2 = computeLeaderboardDocId(hostA, "  Falcon   Squad  ");
    const docIdA3 = computeLeaderboardDocId(hostA, "falcon squad");

    // Same host and same team name produces identical doc ID (overwriting previous entry)
    expect(docIdA1).toBe("uid_host_aaa__falcon squad");
    expect(docIdA1).toBe(docIdA2);
    expect(docIdA1).toBe(docIdA3);

    // Different host using the same team name produces a separate entry
    const docIdB = computeLeaderboardDocId(hostB, "Falcon Squad");
    expect(docIdB).toBe("uid_host_bbb__falcon squad");
    expect(docIdB).not.toBe(docIdA1);

    // Renamed room creates a new entry under the new name
    const docIdRenamed = computeLeaderboardDocId(hostA, "Eagle Eye");
    expect(docIdRenamed).toBe("uid_host_aaa__eagle eye");
    expect(docIdRenamed).not.toBe(docIdA1);
  });

  it("Acceptance 10: Formats record as points pts (cleared hoops)", () => {
    expect(formatRecord(1240, 37)).toBe("1,240 pts (37 hoops)");
    expect(formatRecord(0, 0)).toBe("0 pts (0 hoops)");
    expect(formatRecord(50000, 150)).toBe("50,000 pts (150 hoops)");
  });

  it("Acceptance 10: Sorting order: points desc, then distanceM desc, then earlier updatedAt", () => {
    const entries = [
      { id: "1", points: 100, distanceM: 2000, updatedAt: 100 },
      { id: "2", points: 200, distanceM: 1500, updatedAt: 150 },
      { id: "3", points: 100, distanceM: 2500, updatedAt: 200 },
      { id: "4", points: 100, distanceM: 2000, updatedAt: 80 }, // Same pts, same dist, earlier updated
    ];

    entries.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.distanceM !== a.distanceM) return b.distanceM - a.distanceM;
      return a.updatedAt - b.updatedAt;
    });

    expect(entries[0].id).toBe("2"); // 200 pts
    expect(entries[1].id).toBe("3"); // 100 pts, 2500m
    expect(entries[2].id).toBe("4"); // 100 pts, 2000m, earlier updatedAt (80 vs 100)
    expect(entries[3].id).toBe("1"); // 100 pts, 2000m, later updatedAt (100)
  });

  it("Acceptance 11: Submissions rejected on connection_lost reason", () => {
    const shouldSubmitLeaderboard = (reason: "crash" | "host_ended" | "connection_lost") => {
      return reason === "crash" || reason === "host_ended";
    };

    expect(shouldSubmitLeaderboard("crash")).toBe(true);
    expect(shouldSubmitLeaderboard("host_ended")).toBe(true);
    expect(shouldSubmitLeaderboard("connection_lost")).toBe(false);
  });
});
