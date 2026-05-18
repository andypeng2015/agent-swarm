import ts from "typescript";

const ALLOWED_BARE_IMPORTS = new Set(["swarm-sdk", "stdlib"]);
const FORBIDDEN_HINTS = new Set(["node:", "bun:", "fs", "child_process", "crypto", "bun:sqlite"]);

export type ImportAllowlistResult =
  | { ok: true }
  | { ok: false; diagnostic: string; imports: string[] };

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isAllowed(specifier: string): boolean {
  return isRelative(specifier) || ALLOWED_BARE_IMPORTS.has(specifier);
}

function collectImportSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "user-script.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier))
        imports.push(moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg)) imports.push(arg.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

export function validateScriptImports(source: string): ImportAllowlistResult {
  const imports = collectImportSpecifiers(source);
  const rejected = imports.filter((specifier) => !isAllowed(specifier));
  if (rejected.length === 0) return { ok: true };

  const hint = rejected.find(
    (specifier) => FORBIDDEN_HINTS.has(specifier) || specifier.startsWith("node:"),
  );
  const reason = hint
    ? `Import '${hint}' is not allowed in swarm scripts`
    : `Import '${rejected[0]}' is not on the swarm script allowlist`;
  return { ok: false, diagnostic: reason, imports: rejected };
}
