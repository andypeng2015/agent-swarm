// Cursor-track types used by Remotion components.
// Kept in sync with assets/release-recorder/src/cursor-track.ts (the canonical source).

export type CursorAction = "move" | "click" | "hover";

export interface CursorEvent {
  tsMs: number;
  x: number;
  y: number;
  action: CursorAction;
}

export interface CursorTrack {
  version: "1";
  durationMs: number;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  events: CursorEvent[];
}
