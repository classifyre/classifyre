# Smoke test

One Playwright test of a release with sign-in on, run by the smoke deploy
(`.github/workflows/develop.yml`, release `classifyre-develop`) after every
push to `develop`:

1. Nothing answers without signing in.
2. An admin signs in, creates a workspace in the UI.
3. A local folder source scans a mounted file (`docker/fixtures/smoke`), and
   the file shows up as an asset with at least one finding.
4. A viewer does not see the workspace until the admin gives their group the
   viewer role on it; then they see and read it, and cannot change it.
5. SQL over tables is off until the admin turns it on; then the admin queries
   the fixture's `orders.csv` on the SQL page, exports it to Excel and CSV, and
   is refused a file read. The viewer sees the table locked until their group
   gets the Data reader role on that one table, then queries it from the
   asset's Data tab, and cannot export it.

Selectors are `data-testid` attributes or the identity server's own form ids,
never visible text, so translations cannot break it.

## Run it against the local dev stack

The dev stack must run with sign-in (`CLASSIFYRE_IAM=true ./scripts/dev/start.sh`)
and the web app on `localhost:3000`.

```bash
NS=classifyre-dev RELEASE=classifyre BASE_URL=http://localhost:3000 scripts/smoke/seed.sh
cd apps/e2e && npx playwright install chromium && npx playwright test
NS=classifyre-dev RELEASE=classifyre scripts/smoke/teardown.sh
```

`seed.sh` makes the ConfigMap with the file (mounted into scan jobs at
`/mnt/corpora/smoke` by `api.localFolders`), two people in the identity server
(`smoke-admin` in the tenant's `admins` group, `smoke-viewer` in a new
`smoke-viewers` group) with new passwords, and writes `apps/e2e/.env`. The test
deletes its workspace; `teardown.sh` removes the rest.

## In CI

The smoke deploy destroys any previous `classifyre-develop` release, installs
it fresh with sign-in, seeds it, runs the test, and then destroys the release
with its database (`scripts/smoke/destroy.sh`), so every run starts empty and
nothing stays on the node it shares with production. Run it by hand with
**Actions → Deploy Image** (`keep_running: true` leaves the release up).
