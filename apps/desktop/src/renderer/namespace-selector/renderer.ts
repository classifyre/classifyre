interface Namespace {
  id: string;
  name: string;
  type?: 'local' | 'remote';
  schemaName: string;
  remoteUrl?: string;
  createdAt: string;
  lastOpenedAt: string;
  apiPort?: number;
  maxParallelScans?: number;
  memoryLimitMb?: number;
  env?: Record<string, string>;
}

interface AppSettings {
  postgresPort: number;
  runInBackground: boolean;
}

interface ElectronAPI {
  listNamespaces(): Promise<Namespace[]>;
  createNamespace(name: string, remoteUrl?: string): Promise<Namespace>;
  deleteNamespace(id: string): Promise<void>;
  updateNamespace(id: string, patch: Record<string, unknown>): Promise<Namespace>;
  openNamespace(id: string, options?: { activate?: boolean }): Promise<{ apiPort: number; namespaceId: string }>;
  closeNamespace(id: string): Promise<void>;
  isNamespaceOpen(id: string): Promise<boolean>;
  getNamespaceThumbnail(id: string): Promise<string | null>;
  onOpenProgress(cb: (data: { namespaceId: string; stage: string }) => void): void;
  onNamespaceStateChanged(cb: () => void): void;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getApiPort(namespaceId: string): Promise<number | null>;
  selectFolder(): Promise<{ canceled: boolean; path: string | null }>;
}

const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const listEl = el<HTMLDivElement>('namespace-list');
const emptyStateEl = el<HTMLDivElement>('empty-state');
const newSection = el<HTMLDivElement>('new-workspace-section');
const newWorkspaceBtn = el<HTMLButtonElement>('new-workspace-btn');

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function cleanIpcError(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method[^:]*:\s*(Error:\s*)?/, '');
}

// ---------- The case-opening ritual (real progress, quirky copy) ----------
//
// Stages arrive from the main process as the open actually advances
// (db → schema → migrate → api → interface → done/error), so the bar tells
// the truth — the copy just refuses to say "running migrations".

const STAGE_COPY: Record<string, { label: string; target: number }> = {
  db: { label: 'Unlocking the archive room…', target: 14 },
  schema: { label: 'Opening a fresh case file…', target: 26 },
  migrate: { label: 'Stamping the paperwork…', target: 45 },
  api: { label: 'Briefing the detectives…', target: 72 },
  interface: { label: 'Pinning red string to the corkboard…', target: 97 },
};

// The interface stage is the long one — keep morale up while the bar creeps.
const STAKEOUT_QUIPS = [
  'Polishing the magnifying glass…',
  'Brewing stakeout coffee…',
  'Dusting for fingerprints…',
  'Interviewing the witnesses…',
  'Following a hunch…',
  'Squinting at the evidence…',
  'Rearranging the corkboard…',
];

interface OpeningState {
  stage: string;
  value: number;
  target: number;
  quipIndex: number;
  creepTimer: number;
  quipTimer: number;
}

const openingCards = new Map<string, OpeningState>();

function stopOpening(id: string): void {
  const state = openingCards.get(id);
  if (!state) return;
  clearInterval(state.creepTimer);
  clearInterval(state.quipTimer);
  openingCards.delete(id);
}

function paintProgress(id: string): void {
  const state = openingCards.get(id);
  if (!state) return;
  const card = listEl.querySelector<HTMLElement>(`.namespace-item[data-id="${id}"]`);
  if (!card) return;
  const fill = card.querySelector<HTMLElement>('.progress-fill');
  const step = card.querySelector<HTMLElement>('.loading-step');
  const substep = card.querySelector<HTMLElement>('.progress-substep');
  if (fill) fill.style.width = `${Math.min(state.value, 100)}%`;
  if (step) step.textContent = STAGE_COPY[state.stage]?.label ?? 'On the case…';
  if (substep) {
    substep.textContent =
      state.stage === 'api' || state.stage === 'interface'
        ? STAKEOUT_QUIPS[state.quipIndex % STAKEOUT_QUIPS.length]!
        : '';
  }
}

