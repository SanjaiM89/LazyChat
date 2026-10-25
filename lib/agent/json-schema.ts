/**
 * A JSON schema subset for validating stored values.
 *
 * It covers the shapes the application needs: types, required properties,
 * enums, constants, arrays, additional properties and oneOf branches.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a value against the schema subset the workflow contract allows:
 * type, properties, required, additionalProperties, items, enum, const, oneOf.
 */
export function validateSchema(value: unknown, schema: Record<string, unknown>): string | null {
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.filter((branch) =>
      isPlainObject(branch) ? validateSchema(value, branch) === null : false,
    );
    if (branches.length === 0) return "the value matches none of the allowed shapes";
  }
  if (schema.const !== undefined && value !== schema.const) {
    return `the value must be ${JSON.stringify(schema.const)}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    return `the value must be one of ${JSON.stringify(schema.enum)}`;
  }
  if (typeof schema.type === "string") {
    const ok = matchesType(value, schema.type);
    if (!ok) return `the value must be a ${schema.type}`;
  }
  if (isPlainObject(schema.properties) && isPlainObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) return `"${key}" is missing`;
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (!(key in value)) continue;
      if (!isPlainObject(sub)) continue;
      const error = validateSchema(value[key], sub);
      if (error) return `"${key}": ${error}`;
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties as Record<string, unknown>))) {
          return `"${key}" is not allowed`;
        }
      }
    }
  }
  if (isPlainObject(schema.items) && Array.isArray(value)) {
    for (const item of value) {
      const error = validateSchema(item, schema.items);
      if (error) return error;
    }
  }
  return null;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
