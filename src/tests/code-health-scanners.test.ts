import { describe, expect, it } from "bun:test";
import { parseDesloppifyOutput } from "../tools/mcp-servers/code-health/scanners/desloppify";
import { parseKnipReport } from "../tools/mcp-servers/code-health/scanners/knip";

describe("parseKnipReport", () => {
  it("returns [] for an empty report", () => {
    expect(parseKnipReport({ issues: [] })).toEqual([]);
  });

  it("emits one item per unreferenced file (top-level files)", () => {
    const items = parseKnipReport({ files: ["src/dead.ts"] });
    expect(items).toHaveLength(1);
    expect(items[0]?.scanner).toBe("knip");
    expect(items[0]?.kind).toBe("unused-file");
    expect(items[0]?.severity).toBe("high");
    expect(items[0]?.file).toBe("src/dead.ts");
  });

  it("parses dead-exports as medium severity", () => {
    const items = parseKnipReport({
      issues: [
        {
          file: "src/foo.ts",
          exports: [{ name: "unusedExport", line: 12, col: 1, pos: 0 }],
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("dead-export");
    expect(items[0]?.severity).toBe("medium");
    expect(items[0]?.line).toBe(12);
    expect(items[0]?.symbol).toBe("unusedExport");
  });

  it("parses dead enum members with namespace", () => {
    const items = parseKnipReport({
      issues: [
        {
          file: "src/foo.ts",
          enumMembers: [{ namespace: "MyEnum", name: "Dead", line: 5 }],
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("dead-enum-member");
    expect(items[0]?.title).toContain("MyEnum.Dead");
  });

  it("handles the documented example with exports + types + enumMembers + duplicates", () => {
    const items = parseKnipReport({
      issues: [
        {
          file: "src/Registration.tsx",
          unresolved: [{ name: "./unresolved", line: 8 }],
          exports: [{ name: "unusedExport", line: 1 }],
          types: [
            { name: "unusedEnum", line: 3 },
            { name: "unusedType", line: 8 },
          ],
          enumMembers: [
            { namespace: "MyEnum", name: "unusedMember", line: 13 },
            { namespace: "MyEnum", name: "unusedKey", line: 15 },
          ],
          duplicates: ["Registration", "default"],
        },
      ],
    });
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(
      [
        "duplicate-export",
        "duplicate-export",
        "dead-enum-member",
        "dead-enum-member",
        "dead-export",
        "dead-type",
        "dead-type",
        "unresolved-import",
      ].sort(),
    );
  });

  it("generates stable ids for the same input", () => {
    const a = parseKnipReport({
      issues: [{ file: "src/foo.ts", exports: [{ name: "x", line: 1 }] }],
    });
    const b = parseKnipReport({
      issues: [{ file: "src/foo.ts", exports: [{ name: "x", line: 1 }] }],
    });
    expect(a[0]?.id).toBe(b[0]?.id);
  });
});

describe("parseDesloppifyOutput", () => {
  it("returns [] for an unrecognized shape", () => {
    expect(parseDesloppifyOutput({ random: "thing" })).toEqual([]);
    expect(parseDesloppifyOutput(null)).toEqual([]);
  });

  it("parses identifier-encoded items (type::file::line)", () => {
    const items = parseDesloppifyOutput({
      items: [
        {
          identifier: "unused_import::src/utils/helpers.py::3",
          summary: "Unused import: os",
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("unused_import");
    expect(items[0]?.file).toBe("src/utils/helpers.py");
    expect(items[0]?.line).toBe(3);
  });

  it("normalizes severity tokens", () => {
    const items = parseDesloppifyOutput({
      items: [
        { id: "1", type: "x", severity: "blocker", summary: "a" },
        { id: "2", type: "x", level: "warning", summary: "b" },
        { id: "3", type: "x", confidence: "low", summary: "c" },
      ],
    });
    expect(items[0]?.severity).toBe("critical");
    expect(items[1]?.severity).toBe("medium");
    expect(items[2]?.severity).toBe("low");
  });

  it("maps numeric priority to severity buckets", () => {
    const items = parseDesloppifyOutput({
      items: [
        { id: "h", type: "x", priority: 90 },
        { id: "m", type: "x", priority: 40 },
        { id: "l", type: "x", priority: 5 },
      ],
    });
    expect(items[0]?.severity).toBe("critical");
    expect(items[1]?.severity).toBe("medium");
    expect(items[2]?.severity).toBe("low");
  });

  it("skips already-resolved items in source feed", () => {
    const items = parseDesloppifyOutput({
      items: [
        { id: "open", type: "x", status: "open" },
        { id: "done", type: "x", status: "resolved" },
        { id: "fixed", type: "x", status: "fixed" },
      ],
    });
    const ids = items.map((it) => it.title);
    // Only the open item should survive (the explicit "resolved" / "fixed" are dropped)
    expect(items).toHaveLength(1);
    expect(ids[0]).toMatch(/x/);
  });

  it("accepts bare-array shape and findings shape", () => {
    expect(parseDesloppifyOutput([{ id: "a", type: "t" }])).toHaveLength(1);
    expect(
      parseDesloppifyOutput({
        findings: [{ identifier: "k::p::1", dimension: "naming", summary: "s" }],
      }),
    ).toHaveLength(1);
  });
});
