/** pg-boss queue that carries "a source finished ingesting" jobs to the matching engine. */
export const INQUIRY_MATCH_QUEUE = 'inquiry.match.source';

/**
 * Coalescing window for the per-scan matching job. Paired with the source's
 * `singletonKey` as `singletonSeconds` — pg-boss 12 leaves `singleton_on` null
 * without it, and the dedupe index is partial on that column, so a lone
 * `singletonKey` does nothing. Mirrors CORRELATION_SCAN_COALESCE_SECONDS: both
 * jobs are enqueued from the same scan-completion hook and there is no reason
 * for them to debounce differently.
 */
export const INQUIRY_MATCH_COALESCE_SECONDS = 60;

export interface InquiryMatchJob {
  sourceId: string;
  runnerId?: string;
}
