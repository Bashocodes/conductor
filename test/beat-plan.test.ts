import { describe, expect, it } from "vitest";

import {
  buildBeatSyncEvents,
  buildQuantizedBeatMap,
} from "../src/beat/plan.js";

describe("beat-sync planning foundation", () => {
  it("quantizes detector times to exact edit frames", () => {
    expect(
      buildQuantizedBeatMap({
        frameRate: 30,
        beatTimesSeconds: [0.016, 0.51, 1.01],
      }),
    ).toEqual([
      { frame: 0, timeSeconds: 0, importance: "beat" },
      { frame: 15, timeSeconds: 0.5, importance: "beat" },
      { frame: 30, timeSeconds: 1, importance: "beat" },
    ]);
  });

  it("keeps the strongest hierarchy when detectors share a frame", () => {
    expect(
      buildQuantizedBeatMap({
        frameRate: 24,
        beatTimesSeconds: [1],
        primaryBeatTimesSeconds: [1.01],
        downbeatTimesSeconds: [1.02],
      }),
    ).toEqual([
      { frame: 24, timeSeconds: 1, importance: "downbeat" },
    ]);
  });

  it("maps strong beats to cuts and transition peaks", () => {
    const events = buildBeatSyncEvents(
      [
        { frame: 12, timeSeconds: 0.5, importance: "beat" },
        { frame: 24, timeSeconds: 1, importance: "downbeat" },
      ],
      { brandPulse: true },
    );
    expect(events[0]?.targets).toEqual(["light-accent", "camera-impact"]);
    expect(events[1]?.targets).toEqual([
      "cut",
      "transition-apex",
      "light-accent",
      "brand-pulse",
    ]);
  });

  it("feeds density and allowed families through the existing hierarchy", () => {
    const beats = [
      { frame: 12, timeSeconds: 0.5, importance: "beat" as const },
      { frame: 24, timeSeconds: 1, importance: "primary" as const },
      { frame: 48, timeSeconds: 2, importance: "downbeat" as const },
    ];
    const restrained = buildBeatSyncEvents(beats, {
      density: "restrained",
      allowedEventFamilies: ["cuts", "light"],
    });
    expect(restrained.map((event) => event.targets)).toEqual([
      [],
      ["light-accent"],
      ["cut", "light-accent"],
    ]);

    const active = buildBeatSyncEvents(beats, {
      density: "active",
      allowedEventFamilies: ["cuts", "camera"],
    });
    expect(active.map((event) => event.targets)).toEqual([
      ["camera-impact"],
      ["cut"],
      ["cut"],
    ]);
  });

  it("rejects invalid detector output before it reaches After Effects", () => {
    expect(() =>
      buildQuantizedBeatMap({
        frameRate: 0,
        beatTimesSeconds: [1],
      }),
    ).toThrow("frameRate");
    expect(() =>
      buildQuantizedBeatMap({
        frameRate: 30,
        beatTimesSeconds: [-1],
      }),
    ).toThrow("non-negative");
  });
});
