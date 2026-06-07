import { describe, expect, test } from "bun:test";
import {
  DISCOVERY_TOPIC_GROUNDING_SQL_PREDICATE,
  isSelfReferentialHowToTopic,
  shouldRejectUngroundedHowToTopic,
} from "../content/how-to-grounding";

describe("how-to grounding guardrails", () => {
  test.each([
    "how we made mcp development feel good",
    "How We Built Our MCP Testing Workflow",
    "why our team migrated to automated QA",
    "what we learned shipping AI agents",
    "behind our production workflow",
    "our full setup for MCP CI",
  ])("flags self-referential topic: %s", (topic) => {
    expect(isSelfReferentialHowToTopic(topic)).toBe(true);
  });

  test.each([
    "how to test an mcp server in ci",
    "how to connect cursor to an mcp server",
    "mcp server best practices",
    "debug flaky e2e tests with traces",
    "how engineering teams reduce qa time",
  ])("allows generic procedural topic: %s", (topic) => {
    expect(isSelfReferentialHowToTopic(topic)).toBe(false);
  });

  test("rejects self-referential topics without grounding sources", () => {
    expect(
      shouldRejectUngroundedHowToTopic({
        topic: "how we made mcp development feel good",
        groundingSources: [],
      }),
    ).toBe(true);
  });

  test("allows self-referential topics when explicit sources are provided", () => {
    expect(
      shouldRejectUngroundedHowToTopic({
        topic: "how we made mcp development feel good",
        groundingSources: ["https://github.com/desplega-ai/agent-swarm/pull/123"],
      }),
    ).toBe(false);
  });

  test("preserves the existing empty-schema fixture path", () => {
    expect(
      shouldRejectUngroundedHowToTopic({
        topic: "how we made mcp development feel good",
        gscQuery: "FIXTURE_EMPTY_SCHEMA_STEPS_REJECT_TEST",
      }),
    ).toBe(false);
  });

  test("exports a dispatcher SQL predicate for content-state.discovery_topics", () => {
    expect(DISCOVERY_TOPIC_GROUNDING_SQL_PREDICATE).toContain("lower(phrase)");
    expect(DISCOVERY_TOPIC_GROUNDING_SQL_PREDICATE).toContain("how we *");
    expect(DISCOVERY_TOPIC_GROUNDING_SQL_PREDICATE).toContain("our team");
  });
});
