interface Namespace {
  id: string;
  name: string;
  schemaName: string;
  createdAt: string;
  lastOpenedAt: string;
}

interface ElectronAPI {
  listNamespaces(): Promise<Namespace[]>;
  createNamespace(name: string, remoteUrl?: string): Promise<Namespace>;
  deleteNamespace(id: string): Promise<void>;
  openNamespace(id: string): Promise<{ apiPort: number; namespaceId: string }>;
  isNamespaceOpen(id: string): Promise<boolean>;
}

const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;

const listEl = document.getElementById('namespace-list')!;
const nameInput = document.getElementById('new-name') as HTMLInputElement;
const createBtn = document.getElementById('create-btn')!;
const remoteUrlInput = document.getElementById('remote-url') as HTMLInputElement;
const connectBtn = document.getElementById('connect-btn')!;

async function render(): Promise<void> {
  const namespaces = await api.listNamespaces();

  if (namespaces.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No workspaces yet. Create one below.</div>';
    return;
  }

  const openChecks = await Promise.all(
    namespaces.map(async (ns) => ({
      id: ns.id,
      isOpen: await api.isNamespaceOpen(ns.id),
    })),
  );
  const openMap = new Map(openChecks.map((c) => [c.id, c.isOpen]));

  listEl.innerHTML = namespaces
    .map((ns) => {
      const isOpen = openMap.get(ns.id) ?? false;
      const isRemote = (ns as any).type === 'remote';
      const date = new Date(ns.lastOpenedAt).toLocaleDateString();
      const typeBadge = isRemote
        ? '<span class="type-badge remote">remote</span>'
        : '<span class="type-badge local">local</span>';
      return `
        <div class="namespace-item" data-id="${ns.id}">
          <div class="namespace-info">
            <div class="namespace-name">
              <span class="status-dot ${isOpen ? '' : 'closed'}"></span>
              ${escapeHtml(ns.name)} ${typeBadge}
            </div>
            <div class="namespace-meta">${isRemote ? escapeHtml((ns as any).remoteUrl || '') : `Last opened ${date}`}</div>
          </div>
          <div class="namespace-actions">
            <button class="btn btn-open" data-action="open" data-id="${ns.id}">
              ${isOpen ? 'Focus' : isRemote ? 'Connect' : 'Open'}
            </button>
            <button class="btn btn-danger" data-action="delete" data-id="${ns.id}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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

listEl.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('[data-action]') as HTMLElement | null;
  if (!btn) return;

  const action = btn.dataset['action'];
  const id = btn.dataset['id'];
  if (!action || !id) return;

  if (action === 'open') {
    const item = btn.closest('.namespace-item') as HTMLElement | null;
    if (item) {
      item.classList.add('opening');
      showLoading(item);
    }
    try {
      await api.openNamespace(id);
    } finally {
      if (item) clearLoading(item);
      await render();
    }
  }

  if (action === 'delete') {
    const ns = (await api.listNamespaces()).find((n) => n.id === id);
    if (ns && confirm(`Delete workspace "${ns.name}"? This cannot be undone.`)) {
      await api.deleteNamespace(id);
      await render();
    }
  }
});

createBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) return;

  createBtn.setAttribute('disabled', '');
  try {
    await api.createNamespace(name);
    nameInput.value = '';
    await render();
  } finally {
    createBtn.removeAttribute('disabled');
  }
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    createBtn.click();
  }
});

connectBtn.addEventListener('click', async () => {
  const url = remoteUrlInput.value.trim();
  if (!url) return;

  try {
    new URL(url);
  } catch {
    remoteUrlInput.style.borderColor = '#ff2b2b';
    return;
  }

  connectBtn.setAttribute('disabled', '');
  try {
    const hostname = new URL(url).hostname;
    const name = hostname.replace(/^(www|demo|app)\./, '').split('.')[0] || hostname;
    await api.createNamespace(name, url);
    remoteUrlInput.value = '';
    await render();
  } finally {
    connectBtn.removeAttribute('disabled');
  }
});

remoteUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    connectBtn.click();
  }
});

remoteUrlInput.addEventListener('input', () => {
  remoteUrlInput.style.borderColor = '';
});

void render();
