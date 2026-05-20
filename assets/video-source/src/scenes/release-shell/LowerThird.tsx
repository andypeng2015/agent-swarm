import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../../theme";
import type { Beat } from "./schema";

// Per-beat lower-third overlay. Designed to composite over demo footage — the
// area above the lower-third is intentionally left transparent. For the
// standalone ReleaseShell render a faint placeholder marks where footage lands.
export const LowerThird: React.FC<{
  beat: Beat;
  index: number;
  total: number;
}> = ({ beat, index, total }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Slide in from the left, hold, slide out near the end of the beat.
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exitStart = durationInFrames - 20;
  const exit = interpolate(frame, [exitStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const slideX = interpolate(enter, [0, 1], [-720, 0]) + exit * -720;
  const opacity = interpolate(enter, [0, 1], [0, 1]) * (1 - exit);

  const accentBarHeight = interpolate(enter, [0, 1], [0, 168]);

  return (
    <AbsoluteFill>
      {/* Placeholder demo-footage area — not part of the final composite. */}
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 24,
            color: theme.mutedDim,
            letterSpacing: 3,
            textTransform: "uppercase",
            border: `2px dashed ${theme.border}`,
            borderRadius: 16,
            padding: "320px 360px",
          }}
        >
          demo footage
        </div>
      </AbsoluteFill>

      {/* The lower-third itself. */}
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 110,
          display: "flex",
          alignItems: "stretch",
          gap: 28,
          transform: `translateX(${slideX}px)`,
          opacity,
        }}
      >
        <div
          style={{
            width: 8,
            height: accentBarHeight,
            backgroundColor: theme.accent,
            borderRadius: 4,
            alignSelf: "center",
          }}
        />
        <div
          style={{
            backgroundColor: theme.card,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 16,
            padding: "30px 44px",
            maxWidth: 1180,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              marginBottom: 16,
            }}
          >
            <span
              style={{
                fontFamily: theme.mono,
                fontSize: 26,
                fontWeight: 700,
                color: theme.accentFg,
                backgroundColor: theme.accent,
                borderRadius: 8,
                padding: "6px 16px",
              }}
            >
              PR #{beat.prNumber}
            </span>
            <span
              style={{
                fontFamily: theme.mono,
                fontSize: 22,
                color: theme.muted,
                letterSpacing: 2,
              }}
            >
              {index + 1} / {total}
            </span>
          </div>
          <div
            style={{
              fontSize: 46,
              fontWeight: 600,
              color: theme.fg,
              lineHeight: 1.2,
            }}
          >
            {beat.title}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
