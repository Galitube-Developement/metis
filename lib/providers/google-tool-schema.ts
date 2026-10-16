import { wrapLanguageModel } from "ai";

type Schema = Record<string, unknown>;

/**
 * Google's OpenAPI Schema.enum is string[], even for integer/boolean fields.
 * Keep the original types and move unsupported enum/const constraints into a
 * description on the outbound copy. Canonical tool validation stays untouched.
 */
export function googleToolSchema(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const schema = input as Schema;
  const result: Schema = { ...schema };
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  const unsupportedEnum = enumValues?.some(value => typeof value !== "string");
  const unsupportedConst = "const" in schema && typeof schema.const !== "string";
  if (unsupportedEnum || unsupportedConst) {
    const values = unsupportedEnum ? enumValues : [schema.const];
    const constraint = `Allowed values (JSON): ${JSON.stringify(values)}.`;
    result.description = [typeof schema.description === "string" ? schema.description : "", constraint].filter(Boolean).join(" ");
    if (unsupportedEnum) delete result.enum;
    if (unsupportedConst) delete result.const;
  }
  for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]) {
    const map = schema[key];
    if (map && typeof map === "object" && !Array.isArray(map)) {
      result[key] = Object.fromEntries(Object.entries(map).map(([name, value]) => [name, googleToolSchema(value)]));
    }
  }
  for (const key of ["items", "additionalProperties", "additionalItems", "contains", "not", "if", "then", "else", "propertyNames"]) {
    if (key in schema) result[key] = Array.isArray(schema[key])
      ? (schema[key] as unknown[]).map(googleToolSchema)
      : googleToolSchema(schema[key]);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (Array.isArray(schema[key])) result[key] = (schema[key] as unknown[]).map(googleToolSchema);
  }
  return result;
}

export function withGoogleToolSchemas(model: Parameters<typeof wrapLanguageModel>[0]["model"]) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        tools: params.tools?.map(tool => tool.type === "function"
          ? { ...tool, inputSchema: googleToolSchema(tool.inputSchema) as typeof tool.inputSchema }
          : tool),
      }),
    },
  });
}
