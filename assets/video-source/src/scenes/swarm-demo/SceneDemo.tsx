import { AbsoluteFill, Video, interpolate, staticFile, useCurrentFrame } from "remotion";
import { theme } from "../../theme";
import { Cursor } from "./Cursor";
import type { CursorTrack } from "../../cursor-track";

// 90-765 frames (3-25.5s): E2E demo footage + real cursor overlay.
// Cursor positions come from cursor-track.json (recorded via agent-browser),
// NOT synthesized waypoints. Lower-thirds fire AFTER the event lands on screen.

const DEMO_FRAME_COUNT = 675; // 22.5s @ 30fps

interface SceneDemoProps {
  cursorTrack: CursorTrack;
}

export const SceneDemo: React.FC<SceneDemoProps> = ({ cursorTrack }) => {
  const frame = useCurrentFrame(); // relative frame within this sequence (0-674)

  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [660, 675], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity }}>
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(180,83,9,0.04) 0%, transparent 70%)",
        }}
      />

      {/* Video frame */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Bezel */}
        <div
          style={{
            position: "relative",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 32px 80px rgba(0,0,0,0.8)",
            width: 1920,
            height: 1080,
          }}
        >
          {/* Amber accent bar at top */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
              zIndex: 10,
              opacity: 0.5,
            }}
          />

          <Video
            src={staticFile("swarm-demo.mp4")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />

          {/* Cursor overlay — uses real recorder coordinates */}
          <Cursor
            track={cursorTrack}
            demoFrameCount={DEMO_FRAME_COUNT}
            demoStartFrame={90}
          />
        </div>
      </div>

      {/* Lower-thirds — fire AFTER the event lands on screen */}
      <LowerThird frame={frame} />
    </AbsoluteFill>
  );
};

// Timing: cursor arrives ~9 frames (~300ms) before the click frame.
// Lower-third fires ~3 frames (~100ms) AFTER the event renders.
// These timings are calibrated to the sample-cursor-track.json fixture.
const LOWER_THIRDS: Array<{ start: number; end: number; text: string }> = [
  { start: 33,  end: 100, text: "Task queue"        },
  { start: 130, end: 200, text: "Agent picks it up" },
  { start: 280, end: 370, text: "Working…"          },
  { start: 460, end: 560, text: "Review complete"   },
];

function LowerThird({ frame }: { frame: number }) {
  const active = LOWER_THIRDS.find((l) => frame >= l.start && frame <= l.end);
  if (!active) return null;

  const t = frame - active.start;
  const dur = active.end - active.start;
  const fadeIn = interpolate(t, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(t, [dur - 12, dur], [1, 0], { extrapolateRight: "clamp" });
  const slideX = interpolate(t, [0, 12], [-16, 0], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 96,
        left: 80,
        opacity: Math.min(fadeIn, fadeOut),
        transform: `translateX(${slideX}px)`,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: 3,
          background: "rgba(9,9,11,0.88)",
          border: `1px solid rgba(180,83,9,0.35)`,
          borderRadius: 8,
          padding: "9px 18px",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Slash-prefixed eyebrow */}
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 10,
            fontWeight: 400,
            color: theme.accent,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          / step
        </div>
        <div
          style={{
            fontFamily: theme.sans,
            fontSize: 16,
            fontWeight: 600,
            color: "#ffffff",
            letterSpacing: "-0.02em",
          }}
        >
          {active.text}
        </div>
      </div>
    </div>
  );
}
