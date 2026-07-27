import { adapterConfigSchema } from "../config.js";

export const fakeServerAdapterConfig = adapterConfigSchema.parse({
  id: "fake-ae",
  label: "In-process fake AE server",
  operations: {
    createComp: {
      tool: "fake_create_comp",
      argsTemplate: "${args}",
    },
    addMarkers: {
      tool: "fake_add_markers",
      argsTemplate: "${args}",
    },
    addTextLayer: {
      tool: "fake_add_text_layer",
      argsTemplate: "${args}",
    },
    addMediaLayer: {
      tool: "fake_add_media_layer",
      argsTemplate: "${args}",
    },
    setKeyframes: {
      tool: "fake_set_keyframes",
      argsTemplate: "${args}",
    },
    applyEffect: {
      tool: "fake_apply_effect",
      argsTemplate: "${args}",
    },
    precompose: {
      tool: "fake_precompose",
      argsTemplate: "${args}",
    },
    queueRender: {
      tool: "fake_queue_render",
      argsTemplate: "${args}",
    },
    saveFrame: {
      tool: "fake_save_frame",
      argsTemplate: "${args}",
    },
    projectInfo: {
      tool: "fake_project_info",
      argsTemplate: "${args}",
    },
  },
});
