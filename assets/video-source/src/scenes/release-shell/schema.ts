import { z } from "zod";

// Input-prop schema for the ReleaseShell brand-wrap composition. A storyboard
// JSON (see bin/storyboard-from-tag.ts) is a superset of this shape — the extra
// `demo_script_id` / `vo_line` keys on each beat are stripped by Zod, so a
// storyboard file can be passed straight through `remotion render --props`.
export const beatSchema = z.object({
  title: z.string(),
  prNumber: z.number().int().nonnegative(),
  prUrl: z.string(),
});

export const releaseShellSchema = z.object({
  version: z.string(),
  summary: z.string(),
  beats: z.array(beatSchema).min(1),
});

export type Beat = z.infer<typeof beatSchema>;
export type ReleaseShellProps = z.infer<typeof releaseShellSchema>;

// Timing — 30fps. Title + N beats + outro. Duration is derived from the beat
// count at render time via `calculateMetadata` in Root.tsx.
export const FPS = 30;
export const TITLE_DURATION = 105;
export const BEAT_DURATION = 150;
export const OUTRO_DURATION = 105;

export const computeDuration = (beatCount: number): number =>
  TITLE_DURATION + beatCount * BEAT_DURATION + OUTRO_DURATION;

// Sane defaults so `remotion studio` and `build:release-shell` preview without
// args. Mirrors the current v1.80.2 release for a realistic preview.
export const defaultReleaseShellProps: ReleaseShellProps = {
  version: "v1.80.2",
  summary:
    "Resilient rate-limit cooldown, webhook HMAC fixes, and a smarter workflow graph.",
  beats: [
    {
      title: "Resilient 5h rate-limit cooldown for the runner",
      prNumber: 508,
      prUrl: "https://github.com/desplega-ai/agent-swarm/pull/508",
    },
    {
      title: "Webhook triggers honor custom HMAC headers and secret refs",
      prNumber: 510,
      prUrl: "https://github.com/desplega-ai/agent-swarm/pull/510",
    },
    {
      title: "Single-branch condition nodes connect in the workflow graph",
      prNumber: 511,
      prUrl: "https://github.com/desplega-ai/agent-swarm/pull/511",
    },
  ],
};
