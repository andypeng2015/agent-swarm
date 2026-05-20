import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { theme } from "../theme";
import { SceneIntro } from "../scenes/swarm-demo/SceneIntro";
import { SceneDemo } from "../scenes/swarm-demo/SceneDemo";
import { SceneOutro } from "../scenes/swarm-demo/SceneOutro";

// 30s @ 30fps = 900 frames.
// Structure:
//   0-90    (0-3s)    Intro title card — "This is agent-swarm" VO
//   90-765  (3-25.5s) E2E demo footage + animated cursor
//   765-900 (25.5-30s) Outro — "agent-swarm — by Desplega" VO
//
// VO (22.5s) starts at frame 0. Music bed runs the full 30s @ volume 0.18.
export const SwarmDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.sans }}>
      {/* Voiceover — plays from frame 0, full 22.5s */}
      <Audio src={staticFile("audio/swarm-demo-vo.mp3")} volume={1.0} />

      {/* Music bed — low mix so VO sits clearly above */}
      <Audio src={staticFile("audio/cool-chill-beat-loop.mp3")} volume={0.18} />

      <Sequence from={0} durationInFrames={90}>
        <SceneIntro />
      </Sequence>

      <Sequence from={90} durationInFrames={675}>
        <SceneDemo />
      </Sequence>

      <Sequence from={765} durationInFrames={135}>
        <SceneOutro />
      </Sequence>
    </AbsoluteFill>
  );
};
