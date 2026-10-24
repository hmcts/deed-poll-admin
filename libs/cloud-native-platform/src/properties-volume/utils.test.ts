import { describe, expect, it } from "vitest";
import { deepMerge, deepSearch, normalizeSecretName } from "./utils.js";

describe("deepMerge", () => {
  it("should merge objects recursively", () => {
    const target = { a: 1, b: { c: 2 } };
    const source = { b: { d: 3 }, e: 4 };

    const result = deepMerge(target, source);

    expect(result).toEqual({
      a: 1,
      b: { c: 2, d: 3 },
      e: 4
    });
  });

  it("should overwrite primitive values", () => {
    const target = { a: 1, b: "old" };
    const source = { b: "new", c: 3 };

    const result = deepMerge(target, source);

    expect(result).toEqual({
      a: 1,
      b: "new",
      c: 3
    });
  });

  it("should not mutate original objects", () => {
    const target = { a: 1, b: { c: 2 } };
    const source = { b: { d: 3 } };

    const result = deepMerge(target, source);

    expect(target).toEqual({ a: 1, b: { c: 2 } });
    expect(source).toEqual({ b: { d: 3 } });
    expect(result).not.toBe(target);
  });

  it("should handle null and undefined values", () => {
    const target = { a: 1, b: null };
    const source = { b: { c: 2 }, d: undefined };

    const result = deepMerge(target, source);

    expect(result).toEqual({
      a: 1,
      b: { c: 2 },
      d: undefined
    });
  });
});

describe("deepSearch", () => {
  const obj = {
    keyVaults: [
      {
        name: "vault1",
        keyVaults: [{ name: "nested" }]
      }
    ],
    other: {
      keyVaults: "string-value"
    },
    array: [
      { keyVaults: "in-array" },
      {
        nested: {
          keyVaults: "deeply-nested"
        }
      }
    ]
  };

  it("should find all occurrences of a key", () => {
    const results = deepSearch(obj, "keyVaults");
    expect(results).toEqual([[{ name: "vault1", keyVaults: [{ name: "nested" }] }], [{ name: "nested" }], "string-value", "in-array", "deeply-nested"]);
  });

  it("should return empty array if key not found", () => {
    const results = deepSearch(obj, "nonexistent");
    expect(results).toEqual([]);
  });

  it("should handle primitive values", () => {
    const results = deepSearch("not-an-object", "key");
    expect(results).toEqual([]);
  });

  it("should handle null and undefined", () => {
    expect(deepSearch(null, "key")).toEqual([]);
    expect(deepSearch(undefined, "key")).toEqual([]);
  });

  it("should handle arrays at root level", () => {
    const arrayObj = [{ target: "value1" }, { other: { target: "value2" } }];
    const results = deepSearch(arrayObj, "target");
    expect(results).toEqual(["value1", "value2"]);
  });
});

describe("normalizeSecretName", () => {
  it("should replace non-alphanumeric characters with underscores", () => {
    expect(normalizeSecretName("secret-name")).toBe("secret_name");
    expect(normalizeSecretName("secret.name")).toBe("secret_name");
    expect(normalizeSecretName("secret name")).toBe("secret_name");
    expect(normalizeSecretName("secret@name#123")).toBe("secret_name_123");
  });

  it("should preserve alphanumeric characters", () => {
    expect(normalizeSecretName("secretName123")).toBe("secretName123");
    expect(normalizeSecretName("SECRET")).toBe("SECRET");
    expect(normalizeSecretName("123")).toBe("123");
  });

  it("should handle empty string", () => {
    expect(normalizeSecretName("")).toBe("");
  });

  it("should handle strings with only special characters", () => {
    expect(normalizeSecretName("!@#$%")).toBe("_____");
  });
});
