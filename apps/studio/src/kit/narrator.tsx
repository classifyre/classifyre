import { getInputProps, Html5Audio, Sequence, useCurrentFrame } from "remotion";
import { MrFyreActor, type FyreCue } from "./mr-fyre";
import { captionParts, type SceneCue } from "./narration";
import { during } from "./timing";

/* What lies over every scene of a narrated video: Mr. Fyre, his voice, and the words of it. */

/**
 * What a render may leave out. `--props='{"captions":false}'` gives a picture
 * without the words burnt in (for a subtitle file to carry them), and
 * `{"fyre":false}` the product alone, for screenshots.
 */
const asked = getInputProps() as { captions?: boolean; fyre?: boolean };

/**
 * His voice: one clip a line, starting on the line's frame. `clip` finds a
 * line's audio; the clips live with the video, so the video says where.
 */
export function Voice({
  scene,
  clip,
}: {
  scene: SceneCue;
  clip: (lineId: string) => string;
}) {
  return (
    <>
      {scene.lines.map((line) => (
        <Sequence
          key={line.id}
          name={`Voice ${line.id}`}
          from={line.from}
          durationInFrames={line.frames + 12}
          layout="none"
        >
          <Html5Audio src={clip(line.id)} />
        </Sequence>
      ))}
    </>
  );
}

/** The words, a sentence or two at a time, under the picture. */
export function Captions({ scene }: { scene: SceneCue }) {
  const frame = useCurrentFrame();
  const line = (asked.captions === false ? [] : scene.lines).find(
    (candidate) =>
      frame >= candidate.from - 3 &&
      frame < candidate.from + candidate.frames + 8,
  );
  if (!line) return null;
  const cut = captionParts(line);
  const part = cut.find((candidate) => frame < candidate.to) ?? cut.at(-1);
  if (!part) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-[22px] flex justify-center"
      style={{
        opacity: during(frame, line.from - 3, line.from + line.frames + 8, 5),
      }}
    >
      <div className="flex max-w-[1400px] items-stretch bg-black/90 shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
        <span className="w-[7px] shrink-0 bg-accent" />
        <p className="px-7 py-3 text-center font-sans text-[31px] font-medium leading-[1.3] text-white">
          {part.text}
        </p>
      </div>
    </div>
  );
}

/** What plays under the voice, and well under it, for the whole video. */
export function Bed({ src, volume = 0.8 }: { src: string; volume?: number }) {
  return <Html5Audio src={src} volume={volume} />;
}

/** Mr. Fyre as the narrator: `MrFyreActor`, unless the render asked for the product alone. */
export function Narrator({ cues }: { cues: FyreCue[] }) {
  return asked.fyre === false ? null : <MrFyreActor cues={cues} />;
}