function beginOpening(id: string): void {
  if (openingCards.has(id)) return;
  const state: OpeningState = {
    stage: 'db',
    value: 2,
    target: STAGE_COPY['db']!.target,
    quipIndex: Math.floor(Math.random() * STAKEOUT_QUIPS.length),
    // Asymptotic creep toward the current stage target: always moving, never
    // arriving — the perception of progress for the stages that block.
    creepTimer: window.setInterval(() => {
      state.value += Math.max((state.target - state.value) * 0.06, 0.02);
      paintProgress(id);
    }, 250),
    quipTimer: window.setInterval(() => {
      state.quipIndex++;
      paintProgress(id);
    }, 2600),
  };
  openingCards.set(id, state);
  const card = listEl.querySelector<HTMLElement>(`.namespace-item[data-id="${id}"]`);
  if (card && !card.querySelector('.card-progress')) {
    card.classList.add('opening');
    card.insertAdjacentHTML('beforeend', progressOverlayHtml());
  }
  paintProgress(id);
}

function progressOverlayHtml(): string {
  return `
    <div class="card-progress">
      <div class="progress-glyph">🔎</div>
      <div class="loading-step"></div>
      <div class="progress-track"><div class="progress-fill"></div></div>
      <div class="progress-substep"></div>
    </div>
  `;
}

api.onOpenProgress(({ namespaceId, stage }) => {
  if (stage === 'done') {
    stopOpening(namespaceId);
    void render();
    return;
  }
  if (stage === 'error') {
    stopOpening(namespaceId);
    void render();
    return;
  }
  // Covers opens started anywhere (card click, tray, menu, session restore).
  beginOpening(namespaceId);
  const state = openingCards.get(namespaceId)!;
  state.stage = stage;
  const copy = STAGE_COPY[stage];
  if (copy) {
    state.target = copy.target;
    // Jump most of the way to the previous target so stage changes feel real.
    state.value = Math.max(state.value, copy.target - Math.max(copy.target * 0.25, 6));
  }
  paintProgress(namespaceId);
});

// ---------- Metadata formatting ----------

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------- Grid rendering ----------

async function render(): Promise<void> {
  const namespaces = await api.listNamespaces();

  newSection.classList.remove('hidden');

  if (namespaces.length === 0) {
    listEl.innerHTML = '';
    emptyStateEl.classList.remove('hidden');
    // First run: open the create dialog straight away, nothing to cancel to.
    openCreateDialog({ cancelable: false });
    return;
  }

  emptyStateEl.classList.add('hidden');
  createCancelBtn.classList.remove('hidden');
  createCloseBtn.classList.remove('hidden');

  const details = await Promise.all(
    namespaces.map(async (ns) => {
      const isOpen = await api.isNamespaceOpen(ns.id);
      // The live port matters: without a fixed apiPort it's allocated per
      // start, and it's the address MCP clients must use.
      const livePort = isOpen ? await api.getApiPort(ns.id) : null;
      const thumbnail = await api.getNamespaceThumbnail(ns.id);
      return { id: ns.id, isOpen, livePort, thumbnail };
    }),
  );
  const detailMap = new Map(details.map((d) => [d.id, d]));

  const sorted = [...namespaces].sort((a, b) => {
    const aOpen = detailMap.get(a.id)?.isOpen ? 1 : 0;
    const bOpen = detailMap.get(b.id)?.isOpen ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime();
  });

  listEl.innerHTML = sorted.map((ns) => cardHtml(ns, detailMap.get(ns.id))).join('');

  // Re-attach progress overlays for cards that are mid-open (e.g. a re-render
  // triggered while session restore is working through the list).
  for (const id of openingCards.keys()) {
    const card = listEl.querySelector<HTMLElement>(`.namespace-item[data-id="${id}"]`);
    if (card) {
      card.classList.add('opening');
      card.insertAdjacentHTML('beforeend', progressOverlayHtml());
      paintProgress(id);
    }
  }
}

