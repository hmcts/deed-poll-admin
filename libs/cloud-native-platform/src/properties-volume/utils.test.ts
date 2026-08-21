import { describe, expect, it } from "vitest";
import { deepMerge, deepSearch, getProperty, normalizeSecretName, setProperty } from "./utils.js";

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

describe("getProperty", () => {
  const obj = {
    a: 1,
    b: {
      c: 2,
      d: {
        e: "deep value"
      }
    },
    array: [1, 2, 3]
  };

  it("should get top-level properties", () => {
    expect(getProperty(obj, "a")).toBe(1);
    expect(getProperty(obj, "array")).toEqual([1, 2, 3]);
  });

  it("should get nested properties", () => {
    expect(getProperty(obj, "b.c")).toBe(2);
    expect(getProperty(obj, "b.d.e")).toBe("deep value");
  });

  it("should return default value for non-existent paths", () => {
    expect(getProperty(obj, "nonexistent", "default")).toBe("default");
    expect(getProperty(obj, "b.nonexistent", "default")).toBe("default");
    expect(getProperty(obj, "b.c.nonexistent", "default")).toBe("default");
  });

  it("should return undefined for non-existent paths without default", () => {
    expect(getProperty(obj, "nonexistent")).toBeUndefined();
    expect(getProperty(obj, "b.nonexistent")).toBeUndefined();
  });

  it("should handle null and undefined objects", () => {
    expect(getProperty(null, "a", "default")).toBe("default");
    expect(getProperty(undefined, "a", "default")).toBe("default");
  });
});

describe("setProperty", () => {
  it("should set top-level properties", () => {
    const obj = {};
    setProperty(obj, "a", 1);
    expect(obj).toEqual({ a: 1 });
  });

  it("should set nested properties", () => {
    const obj = {};
    setProperty(obj, "a.b.c", "value");
    expect(obj).toEqual({
      a: {
        b: {
          c: "value"
        }
      }
    });
  });

  it("should overwrite existing properties", () => {
    const obj = { a: { b: "old" } };
    setProperty(obj, "a.b", "new");
    expect(obj).toEqual({ a: { b: "new" } });
  });

  it("should create intermediate objects", () => {
    const obj = { a: 1 };
    setProperty(obj, "b.c.d", "value");
    expect(obj).toEqual({
      a: 1,
      b: {
        c: {
          d: "value"
        }
      }
    });
  });

  it("should replace non-object values in path", () => {
    const obj = { a: { b: "not-object" } };
    setProperty(obj, "a.b.c", "value");
    expect(obj).toEqual({
      a: {
        b: {
          c: "value"
        }
      }
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
