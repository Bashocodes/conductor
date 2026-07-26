import { adapterConfigSchema } from "../config.js";

/**
 * A deliberately generic mapping for AE MCP servers.
 *
 * Open-source servers do not share stable tool names or argument shapes yet.
 * Copy this config and adjust the tool names/templates to match the server
 * reported by `conductor doctor`.
 */
export const genericAeAdapterConfig = adapterConfigSchema.parse({
  id: "generic-ae",
  label: "Generic After Effects MCP (adjust tool names to your server)",
  operations: {
    createComp: {
      tool: "ae_create_composition",
      argsTemplate: {
        name: "${args.name}",
        settings: {
          width: "${args.width}",
          height: "${args.height}",
          pixel_aspect: "${args.pixelAspect}",
          frame_rate: "${args.frameRate}",
          duration_seconds: "${args.durationSeconds}",
          background_color: "${args.backgroundColor}",
        },
      },
    },
    addTextLayer: {
      tool: "ae_add_text_layer",
      argsTemplate: {
        composition_id: "${args.compId}",
        layer: {
          name: "${args.name}",
          text: "${args.text}",
          font: "${args.font}",
          size_preset: "${args.sizePreset}",
          alignment: "${args.alignment}",
          position: "${args.position}",
          color: "${args.color}",
          opacity: "${args.opacity}",
          motion_blur: "${args.motionBlur}",
        },
      },
    },
    addMediaLayer: {
      tool: "ae_add_media_layer",
      argsTemplate: {
        composition_id: "${args.compId}",
        layer: {
          path: "${args.path}",
          name: "${args.name}",
          width_percent: "${args.widthPercent}",
          position_preset: "${args.positionPreset}",
          custom_x_percent: "${args.customXPercent}",
          custom_y_percent: "${args.customYPercent}",
          opacity: "${args.opacity}",
          motion_blur: "${args.motionBlur}",
        },
      },
    },
    setKeyframes: {
      tool: "ae_set_keyframes",
      argsTemplate: {
        layer_id: "${args.layerId}",
        property: "${args.property}",
        time_mode: "${args.timeMode}",
        coordinate_space: "${args.coordinateSpace}",
        keyframes: "${args.keyframes}",
        temporal_easing: "${args.easing}",
        motion_blur: "${args.motionBlur}",
      },
    },
    applyEffect: {
      tool: "ae_apply_effect",
      argsTemplate: {
        target_id: "${args.targetId}",
        effect_name: "${args.effect}",
        parameters: "${args.settings}",
        timing: {
          at_seconds: "${args.atTimeSeconds}",
          duration_seconds: "${args.durationSeconds}",
        },
      },
    },
    precompose: {
      tool: "ae_precompose",
      argsTemplate: {
        composition_id: "${args.compId}",
        name: "${args.name}",
        sources: "${args.sources}",
        layer_ids: "${args.layerIds}",
        collapse_transformations: "${args.collapseTransformations}",
        motion_blur: "${args.motionBlur}",
      },
    },
    queueRender: {
      tool: "ae_queue_render",
      argsTemplate: {
        composition_id: "${args.compId}",
        output_path: "${args.outputPath}",
        output_module: {
          format: "${args.format}",
          codec: "${args.codec}",
          bit_depth: "${args.bitDepth}",
          color_space: "${args.colorSpace}",
        },
        render_settings: "${args.renderSettings}",
      },
    },
    projectInfo: {
      tool: "ae_project_info",
      argsTemplate: {
        action: "${args.action}",
        media_path: "${args.mediaPath}",
        settings: "${args.settings}",
      },
    },
  },
});
