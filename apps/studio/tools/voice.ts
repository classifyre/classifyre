/*
 * Speaks a video's script. One clip a line into the video's audio/<id>.mp3;
 * how long each takes into audio/durations.json, which is what the timeline is
 * cut to; and where the speaker pauses inside it into audio/pauses.json, which
 * is what pictures and captions are cut to.
 *
 *   bun apps/studio/tools/voice.ts <video-folder> [--force] [line-id ...]
 *
 * The video's script.ts exports SCRIPT (scenes of lines) and VOICE (the model,
 * the voice and how to speak): see src/kit/narration.ts. A line that already
 * has a clip is left alone unless it is named or --force is given: every call
 * is paid for. The key is OPEN_ROUTER_KEY in the video's own .env.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SceneSpec, VoiceSpec } from "../src/kit/narration";

const [video, ...rest] = process.argv.slice(2);
if (!video) {
  console.error("usage: voice.ts <video-folder> [--force] [line-id ...]");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..", "videos", video);
const audio = path.join(root, "audio");
const force = rest.includes("--force");
const named = new Set(rest.filter((arg) => !arg.startsWith("--")));

const { SCRIPT, VOICE } = (await import(path.join(root, "script.ts"))) as {
  SCRIPT: readonly SceneSpec[];
  VOICE: VoiceSpec;
};

function key(): string {
  const env = readFileSync(path.join(root, ".env"), "utf8");
  const found = /^OPEN_ROUTER_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!found) throw new Error("OPEN_ROUTER_KEY is not in the video's .env");
  return found.replace(/^["']|["']$/g, "");
}

/** Cuts the silence the model leaves at either end, down to a breath. */
const TRIM =
  "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.08";

/** Where the speaker pauses inside a clip, in seconds. */
function pauses(file: string): number[][] {
  const log = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      "silencedetect=noise=-38dB:d=0.22",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  ).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  return starts
    .map((start, index) => [start, ends[index] ?? start])
    .filter(([start = 0, end = 0]) => start > 0.2 && end > start)
    .map(([start = 0, end = 0]) => [
      Number(start.toFixed(2)),
      Number(end.toFixed(2)),
    ]);
}

function seconds(file: string): number {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(out.toString().trim());
}

async function speak(text: string, file: string, token: string) {
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOICE.model,
      voice: VOICE.voice,
      instructions: VOICE.instructions,
      input: text,
      // Gemini speaks raw PCM only: 16-bit mono, at the rate its header names.
      response_format: "pcm",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const rate =
    /rate=(\d+)/.exec(response.headers.get("content-type") ?? "")?.[1] ??
    "24000";
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "s16le",
      "-ar",
      rate,
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-af",
      `${TRIM},areverse,${TRIM},areverse,loudnorm=I=-18:TP=-2:LRA=7`,
      "-ar",
      "48000",
      "-b:a",
      "160k",
      file,
    ],
    { input: Buffer.from(await response.arrayBuffer()) },
  );
}

mkdirSync(audio, { recursive: true });
const durations: Record<string, number> = {};
const breaks: Record<string, number[][]> = {};
let token: string | undefined;

for (const scene of SCRIPT) {
  for (const line of scene.lines) {
    const file = path.join(audio, `${line.id}.mp3`);
    if (force || named.has(line.id) || !existsSync(file)) {
      token ??= key();
      await speak(line.say ?? line.text, file, token);
      console.log(`spoke ${line.id}`);
    }
    durations[line.id] = Number(seconds(file).toFixed(3));
    breaks[line.id] = pauses(file);
  }
}

writeFileSync(path.join(audio, "pauses.json"), `${JSON.stringify(breaks)}\n`);
writeFileSync(
  path.join(audio, "durations.json"),
  `${JSON.stringify(durations, null, 2)}\n`,
);
const total = Object.values(durations).reduce((sum, value) => sum + value, 0);
console.log(
  `${Object.keys(durations).length} lines, ${total.toFixed(1)} s of speech`,
);
