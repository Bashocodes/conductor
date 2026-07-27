import { describe, expect, it } from "vitest";

import { analyzePcm } from "../src/beat/analyze.js";
import {
  instrumentTrack,
  type InstrumentHit,
  type InstrumentTrackOptions,
} from "./helpers/instrumentTrack.js";

/**
 * Recall, not precision.
 *
 * The existing synthetic tests measure how *close* detected onsets are to known
 * times. That is precision, and precision is silent about the failure that
 * actually matters: an onset the detector never found contributes no error, so
 * a detector that misses every kick drum can still report sub-millisecond
 * accuracy on the events it did find.
 *
 * These tests ask the other question — which events were found at all — using a
 * track whose ground truth is exact because the hits were placed rather than
 * detected.
 */

const MATCH_TOLERANCE_SECONDS = 0.025;

interface VoiceMetrics {
  found: number;
  total: number;
  meanDeviationSeconds: number | null;
  maxDeviationSeconds: number | null;
}

function metricsByKind(
  hits: InstrumentHit[],
  options: InstrumentTrackOptions = {},
): Partial<Record<InstrumentHit["kind"], VoiceMetrics>> {
  const durationSeconds =
    Math.max(...hits.map((hit) => hit.timeSeconds), 0) + 0.5;
  const { pcm } = instrumentTrack(durationSeconds, hits, options);
  const detected = analyzePcm(pcm).onsets.map((onset) => onset.timeSeconds);
  const availableDetections = new Set(
    detected.map((_, index) => index),
  );
  const deviations = new Map<InstrumentHit["kind"], number[]>();
  const result: Partial<
    Record<InstrumentHit["kind"], VoiceMetrics>
  > = {};

  for (const truth of [...hits].sort(
    (left, right) => left.timeSeconds - right.timeSeconds,
  )) {
    const nearest = [...availableDetections]
      .map((index) => ({
        index,
        deviation: Math.abs(
          (detected[index] as number) - truth.timeSeconds,
        ),
      }))
      .sort(
        (left, right) =>
          left.deviation - right.deviation || left.index - right.index,
      )[0];
    const bucket = result[truth.kind] ?? {
      found: 0,
      total: 0,
      meanDeviationSeconds: null,
      maxDeviationSeconds: null,
    };
    bucket.total += 1;
    if (
      nearest !== undefined &&
      nearest.deviation <= MATCH_TOLERANCE_SECONDS
    ) {
      availableDetections.delete(nearest.index);
      bucket.found += 1;
      const kindDeviations = deviations.get(truth.kind) ?? [];
      kindDeviations.push(nearest.deviation);
      deviations.set(truth.kind, kindDeviations);
    }
    result[truth.kind] = bucket;
  }

  for (const [kind, kindDeviations] of deviations) {
    const bucket = result[kind] as VoiceMetrics;
    bucket.meanDeviationSeconds =
      kindDeviations.reduce((sum, value) => sum + value, 0) /
      kindDeviations.length;
    bucket.maxDeviationSeconds = Math.max(...kindDeviations);
  }
  return result;
}

function backbeat(bpm: number): InstrumentHit[] {
  const beat = 60 / bpm;
  const hits: InstrumentHit[] = [];
  for (let bar = 0; bar < 3; bar += 1) {
    const base = 0.35 + bar * beat * 4;
    hits.push({ timeSeconds: base, kind: "kick" });
    hits.push({ timeSeconds: base + beat, kind: "snare" });
    hits.push({ timeSeconds: base + beat * 2, kind: "kick" });
    hits.push({ timeSeconds: base + beat * 3, kind: "snare" });
  }
  return hits;
}

describe("onset recall on instrument-shaped audio", () => {
  it("detects kick drums underneath a sustained bass line", () => {
    // The regression this exists for: emphasising high bands twice (once in
    // the weighted signal, once again on spectral flux) multiplied down to
    // ~0.12 gain at 60 Hz against ~2.1 for a hi-hat. Every kick fell under the
    // amplitude gate and the detector returned ZERO onsets for a kick pattern
    // over a bass drone — while still reporting excellent precision on tracks
    // whose snares it happened to find.
    const kicks = backbeat(120).filter((hit) => hit.kind === "kick");
    const metrics = metricsByKind(kicks);
    expect(metrics.kick?.total).toBe(6);
    expect(
      metrics.kick?.found,
      "kick drums under a bass drone must not be silently dropped",
    ).toBe(6);
  });

  it.each([
    {
      name: "120 BPM backbeat",
      bpm: 120,
      options: {},
    },
    {
      name: "96 BPM backbeat",
      bpm: 96,
      options: { seed: 20260728 },
    },
    {
      name: "110 BPM with kick and bass sharing 60 Hz",
      bpm: 110,
      options: {
        bassFrequencyHz: 60,
        kickFundamentalHz: 60,
        droneGain: 0.28,
        seed: 20260729,
      },
    },
  ] satisfies Array<{
    name: string;
    bpm: number;
    options: InstrumentTrackOptions;
  }>)(
    "keeps every drum voice in the $name mix",
    ({ bpm, options }) => {
      const metrics = metricsByKind(backbeat(bpm), options);
      expect(metrics.kick?.total).toBe(6);
      // This is the recall floor, raised from 4/6 only after all three
      // patterns reached 6/6. Never lower it to make a detector pass.
      expect(metrics.kick?.found).toBe(6);
      expect(metrics.snare?.found).toBe(metrics.snare?.total);
      expect(
        metrics.kick?.maxDeviationSeconds,
      ).not.toBeNull();
      expect(
        metrics.kick?.maxDeviationSeconds ?? Infinity,
      ).toBeLessThanOrEqual(MATCH_TOLERANCE_SECONDS);
      expect(
        metrics.snare?.maxDeviationSeconds ?? Infinity,
      ).toBeLessThanOrEqual(MATCH_TOLERANCE_SECONDS);
    },
  );

  it("still refuses to invent onsets inside sustained material", () => {
    // Deliberately scoped to the interior. A finite buffer has to start and
    // stop, and however gently that is ramped it remains a real change in the
    // signal — a detector that reports it is behaving correctly. Asserting
    // zero onsets across the whole buffer tested the fixture's fade shape
    // rather than the detector, so it is the claim that was wrong, not the
    // result. What matters is that a drone, a swelling pad and a noise floor
    // produce nothing while they are simply playing.
    const { pcm } = instrumentTrack(5, []);
    const interior = analyzePcm(pcm).onsets
      .map((onset) => onset.timeSeconds)
      .filter((time) => time > 0.25 && time < 4.75);
    expect(interior).toHaveLength(0);

    const sharedFundamental = instrumentTrack(5, [], {
      bassFrequencyHz: 60,
      kickFundamentalHz: 60,
      droneGain: 0.28,
      seed: 20260729,
    }).pcm;
    const sharedInterior = analyzePcm(sharedFundamental).onsets
      .map((onset) => onset.timeSeconds)
      .filter((time) => time > 0.25 && time < 4.75);
    expect(sharedInterior).toHaveLength(0);
  });
});
