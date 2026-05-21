import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadSpaceMono } from "@remotion/google-fonts/SpaceMono";

// Agent-swarm-landing canonical fonts (verified from agent-swarm-landing/src/app/layout.tsx).
// Space Grotesk: display/body, weights 300–700.
// Space Mono: mono eyebrows (/ slash-prefixed labels) + code accents, weights 400/700.
loadSpaceGrotesk("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

loadSpaceMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});
