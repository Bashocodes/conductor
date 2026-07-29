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
  beatPeriodSeconds: number | null;
  beatPhaseSeconds: number | null;
  beatSnapWindowSeconds: number | null;
  tempoConfidence: BeatTempoConfidence;
  onsets: DetectedOnset[];
  beatTimesSeconds: number[];
  primaryBeatTimesSeconds: number[];
  downbeatTimesSeconds: number[];
}

export interface BeatTempoConfidence {
  level: "low" | "medium" | "high";
  score: number;
  autocorrelation: number;
  ambiguity: number;
  gridCoverage: number;
  summary: string;
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

/**
 * A deliberately coarse tempo estimate used only to resolve autocorrelation's
 * classic octave ambiguity. It never places a beat.
 */
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

interface TempoGrid {
  bpm: number;
  periodSeconds: number;
  phaseSeconds: number;
  snapWindowSeconds: number;
  beatTimesSeconds: number[];
  primaryBeatTimesSeconds: number[];
  downbeatTimesSeconds: number[];
  confidence: BeatTempoConfidence;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function normalizedAutocorrelation(
  values: Float64Array,
  lag: number,
): number {
  let product = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = lag; index < values.length; index += 1) {
    const left = values[index] as number;
    const right = values[index - lag] as number;
    product += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator <= Number.EPSILON ? 0 : product / denominator;
}

function refinedLag(
  correlations: Map<number, number>,
  lag: number,
): number {
  const previous = correlations.get(lag - 1) ?? 0;
  const peak = correlations.get(lag) ?? 0;
  const next = correlations.get(lag + 1) ?? 0;
  return lag + parabolicPeakOffset(previous, peak, next);
}

function octaveDistance(leftBpm: number, rightBpm: number): number {
  let best = Infinity;
  for (const factor of [0.5, 1, 2]) {
    best = Math.min(best, Math.abs(Math.log2((leftBpm * factor) / rightBpm)));
  }
  return best;
}

/**
 * Scores the onset-strength envelope at candidate beat periods. The sparse
 * detector is not used as the clock: it supplies the octave anchor and later
 * confirms individual grid positions.
 */
function estimateBeatPeriod(
  envelope: Float64Array,
  framesPerSecond: number,
  coarseBpm: number,
): {
  lagFrames: number;
  autocorrelation: number;
  ambiguity: number;
} | null {
  const floor = median([...envelope]);
  const strengths = Float64Array.from(
    envelope,
    (value) => Math.max(0, value - floor),
  );
  const minimumLag = Math.max(2, Math.floor((framesPerSecond * 60) / 210));
  const maximumLag = Math.min(
    strengths.length - 2,
    Math.ceil((framesPerSecond * 60) / 55),
  );
  if (maximumLag <= minimumLag) return null;

  const correlations = new Map<number, number>();
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    correlations.set(lag, normalizedAutocorrelation(strengths, lag));
  }

