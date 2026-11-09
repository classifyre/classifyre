/**
 * Signs out: a POST to `/auth/logout/`, which refuses other sites' requests.
 * A plain link would let any page sign people out.
 */
export function signOut(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/logout/";
  document.body.append(form);
  form.submit();
}
