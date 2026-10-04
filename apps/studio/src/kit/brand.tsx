import type { CSSProperties } from "react";
import { Img } from "remotion";
import { cn } from "@workspace/ui/lib/utils";
import logo from "../../../web/public/clasifyre_icon.png";
import hiddenGem from "../../../../mascot/classifyre_mascot_hidden_gem.png";
import lookingAround from "../../../../mascot/classifyre_mascot_looking_around.png";
import lookingAtYou from "../../../../mascot/classifyre_mascot_looking_at_you.png";
import questioning from "../../../../mascot/classifyre_mascot_questining.png";

/* Imported from where the product keeps them, so a redrawn logo or mascot
   reaches the next render without anyone copying a file. */

const MASCOT_POSES = {
  "hidden-gem": hiddenGem,
  "looking-around": lookingAround,
  "looking-at-you": lookingAtYou,
  questioning,
} as const;

export type MascotPose = keyof typeof MASCOT_POSES;

interface BrandImageProps {
  className?: string;
  style?: CSSProperties;
}

export function Logo({ className, style }: BrandImageProps) {
  return <Img src={logo} className={className} style={style} />;
}

/**
 * The mascot is black ink on a transparent ground, which disappears on the dark
 * theme. Inverting it there turns the same drawing into white ink.
 */
export function Mascot({
  pose = "looking-at-you",
  className,
  style,
}: BrandImageProps & { pose?: MascotPose }) {
  return (
    <Img
      src={MASCOT_POSES[pose]}
      className={cn("dark:invert", className)}
      style={style}
    />
  );
}
