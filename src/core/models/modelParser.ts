/**
 * Generic model parser factory.
 *
 * Eliminates the parse/serialize boilerplate repeated across every model file.
 * Returns typed parse and serialize functions backed by a Zod schema.
 */
import type { ZodType } from 'zod';

export interface ModelParseSuccess<T> {
  success: true;
  data: T;
}

export interface ModelParseFailure {
  success: false;
  errors: Array<{ path: string; message: string }>;
}

export type ModelParseResult<T> = ModelParseSuccess<T> | ModelParseFailure;

/**
 * Create typed parse and serialize functions for a model.
 *
 * @param schema - Zod schema for the model
 * @returns Object with `parse` and `serialize` functions
 *
 * @example
 * const { parse: parseFeature, serialize: serializeFeature } =
 *   createModelParser<Feature>(FeatureSchema);
 */
export function createModelParser<T>(schema: ZodType<T>): {
  parse: (json: unknown) => ModelParseResult<T>;
  serialize: (obj: T, pretty?: boolean) => string;
} {
  return {
    parse: (json: unknown): ModelParseResult<T> => {
      const result = schema.safeParse(json);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return {
        success: false,
        errors: result.error.issues.map((err) => ({
          path: err.path.join('.') || 'root',
          message: err.message,
        })),
      };
    },
    serialize: (obj: T, pretty = true): string => {
      return JSON.stringify(obj, null, pretty ? 2 : 0);
    },
  };
}
