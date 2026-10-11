/*
 * Writes a video's words as subtitle files, timed like its burnt-in captions.
 *
 *   bun apps/studio/tools/subtitles.ts <video-folder> <CompositionId>
 *
 * out/<CompositionId>.en.srt from the script itself, and one more file for
 * every language the script translates itself into: script.ts may export
 * SUBTITLES = { de: { <line id>: "…" } }. A translated line has to have as
 * many sentences as the original; it is then on screen when the original is
 * being said.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  cut,
  subtitles,
  type Clips,
  type SceneSpec,
} from "../src/kit/narration";

const [video, id] = process.argv.slice(2);
if (!video || !id) {
  console.error("usage: subtitles.ts <video-folder> <CompositionId>");
  process.exit(1);
}
const studio = path.resolve(import.meta.dirname, "..");
const root = path.join(studio, "videos", video);
const json = (name: string) =>
  JSON.parse(readFileSync(path.join(root, "audio", name), "utf8"));

const { SCRIPT, SUBTITLES = {} } = (await import(
  path.join(root, "script.ts")
)) as {
  SCRIPT: readonly SceneSpec[];
  SUBTITLES?: Record<string, Record<string, string>>;
};
const clips: Clips = {
  durations: json("durations.json"),
  pauses: json("pauses.json"),
};
const { scenes } = cut(SCRIPT, clips);
const sentences = (text: string) => text.split(/(?<=[.?!])(?<!Mr\.)\s+/).length;

mkdirSync(path.join(studio, "out"), { recursive: true });
const write = (language: string, body: string) => {
  const file = path.join(studio, "out", `${id}.${language}.srt`);
  writeFileSync(file, body);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
};

write("en", subtitles(scenes));
for (const [language, lines] of Object.entries(SUBTITLES)) {
  for (const scene of scenes) {
    for (const line of scene.lines) {
      const translated = lines[line.id];
      if (!translated)
        console.warn(
          `${language}: no translation of ${line.id}, the original is used`,
        );
      else if (sentences(translated) !== sentences(line.text)) {
        console.warn(
          `${language}: ${line.id} has ${sentences(translated)} sentences, the original ${sentences(line.text)}: it is shown whole`,
        );
      }
    }
  }
  write(
    language,
    subtitles(scenes, (line) => lines[line.id]),
  );
}
