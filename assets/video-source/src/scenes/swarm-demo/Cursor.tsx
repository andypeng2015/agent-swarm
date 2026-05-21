import { interpolate, useCurrentFrame } from "remotion";
import type { CursorEvent, CursorTrack } from "../../cursor-track";

// ---------------------------------------------------------------------------
// Cursor component — replays real recorder events from cursor-track.json.
//
// The recorder emits CursorTrack alongside each beat clip, capturing real
// element coordinates via `agent-browser get box` + `agent-browser mouse move`.
// This component reads those events and replays them frame-accurately.
//
// Timing contract:
//   - frame 0 in this component = demoStartFrame in the output video
//   - recordingDurationMs tells us the total span of the cursor events
//   - For each frame f: recordingTimeMs = (f / demoFrameCount) * recordingDurationMs
//   - Then we interpolate cursor position from the two nearest events
// ---------------------------------------------------------------------------

interface CursorProps {
  /** The cursor track loaded from cursor-track.json. */
  track: CursorTrack;
  /** Total frames in the demo section (e.g. 675 for a 22.5s demo at 30fps). */
  demoFrameCount: number;
  /** Demo section start frame in the OUTPUT video (used for fade in/out). */
  demoStartFrame?: number;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Find the cursor position at a given recording timestamp via linear interp with cubic easing. */
function cursorAtMs(events: CursorEvent[], ms: number): { x: number; y: number } {
  if (events.length === 0) return { x: 960, y: 540 };
  if (ms <= events[0].tsMs) return { x: events[0].x, y: events[0].y };
  const last = events[events.length - 1];
  if (ms >= last.tsMs) return { x: last.x, y: last.y };

  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (ms >= a.tsMs && ms <= b.tsMs) {
      const span = b.tsMs - a.tsMs;
      const t = span > 0 ? (ms - a.tsMs) / span : 1;
      const eased = easeOutCubic(Math.max(0, Math.min(1, t)));
      return {
        x: a.x + (b.x - a.x) * eased,
        y: a.y + (b.y - a.y) * eased,
      };
    }
  }
  return { x: last.x, y: last.y };
}

/** True if a click event is nearby (within ±4 frames at 30fps = ±133ms). */
function nearClick(events: CursorEvent[], ms: number): boolean {
  const windowMs = 133;
  return events.some((e) => e.action === "click" && Math.abs(e.tsMs - ms) <= windowMs);
}

export const Cursor: React.FC<CursorProps> = ({
  track,
  demoFrameCount,
  demoStartFrame = 90,
}) => {
  const frame = useCurrentFrame(); // 0-based within demo sequence

  const fps = 30;
  const recordingMs = (frame / demoFrameCount) * track.durationMs;
  const { x, y } = cursorAtMs(track.events, recordingMs);
  const isNearClick = nearClick(track.events, recordingMs);

  // Scale cursor coords from recording viewport to 1920×1080 output
  const scaleX = 1920 / track.viewport.width;
  const scaleY = 1080 / track.viewport.height;
  const cx = x * scaleX;
  const cy = y * scaleY;

  // Fade in at start of demo, fade out at end
  const opacity = interpolate(
    frame,
    [0, fps * 0.5, demoFrameCount - fps * 0.5, demoFrameCount],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Click pulse — lime-green ring that expands on click events
  const clickPulseProgress = isNearClick
    ? interpolate(
        track.events.find(
          (e) =>
            e.action === "click" &&
            Math.abs(e.tsMs - recordingMs) <=
              133
        )?.tsMs ?? recordingMs,
        [recordingMs - 133, recordingMs + 133],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 0;
  const pulseOpacity = isNearClick ? interpolate(clickPulseProgress, [0, 0.4, 1], [0, 0.9, 0]) : 0;
  const pulseScale = 1 + clickPulseProgress * 0.6;

  return (
    <div
      style={{
        position: "absolute",
        left: cx - 8,
        top: cy - 4,
        pointerEvents: "none",
        opacity,
        zIndex: 100,
      }}
    >
      {/* Click pulse ring — amber-500 */}
      {isNearClick && (
        <div
          style={{
            position: "absolute",
            left: -16,
            top: -16,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "2px solid #f59e0b",
            opacity: pulseOpacity * 0.8,
            transform: `scale(${pulseScale})`,
          }}
        />
      )}
      {/* OS-style arrow cursor */}
      <svg
        width={24}
        height={28}
        viewBox="0 0 24 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.6))" }}
      >
        <path
          d="M2 2L2 22L7.5 16.5L11 24L14 22.5L10.5 15L18 15L2 2Z"
          fill="white"
          stroke="#1a1a1a"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
