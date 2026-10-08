---
name: code-review
description: Review a proposed code change and return only actionable bug findings in a strict JSON schema. Use when the user asks for code review, patch review, PR review, diff review, or wants structured findings with priorities, confidence, file locations, and an overall correctness verdict.
---

# Code Review

Review the patch as another engineer's change. Report only issues that are discrete, actionable, introduced by the patch, and important enough that the author would likely fix them once notified.

## Review Standard

- Focus on bugs that materially affect correctness, performance, security, or maintainability.
- Ignore pre-existing issues unless the patch clearly makes them worse.
- Ignore trivial style, formatting, wording, and speculative concerns.
- Flag only issues you can tie to specific changed code and an identifiable failure mode.
- Prefer no findings over weak findings.
- Return all qualifying findings, not just the first one.

## Severity

- `P0` / `priority: 0`: release-blocking or universally severe
- `P1` / `priority: 1`: urgent, should be fixed in the next cycle
- `P2` / `priority: 2`: normal bug, should be fixed eventually
- `P3` / `priority: 3`: lower-priority but still worth fixing

Start every finding title with the priority tag, for example `[P1] Prevent stale cache reuse`.

## Comment Rules

- Keep each finding body to one paragraph.
- State why the issue is a bug and under what scenario it happens.
- Keep the tone matter-of-fact.
- Do not include long code excerpts.
- Do not provide a fix unless the caller explicitly asks for one.
- Keep line ranges tight and ensure the location overlaps the diff.
- Use one finding per distinct issue.

## Correctness Bar

Mark the patch as incorrect when at least one meaningful bug remains in the change. Mark it as correct only when the patch is free of actionable bugs under this review standard.

## Output

Return JSON only. Do not wrap it in markdown fences. Do not add prose before or after the JSON.

Use this schema exactly:

```json
{
  "findings": [
    {
      "title": "[P1] Example title",
      "body": "One-paragraph explanation of the bug and the scenario where it breaks.",
      "confidence_score": 0.91,
      "priority": 1,
      "code_location": {
        "absolute_file_path": "/abs/path/file.ext",
        "line_range": {"start": 10, "end": 12}
      }
    }
  ],
  "overall_correctness": "patch is correct",
  "overall_explanation": "Short justification of the verdict.",
  "overall_confidence_score": 0.88
}
```

## Review Process

1. Inspect the diff and changed files first.
2. Identify concrete regressions introduced by the patch.
3. Filter findings against the review standard.
4. Assign the narrowest useful line range in changed code.
5. Emit strict JSON with the final verdict.
