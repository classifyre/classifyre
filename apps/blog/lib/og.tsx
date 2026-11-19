import fs from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

/**
 * Social cards (1200×630), rendered once at export time.
 *
 * The same desk as the site: the black table with its faint grid, a strip
 * of paper with one value in clear and the same value under its mask, the
 * headline in League Gothic, and Mr. Fyre at the edge. Fonts are vendored
 * under `assets/og/` (OFL) because the export runs without network access.
 */

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

const ASSETS = path.join(process.cwd(), "assets", "og");

function asset(name: string): Buffer {
  return fs.readFileSync(path.join(ASSETS, name));
}

function dataUrl(name: string): string {
  return `data:image/png;base64,${asset(name).toString("base64")}`;
}

export function renderOg({
  title,
  kicker,
  clear = "AT61 1904 3002 3457 3201",
  masked = "••••3201",
}: {
  title: string;
  kicker: string;
  clear?: string;
  masked?: string;
}): ImageResponse {
  const long = title.length > 46;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          padding: "56px 64px",
          position: "relative",
          fontFamily: "Plex",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 860 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                display: "flex",
                backgroundColor: "#b7ff00",
                color: "#0a0a0a",
                fontSize: 24,
                padding: "6px 14px",
              }}
            >
              {kicker}
            </div>
            <div style={{ display: "flex", color: "rgba(255,255,255,0.6)", fontSize: 24 }}>
              classifyre.com
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 36,
              fontFamily: "League",
              fontSize: long ? 92 : 112,
              maxWidth: 760,
              lineHeight: 0.9,
              color: "#ffffff",
              textTransform: "uppercase",
            }}
          >
            {title.split("\n").map((line) => (
              <span key={line} style={{ display: "flex" }}>
                {line}
              </span>
            ))}
          </div>

          {/* The paper strip: a value in clear, then under its mask. */}
          <div
            style={{
              display: "flex",
              marginTop: "auto",
              backgroundColor: "#ffffff",
              color: "#0a0a0a",
              fontFamily: "Mono",
              fontSize: 28,
              padding: "16px 22px",
              gap: 24,
              alignItems: "center",
              transform: "rotate(-1deg)",
              width: 800,
            }}
          >
            <span style={{ display: "flex", whiteSpace: "nowrap", flexShrink: 0 }}>{clear}</span>
            <span style={{ display: "flex", whiteSpace: "nowrap", flexShrink: 0 }}>{masked}</span>
            <span
              style={{ display: "flex", width: 110, height: 26, backgroundColor: "#0a0a0a", flexShrink: 0 }}
            />
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl("badge.png")}
          alt=""
          width={300}
          height={300}
          style={{ position: "absolute", right: 70, top: 150 }}
        />
      </div>
    ),
    {
      ...ogSize,
      fonts: [
        { name: "League", data: asset("LeagueGothic-Regular.woff"), style: "normal" },
        { name: "Plex", data: asset("IBMPlexSans-SemiBold.woff"), style: "normal", weight: 600 },
        { name: "Mono", data: asset("IBMPlexMono-Regular.ttf"), style: "normal" },
      ],
    },
  );
}
