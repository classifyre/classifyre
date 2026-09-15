/**
 * The key a regex pattern is stored under. The scanner names every finding of
 * the pattern `regex:<key>`, so the key is the finding's identity.
 *
 * Case is preserved. Lowercasing here renamed every API-authored pattern on an
 * unrelated save (`AT_FIRMENBUCHNUMMER` became `at_firmenbuchnummer`): the
 * next scan saw each existing finding as gone and each re-detection as new,
 * losing its status and history.
 */
export function regexPatternKey(name: string): string {
  return name.trim().replace(/\s+/g, "_");
}