  const candidates = [...correlations.entries()]
    .filter(([lag, value]) =>
      value > 0 &&
      value >= (correlations.get(lag - 1) ?? -Infinity) &&
      value >= (correlations.get(lag + 1) ?? -Infinity)
    )
    .map(([lag, value]) => {
      const rawBpm = (60 * framesPerSecond) / refinedLag(correlations, lag);
      const variants = [rawBpm / 2, rawBpm, rawBpm * 2]
        .filter((bpm) => bpm >= 70 && bpm <= 180)
        .sort(
          (left, right) =>
            Math.abs(Math.log2(left / coarseBpm)) -
            Math.abs(Math.log2(right / coarseBpm)),
        );
      const resolvedBpm = variants[0];
      if (resolvedBpm === undefined) return null;
      const resolvedLag = (60 * framesPerSecond) / resolvedBpm;
      return {
        rawLag: lag,
        rawValue: value,
        resolvedLag,
        resolvedBpm,
        octaveError: octaveDistance(rawBpm, coarseBpm),
        coarseError: Math.abs(Math.log2(resolvedBpm / coarseBpm)),
      };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => {
      const leftScore =
        left.rawValue * Math.exp(-left.coarseError * 3.5);
      const rightScore =
        right.rawValue * Math.exp(-right.coarseError * 3.5);
      return rightScore - leftScore;
    });
  const best = candidates[0];
  if (best === undefined) return null;

  // Re-score the resolved period itself. A 188.8-BPM subdivision can win the
  // raw autocorrelation, but its explicitly resolved 94.4-BPM lag is the clock
  // Conductor generates.
  const resolvedIntegerLag = Math.max(
    minimumLag,
    Math.min(maximumLag, Math.round(best.resolvedLag)),
  );
  const resolvedCorrelation =
    correlations.get(resolvedIntegerLag) ?? best.rawValue;
  const competing = candidates.find(
    (candidate) =>
      Math.abs(candidate.resolvedLag - best.resolvedLag) >
        best.resolvedLag * 0.08 &&
      Math.abs(candidate.resolvedLag - best.resolvedLag * 0.5) >
        best.resolvedLag * 0.08 &&
      Math.abs(candidate.resolvedLag - best.resolvedLag * 2) >
        best.resolvedLag * 0.08,
  );
  const competingCorrelation = competing?.rawValue ?? 0;
  const ambiguity =
    resolvedCorrelation <= Number.EPSILON
      ? 1
      : Math.max(
          0,
          Math.min(1, competingCorrelation / resolvedCorrelation),
        );
  return {
    lagFrames: best.resolvedLag,
    autocorrelation: resolvedCorrelation,
    ambiguity,
  };
}

function circularDistance(value: number, period: number): number {
  const wrapped = ((value % period) + period) % period;
  return Math.min(wrapped, period - wrapped);
}

function estimateBeatPhase(
  onsets: DetectedOnset[],
  periodSeconds: number,
): number {
  const candidates = [
    0,
    ...onsets.map(
      (onset) =>
        ((onset.timeSeconds % periodSeconds) + periodSeconds) %
        periodSeconds,
    ),
  ];
  const sigma = periodSeconds / 16;
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (const phase of candidates) {
    let score = 0;
    for (const onset of onsets) {
      const distance = circularDistance(
        onset.timeSeconds - phase,
        periodSeconds,
      );
      const normalized = distance / sigma;
      score += onset.strength * Math.exp(-0.5 * normalized * normalized);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

function refineTempoGrid(
  onsets: DetectedOnset[],
  phaseSeconds: number,
  periodSeconds: number,
  durationSeconds: number,
): {
  phaseSeconds: number;
  periodSeconds: number;
} {
  const snapWindow = periodSeconds / 8;
  const matched: Array<{ index: number; timeSeconds: number }> = [];
  const beatCount = Math.ceil(
    Math.max(0, durationSeconds - phaseSeconds) / periodSeconds,
  );
  for (let index = 0; index < beatCount; index += 1) {
    const gridTime = phaseSeconds + index * periodSeconds;
    let strongest: DetectedOnset | undefined;
    for (const onset of onsets) {
      if (
        Math.abs(onset.timeSeconds - gridTime) <=
          snapWindow + Number.EPSILON &&
        (strongest === undefined || onset.strength > strongest.strength)
      ) {
        strongest = onset;
      }
    }
    if (strongest !== undefined) {
      matched.push({ index, timeSeconds: strongest.timeSeconds });
    }
  }
  if (matched.length < 3) {
    return { phaseSeconds, periodSeconds };
  }

  let indexMean = 0;
  let timeMean = 0;
  for (const match of matched) {
    indexMean += match.index;
    timeMean += match.timeSeconds;
  }
  indexMean /= matched.length;
  timeMean /= matched.length;
  let numerator = 0;
  let denominator = 0;
  for (const match of matched) {
    numerator +=
      (match.index - indexMean) * (match.timeSeconds - timeMean);
    denominator += (match.index - indexMean) ** 2;
  }
  if (denominator <= Number.EPSILON) {
    return { phaseSeconds, periodSeconds };
  }
  const refinedPeriod = numerator / denominator;
  if (
    !Number.isFinite(refinedPeriod) ||
    Math.abs(refinedPeriod - periodSeconds) > periodSeconds * 0.03
  ) {
    return { phaseSeconds, periodSeconds };
  }
  const intercept = timeMean - refinedPeriod * indexMean;
  const refinedPhase =
    ((intercept % refinedPeriod) + refinedPeriod) % refinedPeriod;
  return {
    phaseSeconds: refinedPhase,
    periodSeconds: refinedPeriod,
  };
}

function confidenceForGrid(
  autocorrelation: number,
  ambiguity: number,
  matchedBeatCount: number,
  beatCount: number,
): BeatTempoConfidence {
  const gridCoverage =
    beatCount === 0 ? 0 : matchedBeatCount / beatCount;
  const clarity = 1 - ambiguity;
  const score = Math.max(
    0,
    Math.min(
      1,
      autocorrelation * 0.45 + clarity * 0.25 + gridCoverage * 0.3,
    ),
  );
  const level =
    autocorrelation < 0.08 || clarity < 0.08 || gridCoverage < 0.35
      ? "low"
      : autocorrelation < 0.18 || clarity < 0.2 || gridCoverage < 0.65
        ? "medium"
        : "high";
  const percent = Math.round(gridCoverage * 100);
  const summary =
    level === "low"
      ? ambiguity > 0.9
        ? `Low tempo-grid confidence: competing tempo periods are nearly tied, although ${percent}% of grid beats have a confirming onset. Review the map before rendering.`
        : `Low tempo-grid confidence: the tempo pulse is weak or only ${percent}% of grid beats have a confirming onset. Review the map before rendering.`
      : level === "medium"
        ? `Medium tempo-grid confidence: ${percent}% of grid beats have a confirming onset; preview the map before rendering.`
        : `High tempo-grid confidence: ${percent}% of grid beats have a confirming onset.`;
  return {
    level,
    score: rounded(score),
    autocorrelation: rounded(autocorrelation),
    ambiguity: rounded(ambiguity),
    gridCoverage: rounded(gridCoverage),
    summary,
  };
}

function buildTempoGrid(
  envelope: Float64Array,
  onsets: DetectedOnset[],
  durationSeconds: number,
  hopSize: number,
  sampleRate: number,
): TempoGrid | null {
  const coarseBpm = estimateTempo(onsets.map((onset) => onset.timeSeconds));
  if (coarseBpm === null) return null;
  const framesPerSecond = sampleRate / hopSize;
  const estimate = estimateBeatPeriod(envelope, framesPerSecond, coarseBpm);
  if (estimate === null) return null;
  // When two autocorrelation periods are effectively tied, refining the lag
  // against whichever one won by rounding noise creates a false precision.
  // Keep the robust inter-onset median as the octave-resolved anchor, while
  // retaining the low confidence verdict for the plan.
  const periodIsAmbiguous = estimate.ambiguity > 0.85;
  const initialPeriodSeconds = periodIsAmbiguous
    ? 60 / coarseBpm
    : estimate.lagFrames / framesPerSecond;
  const initialPhaseSeconds = estimateBeatPhase(onsets, initialPeriodSeconds);
  const refined = periodIsAmbiguous
    ? {
        phaseSeconds: initialPhaseSeconds,
        periodSeconds: initialPeriodSeconds,
      }
    : refineTempoGrid(
        onsets,
        initialPhaseSeconds,
        initialPeriodSeconds,
        durationSeconds,
      );
  const periodSeconds = refined.periodSeconds;
  const bpm = 60 / periodSeconds;
  const phaseSeconds = refined.phaseSeconds;
  const snapWindowSeconds = periodSeconds / 8;
  const beatTimesSeconds: number[] = [];
  let matchedBeatCount = 0;

  const beatCount = Math.ceil(
    Math.max(0, durationSeconds - phaseSeconds) / periodSeconds,
  );
  for (let index = 0; index < beatCount; index += 1) {
    const gridTime = phaseSeconds + index * periodSeconds;
    if (gridTime >= durationSeconds - Number.EPSILON) break;
    let strongest: DetectedOnset | undefined;
    for (const onset of onsets) {
      if (
        Math.abs(onset.timeSeconds - gridTime) <=
          snapWindowSeconds + Number.EPSILON &&
        (strongest === undefined || onset.strength > strongest.strength)
      ) {
        strongest = onset;
      }
    }
    if (strongest !== undefined) matchedBeatCount += 1;
    beatTimesSeconds.push(rounded(strongest?.timeSeconds ?? gridTime));
  }

  const primaryBeatTimesSeconds = beatTimesSeconds.filter(
    (_time, index) => index % 2 === 0,
  );
  const downbeatTimesSeconds = beatTimesSeconds.filter(
    (_time, index) => index % 4 === 0,
  );
  return {
    bpm: Math.round(bpm * 100) / 100,
    periodSeconds: rounded(periodSeconds),
    phaseSeconds: rounded(phaseSeconds),
    snapWindowSeconds: rounded(snapWindowSeconds),
    beatTimesSeconds,
    primaryBeatTimesSeconds,
    downbeatTimesSeconds,
    confidence: confidenceForGrid(
      estimate.autocorrelation,
      estimate.ambiguity,
      matchedBeatCount,
      beatTimesSeconds.length,
    ),
  };
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
    // This remains a diagnostic label on the raw transient list. Edit
    // structure comes from buildTempoGrid(), not from onset order.
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
  const durationSeconds = pcm.length / sampleRate;
  const tempoGrid = buildTempoGrid(
    envelope,
    onsets,
    durationSeconds,
    hopSize,
    sampleRate,
  );
  const unavailableConfidence: BeatTempoConfidence = {
    level: "low",
    score: 0,
    autocorrelation: 0,
    ambiguity: 1,
    gridCoverage: 0,
    summary:
      "Low tempo-grid confidence: no stable tempo and phase could be estimated. Review the source before rendering.",
  };
  return {
    sampleRate,
    windowSize,
    hopSize,
    durationSeconds,
    estimatedBpm: tempoGrid?.bpm ?? null,
    beatPeriodSeconds: tempoGrid?.periodSeconds ?? null,
    beatPhaseSeconds: tempoGrid?.phaseSeconds ?? null,
    beatSnapWindowSeconds: tempoGrid?.snapWindowSeconds ?? null,
    tempoConfidence: tempoGrid?.confidence ?? unavailableConfidence,
    onsets,
    beatTimesSeconds: tempoGrid?.beatTimesSeconds ?? [],
    primaryBeatTimesSeconds:
      tempoGrid?.primaryBeatTimesSeconds ?? [],
    downbeatTimesSeconds:
      tempoGrid?.downbeatTimesSeconds ?? [],
  };
}

export async function analyzeAudioFile(
  audioPath: string,
  options: { ffmpegPath?: string } = {},
): Promise<BeatAnalysis> {
  return analyzePcm(await decodeAudioToPcm(audioPath, options.ffmpegPath));
}
