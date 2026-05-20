import { AbsoluteFill, Video, interpolate, staticFile, useCurrentFrame } from "remotion";
import { theme } from "../../theme";
import { Cursor } from "./Cursor";

// 90-765 frames (3-25.5s): E2E demo footage + animated cursor overlay.
// Video is pre-processed to 22.5s at 30fps (full flow compressed ~1.83×).
// Subtle rounded bezel wrapper + amber accent line at top.
export const SceneDemo: React.FC = () => {
  const frame = useCurrentFrame(); // relative frame within this sequence (0-674)

  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [660, 675], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  // Absolute frame for cursor (cursor needs output-timeline coords, add 90)
  const absoluteFrame = frame + 90;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity }}>
      {/* Ambient glow behind video */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(242,169,59,0.04) 0%, transparent 70%)",
        }}
      />

      {/* Video frame wrapper */}
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
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 80px rgba(0,0,0,0.8)",
            width: 1920,
            height: 867, // 578 * 1.5
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
              opacity: 0.8,
            }}
          />

          <Video
            src={staticFile("swarm-demo.mp4")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />

          {/* Cursor overlay — positioned in the 1920×867 bezel space */}
          <Cursor demoStartFrame={90} />
        </div>
      </div>

      {/* Lower-third label: appears mid-way to mark state transitions */}
      <LowerThird frame={frame} />
    </AbsoluteFill>
  );
};

// Subtle lower-third labels timed to VO beats
const LOWER_THIRDS: Array<{ start: number; end: number; text: string }> = [
  { start: 20,  end: 95,  text: "Task queue" },
  { start: 120, end: 195, text: "Agent picks it up" },
  { start: 270, end: 360, text: "Working…" },
  { start: 465, end: 570, text: "Review complete" },
];

function LowerThird({ frame }: { frame: number }) {
  const active = LOWER_THIRDS.find((l) => frame >= l.start && frame <= l.end);
  if (!active) return null;

  const t = frame - active.start;
  const dur = active.end - active.start;
  const fadeIn = interpolate(t, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(t, [dur - 12, dur], [1, 0], { extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);
  const slideX = interpolate(t, [0, 12], [-16, 0], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 96,
        left: 80,
        opacity,
        transform: `translateX(${slideX}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(9,9,11,0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 6,
          padding: "8px 16px",
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#f2a93b" }} />
        <div
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: 18,
            fontWeight: 500,
            color: "rgba(250,250,250,0.9)",
            letterSpacing: 0.3,
          }}
        >
          {active.text}
        </div>
      </div>
    </div>
  );
}
