import { describe, expect, it } from "vitest";

import {
  AdapterError,
  DeclarativeToolAdapter,
  fakeServerAdapterConfig,
  genericAeAdapterConfig,
} from "../src/adapters/index.js";
import type { JsonValue } from "../src/schema/recipe.js";

describe("declarative ToolContract adapters", () => {
  it("maps a logical createComp call to a generic AE tool and argument shape", () => {
    const adapter = new DeclarativeToolAdapter(
      "aftereffects",
      genericAeAdapterConfig,
    );

    expect(
      adapter.mapCall("createComp", {
        name: "Reference Comp",
        width: 1920,
        height: 1080,
        pixelAspect: 1,
        frameRate: 24,
        durationSeconds: 6,
        backgroundColor: "#000000",
      }),
    ).toEqual({
      operation: "createComp",
      tool: "ae_create_composition",
      args: {
        name: "Reference Comp",
        settings: {
          width: 1920,
          height: 1080,
          pixel_aspect: 1,
          frame_rate: 24,
          duration_seconds: 6,
          background_color: "#000000",
        },
      },
    });
  });

  it("omits unavailable optional values from a mapped argument object", () => {
    const adapter = new DeclarativeToolAdapter(
      "aftereffects",
      genericAeAdapterConfig,
    );

    expect(
      adapter.mapCall("projectInfo", {
        action: "inspect",
        settings: {},
      }).args,
    ).toEqual({
      action: "inspect",
      settings: {},
    });
  });

  it("ships a passthrough fake-server adapter", () => {
    const adapter = new DeclarativeToolAdapter(
      "aftereffects",
      fakeServerAdapterConfig,
    );
    const args: Record<string, JsonValue> = {
      layerId: "layer-1",
      property: "positionX",
      timeMode: "seconds",
      keyframes: [
        { time: 0, value: 0 },
        { time: 1, value: 100 },
      ],
      easing: {
        type: "cubic-bezier",
        profile: "whip-acceleration",
        controlPoints: [0.55, 0, 0.85, 0.35],
      },
      motionBlur: true,
    };

    expect(adapter.mapCall("setKeyframes", args)).toEqual({
      operation: "setKeyframes",
      tool: "fake_set_keyframes",
      args,
    });
  });

  it("rejects keyframe calls without the contract's non-linear easing", () => {
    const adapter = new DeclarativeToolAdapter(
      "aftereffects",
      genericAeAdapterConfig,
    );

    expect(() =>
      adapter.mapCall("setKeyframes", {
        layerId: "layer-1",
        property: "positionX",
        timeMode: "seconds",
        keyframes: [
          { time: 0, value: 0 },
          { time: 1, value: 100 },
        ],
        motionBlur: true,
      }),
    ).toThrowError(AdapterError);
  });
});
