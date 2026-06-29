import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

const ADAPTER_DYNAMIC_IMPORTS = [
  "./claude-adapter",
  "./pi-mono-adapter",
  "./codex-adapter",
  "./claude-managed-adapter",
  "./devin-adapter",
  "./opencode-adapter",
] as const;

const ADAPTER_FILES = ADAPTER_DYNAMIC_IMPORTS.map((specifier) => `${specifier.slice(2)}.ts`);

const ADAPTER_SDK_ROOTS = new Set([
  "@anthropic-ai/sdk",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@openai/codex-sdk",
  "@opencode-ai/sdk",
]);

function staticImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

function toPackageRoot(specifier: string): string {
  if (!specifier.startsWith("@")) return specifier.split("/")[0] ?? specifier;
  const parts = specifier.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const resolved = resolve(dirname(fromFile), specifier);
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
}

async function collectStaticEntryGraph(entryFile: string): Promise<{
  files: Set<string>;
  externalSpecifiers: Set<string>;
}> {
  const files = new Set<string>();
  const externalSpecifiers = new Set<string>();
  const pending = [entryFile];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;

    files.add(file);
    const source = await Bun.file(file).text();
    for (const specifier of staticImportSpecifiers(source)) {
      const local = resolveLocalImport(file, specifier);
      if (local) {
        pending.push(local);
      } else {
        externalSpecifiers.add(specifier);
      }
    }
  }

  return { files, externalSpecifiers };
}

describe("@swarm/harness entry module graph", () => {
  test("keeps adapter modules and SDKs out of the static entry graph", async () => {
    const entryFile = resolve(import.meta.dir, "index.ts");
    const entrySource = await Bun.file(entryFile).text();

    for (const specifier of ADAPTER_DYNAMIC_IMPORTS) {
      expect(entrySource).toContain(`await import("${specifier}")`);
    }

    const graph = await collectStaticEntryGraph(entryFile);
    const relativeFiles = [...graph.files].map((file) => relative(import.meta.dir, file));
    for (const adapterFile of ADAPTER_FILES) {
      expect(relativeFiles).not.toContain(adapterFile);
    }

    const externalRoots = new Set([...graph.externalSpecifiers].map(toPackageRoot));
    for (const sdkRoot of ADAPTER_SDK_ROOTS) {
      expect(externalRoots).not.toContain(sdkRoot);
    }
  });
});
