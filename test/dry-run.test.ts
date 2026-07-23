import { describe, expect, it } from "vitest";

import { createDryRunPlan } from "../src/engine/dry-run.js";
import {
  hdrSafeGradeRecipe,
  motivatedTransitionRecipe,
  titleCardRecipe,
} from "../src/recipes/index.js";

describe("reference recipe dry runs", () => {
  it("snapshots the title-card checklist", () => {
    expect(
      createDryRunPlan(titleCardRecipe, {
        text: "Reference Title",
        outputPath: "/renders/title-card.mov",
      }),
    ).toMatchSnapshot();
  });

  it("snapshots the motivated-transition checklist", () => {
    const params = {
      clipA: "/media/clip-a.mov",
      clipB: "/media/clip-b.mov",
      style: "luma-wipe",
      outputPath: "/renders/motivated-transition.mov",
    };
    const plan = createDryRunPlan(motivatedTransitionRecipe, params);

    expect(plan).toEqual(createDryRunPlan(motivatedTransitionRecipe, params));
    expect(plan.steps.map((step) => step.id)).toContain(
      "luma-wipe-directional-progress",
    );
    expect(plan.steps.map((step) => step.id)).not.toContain(
      "burst-peak-frame",
    );
    expect(plan.steps.map((step) => step.id)).not.toContain(
      "outgoing-whip-position-keyframes",
    );
    expect(plan).toMatchSnapshot();
  });

  it("snapshots the hdr-safe-grade checklist", () => {
    expect(
      createDryRunPlan(hdrSafeGradeRecipe, {
        clip: "/media/source.mov",
        outputPath: "/renders/hlg-master.mov",
      }),
    ).toMatchSnapshot();
  });
});
