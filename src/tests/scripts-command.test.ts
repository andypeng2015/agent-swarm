import { describe, expect, test } from "bun:test";
import { runScriptsCommand } from "@swarm/app-cli/commands/scripts";

describe("runScriptsCommand", () => {
  test("reembed posts to the API maintenance route", async () => {
    const logs: string[] = [];
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await runScriptsCommand(["reembed"], {
      apiKey: "test-key",
      baseUrl: "http://swarm.test/",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ reembedded: 2 });
      },
      log: (message) => logs.push(message),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://swarm.test/api/scripts/reembed");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(logs).toEqual(["Scripts re-embedded: 2."]);
  });

  test("unknown subcommand exits with usage", async () => {
    const errors: string[] = [];
    let exitCode: number | undefined;

    await runScriptsCommand(["unknown"], {
      error: (message) => errors.push(message),
      exit: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["Unknown scripts command. Usage: scripts reembed"]);
  });
});
