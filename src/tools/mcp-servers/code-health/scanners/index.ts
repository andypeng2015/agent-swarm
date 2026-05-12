import type { Scanner, ScannerResult } from "../types";
import { defaultDesloppifyRunner, runDesloppify } from "./desloppify";
import { defaultKnipRunner, runKnip } from "./knip";

export { defaultDesloppifyRunner, parseDesloppifyOutput, runDesloppify } from "./desloppify";
export { defaultKnipRunner, parseKnipReport, runKnip } from "./knip";

export interface ScannerRunners {
  knip?: typeof defaultKnipRunner;
  desloppify?: typeof defaultDesloppifyRunner;
}

export async function runScanner(
  scanner: Scanner,
  repoPath: string,
  runners: ScannerRunners = {},
): Promise<ScannerResult> {
  if (scanner === "knip") return runKnip(repoPath, runners.knip ?? defaultKnipRunner);
  return runDesloppify(repoPath, runners.desloppify ?? defaultDesloppifyRunner);
}
