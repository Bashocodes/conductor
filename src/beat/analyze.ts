import { spawn } from "node:child_process";

import {
  FFMPEG_CANDIDATES,
  findExecutable,
} from "../media.js";

export const BEAT_SAMPLE_RATE = 22_050;
export const BEAT_WINDOW_SIZE = 1_024;
export const BEAT_HOP_SIZE = 512;

export interface DetectedOnset {
  /** Sample-derived time. No elapsed clock or repeated floating-point addition. */
  timeSeconds: number;
  envelopeFrame: number;
  strength: number;
  importance: "beat" | "primary" | "downbeat";
}

export interface BeatAnalysis {
  sampleRate: number;
  windowSize: number;
  hopSize: number;
  durationSeconds: number;
  estimatedBpm: number | null;
  onsets: DetectedOnset[];
  beatTimesSeconds: number[];
  primaryBeatTimesSeconds: number[];
  downbeatTimesSeconds: number[];
}

export interface AnalyzePcmOptions {
  sampleRate?: number;
  windowSize?: number;
  hopSize?: number;
  medianRadiusFrames?: number;
  minimumGapSeconds?: number;
}

export function ffmpegPcmArgs(audioPath: string): string[] {
  return [
    "-v",
    "error",
    "-i",
    audioPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(BEAT_SAMPLE_RATE),
    "-f",
    "f32le",
    "-acodec",
    "pcm_f32le",
    "pipe:1",
  ];
}

async function findFfmpeg(): Promise<string> {
  const executable = await findExecutable(FFMPEG_CANDIDATES);
  if (executable !== undefined) return executable;
  throw new Error(
    "ffmpeg is required for beat analysis, but it was not found in a supported location.",
  );
}

/**
 * Decodes the only representation the detector accepts: mono 22050 Hz f32 PCM.
 * ffmpeg remains the repository's existing media boundary; the analysis after
 * this function is pure TypeScript and has no native or Python dependency.
 */
export async function decodeAudioToPcm(
  audioPath: string,
  ffmpegPath?: string,
): Promise<Float32Array> {
  const executable = ffmpegPath ?? await findFfmpeg();
  const child = spawn(executable, ffmpegPcmArgs(audioPath), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  let errorText = "";
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    errorText = (errorText + chunk.toString("utf8")).slice(-8_000);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  if (exitCode !== 0) {
    throw new Error(
      `ffmpeg could not decode '${audioPath}' (exit ${exitCode}).${errorText === "" ? "" : ` ${errorText.trim()}`}`,
    );
  }

  const bytes = Buffer.concat(output);
  if (bytes.byteLength % 4 !== 0) {
    throw new Error("ffmpeg returned an incomplete 32-bit PCM sample.");
  }
  const samples = new Float32Array(bytes.byteLength / 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readFloatLE(index * 4);
  }
  return samples;
}

function hannWindow(size: number): Float64Array {
  const values = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    values[index] =
      0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return values;
}

/**
 * In-place radix-2 FFT with one explicit, stable loop order.
 *
 * Beat times are derived from integer frame/sample indices, never wall-clock
 * time or repeated additions. The fixed traversal also avoids reductions whose
 * floating-point accumulation order could change with task scheduling.
 */
function fftMagnitudes(
  samples: ArrayLike<number>,
  window: Float64Array,
): Float64Array {
  const size = window.length;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    real[index] = (samples[index] ?? 0) * (window[index] ?? 0);
  }

  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const swapReal = real[index] as number;
      real[index] = real[reversed] as number;
      real[reversed] = swapReal;
      const swapImaginary = imaginary[index] as number;
      imaginary[index] = imaginary[reversed] as number;
      imaginary[reversed] = swapImaginary;
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const half = length / 2;
    for (let block = 0; block < size; block += length) {
      for (let offset = 0; offset < half; offset += 1) {
        const angle = (-2 * Math.PI * offset) / length;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const even = block + offset;
        const odd = even + half;
        const oddReal =
          (real[odd] as number) * cosine -
          (imaginary[odd] as number) * sine;
        const oddImaginary =
          (real[odd] as number) * sine +
          (imaginary[odd] as number) * cosine;
        const evenReal = real[even] as number;
        const evenImaginary = imaginary[even] as number;
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
      }
    }
  }

  const magnitudes = new Float64Array(size / 2 + 1);
  for (let bin = 0; bin < magnitudes.length; bin += 1) {
    magnitudes[bin] = Math.hypot(
      real[bin] as number,
      imaginary[bin] as number,
    );
  }
  return magnitudes;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] as number;
  return (
    ((ordered[middle - 1] as number) + (ordered[middle] as number)) /
    2
  );
}

/**
 * Applies the detector's percussive emphasis once, before both spectral-flux
 * analysis and sub-hop transient localization.
 *
 * This is not source separation. The three-tap FIR blends the broadband signal
 * with a small second-difference branch. DC retains 0.35x gain and Nyquist
 * reaches 0.75x: high frequencies are still favoured, but only by about 2.1:1
 * rather than 5.7:1. That keeps low drum attacks in the spectral-flux signal.
 * A sustained bass tone still produces no positive spectral change after its
 * attack, so preserving its band does not turn the tone itself into onsets.
 */
