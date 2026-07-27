# Beat Sync Studio — implementation contract

Beat sync does not mean attaching music to an unchanged video. Conductor will
analyze the music once, save an exact frame map, and place chosen visual events
on that map.

## What can be synchronized

- With multiple videos or images: shot changes and image cuts.
- With one continuous video: transition peaks, light accents, zoom/scale
  impacts, and carefully bounded speed changes.
- With either: flash or glow apexes, camera impacts, and optional subtle
  logo/text pulses.

The strongest musical moments carry cuts or transition apexes. Ordinary beats
carry smaller effects. This hierarchy prevents every beat from becoming an
equally loud gimmick.

## Required analysis order

1. Decode the audio to mono PCM and run Conductor's onset and tempo analysis.
   This analysis is the source of truth for the edit.
2. Classify accepted onsets as ordinary beats, primary beats, and downbeats.
3. Quantize the accepted times to the source frame rate with
   [`src/beat/plan.ts`](../src/beat/plan.ts).
4. Save the complete quantized map as After Effects markers before building the
   edit, so a person can inspect and adjust it.
5. When an After Effects marker-detection command is available and returns
   usable markers, it may be run as an optional corroborating pass. An empty or
   unavailable result does not replace or invalidate Conductor's analysis.
6. After rendering, save two separate reports in the run journal:
   - **Authored frame placement** checks the layer boundary AE reported against
     the intended onset. It catches frame-rate or render-pipeline drift.
   - **Rendered A/V conformance** re-analyzes the rendered file's audio track,
     detects visible scene changes from decoded rendered frames, and checks
     that the delivered audio and video still carry the authored alignment.
7. Treat those reports as two views of the same authored cut intent. In a
   healthy pipeline they agree by construction; the rendered A/V check is a
   failure detector, not independent corroboration that Conductor understood
   the music. They diverge when a cut is missing or extra, the render drifts,
   or the delivered audio and video no longer match.
8. Fail when authored frame placement drifts by more than one delivered frame,
   when the visual detector does not recover the authored cut count, or when
   any detected visual cut is more than one frame from a rendered audio onset.

Conductor must never claim an edit is beat-synced without a **VERIFIED**
post-render alignment measurement. Detector names, marker creation, and a
plausible-looking timeline are not evidence by themselves; the measured
rendered-video-to-rendered-audio deltas are. Authored frame placement and
rendered A/V conformance must always be labeled and reported separately.

Sub-hop onset localization is not improved cut accuracy. A 30 fps cut can only
land on the 33.33 ms frame grid, so nearest-frame quantization alone permits up
to 16.67 ms of cut timing error. The finer sample-derived onset time matters
for continuous parameter curves, including beat-driven effect envelopes,
whose keyframe times are not restricted to edit boundaries.

## Precision is not recall

Every timing figure this project reported for most of its life measured
**precision**: how close a detected onset sits to a known attack. Precision is
blind to the failure that matters most, because an onset the detector never
finds contributes no error at all. A detector that drops an entire instrument
still reports excellent precision on whatever it did find.

That is not hypothetical. The percussive emphasis was once applied twice — in
the weighted signal and again over spectral flux — which multiplied down to
roughly 0.12x gain at 60 Hz against 2.1x for a hi-hat. Kick drums fell below
the amplitude gate, and a kick pattern over a bass drone returned **zero**
onsets, while the same detector reported sub-millisecond precision on tracks
whose snares it happened to find.

So:

- Any claim about detector accuracy must state recall alongside precision.
- Click trains are step functions and every transient search finds their exact
  sample. They are regression fixtures, not evidence of precision.
- Precision cannot be quoted finer than the resolution of the ground truth it
  was measured against. Marks read from a spectrogram at ~1 ms granularity
  cannot support a sub-millisecond claim, however the arithmetic comes out.
- Ground truth must be reproducible in the repository. A number produced from
  a file in a temporary directory, by a procedure nobody can re-run, is an
  assertion rather than a measurement.

`test/beat-instrument-recall.test.ts` covers recall against drums with finite
attacks over sustained material, where the truth is exact because the hits were
placed rather than detected. The percussive FIR keeps its 0.35 DC branch but
reduces the second-difference coefficient from 0.4125 to 0.1, changing the
steady low-to-high tilt from about 5.7:1 to 2.1:1. The recall floor is 6/6 kicks
at 120 BPM, 6/6 at 96 BPM, and 6/6 when the kick and sustained bass share a
60 Hz fundamental. The matching sustained-tone fixtures still produce no
interior onsets. These are floors to raise, never targets to lower.

`test/fixtures/binary-love-attacks.json` commits only manual annotations for
the external copyrighted `../beat-fixtures/binary-love-12s.wav`; the audio is
not part of the repository. The marks cover the detector-blind 4.5–12 second
window and declare an honest ±50 ms resolution, based on the 46 ms analysis
window used to read the spectrogram. `test/beat-real-music.test.ts` runs the
detector against those marks when the sibling audio fixture exists and skips
cleanly elsewhere. A 10 ms numeric step in the JSON is not a 10 ms precision
claim.

## Planned Conductor controls

- Music file
- One continuous video, or a bin of clips/images
- Editing density: restrained, active, or impact
- Allowed event families: cuts, transitions, light, camera, native pixel sort,
  brand pulse
- Beat hierarchy threshold
- Short beat-synced preview before the full render

Brand pulses remain off by default. The fixed logo and moving
`yourbrand_` protection layer should stay subtle unless the user explicitly
chooses a musical branding treatment.

Native pixel sort is also opt-in. When enabled, Conductor applies the exact
`director-pixel-sort` effect contract and writes the analyzed 0–1 strength
envelope to its `Beat Amount` percentage parameter. Downbeats and primary beats
receive larger ranges than ordinary beats using the same importance hierarchy
that plans cuts and accents.
