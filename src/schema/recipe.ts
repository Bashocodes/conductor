import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const identifierSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/,
    "must start with a lowercase letter and contain only lowercase letters, numbers, '-' or '_'",
  );

const paramNameSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    "must start with a letter and contain only letters, numbers, '-' or '_'",
  );

const describedParamSchema = z.object({
  description: z.string().min(1),
});

const stringParamSchema = describedParamSchema
  .extend({
    type: z.literal("string"),
    default: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (
      definition.minLength !== undefined &&
      definition.maxLength !== undefined &&
      definition.minLength > definition.maxLength
    ) {
      context.addIssue({
        code: "custom",
        message: "minLength cannot be greater than maxLength",
      });
    }

    if (definition.pattern !== undefined) {
      try {
        const pattern = new RegExp(definition.pattern);
        if (
          definition.default !== undefined &&
          !pattern.test(definition.default)
        ) {
          context.addIssue({
            code: "custom",
            path: ["default"],
            message: "default does not match pattern",
          });
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["pattern"],
          message: "must be a valid regular expression",
        });
      }
    }

    if (
      definition.default !== undefined &&
      definition.minLength !== undefined &&
      definition.default.length < definition.minLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: "default is shorter than minLength",
      });
    }

    if (
      definition.default !== undefined &&
      definition.maxLength !== undefined &&
      definition.default.length > definition.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: "default is longer than maxLength",
      });
    }
  });

const numberParamSchema = describedParamSchema
  .extend({
    type: z.literal("number"),
    default: z.number().finite().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (
      definition.min !== undefined &&
      definition.max !== undefined &&
      definition.min > definition.max
    ) {
      context.addIssue({
        code: "custom",
        message: "min cannot be greater than max",
      });
    }

    if (
      definition.default !== undefined &&
      definition.integer === true &&
      !Number.isInteger(definition.default)
    ) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: "default must be an integer",
      });
    }

    if (
      definition.default !== undefined &&
      definition.min !== undefined &&
      definition.default < definition.min
    ) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: "default cannot be less than min",
      });
    }

    if (
      definition.default !== undefined &&
      definition.max !== undefined &&
      definition.default > definition.max
    ) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: "default cannot be greater than max",
      });
    }
  });

const booleanParamSchema = describedParamSchema
  .extend({
    type: z.literal("boolean"),
    default: z.boolean().optional(),
  })
  .strict();

const enumParamSchema = describedParamSchema
  .extend({
    type: z.literal("enum"),
    values: z.array(z.string()).min(1),
    default: z.string().optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (new Set(definition.values).size !== definition.values.length) {
      context.addIssue({
        code: "custom",
        path: ["values"],
        message: "enum values must be unique",
      });
    }

    if (
      definition.default !== undefined &&
      !definition.values.includes(definition.default)
    ) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: "default must be one of the enum values",
      });
    }
  });

const jsonParamSchema = describedParamSchema
  .extend({
    type: z.literal("json"),
    default: jsonValueSchema.optional(),
  })
  .strict();

export const paramDefinitionSchema = z.discriminatedUnion("type", [
  stringParamSchema,
  numberParamSchema,
  booleanParamSchema,
  enumParamSchema,
  jsonParamSchema,
]);

export type ParamDefinition = z.infer<typeof paramDefinitionSchema>;

const expectedTypeSchema = z.enum([
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "null",
]);

export interface ExpectedShape {
  type: z.infer<typeof expectedTypeSchema>;
  required?: string[];
  properties?: Record<string, ExpectedShape>;
  items?: ExpectedShape;
}

export const expectedShapeSchema: z.ZodType<ExpectedShape> = z.lazy(() =>
  z
    .object({
      type: expectedTypeSchema,
      required: z.array(z.string().min(1)).optional(),
      properties: z.record(z.string(), expectedShapeSchema).optional(),
      items: expectedShapeSchema.optional(),
    })
    .strict()
    .superRefine((shape, context) => {
      if (
        shape.type !== "object" &&
        (shape.required !== undefined || shape.properties !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          message: "required and properties are only valid for object shapes",
        });
      }

      if (shape.type !== "array" && shape.items !== undefined) {
        context.addIssue({
          code: "custom",
          message: "items is only valid for array shapes",
        });
      }
    }),
);

export const recipeStepSchema = z
  .object({
    id: identifierSchema,
    server: identifierSchema,
    tool: z.string().min(1),
    args: z.record(z.string(), jsonValueSchema).default({}),
    timeoutMs: z.number().int().positive().max(3_600_000).default(30_000),
    precondition: z.string().min(1).optional(),
    verify: expectedShapeSchema.optional(),
  })
  .strict();

export const recipeSchema = z
  .object({
    id: identifierSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    targetServers: z.array(identifierSchema).min(1),
    params: z.record(paramNameSchema, paramDefinitionSchema).default({}),
    steps: z.array(recipeStepSchema).min(1),
  })
  .strict()
  .superRefine((recipe, context) => {
    if (new Set(recipe.targetServers).size !== recipe.targetServers.length) {
      context.addIssue({
        code: "custom",
        path: ["targetServers"],
        message: "target servers must be unique",
      });
    }

    const stepIds = new Set<string>();
    recipe.steps.forEach((step, index) => {
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: `duplicate step id '${step.id}'`,
        });
      }
      stepIds.add(step.id);

      if (!recipe.targetServers.includes(step.server)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "server"],
          message: `server '${step.server}' is not declared in targetServers`,
        });
      }
    });
  });

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;

export function buildParamsSchema(
  definitions: Record<string, ParamDefinition>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, definition] of Object.entries(definitions)) {
    let schema: z.ZodTypeAny;

    switch (definition.type) {
      case "string": {
        let stringSchema = z.string();
        if (definition.minLength !== undefined) {
          stringSchema = stringSchema.min(definition.minLength);
        }
        if (definition.maxLength !== undefined) {
          stringSchema = stringSchema.max(definition.maxLength);
        }
        if (definition.pattern !== undefined) {
          stringSchema = stringSchema.regex(new RegExp(definition.pattern));
        }
        schema = stringSchema;
        break;
      }
      case "number": {
        let numberSchema = z.number().finite();
        if (definition.integer === true) {
          numberSchema = numberSchema.int();
        }
        if (definition.min !== undefined) {
          numberSchema = numberSchema.min(definition.min);
        }
        if (definition.max !== undefined) {
          numberSchema = numberSchema.max(definition.max);
        }
        schema = numberSchema;
        break;
      }
      case "boolean":
        schema = z.boolean();
        break;
      case "enum":
        schema = z.enum(definition.values as [string, ...string[]]);
        break;
      case "json":
        schema = jsonValueSchema;
        break;
    }

    schema = schema.describe(definition.description);
    if (definition.default !== undefined) {
      schema = schema.default(definition.default);
    }
    shape[name] = schema;
  }

  return z.object(shape).strict();
}