function percussiveWeightedSignal(
  pcm: ArrayLike<number>,
): Float64Array {
  const weighted = new Float64Array(pcm.length);
  let previous = 0;
  let previousPrevious = 0;
  for (let sample = 0; sample < pcm.length; sample += 1) {
    const current = Number.isFinite(pcm[sample])
      ? (pcm[sample] as number)
      : 0;
    const secondDifference =
      current - 2 * previous + previousPrevious;
    weighted[sample] = 0.35 * current + 0.1 * secondDifference;
    previousPrevious = previous;
    previous = current;
  }
  return weighted;
}

function onsetEnvelope(
  percussiveSignal: ArrayLike<number>,
  windowSize: number,
  hopSize: number,
): Float64Array {
  const window = hannWindow(windowSize);
  const frameCount = Math.max(
    1,
    Math.ceil(percussiveSignal.length / hopSize) + 1,
  );
  const envelope = new Float64Array(frameCount);
  let previous: Float64Array<ArrayBufferLike> = new Float64Array(
    windowSize / 2 + 1,
  );
  const centered = new Float64Array(windowSize);
  const halfWindow = windowSize / 2;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize - halfWindow;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const sourceIndex = start + offset;
      centered[offset] =
        sourceIndex >= 0 && sourceIndex < percussiveSignal.length
          ? (percussiveSignal[sourceIndex] as number)
          : 0;
    }
    const spectrum = fftMagnitudes(centered, window);
    let flux = 0;
    // The input already carries the percussive emphasis. Applying the same
    // high-band curve a second time here compounded it: at 60 Hz the two
    // stages multiplied to roughly 0.12 gain against 2.1 for a hi-hat, so a
    // kick drum under a bass line fell below the amplitude gate and was never
    // detected at all. Onset energy is counted flat; the emphasis stays in the
    // signal, applied once.
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      const current = Math.log1p(10 * (spectrum[bin] as number));
      const before = Math.log1p(10 * (previous[bin] as number));
      const increase = current - before;
      if (increase > 0) flux += increase;
    }
    envelope[frame] = flux / (spectrum.length - 1);
    previous = spectrum;
  }
  return envelope;
}

interface Peak {
  frame: number;
  refinedFrame: number;
  strength: number;
}

function parabolicPeakOffset(
  previous: number,
  peak: number,
  next: number,
): number {
  const denominator = previous - 2 * peak + next;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) {
    return 0;
  }
  return Math.max(
    -0.5,
    Math.min(0.5, 0.5 * (previous - next) / denominator),
  );
}

function adaptivePeaks(
  envelope: Float64Array,
  medianRadius: number,
  minimumGapFrames: number,
): Peak[] {
  const candidates: Peak[] = [];
  for (let frame = 1; frame < envelope.length - 1; frame += 1) {
    const value = envelope[frame] as number;
    if (
      value <= (envelope[frame - 1] as number) ||
      value < (envelope[frame + 1] as number)
    ) {
      continue;
    }
    const local: number[] = [];
    const start = Math.max(0, frame - medianRadius);
    const end = Math.min(envelope.length - 1, frame + medianRadius);
    for (let index = start; index <= end; index += 1) {
      local.push(envelope[index] as number);
    }
    const localMedian = median(local);
    const deviations = local.map((sample) => Math.abs(sample - localMedian));
    const adaptiveOffset = Math.max(
      Number.EPSILON,
      median(deviations) * 2.5,
      localMedian * 0.35,
    );
    if (value > localMedian + adaptiveOffset) {
      candidates.push({
        frame,
        refinedFrame:
          frame + parabolicPeakOffset(
            envelope[frame - 1] as number,
            value,
            envelope[frame + 1] as number,
          ),
        strength: value,
      });
    }
  }

  const accepted: Peak[] = [];
  for (const candidate of candidates) {
    const previous = accepted.at(-1);
    if (
      previous === undefined ||
      candidate.frame - previous.frame >= minimumGapFrames
    ) {
      accepted.push(candidate);
    } else if (candidate.strength > previous.strength) {
      accepted[accepted.length - 1] = candidate;
    }
  }
  return accepted;
}

function estimateTempo(times: number[]): number | null {
  const intervals: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const interval = (times[index] as number) - (times[index - 1] as number);
    if (interval >= 0.18 && interval <= 2) intervals.push(interval);
  }
  if (intervals.length === 0) return null;
  const middle = median(intervals);
  const inliers = intervals.filter(
    (interval) => Math.abs(interval - middle) <= middle * 0.2,
  );
  let total = 0;
  for (const interval of inliers) total += interval;
  let secondsPerBeat = total / inliers.length;
  let bpm = 60 / secondsPerBeat;
  while (bpm < 70) {
    secondsPerBeat /= 2;
    bpm = 60 / secondsPerBeat;
  }
  while (bpm > 180) {
    secondsPerBeat *= 2;
    bpm = 60 / secondsPerBeat;
  }
  return Math.round(bpm * 100) / 100;
}

