import { extname } from "node:path";

import type { Recipe } from "../schema/recipe.js";
import { resolveRecipeParams } from "../engine/dry-run.js";
import {
  analyzeAudioFile,
  type BeatAnalysis,
} from "../beat/analyze.js";
import {
  buildBeatSyncStudioPlan,
  withBeatSyncPlanParams,
  type BeatSyncStudioParams,
} from "../beat/studio.js";
import { probeMediaDuration as probeFileDuration } from "../beat/verify.js";
import {
  FFPROBE_CANDIDATES,
  findExecutable,
} from "../media.js";
import { beatSyncEditRecipe } from "./beat-sync-edit.js";
import { cinematicLookLabRecipe } from "./cinematic-look-lab.js";
import { hdrSafeGradeRecipe } from "./hdr-safe-grade.js";
import { motivatedTransitionRecipe } from "./motivated-transition.js";
import { titleCardRecipe } from "./title-card.js";

const recipes = [
  beatSyncEditRecipe,
  titleCardRecipe,
  motivatedTransitionRecipe,
  hdrSafeGradeRecipe,
  cinematicLookLabRecipe,
] satisfies Recipe[];

export function listRecipes(): Recipe[] {
  return [...recipes];
}

export function getRecipe(id: string): Recipe | undefined {
  return recipes.find((recipe) => recipe.id === id);
}

const STILL_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

export interface BeatSyncMediaDurationSummary {
  totalDurationSeconds: number;
  imageHoldSeconds: number;
  mediaDurationsSeconds: number[];
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

/**
 * A still has no intrinsic timeline, so it receives one estimated four-beat
 * bar. The 1–4 second bounds keep sparse or pathological tempo estimates from
 * turning one image into either a flash frame or an accidental long hold.
 */
export function beatSyncStillImageHoldSeconds(
  analysis: BeatAnalysis,
): number {
  const intervals = analysis.beatTimesSeconds
    .slice(1)
    .map((time, index) => time - (analysis.beatTimesSeconds[index] as number))
    .filter((interval) => Number.isFinite(interval) && interval > 0);
  const beatSeconds =
    analysis.estimatedBpm !== null && analysis.estimatedBpm > 0
      ? 60 / analysis.estimatedBpm
      : median(intervals) ?? 0.5;
  return Math.max(1, Math.min(4, beatSeconds * 4));
}

export async function deriveBeatSyncMediaDuration(
  mediaPaths: string[],
  analysis: BeatAnalysis,
  probeDuration: (path: string) => Promise<number | null>,
): Promise<BeatSyncMediaDurationSummary> {
  if (mediaPaths.length === 0) {
    throw new Error("Beat Sync Studio requires at least one media file.");
  }
  const imageHoldSeconds = beatSyncStillImageHoldSeconds(analysis);
  let totalDurationSeconds = 0;
  const mediaDurationsSeconds: number[] = [];
  const failures: string[] = [];

  for (const path of mediaPaths) {
    try {
      const duration = await probeDuration(path);
      if (duration !== null && Number.isFinite(duration) && duration > 0) {
        totalDurationSeconds += duration;
        mediaDurationsSeconds.push(duration);
      } else if (STILL_IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
        totalDurationSeconds += imageHoldSeconds;
        mediaDurationsSeconds.push(imageHoldSeconds);
      } else {
        failures.push(`${path} (ffprobe reported no duration)`);
      }
    } catch (error) {
      failures.push(
        `${path} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (failures.length > 0 || totalDurationSeconds <= 0) {
    throw new Error(
      "Beat Sync Studio could not determine the duration of every selected "
        + `media file: ${failures.join("; ") || "no probe returned a usable duration"}.`,
    );
  }
  return {
    totalDurationSeconds,
    imageHoldSeconds,
    mediaDurationsSeconds,
  };
}

export async function prepareRecipeRun(
  recipe: Recipe,
  suppliedParams: Record<string, unknown>,
  options: {
    analyzeAudio?: (audioPath: string) => Promise<BeatAnalysis>;
    probeMediaDuration?: (path: string) => Promise<number | null>;
  } = {},
): Promise<{ recipe: Recipe; params: Record<string, unknown> }> {
  const resolved = resolveRecipeParams(recipe, suppliedParams);
  if (recipe.id !== beatSyncEditRecipe.id) return resolved;

  const params = resolved.params as unknown as BeatSyncStudioParams;
  const analysis = await (options.analyzeAudio ?? analyzeAudioFile)(params.audio);
  let probeDuration = options.probeMediaDuration;
  if (probeDuration === undefined) {
    const ffprobePath = await findExecutable(FFPROBE_CANDIDATES);
    if (ffprobePath === undefined) {
      throw new Error(
        "ffprobe is required to determine Beat Sync media duration, but it was not found.",
      );
    }
    probeDuration = (path) => probeFileDuration(path, ffprobePath);
  }
  const mediaDuration = await deriveBeatSyncMediaDuration(
    params.media,
    analysis,
    probeDuration,
  );
  const plan = buildBeatSyncStudioPlan(params, analysis, {
    mediaDurationSeconds: mediaDuration.totalDurationSeconds,
    mediaDurationsSeconds: mediaDuration.mediaDurationsSeconds,
  });
  return {
    recipe: resolved.recipe,
    params: withBeatSyncPlanParams(resolved.params, plan),
  };
}

export {
  beatSyncEditRecipe,
  cinematicLookLabRecipe,
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
};
