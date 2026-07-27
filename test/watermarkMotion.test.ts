import { describe, expect, it } from "vitest";

import {
  DEFAULT_WATERMARK_PATH,
  WATERMARK_MOTIONS,
  watermarkPathKeyframes,
} from "../src/recipes/watermarkMotion.js";
import { CONSOLE_HTML } from "../src/server/page.js";

/**
 * The console carries its own copy of this maths so it can draw the path and
 * answer a slider without a round trip. Two copies are only acceptable while
 * they agree, so the page's copy is lifted out and run against this one.
 */
function consoleImplementation(): typeof watermarkPathKeyframes {
  const start = CONSOLE_HTML.indexOf("const EDGE_MARGIN");
  const end = CONSOLE_HTML.indexOf("function fullDurationSeconds");
  if (start < 0 || end <= start) {
    throw new Error("The console no longer contains the watermark path maths");
  }
  const source = CONSOLE_HTML.slice(start, end);
  return new Function(
    `${source}\nreturn watermarkPathKeyframes;`,
  )() as typeof watermarkPathKeyframes;
}

function distances(path: Array<{ value: [number, number] }>): number[] {
  const steps: number[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const [ax, ay] = path[index - 1]!.value;
    const [bx, by] = path[index]!.value;
    steps.push(Math.hypot(bx - ax, by - ay));
  }
  return steps;
}

describe("watermark motion", () => {
  it("samples a curve densely enough that no single step is a lurch", () => {
    const path = watermarkPathKeyframes({
      motion: "Drift",
      cycles: 2,
      travel: 100,
      centerXPercent: 50,
      centerYPercent: 50,
    });

    expect(path.length).toBeGreaterThan(40);
    // The four-corner path this replaced moved ~0.64 of the frame between
    // keys, which is what made it lurch. After Effects draws a smooth spatial
    // curve through the samples, so they do not have to be dense — only close
    // enough that no single one is a jump.
    expect(Math.max(...distances(path))).toBeLessThan(0.2);
  });

  it("keeps the mark inside the frame at full travel from any centre", () => {
    for (const motion of WATERMARK_MOTIONS) {
      for (const centre of [0, 50, 100]) {
        const path = watermarkPathKeyframes({
          motion,
          cycles: 1.5,
          travel: 100,
          centerXPercent: centre,
          centerYPercent: 100 - centre,
        });
        for (const { value } of path) {
          expect(value[0]).toBeGreaterThanOrEqual(0.05);
          expect(value[0]).toBeLessThanOrEqual(0.95);
          expect(value[1]).toBeGreaterThanOrEqual(0.05);
          expect(value[1]).toBeLessThanOrEqual(0.95);
        }
      }
    }
  });

  it("spans the whole clip in normalized time, whatever the speed", () => {
    for (const cycles of [0.1, 1, 7.5]) {
      const path = watermarkPathKeyframes({
        motion: "Orbit",
        cycles,
        travel: 40,
        centerXPercent: 50,
        centerYPercent: 50,
      });
      expect(path[0]!.time).toBe(0);
      expect(path.at(-1)!.time).toBe(1);
      for (let index = 1; index < path.length; index += 1) {
        expect(path[index]!.time).toBeGreaterThan(path[index - 1]!.time);
      }
    }
  });

  it("travels further as travel rises, and not at all when it is zero", () => {
    const centre = { centerXPercent: 50, centerYPercent: 50 } as const;
    const spread = (travel: number) => {
      const path = watermarkPathKeyframes({ motion: "Orbit", cycles: 1, travel, ...centre });
      const xs = path.map((keyframe) => keyframe.value[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(0)).toBe(0);
    expect(spread(100)).toBeGreaterThan(spread(50));
    expect(spread(50)).toBeGreaterThan(0);
  });

  it("holds still, with two keys, when asked for no motion", () => {
    const path = watermarkPathKeyframes({
      motion: "Static",
      cycles: 4,
      travel: 90,
      centerXPercent: 80,
      centerYPercent: 20,
    });
    // setKeyframes requires at least two; a held position needs exactly two.
    expect(path).toHaveLength(2);
    expect(path[0]!.value).toEqual([0.8, 0.2]);
    expect(path[1]!.value).toEqual([0.8, 0.2]);
  });

  it("caps the key count so a long clip cannot flood the timeline", () => {
    const path = watermarkPathKeyframes({
      motion: "Drift",
      cycles: 400,
      travel: 60,
      centerXPercent: 50,
      centerYPercent: 50,
    });
    expect(path.length).toBeLessThanOrEqual(601);
  });

  it("agrees exactly with the copy embedded in the console", () => {
    const fromConsole = consoleImplementation();
    for (const motion of WATERMARK_MOTIONS) {
      for (const cycles of [0.2, 1, 4.7]) {
        const options = {
          motion,
          cycles,
          travel: 65,
          centerXPercent: 44,
          centerYPercent: 58,
        } as const;
        expect(fromConsole(options)).toEqual(watermarkPathKeyframes(options));
      }
    }
  });

  it("ships a default a recipe run can use with nothing supplied", () => {
    expect(DEFAULT_WATERMARK_PATH.length).toBeGreaterThan(8);
    expect(DEFAULT_WATERMARK_PATH[0]!.time).toBe(0);
  });
});