function classifyPeaks(
  peaks: Peak[],
  hopSize: number,
  sampleRate: number,
  percussiveSignal: ArrayLike<number>,
): DetectedOnset[] {
  let globalPeak = 0;
  let globalEnergy = 0;
  for (let sample = 0; sample < percussiveSignal.length; sample += 1) {
    const value = percussiveSignal[sample] as number;
    globalPeak = Math.max(globalPeak, Math.abs(value));
    globalEnergy += value * value;
  }
  const globalRms = percussiveSignal.length === 0
    ? 0
    : Math.sqrt(globalEnergy / percussiveSignal.length);
  const amplitudeGate = Math.max(
    1e-5,
    globalPeak * 0.0025,
    globalRms * 0.015,
  );

  const localized = peaks.flatMap((peak) => {
    // The parabolic envelope position gives a stable sub-hop neighbourhood.
    // Within it, the strongest change in the same percussive-weighted signal
    // identifies the transient edge. Raw broadband slope is deliberately not
    // used: a tonal waveform peak or hiss spike is not a perceptual attack.
    const approximateSample = peak.refinedFrame * hopSize;
    const start = Math.max(1, Math.floor(approximateSample - hopSize));
    const end = Math.min(
      percussiveSignal.length - 1,
      Math.ceil(approximateSample + hopSize),
    );
    let localPeak = 0;
    let localEnergy = 0;
    let localSampleCount = 0;
    let transientSample = approximateSample;
    let transientStrength = -Infinity;
    for (let sample = start; sample <= end; sample += 1) {
      const value = percussiveSignal[sample] as number;
      localPeak = Math.max(localPeak, Math.abs(value));
      localEnergy += value * value;
      localSampleCount += 1;
      const strength = Math.abs(
        value - (percussiveSignal[sample - 1] as number),
      );
      if (strength > transientStrength) {
        transientStrength = strength;
        transientSample = sample;
      }
    }
    const localRms = localSampleCount === 0
      ? 0
      : Math.sqrt(localEnergy / localSampleCount);
    if (
      localPeak < amplitudeGate ||
      localRms < amplitudeGate * 0.2
    ) {
      return [];
    }
    return {
      timeSeconds: transientSample / sampleRate,
      envelopeFrame: peak.frame,
      strength: peak.strength,
    };
  });

  return localized.map((onset, index) => ({
    ...onset,
    // With no score or meter metadata, assigning the first accepted pulse as
    // phase zero is an explicit structural estimate. It creates a stable
    // four-beat edit hierarchy without pretending to infer musical semantics.
    importance:
      index % 4 === 0
        ? "downbeat"
        : index % 2 === 0
          ? "primary"
          : "beat",
  }));
}

export function analyzePcm(
  pcm: ArrayLike<number>,
  options: AnalyzePcmOptions = {},
): BeatAnalysis {
  const sampleRate = options.sampleRate ?? BEAT_SAMPLE_RATE;
  const windowSize = options.windowSize ?? BEAT_WINDOW_SIZE;
  const hopSize = options.hopSize ?? BEAT_HOP_SIZE;
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isInteger(windowSize) ||
    windowSize < 2 ||
    (windowSize & (windowSize - 1)) !== 0 ||
    !Number.isInteger(hopSize) ||
    hopSize <= 0
  ) {
    throw new Error(
      "Beat analysis requires a positive sample rate, a radix-2 window, and a positive hop.",
    );
  }

  const percussiveSignal = percussiveWeightedSignal(pcm);
  const envelope = onsetEnvelope(percussiveSignal, windowSize, hopSize);
  const minimumGapFrames = Math.max(
    1,
    Math.round(
      ((options.minimumGapSeconds ?? 0.12) * sampleRate) / hopSize,
    ),
  );
  const peaks = adaptivePeaks(
    envelope,
    options.medianRadiusFrames ?? 16,
    minimumGapFrames,
  );
  const onsets = classifyPeaks(
    peaks,
    hopSize,
    sampleRate,
    percussiveSignal,
  );
  const beatTimesSeconds = onsets.map((onset) => onset.timeSeconds);
  return {
    sampleRate,
    windowSize,
    hopSize,
    durationSeconds: pcm.length / sampleRate,
    estimatedBpm: estimateTempo(beatTimesSeconds),
    onsets,
    beatTimesSeconds,
    primaryBeatTimesSeconds: onsets
      .filter((onset) => onset.importance === "primary")
      .map((onset) => onset.timeSeconds),
    downbeatTimesSeconds: onsets
      .filter((onset) => onset.importance === "downbeat")
      .map((onset) => onset.timeSeconds),
  };
}

export async function analyzeAudioFile(
  audioPath: string,
  options: { ffmpegPath?: string } = {},
): Promise<BeatAnalysis> {
  return analyzePcm(await decodeAudioToPcm(audioPath, options.ffmpegPath));
}
