import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../../theme";

// 765-900 frames (25.5-30s): outro title card.
// VO "agent-swarm — by Desplega" lands around frame 765-780.
export const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame(); // relative within sequence (0-134)

  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const logoY = interpolate(frame, [0, 18], [16, 0], { extrapolateRight: "clamp" });
  const linkOpacity = interpolate(frame, [22, 40], [0, 1], { extrapolateRight: "clamp" });
  const tagOpacity = interpolate(frame, [35, 55], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Horizontal amber accent line */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: interpolate(frame, [0, 24], [0, 280], { extrapolateRight: "clamp" }),
          height: 1,
          backgroundColor: theme.accent,
          opacity: 0.5,
          marginTop: -70,
        }}
      />

      <div style={{ textAlign: "center", opacity: fadeIn, transform: `translateY(${logoY}px)` }}>
        {/* agent-swarm wordmark */}
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 80,
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

        {/* desplega.ai */}
        <div
          style={{
            fontFamily: theme.sans,
            fontSize: 20,
            fontWeight: 400,
            color: theme.muted,
            letterSpacing: 2,
            marginTop: 24,
            opacity: linkOpacity,
          }}
        >
          desplega.ai
        </div>

        {/* Open source pill */}
        <div
          style={{
            display: "inline-block",
            marginTop: 20,
            padding: "5px 16px",
            borderRadius: 100,
            border: `1px solid ${theme.border}`,
            fontFamily: theme.mono,
            fontSize: 13,
            color: theme.mutedDim,
            letterSpacing: 1.5,
            textTransform: "uppercase" as const,
            opacity: tagOpacity,
          }}
        >
          Open source
        </div>
      </div>
    </AbsoluteFill>
  );
};
