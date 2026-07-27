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
   - **Frame placement** checks the layer boundary AE reported against the
     intended onset. It catches frame-rate or render-pipeline drift, but it is
     not independent musical evidence.
   - **End-to-end alignment** re-analyzes the rendered file's audio track,
     detects visible scene changes from decoded rendered frames, and compares
     those independently derived sets.
7. Fail when frame placement drifts by more than one delivered frame, when the
   visual detector does not recover the authored cut count, or when any
   independently detected visual cut is more than one frame from a rendered
   audio onset.

Conductor must never claim an edit is beat-synced without a **VERIFIED**
post-render alignment measurement. Detector names, marker creation, and a
plausible-looking timeline are not evidence by themselves; the measured
rendered-video-to-rendered-audio deltas are. Frame placement and end-to-end
alignment must always be labeled and reported separately.

## Planned Conductor controls

- Music file
- One continuous video, or a bin of clips/images
- Editing density: restrained, active, or impact
- Allowed event families: cuts, transitions, light, camera, brand pulse
- Beat hierarchy threshold
- Short beat-synced preview before the full render

Brand pulses remain off by default. The fixed logo and moving
`yourbrand_` protection layer should stay subtle unless the user explicitly
chooses a musical branding treatment.
