import { Database, ScanSearch, ShieldAlert } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  FindingCard,
  type FindingCardProps,
} from "@workspace/ui/components/finding-card";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { StatsCard } from "@workspace/ui/components/stats-card";
import {
  defineVideo,
  Logo,
  Mascot,
  Pop,
  Rise,
  Stage,
  type Theme,
  useCount,
  Viewport,
} from "../kit";

/*
 * The studio's health check, not a product video. Every pixel of UI in it comes
 * from @workspace/ui: if a component or a token changes there and this still
 * renders correctly, real videos will too.
 */

const INTRO = 80;
const COMPONENTS = 120;
const THEMES = 80;
const CROSSFADE = 12;

/* A fixed date, not `new Date()`: a video has to say the same thing on every
   render. */
const DETECTED_AT = new Date("2026-10-01T09:30:00Z");
const findings: FindingCardProps[] = [
  {
    id: "finding-1",
    severity: "critical",
    status: "open",
    detectorName: "AWS Access Key Detector",
    message: "AWS access key detected",
    filePath: "Engineering / Runbooks / Deploying to production",
    lineNumber: 15,
    matchedContent: "AKIAIOSFODNN7EXAMPLE",
    sourceType: "CONFLUENCE",
    sourceName: "Engineering wiki",
    detectedAt: DETECTED_AT,
  },
  {
    id: "finding-2",
    severity: "high",
    status: "new",
    detectorName: "Private Key Detector",
    message: "Private key detected",
    filePath: "#platform-oncall",
    lineNumber: 1,
    matchedContent: "-----BEGIN RSA PRIVATE KEY-----",
    sourceType: "SLACK",
    sourceName: "Company Slack",
    detectedAt: DETECTED_AT,
  },
];
const [leadFinding] = findings;

function Intro() {
  return (
    <Stage grid>
      <AbsoluteFill className="flex-row items-center justify-between px-40">
        <div className="flex flex-col gap-8">
          <Pop>
            <Logo className="size-36" />
          </Pop>
          <Rise delay={8} distance={60}>
            <h1
              className="text-[220px] uppercase leading-[0.85] text-accent"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              Classifyre
            </h1>
          </Rise>
          <Rise delay={18}>
            <p className="font-mono text-4xl uppercase tracking-[0.2em] text-muted-foreground">
              Studio reuse check
            </p>
          </Rise>
        </div>
        <Rise delay={24} distance={160} damping={16}>
          <Mascot pose="looking-at-you" className="h-[760px]" />
        </Rise>
      </AbsoluteFill>
    </Stage>
  );
}

function Stats() {
  const scanned = useCount(48210, { delay: 10, durationInFrames: 40 });
  const found = useCount(1284, { delay: 16, durationInFrames: 40 });
  const sources = useCount(12, { delay: 22, durationInFrames: 40 });

  return (
    <div className="grid grid-cols-3 gap-4">
      <Rise delay={6}>
        <StatsCard
          title="Assets scanned"
          value={scanned.toLocaleString("en-US")}
          description="Across every connected source"
          icon={ScanSearch}
        />
      </Rise>
      <Rise delay={12}>
        <StatsCard
          title="Findings"
          value={found.toLocaleString("en-US")}
          icon={ShieldAlert}
          trend={{ value: 12, label: "vs last scan" }}
        />
      </Rise>
      <Rise delay={18}>
        <StatsCard
          title="Sources"
          value={sources}
          description="Confluence, Slack, Jira and more"
          icon={Database}
        />
      </Rise>
    </div>
  );
}

function Components() {
  return (
    <Stage>
      <Viewport scale={1.75} className="flex flex-col gap-4 p-10">
        <Rise className="flex items-center gap-3">
          <h2 className="font-serif text-2xl uppercase">Findings</h2>
          <Badge>Live</Badge>
        </Rise>
        <Stats />
        <div className="grid grid-cols-2 gap-4">
          {findings.map((finding, index) => (
            <Rise key={finding.id} delay={34 + index * 10}>
              <FindingCard {...finding} />
            </Rise>
          ))}
        </div>
      </Viewport>
    </Stage>
  );
}

function ThemePanel({ theme, delay }: { theme: Theme; delay: number }) {
  return (
    <Stage theme={theme} className="justify-center gap-10 p-16">
      <Rise delay={delay}>
        <p className="font-mono text-3xl uppercase tracking-[0.2em] text-muted-foreground">
          {theme} theme
        </p>
      </Rise>
      <Rise delay={delay + 6} style={{ zoom: 2 }}>
        {leadFinding && <FindingCard {...leadFinding} />}
      </Rise>
      <Rise
        delay={delay + 12}
        className="flex items-center gap-4"
        style={{ zoom: 2 }}
      >
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <SeverityBadge severity="critical">Critical</SeverityBadge>
        <SeverityBadge severity="medium">Medium</SeverityBadge>
      </Rise>
    </Stage>
  );
}

function Themes() {
  return (
    <AbsoluteFill className="flex-row">
      <div className="relative flex-1">
        <ThemePanel theme="dark" delay={0} />
      </div>
      <div className="relative flex-1">
        <ThemePanel theme="light" delay={10} />
      </div>
    </AbsoluteFill>
  );
}

function ReuseCheck() {
  const crossfade = (
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: CROSSFADE })}
    />
  );

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={INTRO}>
        <Intro />
      </TransitionSeries.Sequence>
      {crossfade}
      <TransitionSeries.Sequence durationInFrames={COMPONENTS}>
        <Components />
      </TransitionSeries.Sequence>
      {crossfade}
      <TransitionSeries.Sequence durationInFrames={THEMES}>
        <Themes />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
}

export const reuseCheck = defineVideo({
  id: "ReuseCheck",
  component: ReuseCheck,
  durationInFrames: INTRO + COMPONENTS + THEMES - 2 * CROSSFADE,
});