function cardHtml(
  ns: Namespace,
  detail: { isOpen: boolean; livePort: number | null; thumbnail: string | null } | undefined,
): string {
  const isOpen = detail?.isOpen ?? false;
  const isRemote = ns.type === 'remote';
  const initial = (ns.name.trim()[0] ?? '?').toUpperCase();

  const thumb = detail?.thumbnail
    ? `<img src="${detail.thumbnail}" alt="" />`
    : `<div class="thumb-fallback${isRemote ? ' remote-thumb' : ''}"><span class="thumb-initial">${escapeHtml(initial)}</span></div>`;

  const metaRows: string[] = [];
  metaRows.push(
    `<div class="meta-row"><span class="meta-label">Last opened</span><span class="meta-value">${escapeHtml(relativeTime(ns.lastOpenedAt))}</span></div>`,
  );
  if (isRemote) {
    metaRows.push(
      `<div class="meta-row"><span class="meta-label">Server</span><span class="meta-value mono">${escapeHtml(ns.remoteUrl || '')}</span></div>`,
    );
  } else if (isOpen && detail?.livePort) {
    metaRows.push(
      `<div class="meta-row"><span class="meta-label">API</span><span class="meta-value mono accent">http://127.0.0.1:${detail.livePort}</span></div>`,
    );
  } else if (ns.apiPort) {
    metaRows.push(
      `<div class="meta-row"><span class="meta-label">API</span><span class="meta-value mono">port ${ns.apiPort} (fixed)</span></div>`,
    );
  }
  const envCount = ns.env ? Object.keys(ns.env).length : 0;
  if (envCount > 0) {
    metaRows.push(
      `<div class="meta-row"><span class="meta-label">Env</span><span class="meta-value mono">${envCount} custom variable${envCount === 1 ? '' : 's'}</span></div>`,
    );
  }

  return `
    <div class="namespace-item${isOpen ? ' running' : ''}" data-id="${ns.id}" role="button" tabindex="0"
         aria-label="Open workspace ${escapeHtml(ns.name)}">
      <div class="card-thumb">
        ${thumb}
        <span class="card-stamp${isOpen ? ' active' : ''}">${isOpen ? 'Active' : 'On ice'}</span>
      </div>
      <div class="card-body">
        <div class="namespace-name">
          <span class="status-dot ${isOpen ? '' : 'closed'}"></span>
          <span class="name-text">${escapeHtml(ns.name)}</span>
          <span class="type-badge ${isRemote ? 'remote' : 'local'}">${isRemote ? 'remote' : 'local'}</span>
        </div>
        <div class="namespace-meta">${metaRows.join('')}</div>
      </div>
      <div class="card-footer">
        <div class="footer-left">
          <button class="power-switch${isOpen ? ' on' : ''}" data-action="power" data-id="${ns.id}"
                  title="${isOpen ? 'Shut down workspace' : 'Start workspace in background'}"
                  aria-label="${isOpen ? 'Shut down workspace' : 'Start workspace'}" aria-pressed="${isOpen}">
            <span class="power-track"><span class="power-knob"></span></span>
            <span class="power-label">${isOpen ? 'On' : 'Off'}</span>
          </button>
        </div>
        <div class="footer-right">
          <span class="open-hint">${isOpen ? 'Switch to' : 'Open'} →</span>
          <button class="icon-btn" data-action="settings" data-id="${ns.id}" title="Workspace settings" aria-label="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ---------- Opening & power toggling ----------

function showOpenError(id: string, message: string): void {
  const card = listEl.querySelector<HTMLElement>(`.namespace-item[data-id="${id}"]`);
  if (!card) return;
  let errEl = card.querySelector('.open-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'open-error';
    card.querySelector('.card-body')?.appendChild(errEl);
  }
  errEl.textContent = message;
}

async function openNamespace(id: string, activate = true): Promise<void> {
  if (openingCards.has(id)) return;
  beginOpening(id);
  try {
    await api.openNamespace(id, { activate });
    stopOpening(id);
    await render();
  } catch (err) {
    stopOpening(id);
    await render();
    showOpenError(id, cleanIpcError(err));
  }
}

async function togglePower(id: string, button: HTMLButtonElement): Promise<void> {
  if (openingCards.has(id)) return;
  const isOpen = await api.isNamespaceOpen(id);
  if (isOpen) {
    button.disabled = true;
    try {
      await api.closeNamespace(id);
    } finally {
      await render();
    }
  } else {
    // Power on in the background — the user stays on the board.
    await openNamespace(id, false);
  }
}

listEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLElement>('[data-action]');
  const item = target.closest<HTMLElement>('.namespace-item');
  if (!item) return;
  const id = item.dataset['id'];
  if (!id) return;

  if (btn) {
    const action = btn.dataset['action'];
    if (action === 'settings') {
      void openSettings(id);
    } else if (action === 'power') {
      void togglePower(id, btn as HTMLButtonElement);
    }
    return;
  }

  void openNamespace(id);
});

listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = (e.target as HTMLElement).closest<HTMLElement>('.namespace-item');
  if (!item || item !== e.target) return;
  e.preventDefault();
  const id = item.dataset['id'];
  if (id) void openNamespace(id);
});

async function confirmDelete(id: string): Promise<void> {
  const ns = (await api.listNamespaces()).find((n) => n.id === id);
  if (!ns) return;
  if (confirm(`Delete workspace "${ns.name}"? This removes its local data and cannot be undone.`)) {
    await api.deleteNamespace(id);
    await render();
  }
}

// ---------- New-workspace dialog ----------

const createOverlay = el<HTMLDivElement>('create-overlay');
const createCloseBtn = el<HTMLButtonElement>('create-close');
const createCancelBtn = el<HTMLButtonElement>('create-cancel');
const createBtn = el<HTMLButtonElement>('create-btn');
const createError = el<HTMLDivElement>('create-error');
const segmentLocal = el<HTMLButtonElement>('segment-local');
const segmentRemote = el<HTMLButtonElement>('segment-remote');
const localFields = el<HTMLDivElement>('create-local-fields');
const remoteFields = el<HTMLDivElement>('create-remote-fields');
const nameInput = el<HTMLInputElement>('new-name');
const remoteUrlInput = el<HTMLInputElement>('remote-url');

let createMode: 'local' | 'remote' = 'local';

function setCreateMode(mode: 'local' | 'remote'): void {
  createMode = mode;
  segmentLocal.classList.toggle('active', mode === 'local');
  segmentLocal.setAttribute('aria-selected', String(mode === 'local'));
  segmentRemote.classList.toggle('active', mode === 'remote');
  segmentRemote.setAttribute('aria-selected', String(mode === 'remote'));
  localFields.classList.toggle('hidden', mode !== 'local');
  remoteFields.classList.toggle('hidden', mode !== 'remote');
  createError.classList.add('hidden');
  (mode === 'local' ? nameInput : remoteUrlInput).focus();
}

function openCreateDialog(options: { cancelable?: boolean } = {}): void {
  const cancelable = options.cancelable !== false;
  createCancelBtn.classList.toggle('hidden', !cancelable);
  createCloseBtn.classList.toggle('hidden', !cancelable);
  createOverlay.classList.remove('hidden');
  setCreateMode('local');
}

function closeCreateDialog(): void {
  createOverlay.classList.add('hidden');
  createError.classList.add('hidden');
  nameInput.value = '';
  remoteUrlInput.value = '';
}

newWorkspaceBtn.addEventListener('click', () => openCreateDialog());
segmentLocal.addEventListener('click', () => setCreateMode('local'));
segmentRemote.addEventListener('click', () => setCreateMode('remote'));
createCancelBtn.addEventListener('click', closeCreateDialog);
createCloseBtn.addEventListener('click', closeCreateDialog);
createOverlay.addEventListener('click', (e) => {
  if (e.target === createOverlay && !createCancelBtn.classList.contains('hidden')) {
    closeCreateDialog();
  }
});

function showCreateError(message: string): void {
  createError.textContent = message;
  createError.classList.remove('hidden');
}

function isValidRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Mirrors the main process (assertValidRemoteUrl): https required, http
    // allowed only for loopback hosts.
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost') ||
      /^127(\.\d{1,3}){3}$/.test(parsed.hostname) ||
      parsed.hostname === '[::1]';
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback);
  } catch {
    return false;
  }
}

// Create, then go straight into the new case — save, activate, and open.
createBtn.addEventListener('click', async () => {
  createError.classList.add('hidden');

  let created: Namespace;
  createBtn.setAttribute('disabled', '');
  try {
    if (createMode === 'local') {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      created = await api.createNamespace(name);
    } else {
      const url = remoteUrlInput.value.trim();
      if (!isValidRemoteUrl(url)) {
        remoteUrlInput.classList.add('input-error');
        showCreateError('Enter a valid https:// URL (http:// is only allowed for localhost).');
        return;
      }
      const hostname = new URL(url).hostname;
      const name = hostname.replace(/^(www|demo|app)\./, '').split('.')[0] || hostname;
      created = await api.createNamespace(name, url);
    }
  } catch (err) {
    showCreateError(cleanIpcError(err));
    return;
  } finally {
    createBtn.removeAttribute('disabled');
  }

  closeCreateDialog();
  await render();
  await openNamespace(created.id);
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});
remoteUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});
remoteUrlInput.addEventListener('input', () => {
  remoteUrlInput.classList.remove('input-error');
});

// ---------- Settings modal ----------

const settingsOverlay = el<HTMLDivElement>('settings-overlay');
const settingsName = el<HTMLInputElement>('settings-name');
const settingsRemoteUrlField = el<HTMLLabelElement>('settings-remote-url-field');
const settingsRemoteUrl = el<HTMLInputElement>('settings-remote-url');
const settingsLocalFields = el<HTMLDivElement>('settings-local-fields');
const settingsApiPort = el<HTMLInputElement>('settings-api-port');
const settingsMaxScans = el<HTMLInputElement>('settings-max-scans');
const settingsMemory = el<HTMLInputElement>('settings-memory');
const settingsDbPort = el<HTMLInputElement>('settings-db-port');
const settingsError = el<HTMLDivElement>('settings-error');
const settingsRestartHint = el<HTMLDivElement>('settings-restart-hint');
const settingsSaveBtn = el<HTMLButtonElement>('settings-save');
const envRowsEl = el<HTMLDivElement>('env-rows');
const envAddBtn = el<HTMLButtonElement>('env-add');

let settingsNamespaceId: string | null = null;
let settingsWasOpen = false;
let savedEnvJson = '{}';

// Mirrors RESERVED_ENV_KEYS in the main process for instant feedback; the
// main process re-validates on save either way.
const RESERVED_ENV_KEYS = new Set([
  'PORT', 'DATABASE_URL', 'PATH', 'NODE_ENV', 'ENVIRONMENT', 'ELECTRON_RUN_AS_NODE',
  'CLASSIFYRE_AUTO_MIGRATE', 'CLASSIFYRE_MASKED_CONFIG_KEY', 'CLI_PATH', 'VENV_PATH',
  'UV_PROJECT_ENVIRONMENT', 'UV_CACHE_DIR', 'RUNNER_LOG_DIR', 'CORS_ORIGIN',
]);

function addEnvRow(key = '', value = ''): void {
  const row = document.createElement('div');
  row.className = 'env-row';
  row.innerHTML = `
    <input type="text" class="env-key" list="env-suggestions" placeholder="EMBEDDING_MODEL" maxlength="64" autocomplete="off" spellcheck="false" />
    <input type="text" class="env-value" placeholder="value" maxlength="4096" autocomplete="off" spellcheck="false" />
    <button class="env-remove" title="Remove variable" aria-label="Remove variable">×</button>
  `;
  const keyInput = row.querySelector<HTMLInputElement>('.env-key')!;
  const valueInput = row.querySelector<HTMLInputElement>('.env-value')!;
  keyInput.value = key;
  valueInput.value = value;
  keyInput.addEventListener('input', () => keyInput.classList.remove('input-error'));
  row.querySelector<HTMLButtonElement>('.env-remove')!.addEventListener('click', () => row.remove());
  envRowsEl.appendChild(row);
}

function collectEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const row of envRowsEl.querySelectorAll<HTMLElement>('.env-row')) {
    const keyInput = row.querySelector<HTMLInputElement>('.env-key')!;
    const key = keyInput.value.trim();
    const value = row.querySelector<HTMLInputElement>('.env-value')!.value;
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || RESERVED_ENV_KEYS.has(key.toUpperCase())) {
      keyInput.classList.add('input-error');
      throw new Error(
        RESERVED_ENV_KEYS.has(key.toUpperCase())
          ? `"${key}" is managed by the app and cannot be overridden`
          : `Invalid environment variable name: "${key}"`,
      );
    }
    if (key in env) {
      keyInput.classList.add('input-error');
      throw new Error(`Duplicate environment variable: "${key}"`);
    }
    env[key] = value;
  }
  return env;
}

envAddBtn.addEventListener('click', () => {
  addEnvRow();
  envRowsEl.querySelector<HTMLInputElement>('.env-row:last-child .env-key')?.focus();
});

async function openSettings(id: string): Promise<void> {
  const ns = (await api.listNamespaces()).find((n) => n.id === id);
  if (!ns) return;
  settingsNamespaceId = id;

  const isRemote = ns.type === 'remote';
  settingsName.value = ns.name;
  settingsRemoteUrlField.classList.toggle('hidden', !isRemote);
  settingsRemoteUrl.value = ns.remoteUrl ?? '';
  settingsLocalFields.classList.toggle('hidden', isRemote);
  settingsApiPort.value = ns.apiPort ? String(ns.apiPort) : '';
  settingsMaxScans.value = ns.maxParallelScans ? String(ns.maxParallelScans) : '';
  settingsMemory.value = ns.memoryLimitMb ? String(ns.memoryLimitMb) : '';

  envRowsEl.innerHTML = '';
  const env = ns.env ?? {};
  savedEnvJson = JSON.stringify(env);
  for (const [key, value] of Object.entries(env)) {
    addEnvRow(key, value);
  }

  try {
    const settings = await api.getSettings();
    settingsDbPort.value = String(settings.postgresPort);
  } catch {
    settingsDbPort.value = '';
  }

  settingsError.classList.add('hidden');
  settingsWasOpen = await api.isNamespaceOpen(id);
  settingsRestartHint.classList.toggle('hidden', !settingsWasOpen);
  settingsSaveBtn.textContent = settingsWasOpen ? 'Save & restart' : 'Save';

  settingsOverlay.classList.remove('hidden');
  settingsName.focus();
}

function closeSettings(): void {
  settingsOverlay.classList.add('hidden');
  settingsNamespaceId = null;
}

function parseOptionalInt(input: HTMLInputElement): number | null {
  const raw = input.value.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`Invalid number: ${raw}`);
  return value;
}

el<HTMLButtonElement>('settings-close').addEventListener('click', closeSettings);
el<HTMLButtonElement>('settings-cancel').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!settingsOverlay.classList.contains('hidden')) closeSettings();
  else if (
    !createOverlay.classList.contains('hidden') &&
    !createCancelBtn.classList.contains('hidden')
  ) {
    closeCreateDialog();
  }
});

el<HTMLButtonElement>('settings-delete').addEventListener('click', async () => {
  if (!settingsNamespaceId) return;
  const id = settingsNamespaceId;
  closeSettings();
  await confirmDelete(id);
});

settingsSaveBtn.addEventListener('click', async () => {
  if (!settingsNamespaceId) return;
  const id = settingsNamespaceId;

  settingsError.classList.add('hidden');
  let needsRestart = false;
  try {
    const ns = (await api.listNamespaces()).find((n) => n.id === id);
    if (!ns) throw new Error('Workspace no longer exists');
    const isRemote = ns.type === 'remote';

    const patch: Record<string, unknown> = { name: settingsName.value.trim() };
    if (isRemote) {
      patch['remoteUrl'] = settingsRemoteUrl.value.trim();
    } else {
      const env = collectEnv();
      patch['apiPort'] = parseOptionalInt(settingsApiPort);
      patch['maxParallelScans'] = parseOptionalInt(settingsMaxScans);
      patch['memoryLimitMb'] = parseOptionalInt(settingsMemory);
      patch['env'] = env;

      // Runtime-affecting change while running → the workspace has to bounce.
      needsRestart =
        settingsWasOpen &&
        (JSON.stringify(env) !== savedEnvJson ||
          (patch['apiPort'] ?? null) !== (ns.apiPort ?? null) ||
          (patch['maxParallelScans'] ?? null) !== (ns.maxParallelScans ?? null) ||
          (patch['memoryLimitMb'] ?? null) !== (ns.memoryLimitMb ?? null));
    }
    await api.updateNamespace(id, patch);

    const dbPort = parseOptionalInt(settingsDbPort);
    if (dbPort !== null) {
      await api.updateSettings({ postgresPort: dbPort });
    }
  } catch (err) {
    settingsError.textContent = cleanIpcError(err);
    settingsError.classList.remove('hidden');
    return;
  }

  closeSettings();

  if (needsRestart) {
    // Off and on again — the only way env/port changes reach the API process.
    try {
      await api.closeNamespace(id);
    } catch {
      // already stopped is fine
    }
    await render();
    await openNamespace(id, false);
  } else {
    await render();
  }
});

// ---------- Boot ----------

// Re-render when the main process reports a running-state change (e.g. a tab
// closed from the tab bar), so a card's power toggle can't stay stuck "On"
// after its workspace was shut down elsewhere. Debounced because a single tab
// switch fires several state-change notifications, and skipped while a card is
// mid-open so its progress overlay isn't interrupted.
let stateChangeTimer: number | undefined;
api.onNamespaceStateChanged(() => {
  if (openingCards.size > 0) return;
  window.clearTimeout(stateChangeTimer);
  stateChangeTimer = window.setTimeout(() => void render(), 150);
});

void render();
