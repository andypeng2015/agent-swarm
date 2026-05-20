import { interpolate, useCurrentFrame } from "remotion";

// Cursor waypoints: {frame, x, y} in 1920×1080 space.
// Video (1280×578) is displayed at 1920×867 centered in 1080 → y offset = 106.5px.
// Mapping: x_out = x_src * 1.5,  y_out = y_src * 1.5 + 106.5
//
// Timeline in SwarmDemo output frames (demo section starts at frame 90):
//   90  → tasks list: hovering on task row
//   160 → still on row (about to click)
//   200 → task detail: moves toward breadcrumb / Back to Tasks link
//   280 → in_progress: moves toward status badge
//   360 → progress: moves toward progress text area
//   480 → progress ticking: stays near progress area
//   555 → completed: moves toward output section
//   670 → back to list: moves toward task row
const WAYPOINTS: Array<{ frame: number; x: number; y: number }> = [
  { frame: 90,  x: 965,  y: 406 }, // task row in list
  { frame: 160, x: 990,  y: 406 }, // slight shift before click
  { frame: 210, x: 340,  y: 238 }, // Back to Tasks link
  { frame: 285, x: 693,  y: 252 }, // status badge area
  { frame: 365, x: 628,  y: 436 }, // progress text (scanning)
  { frame: 480, x: 628,  y: 460 }, // progress ticking (issues found)
  { frame: 558, x: 700,  y: 530 }, // completed output section
  { frame: 672, x: 965,  y: 406 }, // back to list — task row
  { frame: 765, x: 965,  y: 406 }, // hold at end of demo section
];

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function interpolateCursor(frame: number): { x: number; y: number } {
  if (frame <= WAYPOINTS[0].frame) return { x: WAYPOINTS[0].x, y: WAYPOINTS[0].y };
  if (frame >= WAYPOINTS[WAYPOINTS.length - 1].frame) {
    const last = WAYPOINTS[WAYPOINTS.length - 1];
    return { x: last.x, y: last.y };
  }
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      const eased = easeOutCubic(t);
      return {
        x: a.x + (b.x - a.x) * eased,
        y: a.y + (b.y - a.y) * eased,
      };
    }
  }
  return { x: WAYPOINTS[0].x, y: WAYPOINTS[0].y };
}

interface CursorProps {
  // demoStartFrame: the output frame where the demo section begins (90)
  demoStartFrame?: number;
}

export const Cursor: React.FC<CursorProps> = ({ demoStartFrame = 90 }) => {
  const frame = useCurrentFrame();
  const { x, y } = interpolateCursor(frame);

  // Click pulse: brief amber ring when cursor "clicks" (at waypoint boundaries)
  const clickFrames = WAYPOINTS.map((w) => w.frame);
  const nearestClick = clickFrames.reduce((prev, curr) =>
    Math.abs(curr - frame) < Math.abs(prev - frame) ? curr : prev
  );
  const distToClick = Math.abs(frame - nearestClick);
  const clickPulse = distToClick < 8 ? interpolate(distToClick, [0, 8], [1, 0]) : 0;

  // Fade in at demo start, fade out at demo end
  const opacity = interpolate(
    frame,
    [demoStartFrame, demoStartFrame + 10, 755, 765],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: x - 8,
        top: y - 4,
        pointerEvents: "none",
        opacity,
        zIndex: 100,
      }}
    >
      {/* Click pulse ring */}
      {clickPulse > 0 && (
        <div
          style={{
            position: "absolute",
            left: -16,
            top: -16,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "2px solid #f2a93b",
            opacity: clickPulse * 0.7,
            transform: `scale(${1 + (1 - clickPulse) * 0.5})`,
          }}
        />
      )}
      {/* Arrow cursor SVG */}
      <svg
        width={24}
        height={28}
        viewBox="0 0 24 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))" }}
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
