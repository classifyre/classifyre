// The settings window's entire view: markup, styles, and the script that binds
// it to the `settingsAPI` bridge the preload exposes. Kept free of Electron
// imports so the page can be rendered on its own.
//
// Deliberately plain: native form controls, the platform's own font stack, and
// nothing pulled from the web app's toolchain. This window has to be usable
// exactly when the rest of the app is not — a wrong port or a starved heap is
// what brings someone here — so it must not depend on the API, the Next
// export, or anything that has to be unpacked first.

export const SETTINGS_HTML = `
<meta charset="utf-8">
<title>Settings</title>
<style>
  :root {
    color-scheme: light dark;
    --background: #f5f5f5;
    --surface: #ffffff;
    --foreground: #0a0a0a;
    --muted: #5a5a5a;
    --border: #c8c8c8;
    --strong-border: #0a0a0a;
    --accent: #1c6feb;
    --warning: #8a5a00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #1c1c1e;
      --surface: #262628;
      --foreground: #f5f5f5;
      --muted: #a5a5a5;
      --border: #3d3d40;
      --strong-border: #f5f5f5;
      --accent: #4f9cff;
      --warning: #f0b429;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    background: var(--background);
    color: var(--foreground);
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  main { flex: 1; overflow-y: auto; padding: 18px 20px 8px; }
  section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 11px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .row { display: flex; align-items: baseline; gap: 10px; margin: 10px 0; }
  .row:first-of-type { margin-top: 0; }
  .row label.name { flex: 1 1 auto; }
  .check { display: flex; align-items: flex-start; gap: 8px; margin: 10px 0; }
  .check input { margin-top: 2px; }
  .hint { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
  .warn { color: var(--warning); font-size: 12px; margin: 4px 0 0; }
  .warn[hidden] { display: none; }
  input[type="number"], input[type="text"] {
    font: inherit;
    padding: 3px 6px;
    width: 110px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--background);
    color: var(--foreground);
  }
  input[readonly] { color: var(--muted); }
  .wide { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .effective { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .field { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; }
  .field > .line { display: flex; align-items: center; gap: 8px; }
  fieldset { border: 0; margin: 0; padding: 0; }
  fieldset[disabled] { opacity: .45; }
  button {
    font: inherit;
    padding: 4px 14px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--foreground);
    cursor: pointer;
  }
  button:hover { border-color: var(--strong-border); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.small { padding: 2px 9px; font-size: 12px; }
  footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  #status { flex: 1; color: var(--muted); font-size: 12px; }
  #status.error { color: #d92b2b; }
</style>

<main>
  <section>
    <h2>General</h2>
    <div class="check">
      <input type="checkbox" id="runInBackground">
      <label for="runInBackground">Keep running in the background when the window is closed</label>
    </div>
    <div class="check">
      <input type="checkbox" id="desktopNotifications">
      <label for="desktopNotifications">Show desktop notifications</label>
    </div>
  </section>

  <section>
    <h2>Performance</h2>
    <div class="field">
      <div class="line">
        <label class="name" for="memoryGb">Service memory limit</label>
        <input type="number" id="memoryGb" min="1" step="0.5">
        <span class="effective">GB</span>
      </div>
      <div class="check">
        <input type="checkbox" id="memoryAutomatic">
        <label for="memoryAutomatic">Size automatically (recommended)</label>
      </div>
      <p class="hint">
        A larger heap makes the service collect garbage less often, not more
        often — raise this only if a scan fails with an out-of-memory error.
      </p>
      <p class="warn" id="memoryWarning" hidden>
        Values above 4 GB are clamped: Electron will not grant a larger heap.
      </p>
    </div>
    <div class="field">
      <div class="line">
        <label class="name" for="maxConcurrentRunners">Concurrent scans</label>
        <input type="number" id="maxConcurrentRunners" min="0" max="16" step="1">
      </div>
      <p class="hint">
        How many scans may run at once across all workspaces. Scans are
        CPU-heavy: more at once sweeps a large corpus faster, fewer keeps the
        machine responsive. 0 means no limit.
      </p>
    </div>
  </section>

  <section>
    <h2>Ports</h2>
    <div class="field">
      <div class="line">
        <label class="name" for="apiPort">Service port</label>
        <input type="number" id="apiPort" min="0" max="65535" step="1">
        <span class="effective" id="apiPortEffective"></span>
      </div>
      <p class="hint">0 picks any free port. Set one to point external tools at the local service.</p>
    </div>
    <div class="field">
      <div class="line">
        <label class="name" for="postgresPort">Database port</label>
        <input type="number" id="postgresPort" min="1024" max="65535" step="1">
        <span class="effective" id="postgresPortEffective"></span>
      </div>
      <p class="hint">If the port is already taken, the app moves to the next free one.</p>
    </div>
  </section>

  <section>
    <h2>Database access</h2>
    <div class="check">
      <input type="checkbox" id="readonlyDbEnabled">
      <label for="readonlyDbEnabled">Publish a read-only database login</label>
    </div>
    <p class="hint">
      Lets a reporting or SQL tool read the scanned data without the account
      that can also change it. The login can only read.
    </p>
    <p class="warn" id="readonlyWarning" hidden>
      This also opens the database port to other machines on your network.
      Only the read-only login may connect from off this machine.
    </p>
    <fieldset id="readonlyDetails" disabled>
      <div class="field">
        <div class="line">
          <label class="name" for="readonlyUrl">Connection URL</label>
        </div>
        <input type="text" class="wide" id="readonlyUrl" readonly>
        <div class="line">
          <button type="button" class="small" id="copyUrl">Copy</button>
          <button type="button" class="small" id="revealUrl">Show password</button>
          <button type="button" class="small" id="regenerate">Regenerate password</button>
        </div>
        <p class="hint" id="readonlyPending" hidden>
          The login is created the next time Classifyre starts.
        </p>
      </div>
    </fieldset>
  </section>
</main>

<footer>
  <span id="status">Some settings apply after a restart.</span>
  <button type="button" id="cancel">Cancel</button>
  <button type="button" class="primary" id="save">Save</button>
</footer>

<script>
  var api = window.settingsAPI;
  var readonlyInfo = null;
  var revealed = false;

  function el(id) { return document.getElementById(id); }

  function maskUrl(url) {
    return url.replace(/:\\/\\/([^:]+):[^@]+@/, '://$1:' + '\\u2022'.repeat(12) + '@');
  }

  function renderReadonly() {
    var on = el('readonlyDbEnabled').checked;
    el('readonlyWarning').hidden = !on;
    el('readonlyDetails').disabled = !on;
    var pending = on && !readonlyInfo;
    el('readonlyPending').hidden = !pending;
    el('readonlyUrl').value = readonlyInfo
      ? (revealed ? readonlyInfo.connectionString : maskUrl(readonlyInfo.connectionString))
      : '';
    el('revealUrl').textContent = revealed ? 'Hide password' : 'Show password';
  }

  function renderMemory() {
    var automatic = el('memoryAutomatic').checked;
    el('memoryGb').disabled = automatic;
    el('memoryWarning').hidden = automatic || Number(el('memoryGb').value) <= 4;
  }

  function setStatus(message, isError) {
    var node = el('status');
    node.textContent = message;
    node.className = isError ? 'error' : '';
  }

  function render(state) {
    readonlyInfo = state.readonly;
    el('runInBackground').checked = state.settings.runInBackground;
    el('desktopNotifications').checked = state.settings.desktopNotifications;
    el('memoryAutomatic').checked = state.settings.memoryLimitMb === 0;
    el('memoryGb').value = String(
      state.settings.memoryLimitMb > 0 ? state.settings.memoryLimitMb / 1024 : 2
    );
    el('maxConcurrentRunners').value = String(state.settings.maxConcurrentRunners);
    el('apiPort').value = String(state.settings.apiPort);
    el('postgresPort').value = String(state.settings.postgresPort);
    el('readonlyDbEnabled').checked = state.settings.readonlyDbEnabled;
    el('apiPortEffective').textContent = 'in use: ' + state.effective.apiPort;
    el('postgresPortEffective').textContent = 'in use: ' + state.effective.postgresPort;
    renderMemory();
    renderReadonly();
  }

  function collect() {
    var automatic = el('memoryAutomatic').checked;
    var gb = Number(el('memoryGb').value);
    return {
      runInBackground: el('runInBackground').checked,
      desktopNotifications: el('desktopNotifications').checked,
      memoryLimitMb: automatic ? 0 : Math.round(gb * 1024),
      maxConcurrentRunners: Number(el('maxConcurrentRunners').value),
      apiPort: Number(el('apiPort').value),
      postgresPort: Number(el('postgresPort').value),
      readonlyDbEnabled: el('readonlyDbEnabled').checked
    };
  }

  el('memoryAutomatic').addEventListener('change', renderMemory);
  el('memoryGb').addEventListener('input', renderMemory);
  el('readonlyDbEnabled').addEventListener('change', renderReadonly);

  el('revealUrl').addEventListener('click', function () {
    revealed = !revealed;
    renderReadonly();
  });

  el('copyUrl').addEventListener('click', function () {
    if (!readonlyInfo) return;
    api.copy(readonlyInfo.connectionString);
    setStatus('Connection URL copied to the clipboard.', false);
  });

  el('regenerate').addEventListener('click', function () {
    setStatus('Issuing a new password\\u2026', false);
    api.regenerateReadonly().then(function (info) {
      readonlyInfo = info;
      renderReadonly();
      setStatus('New password issued. Existing connections keep working until they reconnect.', false);
    }).catch(function (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    });
  });

  el('cancel').addEventListener('click', function () { api.close(); });

  el('save').addEventListener('click', function () {
    setStatus('Saving\\u2026', false);
    api.save(collect()).then(function (result) {
      if (result.error) {
        setStatus(result.error, true);
        return;
      }
      // The main process owns the restart prompt and closes this window.
      setStatus('Saved.', false);
    }).catch(function (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    });
  });

  api.load().then(render).catch(function (error) {
    setStatus(String(error && error.message ? error.message : error), true);
  });
</script>
`;
