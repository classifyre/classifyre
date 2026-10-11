/*
 * Checks what the voice said against the script: every clip is sent to a
 * model that takes audio, which writes it down word for word, and the words
 * are compared with the line's `say` (or `text`), case and punctuation aside.
 *
 *   bun apps/studio/tools/hear.ts <video-folder> [line-id ...]
 *
 * It finds dropped, added and changed words. It mishears brand names and
 * invented names every time, so read a difference before speaking a line
 * again; and it cannot time anything, so pauses are measured by
 * tools/voice.ts, not here. The key is OPEN_ROUTER_KEY in the video's .env.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SceneSpec } from "../src/kit/narration";

const MODEL = "google/gemini-3.8-flash";

const [video, ...named] = process.argv.slice(2);
if (!video) {
  console.error("usage: hear.ts <video-folder> [line-id ...]");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..", "videos", video);
const { SCRIPT } = (await import(path.join(root, "script.ts"))) as {
  SCRIPT: readonly SceneSpec[];
};
const env = readFileSync(path.join(root, ".env"), "utf8");
const token = /^OPEN_ROUTER_KEY=(.+)$/m
  .exec(env)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!token) throw new Error("OPEN_ROUTER_KEY is not in the video's .env");

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, "")
    .split(/\s+/)
    // "Mr." is written both ways, and "and" comes and goes inside a number.
    .map((word) => (word === "mr" ? "mister" : word))
    .filter((word) => word && word !== "and");

async function hear(file: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this recording word for word, exactly as spoken. Write every number out in words. Write down hesitations and stray sounds (um, mm) too. Answer with the transcript only.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: readFileSync(file).toString("base64"),
                format: "mp3",
              },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const answer = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  return answer.choices?.[0]?.message?.content?.trim() ?? "";
}

const lines = SCRIPT.flatMap((scene) => scene.lines).filter(
  (line) => named.length === 0 || named.includes(line.id),
);
let differing = 0;
const results = await Promise.all(
  lines.map(async (line) => {
    const file = path.join(root, "audio", `${line.id}.mp3`);
    if (!existsSync(file)) return `${line.id.padEnd(5)} not spoken yet`;
    const meant = line.say ?? line.text;
    const heard = await hear(file).catch((error: unknown) => `!! ${String(error)}`);
    if (words(heard).join(" ") === words(meant).join(" ")) {
      return `${line.id.padEnd(5)} ok`;
    }
    differing += 1;
    return `${line.id.padEnd(5)} DIFFERS\n      script: ${meant}\n      heard:  ${heard}`;
  }),
);
console.log(results.join("\n"));
console.log(`${lines.length} lines, ${differing} differ`);
