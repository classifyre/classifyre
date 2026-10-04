import { Composition, Folder } from "remotion";
import "./studio.css";
import { VIDEO_DEFAULTS, type VideoDefinition } from "./kit";
import { reuseCheck } from "./smoke/reuse-check";

/*
 * videos/ is gitignored, so nothing here can import from it by name. Reading
 * the directory at bundle time means a new video shows up by existing, and a
 * fresh clone with an empty videos/ still builds.
 */
const context = require.context("../videos", true, /\/video\.tsx$/);
const videos = context
  .keys()
  .map((key) => context<{ default: VideoDefinition }>(key).default);

function compositionFor(video: VideoDefinition) {
  return <Composition key={video.id} {...VIDEO_DEFAULTS} {...video} />;
}

export function RemotionRoot() {
  return (
    <>
      <Folder name="videos">{videos.map(compositionFor)}</Folder>
      <Folder name="studio">{compositionFor(reuseCheck)}</Folder>
    </>
  );
}
