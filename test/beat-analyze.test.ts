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
  amplitude = 1,
): Float32Array {
  const samples = new Float32Array(
    Math.ceil(durationSeconds * BEAT_SAMPLE_RATE),
  );
  for (const time of onsetTimesSeconds) {
    const sample = Math.round(time * BEAT_SAMPLE_RATE);
    // A short bipolar impulse has broadband energy and no sustained tail.
    samples[sample] = amplitude;
    samples[sample + 1] = -0.7 * amplitude;
    samples[sample + 2] = 0.35 * amplitude;
  }
  return samples;
}

function mix(left: Float32Array, right: Float32Array): Float32Array {
  expect(left).toHaveLength(right.length);
  return Float32Array.from(
    left,
    (value, index) => value + (right[index] as number),
  );
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
  it("generates exactly the expected 120 BPM grid", () => {
    const truth = Array.from({ length: 12 }, (_value, index) => 0.5 + index * 0.5);
    const analysis = analyzePcm(clickTrack(6.5, truth));
    const expectedGrid = Array.from({ length: 13 }, (_value, index) => index * 0.5);
    const errors = onsetErrors(analysis.beatTimesSeconds, expectedGrid);

    expectWithinOneHop(analysis.beatTimesSeconds, expectedGrid);
    expect(errors.max).toBeLessThan(0.006);
    expect(errors.mean).toBeLessThan(0.004);
    expect(analysis.estimatedBpm).toBeCloseTo(120, 0);
    expect(analysis.primaryBeatTimesSeconds).toHaveLength(7);
    expect(analysis.downbeatTimesSeconds).toHaveLength(4);
  });

  it("keeps a deliberately missing beat on the generated grid", () => {
    const expectedGrid = Array.from(
      { length: 11 },
      (_value, index) => index * 0.5,
    );
    const clicks = expectedGrid.filter((time) => time !== 2.5 && time !== 0);
    const analysis = analyzePcm(clickTrack(5.5, clicks));

    expectWithinOneHop(analysis.beatTimesSeconds, expectedGrid);
    expect(analysis.beatTimesSeconds[5]).toBeCloseTo(2.5, 2);
    expect(
      analysis.onsets.some(
        (onset) => Math.abs(onset.timeSeconds - 2.5) < 0.1,
      ),
    ).toBe(false);
  });

  it("does not let stronger irregular off-beat transients drag the grid", () => {
    const expectedGrid = Array.from(
      { length: 13 },
      (_value, index) => index * 0.5,
    );
    const beats = expectedGrid.slice(1);
    const offBeats = [1.21, 2.27, 3.19, 4.24, 5.18];
    const pcm = mix(
      clickTrack(6.5, beats, 0.65),
      clickTrack(6.5, offBeats, 1),
    );
    const analysis = analyzePcm(pcm);

    expectWithinOneHop(analysis.beatTimesSeconds, expectedGrid);
    for (const offBeat of offBeats) {
      expect(
        Math.min(
          ...analysis.beatTimesSeconds.map((beat) =>
            Math.abs(beat - offBeat)
          ),
        ),
      ).toBeGreaterThan(0.15);
    }
  });

  it("resolves a 188.8 BPM subdivision octave to 94.4 BPM", () => {
    const subdivisionPeriod = 60 / 188.8;
    const clicks = Array.from(
      { length: 36 },
      (_value, index) => 0.2 + index * subdivisionPeriod,
    );
    const analysis = analyzePcm(clickTrack(12, clicks));

    expect(analysis.estimatedBpm).toBeCloseTo(94.4, 0);
    expect(analysis.estimatedBpm).toBeLessThan(180);
    expect(analysis.beatTimesSeconds.length).toBeGreaterThanOrEqual(18);
    expect(analysis.beatTimesSeconds.length).toBeLessThanOrEqual(20);
  });

  it("keeps sub-frame onset precision for a 60 fps delivery", () => {
    const frameRate = 60;
    const truth = Array.from(
      { length: 10 },
      (_value, index) => 0.375 + index * 0.375,
    );
    const analysis = analyzePcm(clickTrack(4.25, truth));
    const expectedGrid = Array.from(
      { length: 12 },
      (_value, index) => index * 0.375,
    );
    const errors = onsetErrors(analysis.beatTimesSeconds, expectedGrid);

    expect(analysis.beatTimesSeconds).toHaveLength(expectedGrid.length);
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
