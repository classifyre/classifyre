import {
  getCaseStatusBadgeLabel,
  getCaseStatusBadgeTone,
  getDataRequestStateBadgeLabel,
  getDataRequestStateBadgeTone,
} from "./case-status-badge";
import { STATUS_TONE } from "./status-tone";

describe("case-status-badge", () => {
  it("maps case statuses to labels and tones", () => {
    expect(getCaseStatusBadgeLabel("OPEN")).toBe("cases.statusLabels.OPEN");
    expect(getCaseStatusBadgeLabel("in_progress")).toBe(
      "cases.statusLabels.IN_PROGRESS",
    );
    expect(getCaseStatusBadgeLabel("CLOSED")).toBe("cases.statusLabels.CLOSED");
    expect(getCaseStatusBadgeLabel("ARCHIVED")).toBe(
      "cases.statusLabels.ARCHIVED",
    );
    expect(getCaseStatusBadgeLabel(null)).toBe("cases.statusLabels.OPEN");
    expect(getCaseStatusBadgeTone("CLOSED")).toBe(STATUS_TONE.done);
  });

  it("maps every data request state to its label and tone", () => {
    expect(getDataRequestStateBadgeLabel("DRAFT")).toBe(
      "cases.requestStates.DRAFT",
    );
    expect(getDataRequestStateBadgeLabel("SUBMITTED")).toBe(
      "cases.requestStates.SUBMITTED",
    );
    expect(getDataRequestStateBadgeLabel("IN_PROGRESS")).toBe(
      "cases.requestStates.IN_PROGRESS",
    );
    expect(getDataRequestStateBadgeLabel("CHANGES_REQUESTED")).toBe(
      "cases.requestStates.CHANGES_REQUESTED",
    );
    expect(getDataRequestStateBadgeLabel("DELIVERED")).toBe(
      "cases.requestStates.DELIVERED",
    );
    expect(getDataRequestStateBadgeLabel("DECLINED")).toBe(
      "cases.requestStates.DECLINED",
    );
    expect(getDataRequestStateBadgeLabel("WITHDRAWN")).toBe(
      "cases.requestStates.WITHDRAWN",
    );
    expect(getDataRequestStateBadgeLabel(undefined)).toBe(
      "cases.requestStates.DRAFT",
    );

    expect(getDataRequestStateBadgeTone("DRAFT")).toBe(STATUS_TONE.idle);
    expect(getDataRequestStateBadgeTone("SUBMITTED")).toBe(STATUS_TONE.fresh);
    expect(getDataRequestStateBadgeTone("IN_PROGRESS")).toBe(
      STATUS_TONE.progress,
    );
    expect(getDataRequestStateBadgeTone("CHANGES_REQUESTED")).toBe(
      STATUS_TONE.changed,
    );
    expect(getDataRequestStateBadgeTone("DELIVERED")).toBe(STATUS_TONE.done);
    expect(getDataRequestStateBadgeTone("DECLINED")).toBe(STATUS_TONE.error);
    expect(getDataRequestStateBadgeTone("WITHDRAWN")).toBe(
      STATUS_TONE.archived,
    );
  });
});
