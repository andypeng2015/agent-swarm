import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { theme } from "../theme";
import { LowerThird } from "../scenes/release-shell/LowerThird";
import { OutroCard } from "../scenes/release-shell/OutroCard";
import {
  BEAT_DURATION,
  OUTRO_DURATION,
  type ReleaseShellProps,
  TITLE_DURATION,
} from "../scenes/release-shell/schema";
import { TitleCard } from "../scenes/release-shell/TitleCard";

// Brand-wrap composition for release videos: an opening title card, one
// animated lower-third per release beat (composited over demo footage by the
// downstream video-use editor), and an outro CTA. Driven entirely by input
// props — see schema.ts and bin/storyboard-from-tag.ts.
export const ReleaseShell: React.FC<ReleaseShellProps> = ({
  version,
  summary,
  beats,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.sans }}>
      <Audio src={staticFile("audio/bed.mp3")} volume={0.5} />

      <Sequence from={0} durationInFrames={TITLE_DURATION}>
        <TitleCard version={version} summary={summary} />
      </Sequence>

      {beats.map((beat, i) => (
        <Sequence
          key={`${beat.prNumber}-${i}`}
          from={TITLE_DURATION + i * BEAT_DURATION}
          durationInFrames={BEAT_DURATION}
        >
          <LowerThird beat={beat} index={i} total={beats.length} />
        </Sequence>
      ))}

      <Sequence
        from={TITLE_DURATION + beats.length * BEAT_DURATION}
        durationInFrames={OUTRO_DURATION}
      >
        <OutroCard version={version} />
      </Sequence>
    </AbsoluteFill>
  );
};
