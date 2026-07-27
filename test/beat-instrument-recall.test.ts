import { describe, expect, it } from "vitest";

import { analyzePcm } from "../src/beat/analyze.js";
import { instrumentTrack, type InstrumentHit } from "./helpers/instrumentTrack.js";

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

function recallByKind(
  hits: InstrumentHit[],
  options: Parameters<typeof instrumentTrack>[2] = {},
): Record<string, { found: number; total: number }> {
  const { pcm, groundTruthSeconds } = instrumentTrack(7, hits, options);
  const detected = analyzePcm(pcm).onsets.map((onset) => onset.timeSeconds);
  const result: Record<string, { found: number; total: number }> = {};
  for (const truth of groundTruthSeconds) {
    const kind = hits.find((hit) => hit.timeSeconds === truth)?.kind ?? "?";
    const nearest = detected.reduce(
      (best, time) => Math.min(best, Math.abs(time - truth)),
      Infinity,
    );
    const bucket = result[kind] ?? { found: 0, total: 0 };
    bucket.total += 1;
    if (nearest <= MATCH_TOLERANCE_SECONDS) bucket.found += 1;
    result[kind] = bucket;
  }
  return result;
}

function backbeat(): InstrumentHit[] {
  const beat = 0.5;
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
    const kicks = backbeat().filter((hit) => hit.kind === "kick");
    const recall = recallByKind(kicks);
    expect(recall.kick?.total).toBe(6);
    expect(
      recall.kick?.found,
      "kick drums under a bass drone must not be silently dropped",
    ).toBeGreaterThan(0);
  });

  it("keeps snares and kicks in one mix above a recall floor", () => {
    const recall = recallByKind(backbeat());
    expect(recall.snare?.found).toBe(recall.snare?.total);
    // Kick recall is a FLOOR, not a target. It currently sits at 4 of 6: the
    // remaining loss is the low-frequency tilt of the weighted signal itself
    // (0.35x at DC against 2x at Nyquist). Raise this number when that is
    // improved; never lower it to make a change pass.
    expect(recall.kick?.found).toBeGreaterThanOrEqual(4);
  });

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
  });
});
