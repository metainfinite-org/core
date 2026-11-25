import { describe, expect, it } from "vitest";
import { checkSchema, extendSchema, validate, type Schema } from "@ev/rules";

describe("schema subset", () => {
  it("rejects unsupported keywords and malformed values", () => {
    expect(checkSchema({ type: "object", $ref: "x" })).toEqual(['$: unsupported keyword "$ref"']);
    expect(checkSchema({ type: "number" })).toEqual(["$.type: invalid"]); // floats aren't a type here
    expect(checkSchema({ pattern: "(" })).toEqual(["$.pattern: invalid regular expression"]);
    expect(checkSchema({ properties: { a: { minLength: 1.5 } } })).toEqual(["$.properties.a.minLength: must be an integer"]);
  });

  const post: Schema = {
    type: "object",
    required: ["title"],
    additionalProperties: false,
    properties: { title: { type: "string", minLength: 1, maxLength: 3 }, ref: { type: "string", format: "address" } },
  };

  it("validates objects, strings, formats", () => {
    expect(validate(post, { title: "abc" })).toEqual([]);
    expect(validate(post, { title: "abcd" })).toEqual(["$.title: longer than 3"]);
    expect(validate(post, {})).toEqual(['$: missing "title"']);
    expect(validate(post, { title: "a", x: 1 })).toEqual(['$: unexpected property "x"']);
    expect(validate(post, { title: "a", ref: "1/2/3" })).toEqual(["$.ref: not an address"]);
    expect(validate(post, "nope")).toEqual(["$: expected object, got string"]);
  });

  it("counts string length in code points", () => {
    expect(validate({ type: "string", maxLength: 1 }, "😀")).toEqual([]);
  });

  it("validates arrays, enums, integers", () => {
    const s: Schema = { type: "array", maxItems: 2, items: { type: "integer", enum: [1, -1] } };
    expect(validate(s, [1, -1])).toEqual([]);
    expect(validate(s, [1, 2])).toEqual(["$[1]: not one of the allowed values"]);
    expect(validate(s, [1, 1, 1])).toEqual(["$: more than 2 items"]);
  });

  it("extends a base schema without redefining or unsealing it", () => {
    const base: Schema = { type: "object", required: ["a"], properties: { a: { type: "string" } } };
    const { schema } = extendSchema(base, { type: "object", required: ["b"], properties: { b: { type: "integer" } } });
    expect(schema).toEqual({ type: "object", required: ["a", "b"], properties: { a: { type: "string" }, b: { type: "integer" } } });
    expect(extendSchema(base, { properties: { a: { type: "integer" } } }).error).toMatch(/already defined/);
    expect(extendSchema(post, { properties: { body: { type: "string" } } }).error).toMatch(/sealed/);
    expect(extendSchema(base, { type: "string" }).error).toMatch(/JSON type/);
  });
});
