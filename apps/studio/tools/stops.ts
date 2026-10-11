/*
 * Fits each line's `stops`: which of its clip's pauses end a sentence.
 *
 *   bun apps/studio/tools/stops.ts <video-folder> [--write]
 *
 * Once tools/voice.ts has evened the pauses out (VOICE.maxPause), a full stop
 * is no longer the longest silence in a line, so the captions cannot find the
 * sentences by themselves and every line of more than one sentence names its
 * stops. This works them out the way PLAYBOOK.md says to: if speech ran at an
 * even rate, a sentence's share of the line's characters would be its share of
 * the line's time, and the pause nearest to where each sentence should end is
 * the one that ends it. Where `say` breaks a sentence in two for the voice,
 * the sentences counted are those of `text`: that is what the captions show.
 *
 * It prints the fitted stops next to the ones in the script and marks every
 * line where they differ, or where the nearest pause is far from where the
 * sentence should end (listen to those). With --write it puts the fitted
 * stops into script.ts, for lines written the way the scripts are: `id: "…",`
 * on a line of its own, or a one-line `{ id: "…", text: "…" }`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SENTENCE_END, type SceneSpec } from "../src/kit/narration";

const [video, ...rest] = process.argv.slice(2);
if (!video) {
  console.error("usage: stops.ts <video-folder> [--write]");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..", "videos", video);
const file = path.join(root, "script.ts");
const json = <T>(name: string) =>
  JSON.parse(readFileSync(path.join(root, "audio", name), "utf8")) as T;

const { SCRIPT } = (await import(file)) as { SCRIPT: readonly SceneSpec[] };
const durations = json<Record<string, number>>("durations.json");
const pauses = json<Record<string, number[][]>>("pauses.json");

const last = (sentence: string) =>
  sentence
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .at(-1);

/**
 * How many spoken sentences each written one takes: every way of cutting the
 * spoken ones into as many runs as there are written ones is tried, and the
 * one whose runs are closest in length to the written sentences wins, a run
 * that ends on the written sentence's own last word counting for a lot.
 */
function align(written: string[], spoken: string[]): number[] {
  if (spoken.length <= written.length) return written.map(() => 1);
  const total = (list: string[]) => list.join(" ").length;
  let best: number[] = written.map(() => 1);
  let least = Infinity;
  const walk = (index: number, from: number, runs: number[], cost: number) => {
    const left = written.length - index;
    if (left === 0) {
      if (from === spoken.length && cost < least) {
        least = cost;
        best = runs;
      }
      return;
    }
    for (let size = 1; from + size <= spoken.length - (left - 1); size += 1) {
      const run = spoken.slice(from, from + size);
      const sentence = written[index] ?? "";
      const share = Math.abs(
        total(run) / total(spoken) - sentence.length / total(written),
      );
      const ends = last(run.at(-1) ?? "") === last(sentence) ? 0 : 0.5;
      walk(index + 1, from + size, [...runs, size], cost + share + ends);
    }
  };
  walk(0, 0, [], 0);
  return best;
}

let source = readFileSync(file, "utf8");
let changed = 0;

for (const scene of SCRIPT) {
  for (const line of scene.lines) {
    const written = line.text.split(SENTENCE_END);
    if (written.length < 2) continue;
    const seconds = durations[line.id];
    const breaks = pauses[line.id] ?? [];
    if (seconds === undefined) {
      console.log(`${line.id.padEnd(5)} not spoken yet`);
      continue;
    }
    const spoken = (line.say ?? line.text).split(SENTENCE_END);
    const runs = align(written, spoken);
    const all = spoken.join(" ").length;
    const fitted: number[] = [];
    let far = 0;
    let taken = 0;
    let said = 0;
    runs.slice(0, -1).forEach((size) => {
      said += spoken.slice(taken, taken + size).join(" ").length + 1;
      taken += size;
      const due = (said / all) * seconds;
      let nearest = -1;
      breaks.forEach(([begin = 0, end = 0], index) => {
        if (index <= (fitted.at(-1) ?? -1)) return;
        const middle = (begin + end) / 2;
        const held = breaks[nearest];
        if (
          !held ||
          Math.abs(middle - due) <
            Math.abs(((held[0] ?? 0) + (held[1] ?? 0)) / 2 - due)
        ) {
          nearest = index;
        }
      });
      const found = breaks[nearest];
      if (!found) return;
      fitted.push(nearest);
      far = Math.max(
        far,
        Math.abs(((found[0] ?? 0) + (found[1] ?? 0)) / 2 - due),
      );
    });
    const have = JSON.stringify(line.stops ?? null);
    const want = JSON.stringify(fitted);
    const short = fitted.length < written.length - 1;
    console.log(
      `${line.id.padEnd(5)} ${want.padEnd(10)} script ${have.padEnd(10)} ${breaks.length} pauses, ${written.length} sentences${short ? "  TOO FEW PAUSES: shown whole" : ""}${far > 0.6 ? `  FAR (${far.toFixed(1)} s): listen` : ""}${have !== want ? "  *" : ""}`,
    );
    if (!rest.includes("--write") || have === want || short) continue;
    const stops = `stops: [${fitted.join(", ")}],`;
    const id = line.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = source;
    // Stops already there; an id on its own line; a line written on one line.
    source = source.replace(
      new RegExp(`(id: "${id}",\\s*)stops: \\[[^\\]]*\\],`),
      `$1${stops}`,
    );
    if (source === before) {
      source = source.replace(
        new RegExp(`^(\\s*)id: "${id}",\\n`, "m"),
        `$1id: "${id}",\n$1${stops}\n`,
      );
    }
    if (source === before) {
      source = source.replace(
        new RegExp(`\\{ id: "${id}", `),
        `{ id: "${id}", ${stops} `,
      );
    }
    if (source === before) console.log(`      could not write ${line.id}`);
    else changed += 1;
  }
}

if (changed > 0) {
  writeFileSync(file, source);
  console.log(`wrote the stops of ${changed} lines into script.ts`);
}
