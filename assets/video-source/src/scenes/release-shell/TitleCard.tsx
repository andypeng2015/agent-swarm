import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../../theme";

// Opening title card: agent-swarm logo, the release version, and a one-line
// summary of the release.
export const TitleCard: React.FC<{ version: string; summary: string }> = ({
  version,
  summary,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSpring = spring({ frame, fps, config: { damping: 200 } });
  const logoScale = interpolate(logoSpring, [0, 1], [0.85, 1]);
  const logoOpacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateRight: "clamp",
  });
  const versionOpacity = interpolate(frame, [16, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  const summaryOpacity = interpolate(frame, [30, 46], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", padding: 120 }}
    >
      <div style={{ textAlign: "center" }}>
        <Img
          src={staticFile("agent-swarm-logo.png")}
          style={{
            width: 220,
            height: 220,
            objectFit: "contain",
            marginBottom: 44,
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        />
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 26,
            color: theme.muted,
            letterSpacing: 4,
            textTransform: "uppercase",
            opacity: versionOpacity,
            marginBottom: 24,
          }}
        >
          Agent Swarm — Release
        </div>
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 132,
            fontWeight: 700,
            color: theme.accent,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            opacity: versionOpacity,
            marginBottom: 36,
          }}
        >
          {version}
        </div>
        <div
          style={{
            fontSize: 38,
            color: theme.fg,
            lineHeight: 1.35,
            maxWidth: 1200,
            opacity: summaryOpacity,
          }}
        >
          {summary}
        </div>
      </div>
    </AbsoluteFill>
  );
};
