import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const CLI_PACKAGE_ROOT = join(REPO_ROOT, "apps/cli");
const tempDir = mkdtempSync(join(tmpdir(), "agent-swarm-pack-"));

setDefaultTimeout(30_000);

afterAll(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("published package", () => {
  test("version command works from the packaged node bin", () => {
    const unpackDir = join(tempDir, "unpacked");

    rmSync(unpackDir, { force: true, recursive: true });

    const packOutput = execSync(`npm pack --pack-destination ${JSON.stringify(tempDir)} --json`, {
      cwd: CLI_PACKAGE_ROOT,
      encoding: "utf-8",
      env: { ...process.env, npm_config_cache: join(tempDir, "npm-cache") },
      stdio: "pipe",
    });
    const [{ filename }] = JSON.parse(packOutput) as Array<{ filename: string }>;
    const tarballPath = join(tempDir, filename);

    execSync(
      `mkdir -p ${JSON.stringify(unpackDir)} && tar -xzf ${JSON.stringify(tarballPath)} -C ${JSON.stringify(unpackDir)}`,
      {
        cwd: REPO_ROOT,
        stdio: "pipe",
      },
    );

    // Symlink repo node_modules so top-level imports resolve without a network install
    execSync(
      `rm -rf ${JSON.stringify(join(unpackDir, "package", "node_modules"))} && ` +
        `ln -s ${JSON.stringify(join(REPO_ROOT, "node_modules"))} ${JSON.stringify(join(unpackDir, "package", "node_modules"))}`,
      { stdio: "pipe" },
    );

    const output = execSync(`node ./package/dist/cli.js version`, {
      cwd: unpackDir,
      encoding: "utf-8",
      stdio: "pipe",
    });

    expect(output).toContain("agent-swarm v");
  });
});
