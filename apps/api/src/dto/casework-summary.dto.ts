import { ApiProperty } from '@nestjs/swagger';
import { CaseStatus, Severity } from '@prisma/client';

export class CaseworkCaseStatusBreakdownDto {
  @ApiProperty()
  open: number;

  @ApiProperty()
  inProgress: number;

  @ApiProperty()
  closed: number;

  @ApiProperty()
  archived: number;
}

export class CaseworkCaseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: CaseStatus })
  status: CaseStatus;

  @ApiProperty({
    enum: Severity,
    description:
      "How much this case matters — a priority level, not a threat level. Distinct from a finding's importance score, which is the ranking pass's output.",
  })
  severity: Severity;

  @ApiProperty()
  evidenceCount: number;

  @ApiProperty()
  inquiryCount: number;

  @ApiProperty({ required: false, nullable: true })
  createdBy?: string | null;

  @ApiProperty()
  updatedAt: Date;
}

export class CaseworkCasesDto {
  @ApiProperty({ type: CaseworkCaseStatusBreakdownDto })
  byStatus: CaseworkCaseStatusBreakdownDto;

  @ApiProperty()
  total: number;

  @ApiProperty({
    type: [CaseworkCaseDto],
    description: 'The five most recently touched cases, newest first.',
  })
  recent: CaseworkCaseDto[];
}

export class CaseworkInquiryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  matchCount: number;

  @ApiProperty({
    description: 'Matches that appeared since the inquiry was last viewed.',
  })
  newMatchCount: number;

  @ApiProperty()
  updatedAt: Date;
}

export class CaseworkInquiryStatusBreakdownDto {
  @ApiProperty()
  active: number;

  @ApiProperty()
  archived: number;
}

export class CaseworkInquiriesDto {
  @ApiProperty({ type: CaseworkInquiryStatusBreakdownDto })
  byStatus: CaseworkInquiryStatusBreakdownDto;

  @ApiProperty()
  total: number;

  @ApiProperty({
    description:
      'Sum of newMatchCount across every inquiry — the single number that says whether anything has moved since you last looked.',
  })
  newMatchTotal: number;

  @ApiProperty({ type: [CaseworkInquiryDto] })
  withNewMatches: CaseworkInquiryDto[];
}

export class CaseworkLeadsDto {
  @ApiProperty({
    description: 'Leads proposed and not yet accepted or dismissed.',
  })
  proposed: number;
}

/**
 * Everything the dashboard needs to say what is being investigated right now.
 *
 * Deliberately a summary rather than a page of the case list: the dashboard
 * wants counts and the handful of most recent rows, and asking the list endpoint
 * for that would pull evidence and inquiry joins for rows nothing renders.
 */
export class CaseworkSummaryDto {
  @ApiProperty({ type: CaseworkCasesDto })
  cases: CaseworkCasesDto;

  @ApiProperty({ type: CaseworkInquiriesDto })
  inquiries: CaseworkInquiriesDto;

  @ApiProperty({ type: CaseworkLeadsDto })
  leads: CaseworkLeadsDto;
}
