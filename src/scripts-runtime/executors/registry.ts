import { NativeScriptExecutor } from "./native";
import type { ScriptExecutor } from "./types";

const EXECUTORS: Record<string, () => ScriptExecutor> = {
  native: () => new NativeScriptExecutor(),
};

export function getScriptExecutor(): ScriptExecutor {
  const name = process.env.SCRIPT_EXECUTOR ?? "native";
  const factory = EXECUTORS[name];
  if (!factory) {
    throw new Error(
      `Unknown SCRIPT_EXECUTOR: ${name}. Available: ${Object.keys(EXECUTORS).join(", ")}`,
    );
  }
  return factory();
}
