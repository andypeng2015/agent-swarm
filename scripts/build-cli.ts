import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const distDir = "apps/cli/dist";
const outfile = `${distDir}/cli.js`;

// The monorepo split moved the publishable CLI artifact under apps/cli.
// Clear the former root dist output so low-disk build hosts do not carry both.
await rm("dist", { recursive: true, force: true });
await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await Bun.$`bun build ./apps/cli/src/cli.tsx --target=node --format=esm --splitting --outdir=${distDir} --entry-naming=cli.js`.quiet();

const built = await readFile(outfile, "utf8");
const withNodeShebang = built.replace(/^#!\/usr\/bin\/env bun/, "#!/usr/bin/env node");

if (!withNodeShebang.startsWith("#!/usr/bin/env node")) {
  throw new Error(`Expected ${outfile} to start with a node shebang`);
}

await writeFile(outfile, withNodeShebang);
await chmod(outfile, 0o755);
