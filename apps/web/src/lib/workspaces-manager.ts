export interface SavedWorkspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  layout?: any;
  activeReferenceId?: string;
  openDocumentIds?: string[];
  sidebars?: {
    propertiesOpen?: boolean;
    sidebarCollapsed?: boolean;
    consoleOpen?: boolean;
    structureOpen?: boolean;
    annotationsOpen?: boolean;
  };
  variableOptions?: {
    theme?: string;
    themePreset?: string;
    treeOrder?: string;
    activeLibraryId?: string | null;
    activeSmartFolder?: string | null;
    activeVirtualFolder?: string | null;
    treeSearch?: string;
    doublePage?: boolean;
    mosaic?: boolean;
    fontScale?: number;
    page?: number;
  };
}

export const STORAGE_KEY_WORKSPACES = 'seshat.workspaces.saved.v1';
export const STORAGE_KEY_ACTIVE_WORKSPACE = 'seshat.workspaces.active.v1';

export function loadWorkspaces(): SavedWorkspace[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_WORKSPACES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWorkspaces(workspaces: SavedWorkspace[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(workspaces));
  } catch (error) {
    console.error('Failed to save workspaces to localStorage', error);
  }
}

export function getActiveWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY_ACTIVE_WORKSPACE);
  } catch {
    return null;
  }
}

export function setActiveWorkspaceId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY_ACTIVE_WORKSPACE, id);
    else window.localStorage.removeItem(STORAGE_KEY_ACTIVE_WORKSPACE);
  } catch (error) {
    console.error('Failed to set active workspace ID', error);
  }
}

