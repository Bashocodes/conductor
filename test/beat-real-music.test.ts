import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeAudioFile } from "../src/beat/analyze.js";

interface RealMusicAttack {
  timeSeconds: number;
  voice:
    | "kick_or_low_drum"
    | "snare_or_clap"
    | "hat_or_bright_attack";
}

interface RealMusicFixture {
  fixture: string;
  audioCommitted: false;
  annotationWindowSeconds: { start: number; end: number };
  annotationGranularityMilliseconds: number;
  timeStepMilliseconds: number;
  matchingToleranceMilliseconds: number;
  method: string;
  attacks: RealMusicAttack[];
}

interface VoiceResult {
  found: number;
  total: number;
  deviationsMilliseconds: number[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/binary-love-attacks.json", import.meta.url),
    "utf8",
  ),
) as RealMusicFixture;
const audioPath = resolve(
  process.cwd(),
  "..",
  "beat-fixtures",
  fixture.fixture,
);

function evaluateRealMusic(
  detected: number[],
): {
  found: number;
  byVoice: Map<RealMusicAttack["voice"], VoiceResult>;
} {
  const toleranceSeconds =
    fixture.matchingToleranceMilliseconds / 1_000;
  const available = new Set(detected.map((_, index) => index));
  const byVoice = new Map<RealMusicAttack["voice"], VoiceResult>();
  let found = 0;

  for (const attack of fixture.attacks) {
    const nearest = [...available]
      .map((index) => ({
        index,
        deviation: Math.abs(
          (detected[index] as number) - attack.timeSeconds,
        ),
      }))
      .sort(
        (left, right) =>
          left.deviation - right.deviation || left.index - right.index,
      )[0];
    const bucket = byVoice.get(attack.voice) ?? {
      found: 0,
      total: 0,
      deviationsMilliseconds: [],
    };
    bucket.total += 1;
    if (
      nearest !== undefined &&
      nearest.deviation <= toleranceSeconds
    ) {
      available.delete(nearest.index);
      bucket.found += 1;
      bucket.deviationsMilliseconds.push(nearest.deviation * 1_000);
      found += 1;
    }
    byVoice.set(attack.voice, bucket);
  }
  return { found, byVoice };
}

describe("real-music onset recall", () => {
  it.skipIf(!existsSync(audioPath))(
    "checks the external copyrighted fixture against committed annotations",
    async () => {
      const analysis = await analyzeAudioFile(audioPath);
      const detected = analysis.onsets
        .map((onset) => onset.timeSeconds)
        .filter(
          (time) =>
            time >= fixture.annotationWindowSeconds.start &&
            time <= fixture.annotationWindowSeconds.end,
        );
      const result = evaluateRealMusic(detected);

      // The blind marks are intentionally not tuned to detector output. Keep
      // the current measured floor visible, and raise it only after a new
      // detector-independent annotation pass supports doing so.
      expect(result.found).toBeGreaterThanOrEqual(10);
      expect(
        result.byVoice.get("kick_or_low_drum")?.found,
      ).toBeGreaterThanOrEqual(4);
      expect(
        result.byVoice.get("snare_or_clap")?.found,
      ).toBeGreaterThanOrEqual(3);
      expect(
        result.byVoice.get("hat_or_bright_attack")?.found,
      ).toBeGreaterThanOrEqual(3);
      for (const voice of result.byVoice.values()) {
        expect(
          Math.max(...voice.deviationsMilliseconds),
        ).toBeLessThanOrEqual(
          fixture.annotationGranularityMilliseconds,
        );
      }
    },
  );
});
