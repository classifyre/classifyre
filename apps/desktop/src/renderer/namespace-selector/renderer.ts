interface Namespace {
  id: string;
  name: string;
  schemaName: string;
  createdAt: string;
  lastOpenedAt: string;
}

interface ElectronAPI {
  listNamespaces(): Promise<Namespace[]>;
  createNamespace(name: string): Promise<Namespace>;
  deleteNamespace(id: string): Promise<void>;
  openNamespace(id: string): Promise<{ apiPort: number; namespaceId: string }>;
  isNamespaceOpen(id: string): Promise<boolean>;
}

const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;

const listEl = document.getElementById('namespace-list')!;
const nameInput = document.getElementById('new-name') as HTMLInputElement;
const createBtn = document.getElementById('create-btn')!;

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
      const date = new Date(ns.lastOpenedAt).toLocaleDateString();
      return `
        <div class="namespace-item" data-id="${ns.id}">
          <div class="namespace-info">
            <div class="namespace-name">
              <span class="status-dot ${isOpen ? '' : 'closed'}"></span>
              ${escapeHtml(ns.name)}
            </div>
            <div class="namespace-meta">Last opened ${date}</div>
          </div>
          <div class="namespace-actions">
            <button class="btn btn-open" data-action="open" data-id="${ns.id}">
              ${isOpen ? 'Focus' : 'Open'}
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

listEl.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('[data-action]') as HTMLElement | null;
  if (!btn) return;

  const action = btn.dataset['action'];
  const id = btn.dataset['id'];
  if (!action || !id) return;

  if (action === 'open') {
    const item = btn.closest('.namespace-item') as HTMLElement | null;
    if (item) item.classList.add('opening');
    try {
      await api.openNamespace(id);
    } finally {
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

void render();
