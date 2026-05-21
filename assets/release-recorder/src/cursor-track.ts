/**
 * Cursor-track schema — emitted alongside each beat clip by the recorder.
 *
 * The recorder captures real element coordinates via `agent-browser get box`
 * and real move/click timing. The Remotion brand-wrap reads this file and
 * replays the cursor — it does NOT synthesize positions.
 *
 * File convention:  raw/beat-<n>.webm  →  raw/beat-<n>-cursor.json
 * Full-flow record: raw/e2e-demo.webm  →  raw/e2e-demo-cursor.json
 */

export type CursorAction = "move" | "click" | "hover";

export interface CursorEvent {
  /** Milliseconds since recording started (Date.now() - recordingStartTs). */
  tsMs: number;
  /** X coordinate in recording viewport pixels (matching --width used for recording). */
  x: number;
  /** Y coordinate in recording viewport pixels (matching --height used for recording). */
  y: number;
  /** Type of cursor event. */
  action: CursorAction;
}

export interface CursorTrack {
  /** Schema version — bump on breaking changes. */
  version: "1";
  /** Total recording duration in ms (stopTs - startTs). */
  durationMs: number;
  /** Viewport dimensions used during recording. */
  viewport: { width: number; height: number };
  /** Theme used during recording ("light" | "dark"). Default is "light". */
  theme: "light" | "dark";
  /** Ordered cursor events. Must be sorted by tsMs ascending. */
  events: CursorEvent[];
}
