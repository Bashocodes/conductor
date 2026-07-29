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

  it("routes each importance tier to one exclusive effect family", () => {
    const events = buildBeatSyncEvents(
      [
        { frame: 12, timeSeconds: 0.5, importance: "beat" },
        { frame: 18, timeSeconds: 0.75, importance: "primary" },
        { frame: 24, timeSeconds: 1, importance: "downbeat" },
      ],
      { brandPulse: true },
    );
    expect(events[0]?.targets).toEqual(["directional-blur-accent"]);
    expect(events[1]?.targets).toEqual([
      "cut",
      "pixel-sort-accent",
      "brand-pulse",
    ]);
    expect(events[2]?.targets).toEqual([
      "cut",
      "glow-accent",
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
      allowedEventFamilies: ["cuts", "glow"],
    });
    expect(restrained.map((event) => event.targets)).toEqual([
      [],
      [],
      ["cut", "glow-accent"],
    ]);

    const active = buildBeatSyncEvents(beats, {
      density: "active",
      allowedEventFamilies: ["cuts", "pixel-sort", "directional-blur"],
    });
    expect(active.map((event) => event.targets)).toEqual([
      [],
      ["cut", "pixel-sort-accent"],
      ["cut"],
    ]);

    const impact = buildBeatSyncEvents(beats, {
      density: "impact",
      allowedEventFamilies: ["glow", "pixel-sort", "directional-blur"],
    });
    expect(impact.map((event) => event.targets)).toEqual([
      ["directional-blur-accent"],
      ["pixel-sort-accent"],
      ["glow-accent"],
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
