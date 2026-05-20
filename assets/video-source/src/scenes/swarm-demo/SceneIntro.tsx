import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../../theme";

// 0-90 frames (0-3s): "This is agent-swarm." VO lands here.
// Brand: zinc-dark bg, amber accent, Space Grotesk.
export const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();

  const logoOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const logoY = interpolate(frame, [0, 15], [20, 0], { extrapolateRight: "clamp" });
  const tagOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: "clamp" });
  const tagY = interpolate(frame, [20, 40], [12, 0], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [72, 90], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
      }}
    >
      {/* Subtle amber accent line */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 2,
          height: interpolate(frame, [5, 20], [0, 120], { extrapolateRight: "clamp" }),
          backgroundColor: theme.accent,
          opacity: 0.6,
          marginTop: -80,
        }}
      />

      <div style={{ textAlign: "center", opacity: logoOpacity, transform: `translateY(${logoY}px)` }}>
        {/* agent-swarm wordmark */}
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 72,
            fontWeight: 700,
            color: theme.fg,
            letterSpacing: -2,
            lineHeight: 1,
          }}
        >
          <span style={{ color: theme.accent }}>agent</span>
          <span style={{ color: theme.muted }}>-</span>
          <span>swarm</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontFamily: theme.sans,
            fontSize: 22,
            fontWeight: 400,
            color: theme.muted,
            letterSpacing: 1,
            marginTop: 20,
            opacity: tagOpacity,
            transform: `translateY(${tagY}px)`,
          }}
        >
          Your AI engineering team
        </div>
      </div>

      {/* Corner brand mark */}
      <div
        style={{
          position: "absolute",
          bottom: 48,
          right: 64,
          fontFamily: theme.mono,
          fontSize: 13,
          color: theme.mutedDim,
          letterSpacing: 1,
          opacity: tagOpacity,
        }}
      >
        by Desplega
      </div>
    </AbsoluteFill>
  );
};
