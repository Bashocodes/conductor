import { BEAT_SAMPLE_RATE } from "../../src/beat/analyze.js";

/**
 * A synthetic track that behaves like music rather than like a click train.
 *
 * Click trains are step functions, so any transient search finds their exact
 * sample and reports near-zero error. That flatters a detector without telling
 * you anything: real percussion has a finite attack, sits on top of sustained
 * material, and shares the spectrum with instruments that never "onset" at all.
 *
 * This generator builds the cases that actually break naive detection:
 *
 * - a **kick** whose energy is low-frequency, so its waveform slope is gentle
 *   even though it is perceptually the strongest event in the bar;
 * - a **sustained bass drone and pad**, which carry large sample-to-sample
 *   deltas continuously and will capture a broadband transient search;
 * - a **noise floor**, so no neighbourhood is ever exactly silent.
 *
 * Ground truth is exact because the hits are placed, not detected.
 */

export interface InstrumentHit {
  timeSeconds: number;
  kind: "kick" | "snare" | "hat";
}

export interface InstrumentTrackOptions {
  droneGain?: number;
  noiseGain?: number;
  seed?: number;
  bassFrequencyHz?: number;
  kickFundamentalHz?: number;
}

/** Deterministic noise: tests must not depend on Math.random. */
function makeNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0x100000000) * 2 - 1;
  };
}

function addHit(
  samples: Float32Array,
  hit: InstrumentHit,
  noise: () => number,
  kickFundamentalHz: number,
): void {
  const start = Math.round(hit.timeSeconds * BEAT_SAMPLE_RATE);
  // Attack and decay in seconds, plus the body of each drum voice.
  const shape = {
    kick: { attack: 0.004, decay: 0.16, gain: 0.85 },
    snare: { attack: 0.002, decay: 0.09, gain: 0.55 },
    hat: { attack: 0.001, decay: 0.03, gain: 0.3 },
  }[hit.kind];
  const length = Math.round((shape.attack + shape.decay) * BEAT_SAMPLE_RATE);
  const attackSamples = Math.max(1, Math.round(shape.attack * BEAT_SAMPLE_RATE));

  for (let offset = 0; offset < length; offset += 1) {
    const index = start + offset;
    if (index < 0 || index >= samples.length) continue;
    const t = offset / BEAT_SAMPLE_RATE;
    const envelope = offset < attackSamples
      ? offset / attackSamples
      : Math.exp(-(t - shape.attack) / (shape.decay / 3));

    let voice: number;
    if (hit.kind === "kick") {
      // A pitched-down sine: strong, but with a slow waveform slope.
      const sweep = 110 * Math.exp(-t * 18) + kickFundamentalHz;
      voice = Math.sin(2 * Math.PI * sweep * t);
    } else if (hit.kind === "snare") {
      voice = 0.7 * noise() + 0.3 * Math.sin(2 * Math.PI * 190 * t);
    } else {
      voice = noise();
    }
    samples[index] = (samples[index] as number) + voice * envelope * shape.gain;
  }
}

export function instrumentTrack(
  durationSeconds: number,
  hits: InstrumentHit[],
  options: InstrumentTrackOptions = {},
): { pcm: Float32Array; groundTruthSeconds: number[] } {
  const droneGain = options.droneGain ?? 0.22;
  const noiseGain = options.noiseGain ?? 0.012;
  const bassFrequencyHz = options.bassFrequencyHz ?? 82;
  const kickFundamentalHz = options.kickFundamentalHz ?? 45;
  const noise = makeNoise(options.seed ?? 20260727);
  const samples = new Float32Array(
    Math.ceil(durationSeconds * BEAT_SAMPLE_RATE),
  );

  // Real audio does not begin or end instantaneously. Without these ramps the
  // buffer edges are step discontinuities, and a detector is right to call
  // them transients — which would make this fixture test the edges rather than
  // the music.
  const rampSamples = Math.round(0.05 * BEAT_SAMPLE_RATE);
  for (let index = 0; index < samples.length; index += 1) {
    const t = index / BEAT_SAMPLE_RATE;
    // Sustained bass plus a slowly swelling pad. Neither is an onset, and both
    // exist to be ignored.
    const bass = Math.sin(2 * Math.PI * bassFrequencyHz * t);
    const pad = 0.5 * Math.sin(2 * Math.PI * 330 * t)
      * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.35 * t));
    // Raised cosine, not linear: a linear ramp has a corner where it flattens,
    // and that corner is itself a detectable event.
    const linear = Math.min(
      1,
      index / rampSamples,
      (samples.length - 1 - index) / rampSamples,
    );
    const ramp = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, linear));
    samples[index] = ((bass + pad) * droneGain + noise() * noiseGain) * ramp;
  }

  for (const hit of hits) {
    addHit(samples, hit, noise, kickFundamentalHz);
  }

  return {
    pcm: samples,
    groundTruthSeconds: hits
      .map((hit) => hit.timeSeconds)
      .sort((left, right) => left - right),
  };
}
