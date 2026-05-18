import { afterEach, describe, expect, test } from "bun:test";
import { NativeScriptExecutor } from "../scripts-runtime/executors/native";
import { getScriptExecutor } from "../scripts-runtime/executors/registry";

const original = process.env.SCRIPT_EXECUTOR;

afterEach(() => {
  if (original === undefined) delete process.env.SCRIPT_EXECUTOR;
  else process.env.SCRIPT_EXECUTOR = original;
});

describe("getScriptExecutor", () => {
  test("defaults to native", () => {
    delete process.env.SCRIPT_EXECUTOR;
    expect(getScriptExecutor()).toBeInstanceOf(NativeScriptExecutor);
  });

  test("returns native when requested", () => {
    process.env.SCRIPT_EXECUTOR = "native";
    expect(getScriptExecutor()).toBeInstanceOf(NativeScriptExecutor);
  });

  test("throws for unknown executors", () => {
    process.env.SCRIPT_EXECUTOR = "e2b";
    expect(() => getScriptExecutor()).toThrow("Available: native");
  });
});