export function addWorkspace(
  data: Omit<SavedWorkspace, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; name: string }
): SavedWorkspace {
  const workspaces = loadWorkspaces();
  const id = data.id || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const newWorkspace: SavedWorkspace = {
    ...data,
    id,
    name: data.name.trim() || `Workspace ${workspaces.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };
  workspaces.unshift(newWorkspace);
  saveWorkspaces(workspaces);
  setActiveWorkspaceId(id);
  window.dispatchEvent(new CustomEvent('seshat:workspaces-updated', { detail: { activeId: id } }));
  return newWorkspace;
}

export function updateWorkspace(id: string, updates: Partial<Omit<SavedWorkspace, 'id' | 'createdAt'>>): SavedWorkspace | null {
  const workspaces = loadWorkspaces();
  const index = workspaces.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const updated: SavedWorkspace = {
    ...workspaces[index],
    ...updates,
    updatedAt: Date.now(),
  };
  workspaces[index] = updated;
  saveWorkspaces(workspaces);
  window.dispatchEvent(new CustomEvent('seshat:workspaces-updated', { detail: { activeId: id } }));
  return updated;
}

export function deleteWorkspace(id: string): boolean {
  const workspaces = loadWorkspaces();
  const next = workspaces.filter((item) => item.id !== id);
  if (next.length === workspaces.length) return false;
  saveWorkspaces(next);
  if (getActiveWorkspaceId() === id) {
    setActiveWorkspaceId(next[0]?.id || null);
  }
  window.dispatchEvent(new CustomEvent('seshat:workspaces-updated', { detail: { activeId: getActiveWorkspaceId() } }));
  return true;
}

export interface WorkspacesPanelOptions {
  onSave?: (name: string) => Promise<Partial<SavedWorkspace> | void> | Partial<SavedWorkspace> | void;
  onRecall?: (workspace: SavedWorkspace) => Promise<void> | void;
  onClose?: () => void;
  referenceId?: string;
}

export function mountWorkspacesPanel(container: HTMLElement, options: WorkspacesPanelOptions = {}) {
  let isEditingId: string | null = null;
  let isCreating = false;

  const panel = document.createElement('div');
  panel.className = 'seshat-workspaces-panel';

  const render = () => {
    panel.replaceChildren();

    // Top action area
    const topSection = document.createElement('div');
    topSection.className = 'workspaces-top-section';

    if (isCreating) {
      const createForm = document.createElement('form');
      createForm.className = 'workspaces-create-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'workspaces-name-input';
      const list = loadWorkspaces();
      input.value = `Workspace ${list.length + 1}`;
      input.placeholder = 'Workspace name…';
      input.setAttribute('aria-label', 'Workspace name');

      const actions = document.createElement('div');
      actions.className = 'workspaces-form-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.className = 'workspaces-btn-primary';
      saveBtn.textContent = 'Save';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'workspaces-btn-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => {
        isCreating = false;
        render();
      };

      actions.append(saveBtn, cancelBtn);
      createForm.append(input, actions);

      createForm.onsubmit = async (event) => {
        event.preventDefault();
        const name = input.value.trim() || `Workspace ${list.length + 1}`;
        saveBtn.disabled = true;
        try {
          const customData = options.onSave ? await options.onSave(name) : undefined;
          addWorkspace({
            name,
            ...(customData || {}),
          });
          isCreating = false;
          render();
        } catch (err) {
          console.error('Failed to create workspace', err);
          saveBtn.disabled = false;
        }
      };

      topSection.appendChild(createForm);
      window.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else {
      const quickSaveBtn = document.createElement('button');
      quickSaveBtn.type = 'button';
      quickSaveBtn.className = 'workspaces-save-quick-btn';
      quickSaveBtn.innerHTML = '<span class="workspaces-plus-icon">＋</span><span>Save new workspace</span>';
      quickSaveBtn.onclick = () => {
        isCreating = true;
        render();
      };
      topSection.appendChild(quickSaveBtn);
    }

    panel.appendChild(topSection);

    // List of saved workspaces
    const listSection = document.createElement('div');
    listSection.className = 'workspaces-list-section';

    const workspaces = loadWorkspaces();
    const activeId = getActiveWorkspaceId();

    if (workspaces.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'workspaces-empty-state';
      empty.textContent = 'No saved workspaces yet. Click "+ Save new workspace" above to capture open documents, pods, and layout.';
      listSection.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'workspaces-list';

      workspaces.forEach((workspace) => {
        const isActive = workspace.id === activeId;
        const shell = document.createElement('div');
        shell.className = 'workspace-item-shell';
        shell.dataset.workspaceId = workspace.id;

        if (isEditingId === workspace.id) {
          // Inline edit view
          const editForm = document.createElement('form');
          editForm.className = 'workspace-inline-edit';

          const editInput = document.createElement('input');
          editInput.type = 'text';
          editInput.className = 'workspaces-name-input';
          editInput.value = workspace.name;
          editInput.setAttribute('aria-label', 'Edit workspace name');

          const editActions = document.createElement('div');
          editActions.className = 'workspaces-form-actions';

          const saveEditBtn = document.createElement('button');
          saveEditBtn.type = 'submit';
          saveEditBtn.className = 'workspaces-btn-primary';
          saveEditBtn.textContent = 'Done';

          const cancelEditBtn = document.createElement('button');
          cancelEditBtn.type = 'button';
          cancelEditBtn.className = 'workspaces-btn-cancel';
          cancelEditBtn.textContent = 'Cancel';
          cancelEditBtn.onclick = () => {
            isEditingId = null;
            render();
          };

          editActions.append(saveEditBtn, cancelEditBtn);
          editForm.append(editInput, editActions);

          editForm.onsubmit = (e) => {
            e.preventDefault();
            const newName = editInput.value.trim();
            if (newName) updateWorkspace(workspace.id, { name: newName });
            isEditingId = null;
            render();
          };

          shell.appendChild(editForm);
          list.appendChild(shell);
          window.requestAnimationFrame(() => {
            editInput.focus();
            editInput.select();
          });
          return;
        }

        // Action layer behind the item (revealed on drag)
        const actionsLayer = document.createElement('div');
        actionsLayer.className = 'workspace-swipe-actions-layer';

        const editAction = document.createElement('div');
        editAction.className = 'workspace-swipe-action workspace-action-edit';
        editAction.innerHTML = '<span class="action-glyph">✏️</span><span class="action-text">Edit</span>';
        editAction.onclick = (e) => {
          e.stopPropagation();
          isEditingId = workspace.id;
          render();
        };

        const eraseAction = document.createElement('div');
        eraseAction.className = 'workspace-swipe-action workspace-action-erase';
        eraseAction.innerHTML = '<span class="action-glyph">🗑️</span><span class="action-text">Erase</span>';
        eraseAction.onclick = (e) => {
          e.stopPropagation();
          deleteWorkspace(workspace.id);
          render();
        };

        actionsLayer.append(editAction, eraseAction);
        shell.appendChild(actionsLayer);

        // Foreground swipeable card
        const card = document.createElement('div');
        card.className = `workspace-card ${isActive ? 'is-active-workspace' : ''}`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        const mainInfo = document.createElement('div');
        mainInfo.className = 'workspace-card-info';

        const nameLine = document.createElement('div');
        nameLine.className = 'workspace-card-name-row';

        const nameEl = document.createElement('strong');
        nameEl.className = 'workspace-card-name';
        nameEl.textContent = workspace.name;
        nameLine.appendChild(nameEl);

        if (isActive) {
          const activeTag = document.createElement('span');
          activeTag.className = 'workspace-active-badge';
          activeTag.textContent = '(open workspace)';
          nameLine.appendChild(activeTag);
        }

        const metaLine = document.createElement('small');
        metaLine.className = 'workspace-card-meta';
        const dateStr = new Date(workspace.updatedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const podCount = workspace.layout?.grid?.root?.children?.length || workspace.openDocumentIds?.length || 0;
        metaLine.textContent = `${dateStr}${podCount ? ` · ${podCount} pods` : ''}`;

        mainInfo.append(nameLine, metaLine);
        card.appendChild(mainInfo);

        // Desktop action buttons (accessible for non-touch cursor users)
        const desktopBtns = document.createElement('div');
        desktopBtns.className = 'workspace-card-desktop-btns';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'workspace-card-action-btn edit-btn';
        editBtn.title = 'Edit workspace name (or drag right)';
        editBtn.setAttribute('aria-label', 'Edit workspace');
        editBtn.textContent = '✏️';
        editBtn.onclick = (e) => {
          e.stopPropagation();
          isEditingId = workspace.id;
          render();
        };

        const eraseBtn = document.createElement('button');
        eraseBtn.type = 'button';
        eraseBtn.className = 'workspace-card-action-btn erase-btn';
        eraseBtn.title = 'Erase workspace (or drag left)';
        eraseBtn.setAttribute('aria-label', 'Erase workspace');
        eraseBtn.textContent = '🗑️';
        eraseBtn.onclick = (e) => {
          e.stopPropagation();
          deleteWorkspace(workspace.id);
          render();
        };

        desktopBtns.append(editBtn, eraseBtn);
        card.appendChild(desktopBtns);

        // Click / Enter to recall workspace
        const recall = () => {
          setActiveWorkspaceId(workspace.id);
          window.dispatchEvent(new CustomEvent('seshat:workspace-recall', { detail: { workspace } }));
          if (options.onRecall) options.onRecall(workspace);
          render();
        };

        card.addEventListener('click', () => {
          if (card.dataset.swipeConsumed === 'true') {
            card.dataset.swipeConsumed = 'false';
            return;
          }
          recall();
        });

        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            recall();
          }
        });

        // Pointer Drag / Swipe Gestures (drag right = Edit, drag left = Erase)
        let pointerId = -1;
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let horizontal = false;

        const resetDrag = () => {
          card.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
          card.style.transform = '';
          card.style.opacity = '';
          dx = 0;
          horizontal = false;
          pointerId = -1;
        };

        card.addEventListener('pointerdown', (event: PointerEvent) => {
          if ((event.target as HTMLElement).closest('.workspace-card-action-btn')) return;
          pointerId = event.pointerId;
          startX = event.clientX;
          startY = event.clientY;
          dx = 0;
          horizontal = false;
          card.style.transition = 'none';
        });

        card.addEventListener('pointermove', (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          const currentDx = event.clientX - startX;
          const currentDy = event.clientY - startY;

          if (!horizontal && Math.abs(currentDx) > 8 && Math.abs(currentDx) > Math.abs(currentDy) * 1.1) {
            horizontal = true;
          }
          if (!horizontal) return;

          event.preventDefault();
          dx = currentDx;
          // Clamp offset range
          const clamped = Math.max(-140, Math.min(140, dx));
          card.style.transform = `translateX(${clamped}px)`;
          if (clamped < 0) {
            // Dragging left (Erase): slight opacity fade
            card.style.opacity = String(Math.max(0.4, 1 + clamped / 180));
          } else {
            card.style.opacity = '1';
          }
        });

        const finishDrag = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          if (horizontal) {
            if (dx > 54) {
              // Drag right: Edit!
              card.dataset.swipeConsumed = 'true';
              resetDrag();
              isEditingId = workspace.id;
              render();
              return;
            } else if (dx < -64) {
              // Drag left: Erase!
              card.dataset.swipeConsumed = 'true';
              card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
              card.style.transform = 'translateX(-105%)';
              card.style.opacity = '0';
              window.setTimeout(() => {
                deleteWorkspace(workspace.id);
                render();
              }, 210);
              return;
            }
          }
          resetDrag();
        };

        card.addEventListener('pointerup', finishDrag);
        card.addEventListener('pointercancel', resetDrag);

        shell.appendChild(card);
        list.appendChild(shell);
      });

      listSection.appendChild(list);
    }

    panel.appendChild(listSection);
  };

  const handleUpdate = () => render();
  window.addEventListener('seshat:workspaces-updated', handleUpdate);

  render();
  container.replaceChildren(panel);

  return {
    refresh: render,
    unmount: () => {
      window.removeEventListener('seshat:workspaces-updated', handleUpdate);
      panel.remove();
    },
  };
}
