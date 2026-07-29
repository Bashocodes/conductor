import { stat } from "node:fs/promises";

/**
 * Native media tools have one discovery boundary for the whole application.
 * Callers still receive the resolved executable as an argument, which keeps
 * probing and analysis deterministic in tests.
 */
export const FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/opt/local/bin/ffmpeg",
];

export const FFPROBE_CANDIDATES = [
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe",
  "/opt/local/bin/ffprobe",
];

export async function findExecutable(
  candidates: string[],
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await stat(candidate).then(() => true).catch(() => false)) {
      return candidate;
    }
  }
  return undefined;
}
