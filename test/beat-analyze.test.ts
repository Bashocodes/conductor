import { describe, expect, it } from "vitest";

import {
  analyzePcm,
  BEAT_HOP_SIZE,
  BEAT_SAMPLE_RATE,
  ffmpegPcmArgs,
} from "../src/beat/analyze.js";

function clickTrack(
  durationSeconds: number,
  onsetTimesSeconds: number[],
): Float32Array {
  const samples = new Float32Array(
    Math.ceil(durationSeconds * BEAT_SAMPLE_RATE),
  );
  for (const time of onsetTimesSeconds) {
    const sample = Math.round(time * BEAT_SAMPLE_RATE);
    // A short bipolar impulse has broadband energy and no sustained tail.
    samples[sample] = 1;
    samples[sample + 1] = -0.7;
    samples[sample + 2] = 0.35;
  }
  return samples;
}

function expectWithinOneHop(actual: number[], expected: number[]): void {
  const tolerance = BEAT_HOP_SIZE / BEAT_SAMPLE_RATE;
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(
      Math.abs((actual[index] as number) - (expected[index] as number)),
      `onset ${index}: expected ${expected[index]}, received ${actual[index]}`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

function onsetErrors(actual: number[], expected: number[]): {
  max: number;
  mean: number;
} {
  const errors = actual.map((time, index) =>
    Math.abs(time - (expected[index] as number))
  );
  return {
    max: Math.max(...errors),
    mean: errors.reduce((total, error) => total + error, 0) / errors.length,
  };
}

describe("pure TypeScript beat analysis", () => {
  it("refines a known 120 BPM click train to sub-hop precision", () => {
    const truth = Array.from({ length: 12 }, (_value, index) => 0.5 + index * 0.5);
    const analysis = analyzePcm(clickTrack(6.5, truth));
    const errors = onsetErrors(analysis.beatTimesSeconds, truth);

    expectWithinOneHop(analysis.beatTimesSeconds, truth);
    expect(errors.max).toBeLessThan(0.006);
    expect(errors.mean).toBeLessThan(0.004);
    expect(analysis.estimatedBpm).toBeCloseTo(120, 0);
  });

  it("keeps onset accuracy across a known tempo change", () => {
    const first = Array.from({ length: 8 }, (_value, index) => 0.5 + index * 0.5);
    const secondStart = (first.at(-1) as number) + 2 / 3;
    const second = Array.from(
      { length: 7 },
      (_value, index) => secondStart + index * (2 / 3),
    );
    const truth = [...first, ...second];
    const analysis = analyzePcm(clickTrack(9.5, truth));
    const errors = onsetErrors(analysis.beatTimesSeconds, truth);

    expectWithinOneHop(analysis.beatTimesSeconds, truth);
    expect(errors.max).toBeLessThan(0.006);
    expect(errors.mean).toBeLessThan(0.004);
  });

  it("keeps sub-frame onset precision for a 60 fps delivery", () => {
    const frameRate = 60;
    const truth = Array.from(
      { length: 10 },
      (_value, index) => 0.375 + index * 0.375,
    );
    const analysis = analyzePcm(clickTrack(4.25, truth));
    const errors = onsetErrors(analysis.beatTimesSeconds, truth);

    expect(analysis.beatTimesSeconds).toHaveLength(truth.length);
    expect(errors.max).toBeLessThan(1 / frameRate / 2);
    expect(errors.mean).toBeLessThan(0.004);
  });

  it("does not manufacture peaks in a quiet passage", () => {
    const quiet = new Float32Array(BEAT_SAMPLE_RATE * 5);
    const analysis = analyzePcm(quiet);

    expect(analysis.onsets).toEqual([]);
    expect(analysis.estimatedBpm).toBeNull();
  });

  it("amplitude-gates transient-shaped numerical-floor events", () => {
    const quietClicks = clickTrack(
      5,
      [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
    );
    for (let sample = 0; sample < quietClicks.length; sample += 1) {
      quietClicks[sample] = (quietClicks[sample] as number) * 1e-7;
    }

    const analysis = analyzePcm(quietClicks);

    expect(analysis.onsets).toEqual([]);
    expect(analysis.estimatedBpm).toBeNull();
  });

  it("asks ffmpeg for mono 22050 Hz little-endian float PCM", () => {
    expect(ffmpegPcmArgs("/music/track.wav")).toEqual([
      "-v",
      "error",
      "-i",
      "/music/track.wav",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "22050",
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "pipe:1",
    ]);
  });
});
