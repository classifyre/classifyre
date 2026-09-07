/**
 * Re-export of the shared status vocabulary.
 *
 * The definition lives in `@workspace/ui` so the UI package's own badges
 * (`StatusBadge`, `ToneBadge`) can read the same scale the app does. This file
 * exists only so app-side imports stay short; there is no second definition.
 */
export {
  STATUS_TONE,
  statusBadgeClass,
  toneClass,
  type StatusTone,
} from "@workspace/ui/lib/status-tone";
