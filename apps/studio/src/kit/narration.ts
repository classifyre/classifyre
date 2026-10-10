/*
 * A narrated video is cut to its words. The script says what is said in which
 * scene; `tools/voice.ts` speaks it, one clip a line, and writes down how long
 * each clip is and where the speaker pauses in it; and `cut` turns script and
 * clips into frame numbers. A scene lasts as long as its lines take to say, so
 * re-voicing a line moves everything after it by itself.
 *
 * Nothing here touches React or Remotion: the tools read it too.
 */

export interface Line {
  id: string;
  /** What the caption shows. */
  text: string;
  /** What is spoken, where it should not be read the way it is written. */
  say?: string;
  /** Frames of silence after the line. */
  after?: number;
  /**
   * Which of the clip's pauses (audio/pauses.json, counted from 0) end a
   * sentence, where the captions' own guess, the longest ones, is wrong: a
   * speaker sometimes waits longer at a comma than at a full stop.
   */
  stops?: number[];
}

export interface SceneSpec {
  id: string;
  /** Frames before the first line. */
  lead: number;
  /** Frames after the last line. */
  tail: number;
  lines: readonly Line[];
}

/** The voice a script is spoken in: an OpenRouter speech model, one of its voices, and how to say it. */
export interface VoiceSpec {
  model: string;
  voice: string;
  instructions: string;
  /**
   * The longest a silence inside a clip may be, in seconds. A speech model
   * leaves up to a second between sentences, which a film cut to the voice
   * then sits through; with this set, `tools/voice.ts` shortens every longer
   * silence to about this much. A longer pause stays a little longer than a
   * shorter one, so the captions can still tell a full stop from a comma.
   */
  maxPause?: number;
}

export interface LineCue<Id extends string = string> {
  id: Id;
  text: string;
  /** Frame in its scene on which the line starts. */
  from: number;
  frames: number;
  /** Frames in its scene on which each phrase of it starts, the first included. */
  phrases: number[];
  /** The silences between those phrases, as [from, to] in the scene's frames. */
  pauses: [number, number][];
  /** The pauses that end a sentence, where the script says so. */
  stops?: number[];
}

export interface SceneCue<
  SceneId extends string = string,
  LineId extends string = string,
> {
  id: SceneId;
  /** Frame in the video on which the scene starts. */
  from: number;
  frames: number;
  lines: LineCue<LineId>[];
}

/** What `tools/voice.ts` measured: seconds a clip, and [start, end] of each pause in it. */
export interface Clips {
  durations: Record<string, number>;
  pauses: Record<string, number[][]>;
}

type SceneIdOf<S extends readonly SceneSpec[]> = S[number]["id"];
type LineIdOf<S extends readonly SceneSpec[]> =
  S[number]["lines"][number]["id"];

export interface Cut<SceneId extends string, LineId extends string> {
  scenes: SceneCue<SceneId, LineId>[];
  /** The video's length in frames. */
  total: number;
  scene: (id: SceneId) => SceneCue<SceneId, LineId>;
  /** The frame, in its own scene, on which a line (or the nth phrase of it) starts. */
  at: (id: LineId, phrase?: number) => number;
  /** The frame, in its own scene, on which a line ends. */
  end: (id: LineId) => number;
}

/** Frames of silence between two lines unless the line says otherwise. */
const GAP = 9;

