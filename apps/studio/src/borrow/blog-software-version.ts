/*
 * Stands in for @workspace/ui/lib/software-version where the landing page
 * reads it. The page prints the version it was built from into its Docker
 * command, and the studio always builds from a checkout, which between
 * releases is a -SNAPSHOT no image exists for. What the published site says
 * is the tag the command block itself falls back to: the release, or `latest`.
 */
export {
  dockerImageTag as softwareVersion,
  dockerImageTag as softwareVersionLabel,
} from "../../../../packages/ui/src/components/docker-run-data";
