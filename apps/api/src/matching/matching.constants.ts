/** pg-boss queue that carries "a source finished ingesting" jobs to the matching engine. */
export const INQUIRY_MATCH_QUEUE = 'inquiry.match.source';

export interface InquiryMatchJob {
  sourceId: string;
  runnerId?: string;
}
