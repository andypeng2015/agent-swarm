import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../../theme";

// Outro card: CTA pointing at the GitHub tag release / changelog.
export const OutroCard: React.FC<{ version: string }> = ({ version }) => {
  const frame = useCurrentFrame();
  const headOpacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: "clamp",
  });
  const ctaOpacity = interpolate(frame, [18, 34], [0, 1], {
    extrapolateRight: "clamp",
  });
  const urlOpacity = interpolate(frame, [32, 48], [0, 1], {
    extrapolateRight: "clamp",
  });

  const releaseUrl = `github.com/desplega-ai/agent-swarm/releases/tag/${version}`;

  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", padding: 120 }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 92,
            fontWeight: 700,
            color: theme.fg,
            lineHeight: 1.1,
            marginBottom: 28,
            opacity: headOpacity,
          }}
        >
          Shipped in <span style={{ color: theme.accent }}>{version}</span>.
        </div>
        <div
          style={{
            fontSize: 36,
            color: theme.muted,
            lineHeight: 1.35,
            marginBottom: 44,
            opacity: ctaOpacity,
          }}
        >
          Read the full changelog and release notes
        </div>
        <div
          style={{
            display: "inline-block",
            fontFamily: theme.mono,
            fontSize: 28,
            color: theme.accent,
            letterSpacing: 1,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 12,
            padding: "18px 36px",
            opacity: urlOpacity,
          }}
        >
          {releaseUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};
