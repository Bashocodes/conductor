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

1. Run Adobe Beat Detection in After Effects to create the first marker pass.
2. Analyze the same audio with HPSS and a dynamic beat tracker.
3. Cross-check pulse stability with PLP.
4. Reconcile the passes and classify ordinary beats, primary beats, and
   downbeats.
5. Quantize every accepted time to the source frame rate.
6. Save the report beside the project before building the edit.

Conductor must not claim an edit is beat-synced when the Adobe marker pass was
skipped. The pure planning core in
[`src/beat/plan.ts`](../src/beat/plan.ts) already locks detector output to exact
frames and maps the hierarchy to edit events. Audio analysis, media-bin UI,
short comparison renders, and the AE edit recipe are the next implementation
stage.

## Planned Conductor controls

- Music file
- One continuous video, or a bin of clips/images
- Editing density: restrained, active, or impact
- Allowed event families: cuts, transitions, light, camera, brand pulse
- Beat hierarchy threshold
- Short beat-synced preview before the full render

Brand pulses remain off by default. The fixed Sample logo and moving
`sample_` protection layer should stay subtle unless the user explicitly
chooses a musical branding treatment.
