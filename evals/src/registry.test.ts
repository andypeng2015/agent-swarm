import { describe, expect, test } from "bun:test";
import { validateScenario } from "./registry.ts";
import type { Scenario } from "./types.ts";

/** Minimal valid scenario; tests override single fields to isolate one rule. */
function scenario(overrides: Partial<Scenario>): Scenario {
  return {
    id: "test-scenario",
    name: "Test scenario",
    tasks: [{ title: "t0", description: "d0" }],
    outcome: {},
    ...overrides,
  };
}

describe("validateScenario (v6 §0.11 frozen rules)", () => {
  test("a plain single-task scenario is valid", () => {
    expect(validateScenario(scenario({}))).toEqual([]);
  });

  test("workers bounds: 1..3 accepted, 0 / 4 / non-integers rejected", () => {
    expect(validateScenario(scenario({ workers: 1 }))).toEqual([]);
    expect(validateScenario(scenario({ workers: 3 }))).toEqual([]);
    expect(validateScenario(scenario({ workers: 0 }))).not.toEqual([]);
    expect(validateScenario(scenario({ workers: 4 }))).not.toEqual([]);
    expect(validateScenario(scenario({ workers: 1.5 }))).not.toEqual([]);
  });

  test("task.worker must be an integer within [0, workers)", () => {
    const base = {
      workers: 2,
      tasks: [
        { title: "a", description: "d", worker: 0 },
        { title: "b", description: "d", worker: 1 },
      ],
    };
    expect(validateScenario(scenario(base))).toEqual([]);
    expect(
      validateScenario(
        scenario({ workers: 2, tasks: [{ title: "a", description: "d", worker: 2 }] }),
      ),
    ).not.toEqual([]);
    // default workers = 1 → worker 1 is out of range
    expect(
      validateScenario(scenario({ tasks: [{ title: "a", description: "d", worker: 1 }] })),
    ).not.toEqual([]);
    expect(
      validateScenario(scenario({ tasks: [{ title: "a", description: "d", worker: -1 }] })),
    ).not.toEqual([]);
    expect(
      validateScenario(
        scenario({ workers: 2, tasks: [{ title: "a", description: "d", worker: 0.5 }] }),
      ),
    ).not.toEqual([]);
  });

  test("seed.sqlDump must be a bare .sql filename (no path separators)", () => {
    const withDump = (sqlDump: string) => scenario({ seed: { sqlDump } });
    expect(validateScenario(withDump("seeded-history.sql"))).toEqual([]);
    expect(validateScenario(withDump("Seed_v2.0-final.sql"))).toEqual([]);
    expect(validateScenario(withDump("nested/path.sql"))).not.toEqual([]);
    expect(validateScenario(withDump("../escape.sql"))).not.toEqual([]);
    expect(validateScenario(withDump("no-extension"))).not.toEqual([]);
    expect(validateScenario(withDump("wrong.sqlite"))).not.toEqual([]);
    expect(validateScenario(withDump("has space.sql"))).not.toEqual([]);
  });

  test("seed.memories: non-empty strings, max 16 entries", () => {
    expect(validateScenario(scenario({ seed: { memories: ["a fact"] } }))).toEqual([]);
    expect(
      validateScenario(scenario({ seed: { memories: Array.from({ length: 16 }, () => "m") } })),
    ).toEqual([]);
    expect(
      validateScenario(scenario({ seed: { memories: Array.from({ length: 17 }, () => "m") } })),
    ).not.toEqual([]);
    expect(validateScenario(scenario({ seed: { memories: [""] } }))).not.toEqual([]);
    expect(validateScenario(scenario({ seed: { memories: ["ok", "   "] } }))).not.toEqual([]);
  });

  describe("dependsOn rules (strictly-earlier-index = the cycle check)", () => {
    const tasks3 = (deps: { [i: number]: number[] }) =>
      scenario({
        tasks: [
          { title: "t0", description: "d", dependsOn: deps[0] },
          { title: "t1", description: "d", dependsOn: deps[1] },
          { title: "t2", description: "d", dependsOn: deps[2] },
        ],
      });

    test("a valid 3-task chain is accepted", () => {
      expect(validateScenario(tasks3({ 1: [0], 2: [0, 1] }))).toEqual([]);
    });

    test("out-of-range index rejected", () => {
      expect(validateScenario(tasks3({ 1: [-1] }))).not.toEqual([]);
      expect(validateScenario(tasks3({ 1: [5] }))).not.toEqual([]);
    });

    test("forward reference rejected", () => {
      expect(validateScenario(tasks3({ 1: [2] }))).not.toEqual([]);
    });

    test("self-reference rejected", () => {
      expect(validateScenario(tasks3({ 1: [1] }))).not.toEqual([]);
      // task 0 can never have deps (no earlier task exists)
      expect(validateScenario(tasks3({ 0: [0] }))).not.toEqual([]);
    });

    test("duplicates rejected", () => {
      const errors = validateScenario(tasks3({ 2: [0, 0] }));
      expect(errors).not.toEqual([]);
      expect(errors.join("\n")).toContain("duplicate");
    });

    test("non-integer entries rejected", () => {
      expect(validateScenario(tasks3({ 1: [0.5] }))).not.toEqual([]);
    });
  });
});
