// @ts-nocheck — research artifact
// Deterministic grader for the matrix operations-triage scenario.
type Grade = {
  recall: number;
  precisionViolations: number;
  pass: boolean;
  details: Record<string, unknown>;
};

function parseEmbeddedJson(raw: string): unknown {
  const candidates = [
    raw.trim(),
    ...[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim()),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < raw.length; end++) {
      const char = raw[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          return JSON.parse(raw.slice(start, end + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("task output did not contain a JSON object");
}

export function gradeTriageOutput(rawOutput: string, fixtures: any): Grade {
  const output: any = parseEmbeddedJson(rawOutput);
  const broken = new Set(Array.isArray(output?.brokenSchedules) ? output.brokenSchedules : []);
  const stale = new Set(Array.isArray(output?.staleTaskIds) ? output.staleTaskIds : []);
  // Coerce count: a model that returns `"count": "3"` got the ANSWER right; grading it as a
  // miss would measure JSON-typing pedantry, not triage recall. Value stays strict.
  const clusters = new Map(
    (Array.isArray(output?.failureClusters) ? output.failureClusters : [])
      .filter((item: any) => item && typeof item.token === "string")
      .map((item: any) => [item.token, Number(item.count)]),
  );
  const matchedBrokenSchedules = fixtures.brokenSchedules.filter((name: string) =>
    broken.has(name),
  );
  const matchedFailureClusters = fixtures.failureClusters.filter(
    (expected: any) => clusters.get(expected.token) === expected.count,
  );
  const matchedStaleTaskIds = fixtures.staleTaskIds.filter((id: string) => stale.has(id));
  const recall =
    matchedBrokenSchedules.length + matchedFailureClusters.length + matchedStaleTaskIds.length;
  const healthyAsBroken = fixtures.healthySchedules.filter((name: string) => broken.has(name));
  const freshAsStale = stale.has(fixtures.freshTaskId);
  const precisionViolations =
    Number(healthyAsBroken.length > 0) + Number(freshAsStale) + Number(output?.verdict === "OK");

  return {
    recall,
    precisionViolations,
    pass: recall === 7 && precisionViolations === 0,
    details: {
      matchedBrokenSchedules,
      missingBrokenSchedules: fixtures.brokenSchedules.filter((name: string) => !broken.has(name)),
      matchedFailureClusters,
      missingFailureClusters: fixtures.failureClusters.filter(
        (expected: any) => clusters.get(expected.token) !== expected.count,
      ),
      matchedStaleTaskIds,
      missingStaleTaskIds: fixtures.staleTaskIds.filter((id: string) => !stale.has(id)),
      healthyAsBroken,
      freshAsStale,
      verdict: output?.verdict ?? null,
    },
  };
}

export async function gradeTriageTask(
  taskId: string,
  manifestPath: string,
  options: { base?: string; apiKey?: string } = {},
): Promise<Grade> {
  const base = options.base ?? "http://localhost:3113";
  const apiKey =
    options.apiKey ??
    (await Bun.file(`${process.cwd()}/.env`).text()).match(/^API_KEY=(.*)$/m)![1].trim();
  const response = await fetch(`${base}/api/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok)
    throw new Error(`could not read triage task ${taskId}: HTTP ${response.status}`);
  const task: any = await response.json();
  if (typeof task.output !== "string")
    throw new Error(`triage task ${taskId} has no string output`);
  return gradeTriageOutput(task.output, JSON.parse(await Bun.file(manifestPath).text()));
}

function selfTest() {
  const fixtures = {
    brokenSchedules: ["broken-a", "broken-b", "broken-c"],
    failureClusters: [
      { token: "CLUSTER-A", count: 3 },
      { token: "CLUSTER-B", count: 2 },
    ],
    staleTaskIds: ["stale-a", "stale-b"],
    healthySchedules: ["healthy-a"],
    freshTaskId: "fresh-a",
  };
  const perfect = gradeTriageOutput(
    JSON.stringify({
      brokenSchedules: fixtures.brokenSchedules,
      failureClusters: fixtures.failureClusters,
      staleTaskIds: fixtures.staleTaskIds,
      healthySchedules: fixtures.healthySchedules,
      verdict: "ALERT",
    }),
    fixtures,
  );
  const imperfect = gradeTriageOutput(
    `report follows\n\`\`\`json
${JSON.stringify({
  brokenSchedules: ["broken-a", "broken-b", "healthy-a"],
  failureClusters: fixtures.failureClusters,
  staleTaskIds: fixtures.staleTaskIds,
  healthySchedules: [],
  verdict: "WATCH",
})}
\`\`\``,
    fixtures,
  );
  console.log(JSON.stringify({ perfect, imperfect }, null, 2));
  if (
    !perfect.pass ||
    imperfect.pass ||
    imperfect.recall !== 6 ||
    imperfect.precisionViolations !== 1
  )
    process.exit(1);
}

if (import.meta.main) {
  if (process.argv[2] === "--self-test") selfTest();
  else {
    const [taskId, manifestPath] = process.argv.slice(2);
    if (!taskId || !manifestPath) {
      console.error("usage: triage-grade.ts <taskId> <fixtures.json> | --self-test");
      process.exit(2);
    }
    console.log(JSON.stringify(await gradeTriageTask(taskId, manifestPath), null, 2));
  }
}
