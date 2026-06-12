import type { DeterministicCheck, Scenario } from "../src/types.ts";

/**
 * The seeded test suite (8 strict cases). The negative-exponent pow case is
 * the edge a plausible first-pass implementation misses (a naive integer-only
 * loop returns 1 or throws) — task 1 exists to catch and fix exactly that.
 */
const CALC_TEST = `import { expect, test } from "bun:test";
import { add, mul, pow } from "./calc.ts";

test("add: two positive integers", () => {
  expect(add(2, 3)).toBe(5);
});

test("add: negative numbers", () => {
  expect(add(-2, -3)).toBe(-5);
});

test("mul: basic product", () => {
  expect(mul(4, 5)).toBe(20);
});

test("mul: by zero", () => {
  expect(mul(7, 0)).toBe(0);
});

test("pow: positive integer exponent", () => {
  expect(pow(2, 10)).toBe(1024);
});

test("pow: zero exponent", () => {
  expect(pow(5, 0)).toBe(1);
});

test("pow: negative base, odd exponent", () => {
  expect(pow(-3, 3)).toBe(-27);
});

test("pow: negative exponent yields the exact reciprocal", () => {
  expect(pow(2, -2)).toBe(0.25);
});
`;

/** Re-runs the seeded suite on worker 0 (the default ctx.exec binding). */
const bunTestGreen: DeterministicCheck = {
  name: "bun-test-green",
  fn: async (ctx) => {
    const res = await ctx.exec("cd /workspace/calc && bun test");
    return res.exitCode === 0
      ? { pass: true, detail: "bun test exited 0" }
      : {
          pass: false,
          detail: `bun test exited ${res.exitCode}: ${(res.stderr || res.stdout).slice(0, 400)}`,
        };
  },
};

/**
 * Deterministic build → verify/fix chain (v6 §13.1 S2): dependsOn on a single
 * worker with a compile-grade check. seed.exec plants a strict bun test suite;
 * task 0 implements the module it imports; task 1 (dependsOn task 0) runs the
 * suite and fixes the implementation (never the tests) until green.
 */
export const buildVerifyFix: Scenario = {
  id: "build-verify-fix",
  name: "Build, verify, fix",
  description: [
    "Seeds a strict bun test suite at /workspace/calc/calc.test.ts (8 cases including",
    "negative-exponent pow). Task 0 implements /workspace/calc/calc.ts to satisfy the suite's",
    "imports; task 1 (dependsOn task 0) runs `bun test`, fixing the implementation — never the",
    "tests — until green. Graded deterministically by re-running the suite.",
  ].join(" "),
  seed: {
    exec: [
      [
        "mkdir -p /workspace/calc && cat > /workspace/calc/calc.test.ts <<'CALC_TEST_EOF'",
        CALC_TEST.trimEnd(),
        "CALC_TEST_EOF",
        "chmod -R a+rwX /workspace/calc",
      ].join("\n"),
    ],
  },
  tasks: [
    {
      title: "Implement the calc module",
      description: [
        "A test file exists at /workspace/calc/calc.test.ts. Implement /workspace/calc/calc.ts",
        "exporting exactly what the test file imports, so that the suite can run. Do NOT modify",
        "the test file. When the implementation is in place, report completion via store-progress.",
      ].join(" "),
    },
    {
      title: "Verify and fix",
      dependsOn: [0],
      description: [
        "Run `cd /workspace/calc && bun test`. If any test fails, fix the implementation in",
        "/workspace/calc/calc.ts — never modify the test file — and re-run until the whole suite",
        "is green. Then report the final test summary via store-progress.",
      ].join(" "),
    },
  ],
  outcome: {
    checks: [bunTestGreen],
  },
  timeoutMs: 12 * 60_000,
};
