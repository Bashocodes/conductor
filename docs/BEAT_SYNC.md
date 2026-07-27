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
6. After rendering, measure every actual cut against its intended onset, save
   the alignment report in the run journal, and fail the run when any cut is
   more than one frame away.

Conductor must never claim an edit is beat-synced without a **VERIFIED**
post-render alignment measurement. Detector names, marker creation, and a
plausible-looking timeline are not evidence by themselves; the measured
cut-to-onset deltas are.

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