export function cut<const S extends readonly SceneSpec[]>(
  script: S,
  clips: Clips,
  fps = 30,
): Cut<SceneIdOf<S>, LineIdOf<S>> {
  type SceneId = SceneIdOf<S>;
  type LineId = LineIdOf<S>;

  const scenes: SceneCue<SceneId, LineId>[] = [];
  let start = 0;
  for (const spec of script) {
    let cursor = spec.lead;
    const lines: LineCue<LineId>[] = [];
    spec.lines.forEach((line, index) => {
      // A line nobody has spoken yet is given the time it would take to read.
      const seconds = clips.durations[line.id] ?? line.text.length / 14;
      const frames = Math.ceil(seconds * fps);
      const from = cursor;
      const pauses = clips.pauses[line.id] ?? [];
      lines.push({
        id: line.id as LineId,
        text: line.text,
        from,
        frames,
        phrases: [
          from,
          ...pauses.map(([, to = 0]) => from + Math.round(to * fps)),
        ],
        pauses: pauses.map(([begin = 0, to = 0]) => [
          from + Math.round(begin * fps),
          from + Math.round(to * fps),
        ]),
        stops: line.stops,
      });
      const last = index === spec.lines.length - 1;
      cursor += frames + (last ? 0 : (line.after ?? GAP));
    });
    const frames = cursor + spec.tail;
    scenes.push({ id: spec.id as SceneId, from: start, frames, lines });
    start += frames;
  }

  const byLine = new Map(
    scenes.flatMap((item) =>
      item.lines.map((line) => [line.id, line] as const),
    ),
  );
  const line = (id: LineId) => {
    const found = byLine.get(id);
    if (!found) throw new Error(`No line ${id}`);
    return found;
  };

  return {
    scenes,
    total: start,
    scene: (id) => {
      const found = scenes.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`No scene ${id}`);
      return found;
    },
    at: (id, phrase = 0) => {
      const found = line(id);
      return (
        found.phrases[Math.min(phrase, found.phrases.length - 1)] ?? found.from
      );
    },
    end: (id) => line(id).from + line(id).frames,
  };
}

export interface CaptionPart {
  text: string;
  /** Frames in the scene between which it is on screen. */
  from: number;
  to: number;
}

/**
 * A line cut into what is on screen at a time: a sentence, or two short ones.
 * A speaker stops longest where a sentence ends, so the line's longest
 * silences are taken for its full stops (or the ones the script names): no
 * transcript is needed to know when each sentence is being said.
 *
 * `text` may be a translation of the line, as long as it has as many
 * sentences: it is then timed like the original.
 */
export function captionParts(
  line: LineCue,
  text = line.text,
  longest = 76,
): CaptionPart[] {
  // A full stop ends a sentence only where a space follows ("classifyre.com"
  // is one word), and not after a title ("Mr. Fyre" is one man).
  const sentences = text.split(/(?<=[.?!])(?<!Mr\.)\s+/);
  const stops = (
    line.stops
      ? line.stops.flatMap((index) => {
          const pause = line.pauses[index];
          return pause ? [pause] : [];
        })
      : [...line.pauses]
          .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
          .slice(0, sentences.length - 1)
  ).sort((a, b) => a[0] - b[0]);
  const end = line.from + line.frames;
  const timed: CaptionPart[] =
    stops.length === sentences.length - 1
      ? sentences.map((sentence, index) => ({
          text: sentence,
          from: stops[index - 1]?.[1] ?? line.from,
          to: stops[index]?.[1] ?? end,
        }))
      : [{ text, from: line.from, to: end }];

  const grouped: CaptionPart[] = [];
  for (const part of timed) {
    const last = grouped.at(-1);
    if (last && `${last.text} ${part.text}`.length <= longest) {
      grouped[grouped.length - 1] = {
        text: `${last.text} ${part.text}`,
        from: last.from,
        to: part.to,
      };
    } else {
      grouped.push(part);
    }
  }
  return grouped;
}

function stamp(frame: number, fps: number): string {
  const ms = Math.round((frame / fps) * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/**
 * The whole video's words as a SubRip file. `translate` gives a line in
 * another language (the same number of sentences as the original); without it
 * the script's own text is used.
 */
export function subtitles(
  scenes: readonly SceneCue[],
  translate?: (line: LineCue) => string | undefined,
  fps = 30,
): string {
  const cues = scenes.flatMap((item) =>
    item.lines.flatMap((line) =>
      captionParts(line, translate?.(line) ?? line.text, 84).map((part) => ({
        text: part.text,
        from: item.from + part.from,
        to: item.from + part.to,
      })),
    ),
  );
  return cues
    .map((cue, index) => {
      // A subtitle stays until the next one, but never over a silence longer than a breath.
      const next = cues[index + 1];
      const to = Math.min(cue.to + 6, next ? next.from : cue.to + 6);
      return `${index + 1}\n${stamp(cue.from, fps)} --> ${stamp(to, fps)}\n${cue.text}\n`;
    })
    .join("\n");
}
