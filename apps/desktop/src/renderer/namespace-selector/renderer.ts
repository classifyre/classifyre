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
  openNamespace(id: string): Promise<{ apiPort: number; namespaceId: string }>;
  isNamespaceOpen(id: string): Promise<boolean>;
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
const newSection = el<HTMLDivElement>('new-workspace-section');
const newWorkspaceBtn = el<HTMLButtonElement>('new-workspace-btn');
const createChooser = el<HTMLDivElement>('create-chooser');
const createLocalForm = el<HTMLDivElement>('create-local-form');
const createRemoteForm = el<HTMLDivElement>('create-remote-form');
const nameInput = el<HTMLInputElement>('new-name');
const createBtn = el<HTMLButtonElement>('create-btn');
const remoteUrlInput = el<HTMLInputElement>('remote-url');
const connectBtn = el<HTMLButtonElement>('connect-btn');

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- List rendering ----------

async function render(): Promise<void> {
  const namespaces = await api.listNamespaces();

  newSection.classList.remove('hidden');

  if (namespaces.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No workspaces yet — create your first one below.</div>';
    // First-run: skip the "+ New workspace" step and show the chooser inline.
    newWorkspaceBtn.classList.add('hidden');
    showPanel(createChooser);
    const cancel = el<HTMLButtonElement>('create-cancel');
    cancel.classList.add('hidden');
    return;
  }

  el<HTMLButtonElement>('create-cancel').classList.remove('hidden');

  const openChecks = await Promise.all(
    namespaces.map(async (ns) => {
      const isOpen = await api.isNamespaceOpen(ns.id);
      // The live port matters: without a fixed apiPort it's allocated per
      // start, and it's the address MCP clients must use.
      const livePort = isOpen ? await api.getApiPort(ns.id) : null;
      return { id: ns.id, isOpen, livePort };
    }),
  );
  const openMap = new Map(openChecks.map((c) => [c.id, c]));

  listEl.innerHTML = namespaces
    .map((ns) => {
      const check = openMap.get(ns.id);
      const isOpen = check?.isOpen ?? false;
      const isRemote = ns.type === 'remote';
      const date = new Date(ns.lastOpenedAt).toLocaleDateString();
      const typeBadge = isRemote
        ? '<span class="type-badge remote">remote</span>'
        : '<span class="type-badge local">local</span>';
      const meta = isRemote
        ? escapeHtml(ns.remoteUrl || '')
        : isOpen && check?.livePort
          ? `Running · API http://127.0.0.1:${check.livePort}`
          : `Last opened ${date}${ns.apiPort ? ` · API :${ns.apiPort}` : ''}`;
      return `
        <div class="namespace-item" data-id="${ns.id}" role="button" tabindex="0"
             aria-label="Open workspace">
          <div class="namespace-info">
            <div class="namespace-name">
              <span class="status-dot ${isOpen ? '' : 'closed'}"></span>
              <span class="name-text">${escapeHtml(ns.name)}</span> ${typeBadge}
            </div>
            <div class="namespace-meta">${meta}</div>
          </div>
          <div class="namespace-actions">
            <span class="open-hint">${isOpen ? 'Switch to' : 'Open'} →</span>
            <button class="icon-btn" data-action="settings" data-id="${ns.id}" title="Workspace settings" aria-label="Settings">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="icon-btn icon-btn-danger" data-action="delete" data-id="${ns.id}" title="Delete workspace" aria-label="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  newWorkspaceBtn.classList.remove('hidden');
}

// ---------- Opening (whole card is clickable) ----------

const LOADING_STEPS = [
  'Starting database…',
  'Creating schema…',
  'Running migrations…',
  'Starting API server…',
  'Waiting for API…',
  'Loading interface…',
];

function showLoading(item: HTMLElement): void {
  const actionsEl = item.querySelector('.namespace-actions');
  if (!actionsEl) return;

  actionsEl.innerHTML = `<div class="loading-indicator"><span class="loading-step">${LOADING_STEPS[0]}</span></div>`;

  let step = 0;
  const interval = setInterval(() => {
    step++;
    if (step >= LOADING_STEPS.length) {
      clearInterval(interval);
      return;
    }
    const stepEl = item.querySelector('.loading-step');
    if (stepEl) stepEl.textContent = LOADING_STEPS[step]!;
  }, 3000);

  item.dataset['loadingInterval'] = String(interval);
}

function clearLoading(item: HTMLElement): void {
  const interval = item.dataset['loadingInterval'];
  if (interval) clearInterval(Number(interval));
}

function showOpenError(item: HTMLElement, message: string): void {
  let errEl = item.querySelector('.open-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'open-error';
    item.querySelector('.namespace-info')?.appendChild(errEl);
  }
  errEl.textContent = message;
}

async function openNamespace(item: HTMLElement, id: string): Promise<void> {
  if (item.classList.contains('opening')) return;
  item.classList.add('opening');
  showLoading(item);
  try {
    await api.openNamespace(id);
    await render();
  } catch (err) {
    clearLoading(item);
    item.classList.remove('opening');
    await render();
    const fresh = listEl.querySelector<HTMLElement>(`.namespace-item[data-id="${id}"]`);
    if (fresh) {
      showOpenError(fresh, (err as Error).message.replace(/^Error invoking remote method[^:]*:\s*(Error:\s*)?/, ''));
    }
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
    } else if (action === 'delete') {
      void confirmDelete(id);
    }
    return;
  }

  void openNamespace(item, id);
});

listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = (e.target as HTMLElement).closest<HTMLElement>('.namespace-item');
  if (!item || item !== e.target) return;
  e.preventDefault();
  const id = item.dataset['id'];
  if (id) void openNamespace(item, id);
});

async function confirmDelete(id: string): Promise<void> {
  const ns = (await api.listNamespaces()).find((n) => n.id === id);
  if (!ns) return;
  if (confirm(`Delete workspace "${ns.name}"? This removes its local data and cannot be undone.`)) {
    await api.deleteNamespace(id);
    await render();
  }
}

// ---------- New-workspace flow ----------

function showPanel(panel: HTMLElement | null): void {
  for (const p of [createChooser, createLocalForm, createRemoteForm]) {
    p.classList.toggle('hidden', p !== panel);
  }
  newWorkspaceBtn.classList.toggle('hidden', panel !== null);
}

newWorkspaceBtn.addEventListener('click', () => showPanel(createChooser));
el<HTMLButtonElement>('create-cancel').addEventListener('click', () => showPanel(null));
el<HTMLButtonElement>('choose-local').addEventListener('click', () => {
  showPanel(createLocalForm);
  nameInput.focus();
});
el<HTMLButtonElement>('choose-remote').addEventListener('click', () => {
  showPanel(createRemoteForm);
  remoteUrlInput.focus();
});
el<HTMLButtonElement>('local-back').addEventListener('click', () => showPanel(createChooser));
el<HTMLButtonElement>('remote-back').addEventListener('click', () => showPanel(createChooser));

createBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) return;

  createBtn.setAttribute('disabled', '');
  try {
    await api.createNamespace(name);
    nameInput.value = '';
    showPanel(null);
    await render();
  } finally {
    createBtn.removeAttribute('disabled');
  }
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});

connectBtn.addEventListener('click', async () => {
  const url = remoteUrlInput.value.trim();
  if (!url) return;

  try {
    const parsed = new URL(url);
    // Mirrors the main process (assertValidRemoteUrl): https required, http
    // allowed only for loopback hosts.
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost') ||
      /^127(\.\d{1,3}){3}$/.test(parsed.hostname) ||
      parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      throw new Error('bad protocol');
    }
  } catch {
    remoteUrlInput.classList.add('input-error');
    return;
  }

  connectBtn.setAttribute('disabled', '');
  try {
    const hostname = new URL(url).hostname;
    const name = hostname.replace(/^(www|demo|app)\./, '').split('.')[0] || hostname;
    await api.createNamespace(name, url);
    remoteUrlInput.value = '';
    showPanel(null);
    await render();
  } catch {
    // Main-process validation rejected the URL — mirror the local error state.
    remoteUrlInput.classList.add('input-error');
  } finally {
    connectBtn.removeAttribute('disabled');
  }
});

remoteUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectBtn.click();
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

let settingsNamespaceId: string | null = null;

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

  try {
    const settings = await api.getSettings();
    settingsDbPort.value = String(settings.postgresPort);
  } catch {
    settingsDbPort.value = '';
  }

  settingsError.classList.add('hidden');
  const isOpen = await api.isNamespaceOpen(id);
  settingsRestartHint.classList.toggle('hidden', !isOpen);

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
  if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) closeSettings();
});

el<HTMLButtonElement>('settings-delete').addEventListener('click', async () => {
  if (!settingsNamespaceId) return;
  const id = settingsNamespaceId;
  closeSettings();
  await confirmDelete(id);
});

el<HTMLButtonElement>('settings-save').addEventListener('click', async () => {
  if (!settingsNamespaceId) return;

  settingsError.classList.add('hidden');
  try {
    const ns = (await api.listNamespaces()).find((n) => n.id === settingsNamespaceId);
    if (!ns) throw new Error('Workspace no longer exists');
    const isRemote = ns.type === 'remote';

    const patch: Record<string, unknown> = { name: settingsName.value.trim() };
    if (isRemote) {
      patch['remoteUrl'] = settingsRemoteUrl.value.trim();
    } else {
      patch['apiPort'] = parseOptionalInt(settingsApiPort);
      patch['maxParallelScans'] = parseOptionalInt(settingsMaxScans);
      patch['memoryLimitMb'] = parseOptionalInt(settingsMemory);
    }
    await api.updateNamespace(settingsNamespaceId, patch);

    const dbPort = parseOptionalInt(settingsDbPort);
    if (dbPort !== null) {
      await api.updateSettings({ postgresPort: dbPort });
    }

    closeSettings();
    await render();
  } catch (err) {
    settingsError.textContent = (err as Error).message.replace(
      /^Error invoking remote method[^:]*:\s*(Error:\s*)?/,
      '',
    );
    settingsError.classList.remove('hidden');
  }
});

void render();
