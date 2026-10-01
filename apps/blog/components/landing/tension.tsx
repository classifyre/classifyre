import { getLandingCopy } from "@/content/landing";
import { Mascot } from "@/components/mascot";
import type { Locale } from "@/lib/locale";
import {
  LandingHead,
  LandingSection,
  Micro,
  Enter,
} from "@/components/landing/motifs";

/**
 * The problem, told as a scene rather than a list of pains: six systems, one
 * story, and no line between the facts. The "unlinked board" is the hero
 * motif's dark twin: same pins and dashes, except here the threads stop
 * short of each other and the question stays open.
 */

/** Scattered systems around the one who cannot answer: a board before the
    strings, with the investigator stuck in the middle of it. */
const NODES: readonly { x: number; y: number; label: string; w: number }[] = [
  { x: 20, y: 26, label: "ERP", w: 92 },
  { x: 20, y: 150, label: "DRIVE", w: 104 },
  { x: 28, y: 274, label: "CRM", w: 92 },
  { x: 488, y: 26, label: "MAIL", w: 104 },
  { x: 500, y: 150, label: "LOGS", w: 96 },
  { x: 452, y: 274, label: "REGISTER", w: 132 },
];

/** Threads that aim at the middle and give up just short of it. */
const BROKEN: readonly string[] = [
  "M 112 66 C 150 88, 172 104, 196 122",
  "M 124 190 C 158 196, 184 202, 212 212",
  "M 120 294 C 156 286, 184 278, 214 268",
  "M 488 66 C 452 88, 430 104, 406 122",
  "M 500 190 C 468 196, 442 202, 412 212",
  "M 452 294 C 420 286, 396 278, 366 268",
];

function UnlinkedBoard({
  caption,
  mascotAlt,
}: {
  caption: string;
  mascotAlt: string;
}) {
  return (
    <figure>
      {/* Fixed aspect box so the SVG and the ink drawing scale together at
          every width. The mascot stands exactly where the question mark
          used to be. */}
      <div className="relative aspect-[640/340] w-full">
          <svg
            aria-hidden="true"
            viewBox="0 0 640 340"
            className="absolute inset-0 size-full text-foreground"
          >
            <g fill="none" strokeLinecap="round">
              {BROKEN.map((d) => (
                <path
                  key={d}
                  d={d}
                  stroke="currentColor"
                  strokeOpacity="0.3"
                  strokeWidth="1.5"
                  strokeDasharray="6 8"
                />
              ))}
            </g>
            {NODES.map((node) => (
              <g key={node.label}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={40}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.55"
                  strokeWidth="2"
                />
                <text
                  x={node.x + node.w / 2}
                  y={node.y + 25}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="16"
                  fontWeight="700"
                  letterSpacing="2"
                  fill="currentColor"
                  fillOpacity="0.75"
                >
                  {node.label}
                </text>
              </g>
            ))}
          </svg>
          <Mascot
            name="questioning"
            alt={mascotAlt}
            className="absolute bottom-0 left-1/2 h-[88%] w-auto -translate-x-1/2"
          />
        </div>
      <figcaption className="mt-4">
        <Micro className="text-muted-foreground">{caption}</Micro>
      </figcaption>
    </figure>
  );
}

export function Tension({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  return (
    <LandingSection className="py-20 lg:py-28">
      <div aria-labelledby="tension-title">
        <LandingHead
          id="tension-title"
          mark={copy.tension.marker}
          title={copy.tension.title}
          lede={copy.tension.lede}
        />

        <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:gap-10">
          {/* `min-w-0` on the grid items is load-bearing: the diagram keeps a
              legible minimum width and scrolls sideways, and without it the
              grid item's automatic minimum size drags the whole page wide. */}
          <div className="min-w-0 lg:col-span-7">
            <UnlinkedBoard
              caption={
                copy.tension.figureCaption ??
                "Fig. 01: six systems, one story, no line between the facts"
              }
              mascotAlt={copy.mascots.questioning}
            />
          </div>

          {/* Margin notes: the annotator's voice, hung in the right column. */}
          <ul className="min-w-0 space-y-8 lg:col-span-5">
            {copy.tension.notes.map((note, index) => (
              <Enter key={note.label} as="li" delayMs={index * 90}>
                <div className="border-t-2 border-foreground/80 pt-4">
                  <Micro className="text-accent-ink dark:text-accent">
                    {note.label}
                  </Micro>
                  <h3 className="mt-2 font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                    {note.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {note.body}
                  </p>
                </div>
              </Enter>
            ))}
          </ul>
        </div>

        {/* The pattern, written out: one memo, not another card grid. */}
        <Enter className="mt-14">
          <div className="border-2 border-foreground/25 bg-muted/50 p-6 sm:p-8">
            <Micro className="text-accent-ink dark:text-accent">
              {copy.tension.marker}
            </Micro>
            <p className="mt-3 max-w-4xl text-base leading-8 sm:text-lg sm:leading-9">
              {copy.tension.kicker}
            </p>
          </div>
        </Enter>
      </div>
    </LandingSection>
  );
}
