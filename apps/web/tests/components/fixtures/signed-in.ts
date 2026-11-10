/**
 * Answers `GET /me` as a signed-in person holding `capabilities` in the
 * workspace, for components that show or run a control only for those who
 * may use it.
 */
export async function signedInAs(
  page: {
    route: (
      url: string,
      handler: (route: {
        fulfill: (response: {
          status: number;
          contentType: string;
          body: string;
        }) => Promise<void>;
      }) => unknown,
    ) => Promise<unknown>;
  },
  capabilities: string[],
): Promise<void> {
  await page.route("**/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actor: {
          id: "user:u1",
          displayName: "Ada Kowalczyk",
          kind: "person",
          via: "oidc",
        },
        capabilities,
      }),
    }),
  );
}
