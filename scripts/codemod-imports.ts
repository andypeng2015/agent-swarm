#!/usr/bin/env bun

import path from "node:path";
import { type ExportDeclaration, type ImportDeclaration, Project, type SourceFile } from "ts-morph";

type PackageMapping = {
  srcGlob: string;
  packageName: string;
  root?: string;
  subpath?: string;
  subpathRoot?: string;
};

type PackageMap = {
  version?: number;
  mappings: PackageMapping[];
};

type CompiledMapping = PackageMapping & {
  regex: RegExp;
  inferredRoot: string;
  score: number;
};

type Args = {
  dryRun: boolean;
  packageFilter?: string;
  help: boolean;
};

type Change = {
  file: string;
  line: number;
  from: string;
  to: string;
};

type ModuleDeclaration = ImportDeclaration | ExportDeclaration;

const repoRoot = path.resolve(import.meta.dir, "..");
const packageMapPath = path.join(repoRoot, "packages.map.json");
const sourceGlobs = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "scripts/**/*.ts",
  "apps/evals/**/*.ts",
  "apps/evals/**/*.tsx",
];

const sourceExtensions = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".json"];
const indexFiles = ["index.ts", "index.tsx", "index.d.ts", "index.js", "index.jsx", "index.json"];

function printHelp(): void {
  console.log(`Usage: bun scripts/codemod-imports.ts [--dry-run] [--package @swarm/types]

Rewrites static import/export specifiers from current src-relative paths to the
package aliases described in packages.map.json.

Options:
  --dry-run          Print planned rewrites without editing files.
  --package <name>  Only rewrite specifiers targeting one package.
  --help            Show this help.
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--package") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--package requires a package name");
      }
      args.packageFilter = value;
      index += 1;
    } else if (arg.startsWith("--package=")) {
      args.packageFilter = arg.slice("--package=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePackageMap(raw: unknown): PackageMap {
  if (!isRecord(raw) || !Array.isArray(raw.mappings)) {
    throw new Error("packages.map.json must contain a mappings array");
  }

  const mappings: PackageMapping[] = [];
  for (const [index, value] of raw.mappings.entries()) {
    if (!isRecord(value)) {
      throw new Error(`packages.map.json mappings[${index}] must be an object`);
    }

    const srcGlob = value.srcGlob;
    const packageName = value.packageName;
    if (typeof srcGlob !== "string" || srcGlob.length === 0) {
      throw new Error(`packages.map.json mappings[${index}].srcGlob must be a string`);
    }
    if (typeof packageName !== "string" || packageName.length === 0) {
      throw new Error(`packages.map.json mappings[${index}].packageName must be a string`);
    }

    const mapping: PackageMapping = { srcGlob, packageName };
    if (typeof value.root === "string") mapping.root = value.root;
    if (typeof value.subpath === "string") mapping.subpath = value.subpath;
    if (typeof value.subpathRoot === "string") mapping.subpathRoot = value.subpathRoot;
    mappings.push(mapping);
  }

  return { version: typeof raw.version === "number" ? raw.version : undefined, mappings };
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function toRepoPath(filePath: string): string {
  return normalizePath(path.relative(repoRoot, filePath));
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }

  return new RegExp(`^${source}$`);
}

function inferRoot(srcGlob: string): string {
  const wildcardIndex = srcGlob.search(/[*?]/);
  if (wildcardIndex === -1) {
    return normalizePath(path.posix.dirname(srcGlob));
  }

  const prefix = srcGlob.slice(0, wildcardIndex);
  const root = prefix.endsWith("/") ? prefix.slice(0, -1) : path.posix.dirname(prefix);
  return normalizePath(root === "." ? "" : root);
}

function compileMappings(mappings: PackageMapping[]): CompiledMapping[] {
  return mappings
    .map((mapping): CompiledMapping => {
      const inferredRoot = normalizePath(mapping.root ?? inferRoot(mapping.srcGlob));
      const literalChars = mapping.srcGlob.replace(/[*?]/g, "").length;
      const exactBonus = mapping.subpath ? 10_000 : 0;
      return {
        ...mapping,
        regex: globToRegex(mapping.srcGlob),
        inferredRoot,
        score: literalChars + inferredRoot.length + exactBonus,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function resolveAliasSpecifier(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  return normalizePath(`src/${specifier.slice(2)}`);
}

function resolveRelativeSpecifier(sourceFile: SourceFile, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;

  const sourceDir = path.posix.dirname(toRepoPath(sourceFile.getFilePath()));
  return normalizePath(path.posix.normalize(path.posix.join(sourceDir, specifier)));
}

function candidateRepoPaths(basePath: string): string[] {
  const normalized = normalizePath(basePath);
  const ext = path.posix.extname(normalized);

  if (ext === ".js" || ext === ".jsx") {
    const withoutExt = normalized.slice(0, -ext.length);
    return [
      `${withoutExt}.ts`,
      `${withoutExt}.tsx`,
      `${withoutExt}.d.ts`,
      normalized,
      ...indexFiles.map((file) => `${normalized}/${file}`),
    ];
  }

  if (ext.length > 0) {
    return [normalized, ...indexFiles.map((file) => `${normalized}/${file}`)];
  }

  return [
    ...sourceExtensions.map((extension) => `${normalized}${extension}`),
    ...indexFiles.map((file) => `${normalized}/${file}`),
  ];
}

async function resolveExistingRepoPath(basePath: string): Promise<string | null> {
  for (const candidate of candidateRepoPaths(basePath)) {
    if (await Bun.file(path.join(repoRoot, candidate)).exists()) {
      return candidate;
    }
  }

  return null;
}

function findMapping(
  targetPath: string,
  mappings: CompiledMapping[],
  packageFilter?: string,
): CompiledMapping | null {
  for (const mapping of mappings) {
    if (packageFilter && mapping.packageName !== packageFilter) continue;
    if (mapping.regex.test(targetPath)) return mapping;
  }

  return null;
}

function stripKnownExtension(filePath: string): string {
  if (filePath.endsWith(".d.ts")) return filePath.slice(0, -".d.ts".length);

  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".json"]) {
    if (filePath.endsWith(extension)) {
      return filePath.slice(0, -extension.length);
    }
  }

  return filePath;
}

function packageSpecifier(targetPath: string, mapping: CompiledMapping): string {
  if (mapping.subpath === ".") return mapping.packageName;
  if (mapping.subpath) return `${mapping.packageName}/${mapping.subpath}`;

  const relativeToRoot = normalizePath(path.posix.relative(mapping.inferredRoot, targetPath));
  const withoutExtension = stripKnownExtension(relativeToRoot).replace(/\/index$/, "");
  const subpath = [mapping.subpathRoot, withoutExtension].filter(Boolean).join("/");
  return subpath ? `${mapping.packageName}/${subpath}` : mapping.packageName;
}

function isPackageInternalImport(
  sourcePath: string,
  targetMapping: CompiledMapping,
  mappings: CompiledMapping[],
): boolean {
  const sourceMapping = findMapping(sourcePath, mappings, targetMapping.packageName);
  return sourceMapping?.packageName === targetMapping.packageName;
}

async function rewriteDeclaration(
  sourceFile: SourceFile,
  declaration: ModuleDeclaration,
  mappings: CompiledMapping[],
  packageFilter?: string,
): Promise<Change | null> {
  const specifier = declaration.getModuleSpecifierValue();
  if (!specifier) return null;

  const unresolvedPath =
    resolveAliasSpecifier(specifier) ?? resolveRelativeSpecifier(sourceFile, specifier);
  if (!unresolvedPath) return null;

  const targetPath = await resolveExistingRepoPath(unresolvedPath);
  if (!targetPath) return null;

  const mapping = findMapping(targetPath, mappings, packageFilter);
  if (!mapping) return null;

  const sourcePath = toRepoPath(sourceFile.getFilePath());
  if (isPackageInternalImport(sourcePath, mapping, mappings)) return null;

  const nextSpecifier = packageSpecifier(targetPath, mapping);
  if (nextSpecifier === specifier) return null;

  const moduleSpecifier = declaration.getModuleSpecifier();
  declaration.setModuleSpecifier(nextSpecifier);

  return {
    file: sourcePath,
    line: moduleSpecifier.getStartLineNumber(),
    from: specifier,
    to: nextSpecifier,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const packageMap = parsePackageMap(await Bun.file(packageMapPath).json());
  const mappings = compileMappings(packageMap.mappings);
  const knownPackages = new Set(mappings.map((mapping) => mapping.packageName));
  if (args.packageFilter && !knownPackages.has(args.packageFilter)) {
    throw new Error(`Unknown package in --package: ${args.packageFilter}`);
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(sourceGlobs);

  const changedFiles = new Set<SourceFile>();
  const changes: Change[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const change = await rewriteDeclaration(
        sourceFile,
        declaration,
        mappings,
        args.packageFilter,
      );
      if (change) {
        changes.push(change);
        changedFiles.add(sourceFile);
      }
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const change = await rewriteDeclaration(
        sourceFile,
        declaration,
        mappings,
        args.packageFilter,
      );
      if (change) {
        changes.push(change);
        changedFiles.add(sourceFile);
      }
    }
  }

  if (changes.length === 0) {
    console.log("No import/export specifiers matched the requested package map.");
    return;
  }

  const verb = args.dryRun ? "Would update" : "Updated";
  console.log(
    `${verb} ${changes.length} import/export specifier(s) across ${changedFiles.size} file(s).`,
  );
  for (const change of changes) {
    console.log(`${change.file}:${change.line} ${change.from} -> ${change.to}`);
  }

  if (args.dryRun) return;

  for (const sourceFile of changedFiles) {
    await sourceFile.save();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
