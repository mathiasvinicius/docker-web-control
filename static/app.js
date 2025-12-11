const state = {
  containers: [],
  groups: {},
  groupAliases: {},
  containerAliases: {},
  translations: {},
  currentLang: "pt-BR",
  selected: new Set(),
  filter: "",
  runningOnly: false,
  activeGroup: null,
  autostart: { groups: [], containers: [] },
  sortBy: null, // Coluna atual de ordenação
  sortOrder: 'asc', // 'asc' ou 'desc'
  currentView: 'containers',
  currentPage: 1,
  itemsPerPage: 5,
  viewMode: 'cards', // 'table' ou 'cards' - padrão: cards
  expandedGroups: new Set(), // Grupos expandidos na tabela hierárquica
};

const dom = {
  tableBody: document.getElementById("containers-body"),
  selectAll: document.getElementById("select-all"),
  filterInput: document.getElementById("filter-input"),
  runningOnly: document.getElementById("running-only"),
  refreshContainers: document.getElementById("refresh-containers"),
  refreshGroups: document.getElementById("refresh-groups"),
  assignForm: document.getElementById("assign-group-form"),
  groupSelect: document.getElementById("group-select"),
  createGroupForm: document.getElementById("create-group-form"),
  newGroupInput: document.getElementById("new-group-name"),
  groupsList: document.getElementById("groups-list"),
  selectionInfo: document.getElementById("selection-info"),
  groupFilterInfo: document.getElementById("group-filter-info"),
  groupFilterName: document.getElementById("group-filter-name"),
  clearGroupFilter: document.getElementById("clear-group-filter"),
  toast: document.getElementById("toast"),
  bulkButtons: document.querySelectorAll(".control-buttons button"),
  navItems: document.querySelectorAll(".nav-item"),
  viewPanels: document.querySelectorAll(".view-panel"),
  langSelect: document.getElementById("lang-select"),
  navLanguageLabel: document.getElementById("nav-language-label"),
  navContainers: document.getElementById("nav-containers"),
  navGroups: document.getElementById("nav-groups"),
  appTitle: document.getElementById("app-title"),
  appSubtitle: document.getElementById("app-subtitle"),
  filterInput: document.getElementById("filter-input"),
  labelRunningOnly: document.getElementById("label-running-only"),
  thName: document.getElementById("th-name"),
  thImage: document.getElementById("th-image"),
  thStatus: document.getElementById("th-status"),
  thPorts: document.getElementById("th-ports"),
  thGroups: document.getElementById("th-groups"),
  thAutostart: document.getElementById("th-autostart"),
  thActions: document.getElementById("th-actions"),
  groupsTitle: document.getElementById("groups-title"),
  createGroupInput: document.getElementById("new-group-name"),
  createGroupBtn: document.getElementById("create-group-btn"),
  paginationInfo: document.getElementById("pagination-info-text"),
  prevPage: document.getElementById("prev-page"),
  nextPage: document.getElementById("next-page"),
  pageNumbers: document.getElementById("page-numbers"),
  itemsPerPage: document.getElementById("items-per-page"),
  toggleTable: document.getElementById("toggle-table"),
  toggleCards: document.getElementById("toggle-cards"),
  cardsContainer: document.getElementById("cards-container"),
  cardsView: document.getElementById("cards-view"),
};

let toastTimer;
const defaultTranslations = {
  "pt-BR": {},
  en: {},
};

async function init() {
  await loadTranslations();
  attachEvents();
  await loadAll();
}

function attachEvents() {
  dom.filterInput.addEventListener("input", (event) => {
    state.filter = event.target.value.toLowerCase();
    render();
  });

  dom.runningOnly.addEventListener("change", (event) => {
    state.runningOnly = event.target.checked;
    render();
  });

  dom.selectAll.addEventListener("change", (event) => {
    const visible = getVisibleContainers();
    visible.forEach((container) => {
      if (event.target.checked) {
        state.selected.add(container.id);
      } else {
        state.selected.delete(container.id);
      }
    });
    renderSelectionInfo();
    renderTable();
  });

  dom.assignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.groups || Object.keys(state.groups).length === 0) {
      showToast("Crie um grupo antes de atribuir.", true);
      return;
    }
    const target = dom.groupSelect.value;
    if (!target) {
      showToast("Selecione um grupo para continuar.", true);
      return;
    }
    if (!state.selected.size) {
      showToast("Selecione ao menos um container.", true);
      return;
    }
    const existing = new Set(state.groups[target] || []);
    state.selected.forEach((id) => existing.add(id));
    state.groups[target] = Array.from(existing);
    try {
      await persistGroups("Grupos atualizados.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  dom.createGroupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = dom.newGroupInput.value.trim();
    if (!name) {
      showToast("O nome do grupo é obrigatório.", true);
      return;
    }
    if (state.groups[name]) {
      showToast("Já existe um grupo com esse nome.", true);
      return;
    }
    state.groups[name] = [];
    dom.newGroupInput.value = "";
    try {
      await persistGroups("Grupo criado.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  dom.bulkButtons.forEach((button) =>
    button.addEventListener("click", () => handleBulkAction(button.dataset.action))
  );

  if (dom.clearGroupFilter) {
    dom.clearGroupFilter.addEventListener("click", () => {
      state.activeGroup = null;
      render();
    });
  }

  dom.navItems.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  if (dom.langSelect) {
    dom.langSelect.addEventListener("change", () => {
      state.currentLang = dom.langSelect.value;
      applyStaticTranslations();
      render();
    });
  }

  if (dom.refreshContainers) {
    dom.refreshContainers.addEventListener("click", async () => {
      await refreshContainersView();
    });
  }

  if (dom.refreshGroups) {
    dom.refreshGroups.addEventListener("click", async () => {
      await refreshGroupsView();
    });
  }

  // Adicionar ordenação clicável nos headers
  document.querySelectorAll("th.sortable").forEach((header) => {
    header.addEventListener("click", () => {
      const sortKey = header.dataset.sort;

      // Se já está ordenando por essa coluna, inverte a ordem
      if (state.sortBy === sortKey) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        // Nova coluna, começa com ascendente
        state.sortBy = sortKey;
        state.sortOrder = 'asc';
      }

      render();
    });
  });

  // Paginação
  dom.itemsPerPage.addEventListener("change", (event) => {
    state.itemsPerPage = parseInt(event.target.value);
    state.currentPage = 1; // Reset to first page
    render();
  });

  dom.prevPage.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      render();
    }
  });

  dom.nextPage.addEventListener("click", () => {
    const visible = getVisibleContainers();
    const totalPages = Math.ceil(visible.length / state.itemsPerPage);
    if (state.currentPage < totalPages) {
      state.currentPage++;
      render();
    }
  });

  // View Mode Toggle
  if (dom.toggleTable) {
    dom.toggleTable.addEventListener("click", () => setViewMode('table'));
  }
  if (dom.toggleCards) {
    dom.toggleCards.addEventListener("click", () => setViewMode('cards'));
  }

  // Carregar preferência salva
  const savedMode = localStorage.getItem('dockerControlViewMode') || 'cards';
  setViewMode(savedMode, false);
}

async function loadAll() {
  try {
    const [containers, groupsResponse, autostart] = await Promise.all([
      loadContainers(),
      loadGroups(),
      loadAutostart()
    ]);
    state.containers = containers;
    state.groups = groupsResponse.groups;
    state.groupAliases = groupsResponse.aliases || {};
    applyAutoGrouping(true);
    state.autostart = autostart;
    cleanSelection();
    render();
  } catch (error) {
    showToast(error.message || "Erro ao carregar dados.", true);
  }
}

async function loadTranslations() {
  try {
    const response = await fetch("/static/translations.json");
    const data = await response.json();
    state.translations = { ...defaultTranslations, ...data };
  } catch (error) {
    state.translations = defaultTranslations;
  }
  applyStaticTranslations();
}

async function loadContainers() {
  const response = await fetch("/api/containers");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Falha ao listar containers");
  }
  state.containerAliases = data.aliases || {};
  return data.containers || [];
}

async function loadGroups() {
  const response = await fetch("/api/groups");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Falha ao carregar grupos");
  }
  return {
    groups: data.groups || {},
    aliases: data.aliases || {},
  };
}

async function persistGroups(successMessage) {
  const response = await fetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groups: state.groups, aliases: state.groupAliases }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Não foi possível salvar os grupos.");
  }
  state.groups = body.groups || {};
  state.groupAliases = body.aliases || {};
  if (state.activeGroup && !state.groups[state.activeGroup]) {
    state.activeGroup = null;
  }
  renderGroups();
  renderTable();
  renderGroupFilterInfo();
  if (successMessage) {
    showToast(successMessage);
  }
}

async function loadAutostart() {
  const response = await fetch("/api/autostart");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Falha ao carregar autostart");
  }
  return data.autostart || { groups: [], containers: [] };
}

async function saveAutostart() {
  const response = await fetch("/api/autostart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autostart: state.autostart }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Não foi possível salvar autostart.");
  }
  state.autostart = body.autostart || { groups: [], containers: [] };
}

async function setRestartPolicy(containerId, policy) {
  const response = await fetch(`/api/containers/${containerId}/restart-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policy }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.details || data.error || "Falha ao atualizar restart policy.");
  }
  return data.restart_policy || policy;
}

async function saveContainerAlias(containerId, aliasValue, iconValue) {
  const response = await fetch("/api/container-aliases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aliases: { [containerId]: { alias: aliasValue || "", icon: iconValue || "" } } }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Não foi possível salvar o apelido.");
  }
  state.containerAliases = data.aliases || {};
}

function render() {
  renderTable();
  renderSelectionInfo();
  renderGroups();
  renderGroupFilterInfo();
  updateSortIndicators();
  updateViewVisibility();

  // Renderizar cards se estiver no modo cards
  if (state.viewMode === 'cards') {
    renderCards();
  }
}

function updateSortIndicators() {
  // Limpar todos os indicadores
  document.querySelectorAll("th.sortable").forEach((header) => {
    header.classList.remove("sorted-asc", "sorted-desc");
    const indicator = header.querySelector(".sort-indicator");
    if (indicator) {
      indicator.textContent = "";
    }
  });

  // Adicionar indicador na coluna atual
  if (state.sortBy) {
    const activeHeader = document.querySelector(`th[data-sort="${state.sortBy}"]`);
    if (activeHeader) {
      activeHeader.classList.add(`sorted-${state.sortOrder}`);
      const indicator = activeHeader.querySelector(".sort-indicator");
      if (indicator) {
        indicator.textContent = state.sortOrder === 'asc' ? '▲' : '▼';
      }
    }
  }
}

// View Mode Toggle Functions
function setViewMode(mode, savePreference = true) {
  state.viewMode = mode;

  if (savePreference) {
    localStorage.setItem('dockerControlViewMode', mode);
  }

  // Update button states
  if (dom.toggleTable) {
    dom.toggleTable.classList.toggle('active', mode === 'table');
  }
  if (dom.toggleCards) {
    dom.toggleCards.classList.toggle('active', mode === 'cards');
  }

  // Toggle visibility of table elements
  const tableView = document.getElementById('table-view');
  const paginationControls = document.getElementById('pagination-controls');
  const bulkActions = document.getElementById('bulk-actions');

  if (tableView) {
    tableView.style.display = mode === 'table' ? 'block' : 'none';
  }
  if (paginationControls) {
    paginationControls.style.display = mode === 'table' ? 'flex' : 'none';
  }
  if (bulkActions) {
    bulkActions.style.display = mode === 'table' ? 'block' : 'none';
  }

  // Toggle visibility of cards view
  if (dom.cardsView) {
    dom.cardsView.style.display = mode === 'cards' ? 'block' : 'none';
  }
}

// Hierarchical Table Helper Functions
function toggleGroupExpansion(groupName) {
  if (state.expandedGroups.has(groupName)) {
    state.expandedGroups.delete(groupName);
  } else {
    state.expandedGroups.add(groupName);
  }

  // Update icon
  const icon = document.getElementById(`expand-icon-${groupName}`);
  if (icon) {
    icon.classList.toggle('expanded');
  }

  // Toggle container rows visibility
  const containerRows = document.querySelectorAll(`tr.container-row[data-group="${CSS.escape(groupName)}"]`);
  containerRows.forEach(row => {
    row.classList.toggle('hidden');
  });
}

function renderTable() {
  // Use hierarchical rendering (v2.0)
  return renderTableHierarchical();
}

function renderTableHierarchical() {
  const allVisibleContainers = getVisibleContainers();
  dom.tableBody.innerHTML = "";

  if (!allVisibleContainers.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = t("table.empty");
    row.appendChild(cell);
    dom.tableBody.appendChild(row);
    renderPaginationControls(0);
    return;
  }

  // Organize containers by group
  const selectedGroups = invertGroups();
  const groupedContainers = new Map();
  const standaloneContainers = [];

  allVisibleContainers.forEach(container => {
    const containerGroups = selectedGroups.get(container.id) || [];
    if (containerGroups.length > 0) {
      // Add to first group
      const groupName = containerGroups[0];
      if (!groupedContainers.has(groupName)) {
        groupedContainers.set(groupName, []);
      }
      groupedContainers.get(groupName).push(container);
    } else {
      standaloneContainers.push(container);
    }
  });

  // Render groups first
  groupedContainers.forEach((containers, groupName) => {
    renderGroupRow(groupName, containers, selectedGroups);
  });

  // Then render standalone containers
  standaloneContainers.forEach(container => {
    renderContainerTableRow(container, selectedGroups, null);
  });

  updateSelectAllState();
  renderPaginationControls(allVisibleContainers.length);
}

function renderTableFlat() {
  const allVisibleContainers = getVisibleContainers();

  // Apply pagination
  const totalItems = allVisibleContainers.length;
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);

  // Ensure current page is valid
  if (state.currentPage > totalPages && totalPages > 0) {
    state.currentPage = totalPages;
  }
  if (state.currentPage < 1) {
    state.currentPage = 1;
  }

  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const containers = allVisibleContainers.slice(startIndex, endIndex);

  dom.tableBody.innerHTML = "";

  if (!allVisibleContainers.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = t("table.empty");
    row.appendChild(cell);
    dom.tableBody.appendChild(row);
  } else {
    const selectedGroups = invertGroups();
    containers.forEach((container) => {
      const row = document.createElement("tr");

      const selectCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selected.has(container.id);
      checkbox.addEventListener("change", (event) => {
        if (event.target.checked) {
          state.selected.add(container.id);
        } else {
          state.selected.delete(container.id);
        }
        renderSelectionInfo();
        updateSelectAllState();
      });
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);

      const nameCell = document.createElement("td");
      const nameRow = document.createElement("div");
      nameRow.className = "name-with-icon";
      const display = containerDisplay(container);
      if (display.icon || container.icon) {
        const iconImg = document.createElement("img");
        iconImg.src = display.icon || container.icon;
        iconImg.alt = "";
        iconImg.className = "container-icon";
        nameRow.appendChild(iconImg);
      }

      const nameText = document.createElement("strong");
      nameText.textContent = display.main;
      nameRow.appendChild(nameText);
      if (display.original) {
        const original = document.createElement("span");
        original.className = "meta-line small";
        original.textContent = `(${display.original})`;
        nameRow.appendChild(original);
      }
      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.className = "icon-button";
      renameButton.title = "Editar apelido";
      renameButton.textContent = "✎";
      nameRow.appendChild(renameButton);

      nameCell.appendChild(nameRow);
      const projectLine = document.createElement("div");
      projectLine.className = "meta-line";
      projectLine.textContent = container.project || "";
      nameCell.appendChild(projectLine);

      // Formulário de apelido (oculto)
      const aliasForm = document.createElement("form");
      aliasForm.className = "alias-form";
      aliasForm.classList.remove("visible");
      const aliasInput = document.createElement("input");
      aliasInput.type = "text";
      aliasInput.placeholder = "Apelido (opcional)";
      const metaAlias = state.containerAliases[container.id];
      if (metaAlias && typeof metaAlias === "object") {
        aliasInput.value = metaAlias.alias || "";
      } else if (metaAlias) {
        aliasInput.value = metaAlias;
      } else {
        aliasInput.value = "";
      }

      const aliasRow = document.createElement("div");
      aliasRow.className = "icon-row";

      const aliasSpacer = document.createElement("button");
      aliasSpacer.type = "button";
      aliasSpacer.className = "ghost small upload-placeholder";
      aliasSpacer.textContent = "📤 Upload";
      aliasSpacer.tabIndex = -1;
      aliasSpacer.setAttribute("aria-hidden", "true");

      aliasRow.appendChild(aliasInput);
      aliasRow.appendChild(aliasSpacer);

      const iconInput = document.createElement("input");
      iconInput.type = "text";
      iconInput.placeholder = "Ícone (URL) ex: http://icons.casaos.local/...";
      if (metaAlias && typeof metaAlias === "object") {
        iconInput.value = metaAlias.icon || "";
      } else {
        iconInput.value = "";
      }

      // Container para o campo de ícone e botão de upload
      const iconContainer = document.createElement("div");
      iconContainer.className = "icon-row";

      // Botão de upload
      const uploadButton = document.createElement("button");
      uploadButton.type = "button";
      uploadButton.className = "ghost small";
      uploadButton.textContent = "📤 Upload";
      uploadButton.title = "Upload icon image";

      // Input file oculto
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp,image/x-icon";
      fileInput.style.display = "none";

      uploadButton.addEventListener("click", () => fileInput.click());

      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
          showToast("Arquivo muito grande. Máximo: 5MB", true);
          return;
        }

        try {
          uploadButton.disabled = true;
          uploadButton.textContent = "⏳ Enviando...";

          const formData = new FormData();
          formData.append("icon", file);

          const response = await fetch("/api/upload-icon", {
            method: "POST",
            body: formData,
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Erro ao fazer upload");
          }

          iconInput.value = data.url;
          showToast("Ícone enviado com sucesso!", false);
        } catch (error) {
          showToast(error.message || "Erro ao fazer upload do ícone", true);
        } finally {
          uploadButton.disabled = false;
          uploadButton.textContent = "📤 Upload";
          fileInput.value = "";
        }
      });

      iconContainer.appendChild(iconInput);
      iconContainer.appendChild(uploadButton);
      iconContainer.appendChild(fileInput);

      const saveAlias = document.createElement("button");
      saveAlias.type = "submit";
      saveAlias.className = "ghost small";
      saveAlias.textContent = "Salvar";
      const cancelAlias = document.createElement("button");
      cancelAlias.type = "button";
      cancelAlias.className = "ghost small";
      cancelAlias.textContent = "Cancelar";

      const actionsRow = document.createElement("div");
      actionsRow.className = "alias-actions";
      actionsRow.appendChild(saveAlias);
      actionsRow.appendChild(cancelAlias);

      aliasForm.appendChild(aliasRow);
      aliasForm.appendChild(iconContainer);
      aliasForm.appendChild(actionsRow);
      nameCell.appendChild(aliasForm);

      renameButton.addEventListener("click", () => {
        aliasForm.classList.add("visible");
        aliasInput.focus();
      });
      cancelAlias.addEventListener("click", () => {
        const currentMeta = state.containerAliases[container.id];
        aliasInput.value =
          currentMeta && typeof currentMeta === "object"
            ? currentMeta.alias || ""
            : currentMeta || "";
        iconInput.value =
          currentMeta && typeof currentMeta === "object" ? currentMeta.icon || "" : "";
        aliasForm.classList.remove("visible");
      });
      aliasForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const trimmed = aliasInput.value.trim();
        const iconTrimmed = iconInput.value.trim();
        try {
          await saveContainerAlias(container.id, trimmed, iconTrimmed);
          aliasForm.classList.remove("visible");
          render(); // re-render para aplicar apelido
        } catch (error) {
          showToast(error.message || "Erro ao salvar apelido.", true);
        }
      });
      row.appendChild(nameCell);

      const imageCell = document.createElement("td");
      const imgBlock = document.createElement("div");
      imgBlock.textContent = container.image || "—";

      if (container.command) {
        const cmdLine = document.createElement("div");
        cmdLine.className = "meta-line meta-mono";
        cmdLine.textContent = truncateText(container.command, 60);
        imageCell.appendChild(cmdLine);
      }

      const mountText = formatMount(container.mounts);
      if (mountText) {
        const mountLine = document.createElement("div");
        mountLine.className = "meta-line";
        mountLine.textContent = mountText;
        imageCell.appendChild(mountLine);
      }

      imageCell.insertBefore(imgBlock, imageCell.firstChild);
      row.appendChild(imageCell);

      const statusCell = document.createElement("td");
      statusCell.appendChild(buildStatusPill(container.state, container.status));
      row.appendChild(statusCell);

      const portsCell = document.createElement("td");
      portsCell.textContent = container.ports || "—";
      row.appendChild(portsCell);

      const groupsCell = document.createElement("td");
      const groups = selectedGroups.get(container.id) || [];
      if (!groups.length) {
        groupsCell.textContent = "—";
      } else {
        groups.forEach((groupName) => {
          const badge = document.createElement("span");
          badge.className = "group-badge";
          badge.textContent = groupLabel(groupName);
          groupsCell.appendChild(badge);
        });
      }
      row.appendChild(groupsCell);

      // Auto-start cell
      row.appendChild(renderAutostartCell(container, selectedGroups));

      const actionsCell = document.createElement("td");
      actionsCell.className = "actions-cell";
      const isRunning = container.state === "running";
      const actions = isRunning ? ["stop", "restart"] : ["start"];
      actions.forEach((action) => {
        const button = document.createElement("button");
        button.className = "ghost";
        button.textContent =
          action === "start"
            ? t("actions.start")
            : action === "stop"
            ? t("actions.stop")
            : t("actions.restart");
        button.addEventListener("click", () => handleAction(container.id, action));
        actionsCell.appendChild(button);
      });
      row.appendChild(actionsCell);
      dom.tableBody.appendChild(row);
    });
  }

  updateSelectAllState();

  // Render pagination controls
  renderPaginationControls(allVisibleContainers.length);
}

// Hierarchical Table Rendering Functions
function appendContainerCells(row, container, selectedGroups) {
  // Name cell
  const nameCell = document.createElement("td");
  const nameRow = document.createElement("div");
  nameRow.className = "name-with-icon";
  const display = containerDisplay(container);

  if (display.icon || container.icon) {
    const iconImg = document.createElement("img");
    iconImg.src = display.icon || container.icon;
    iconImg.alt = "";
    iconImg.className = "container-icon";
    nameRow.appendChild(iconImg);
  }

  const nameText = document.createElement("strong");
  nameText.textContent = display.main;
  nameRow.appendChild(nameText);

  if (display.original) {
    const original = document.createElement("span");
    original.className = "meta-line small";
    original.textContent = `(${display.original})`;
    nameRow.appendChild(original);
  }

  nameCell.appendChild(nameRow);
  const projectLine = document.createElement("div");
  projectLine.className = "meta-line";
  projectLine.textContent = container.project || "";
  nameCell.appendChild(projectLine);
  row.appendChild(nameCell);

  // Image cell
  const imageCell = document.createElement("td");
  imageCell.textContent = container.image || "—";
  row.appendChild(imageCell);

  // Status cell
  const statusCell = document.createElement("td");
  const statusPill = document.createElement("span");
  statusPill.className = `status-pill status-${container.state === "running" ? "running" : "exited"}`;
  statusPill.textContent = container.state === "running" ? t("status.running") : t("status.stopped");
  statusCell.appendChild(statusPill);
  row.appendChild(statusCell);

  // Ports cell
  const portsCell = document.createElement("td");
  portsCell.textContent = container.ports || "—";
  row.appendChild(portsCell);

  // Groups cell
  const groupsCell = document.createElement("td");
  const containerGroups = selectedGroups.get(container.id) || [];
  if (containerGroups.length) {
    containerGroups.forEach((g) => {
      const groupLink = document.createElement("button");
      groupLink.className = "group-link";
      groupLink.textContent = groupLabel(g);
      groupLink.addEventListener("click", () => {
        state.activeGroup = g;
        render();
      });
      groupsCell.appendChild(groupLink);
    });
  } else {
    groupsCell.textContent = "—";
  }
  row.appendChild(groupsCell);

  // Auto-start cell
  const autostartCell = renderAutostartCell(container, selectedGroups);
  row.appendChild(autostartCell);

  // Actions cell
  const actionsCell = document.createElement("td");
  const actions = container.state === "running" ? ["stop", "restart"] : ["start", "restart"];
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.className = "ghost small";
    button.textContent =
      action === "start"
        ? t("actions.start")
        : action === "stop"
        ? t("actions.stop")
        : t("actions.restart");
    button.addEventListener("click", () => handleAction(container.id, action));
    actionsCell.appendChild(button);
  });
  row.appendChild(actionsCell);
}

function renderGroupRow(groupName, containers, selectedGroups) {
  const row = document.createElement('tr');
  row.className = 'group-row';
  row.onclick = () => toggleGroupExpansion(groupName);

  // Checkbox cell
  const checkboxCell = document.createElement('td');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.onclick = (e) => e.stopPropagation();
  checkboxCell.appendChild(checkbox);
  row.appendChild(checkboxCell);

  // Group header cell (colspan)
  const headerCell = document.createElement('td');
  headerCell.colSpan = 7;

  const headerDiv = document.createElement('div');
  headerDiv.className = 'group-row-header';

  // Expand icon
  const expandIcon = document.createElement('span');
  expandIcon.className = state.expandedGroups.has(groupName) ? 'expand-icon expanded' : 'expand-icon';
  expandIcon.id = `expand-icon-${groupName}`;
  expandIcon.textContent = '▶';
  headerDiv.appendChild(expandIcon);

  // Group icon
  const aliasMeta = state.groupAliases?.[groupName];
  const groupIconAlias = aliasMeta && typeof aliasMeta === "object" ? aliasMeta.icon : "";
  const containerMap = buildContainerMap();
  const containerIds = state.groups[groupName] || [];
  const groupIconContainer = containerIds
    .map((id) => containerMap.get(id))
    .find((c) => c && c.icon)?.icon;
  const groupIcon = groupIconAlias || groupIconContainer;

  if (groupIcon) {
    const iconImg = document.createElement('img');
    iconImg.src = groupIcon;
    iconImg.className = 'group-row-icon';
    iconImg.alt = '';
    headerDiv.appendChild(iconImg);
  }

  // Group name
  const displayName = groupLabel(groupName);
  const nameSpan = document.createElement('strong');
  nameSpan.className = 'group-row-name';
  nameSpan.textContent = displayName;
  headerDiv.appendChild(nameSpan);

  // Container count badge
  const badge = document.createElement('span');
  badge.className = 'group-row-badge';
  badge.textContent = `${containers.length} container${containers.length > 1 ? 's' : ''}`;
  headerDiv.appendChild(badge);

  // Auto-start button
  const isGroupEnabled = state.autostart.groups.includes(groupName);
  const autostartBtn = document.createElement('button');
  autostartBtn.className = `group-autostart-toggle group-row-autostart ${isGroupEnabled ? 'enabled' : 'disabled'}`;
  autostartBtn.textContent = isGroupEnabled ? 'Auto-start: ON' : 'Auto-start: OFF';
  autostartBtn.title = 'Clique para alterar auto-start do grupo';
  autostartBtn.onclick = async (e) => {
    e.stopPropagation();
    await toggleGroupAutostart(groupName, containers);
  };
  headerDiv.appendChild(autostartBtn);

  // Actions
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'group-row-actions';

  const startBtn = document.createElement('button');
  startBtn.className = 'ghost small';
  startBtn.textContent = '▶ Iniciar';
  startBtn.onclick = (e) => {
    e.stopPropagation();
    handleGroupAction(groupName, 'start');
  };
  actionsDiv.appendChild(startBtn);

  const stopBtn = document.createElement('button');
  stopBtn.className = 'ghost small';
  stopBtn.textContent = '■ Parar';
  stopBtn.onclick = (e) => {
    e.stopPropagation();
    handleGroupAction(groupName, 'stop');
  };
  actionsDiv.appendChild(stopBtn);

  const restartBtn = document.createElement('button');
  restartBtn.className = 'ghost small';
  restartBtn.textContent = '⟳ Reiniciar';
  restartBtn.onclick = (e) => {
    e.stopPropagation();
    handleGroupAction(groupName, 'restart');
  };
  actionsDiv.appendChild(restartBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'ghost small danger';
  deleteBtn.textContent = '🗑 Excluir';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    deleteGroup(groupName);
  };
  actionsDiv.appendChild(deleteBtn);

  headerDiv.appendChild(actionsDiv);
  headerCell.appendChild(headerDiv);
  row.appendChild(headerCell);

  dom.tableBody.appendChild(row);

  // Render containers in group
  containers.forEach(container => {
    renderContainerTableRow(container, selectedGroups, groupName);
  });
}

async function toggleGroupAutostart(groupName, containers) {
  const currentEnabled = state.autostart.groups.includes(groupName);
  const previousGroups = [...state.autostart.groups];
  const previousPolicies = {};

  containers.forEach(c => {
    previousPolicies[c.id] = c.restart_policy || 'no';
  });

  // Update state (optimistic)
  if (currentEnabled) {
    state.autostart.groups = state.autostart.groups.filter((g) => g !== groupName);
  } else {
    state.autostart.groups.push(groupName);
  }
  const newEnabled = !currentEnabled;

  try {
    await saveAutostart();
    // Adjust restart policy for containers
    if (containers.length) {
      const newPolicy = newEnabled ? 'unless-stopped' : 'no';
      await Promise.all(containers.map((c) => setRestartPolicy(c.id, newPolicy)));
      containers.forEach((c) => {
        c.restart_policy = newPolicy;
      });
    }
    showToast(`Auto-start do grupo ${newEnabled ? 'habilitado' : 'desabilitado'}`);
    render(); // Re-render to update button state
  } catch (error) {
    showToast(error.message || 'Erro ao salvar', true);
    // Revert
    state.autostart.groups = previousGroups;
    if (containers.length) {
      await Promise.all(
        containers.map((c) =>
          setRestartPolicy(c.id, previousPolicies[c.id] || 'no').catch(() => null)
        )
      );
      containers.forEach((c) => {
        c.restart_policy = previousPolicies[c.id] || c.restart_policy;
      });
    }
    render();
  }
}

function renderContainerTableRow(container, selectedGroups, groupName) {
  const row = document.createElement("tr");
  row.className = groupName ? 'container-row grouped' : 'container-row standalone';

  if (groupName) {
    row.setAttribute('data-group', groupName);
    if (!state.expandedGroups.has(groupName)) {
      row.classList.add('hidden');
    }
  }

  // Use existing container row rendering logic from renderTableFlat
  // We'll copy the relevant parts here

  const selectCell = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(container.id);
  checkbox.addEventListener("change", (event) => {
    if (event.target.checked) {
      state.selected.add(container.id);
    } else {
      state.selected.delete(container.id);
    }
    renderSelectionInfo();
    updateSelectAllState();
  });
  selectCell.appendChild(checkbox);
  row.appendChild(selectCell);

  // For brevity, we'll call a helper to render the rest
  appendContainerCells(row, container, selectedGroups);

  dom.tableBody.appendChild(row);
}

function renderPaginationControls(totalItems) {
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  const startItem = totalItems === 0 ? 0 : (state.currentPage - 1) * state.itemsPerPage + 1;
  const endItem = Math.min(state.currentPage * state.itemsPerPage, totalItems);

  // Update info text
  dom.paginationInfo.textContent = `Mostrando ${startItem}-${endItem} de ${totalItems}`;

  // Update button states
  dom.prevPage.disabled = state.currentPage === 1;
  dom.nextPage.disabled = state.currentPage === totalPages || totalPages === 0;

  // Update page numbers
  dom.pageNumbers.innerHTML = "";
  if (totalPages > 0) {
    const pageSpan = document.createElement("span");
    pageSpan.className = "page-info";
    pageSpan.textContent = `Página ${state.currentPage} de ${totalPages}`;
    dom.pageNumbers.appendChild(pageSpan);
  }
}

function buildStatusPill(stateValue, statusText) {
  const pill = document.createElement("span");
  const state = (stateValue || "").toLowerCase();
  pill.className = `status-pill ${
    state === "running"
      ? "status-running"
      : state === "exited"
      ? "status-exited"
      : ""
  }`;
  pill.textContent = statusText || stateValue || "desconhecido";
  return pill;
}

function renderGroups() {
  dom.groupsList.innerHTML = "";
  const names = Object.keys(state.groups);

  dom.groupSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione";
  dom.groupSelect.appendChild(placeholder);

  if (!names.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum grupo cadastrado.";
    dom.groupsList.appendChild(empty);
    dom.groupSelect.disabled = true;
    return;
  }

  dom.groupSelect.disabled = false;
  const containerMap = buildContainerMap();

  names.forEach((name) => {
      // Ícone do grupo: preferir ícone definido no alias, senão primeiro container com ícone
      const aliasMeta = state.groupAliases?.[name];
      const groupIconAlias = aliasMeta && typeof aliasMeta === "object" ? aliasMeta.icon : "";
      const groupIconContainer = (state.groups[name] || [])
        .map((id) => containerMap.get(id))
        .find((c) => c && c.icon)?.icon;
      const groupIcon = groupIconAlias || groupIconContainer;
      const displayName = groupLabel(name);

    const option = document.createElement("option");
    option.value = name;
    option.textContent = displayName;
    dom.groupSelect.appendChild(option);

    const card = document.createElement("div");
    card.className = "group-card";
    card.classList.toggle("active", state.activeGroup === name);
    const header = document.createElement("header");
    const title = document.createElement("h3");
    if (groupIcon) {
      const iconImg = document.createElement("img");
      iconImg.src = groupIcon;
      iconImg.alt = "";
      iconImg.className = "group-icon";
      title.appendChild(iconImg);
    }
    const titleText = document.createElement("span");
    titleText.textContent = displayName;
    title.appendChild(titleText);
    const hasAlias = !!(aliasMeta && (aliasMeta.alias || typeof aliasMeta === "string"));
    if (hasAlias) {
      const aliasLine = document.createElement("span");
      aliasLine.className = "meta-line small";
      aliasLine.textContent = `(${name})`;
      title.appendChild(aliasLine);
    }
    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "icon-button";
    renameButton.title = "Editar apelido";
    renameButton.textContent = "✎";
    title.appendChild(renameButton);
    header.appendChild(title);

    // Auto-start button para o grupo
    const isGroupEnabled = state.autostart.groups.includes(name);
    const autostartButton = document.createElement("button");
    autostartButton.className = `group-autostart-toggle ${isGroupEnabled ? 'enabled' : 'disabled'}`;
    autostartButton.textContent = isGroupEnabled ? "Auto-start: Habilitado" : "Auto-start: Desabilitado";
    autostartButton.title = "Clique para alterar auto-start do grupo";
    autostartButton.addEventListener("click", async (event) => {
      const currentEnabled = state.autostart.groups.includes(name);
      const button = event.target;
      const previousGroups = [...state.autostart.groups];
      const containerIds = getGroupContainerIds(name);
      const previousPolicies = {};
      const containerMap = buildContainerMap();
      containerIds.forEach((id) => {
        const c = containerMap.get(id);
        previousPolicies[id] = (c && c.restart_policy) || "no";
      });

      // Atualizar estado (optimista)
      if (currentEnabled) {
        state.autostart.groups = state.autostart.groups.filter((g) => g !== name);
      } else {
        state.autostart.groups.push(name);
      }
      const newEnabled = !currentEnabled;
      button.disabled = true;
      button.textContent = newEnabled ? "Auto-start: Habilitado" : "Auto-start: Desabilitado";
      button.className = `group-autostart-toggle ${newEnabled ? 'enabled' : 'disabled'}`;

      try {
        await saveAutostart();
        // Ajustar restart policy dos containers do grupo para refletir no boot
        if (containerIds.length) {
          const newPolicy = newEnabled ? "unless-stopped" : "no";
          await Promise.all(containerIds.map((id) => setRestartPolicy(id, newPolicy)));
          containerIds.forEach((id) => {
            const c = containerMap.get(id);
            if (c) c.restart_policy = newPolicy;
          });
        }
        showToast(`Auto-start do grupo ${newEnabled ? 'habilitado' : 'desabilitado'}`);
      } catch (error) {
        showToast(error.message || "Erro ao salvar", true);
        // Reverter grupo e restart policy (best effort)
        state.autostart.groups = previousGroups;
        if (containerIds.length) {
          const revertPolicy = currentEnabled ? "unless-stopped" : "no";
          await Promise.all(
            containerIds.map((id) =>
              setRestartPolicy(id, previousPolicies[id] || revertPolicy).catch(() => null)
            )
          );
          containerIds.forEach((id) => {
            const c = containerMap.get(id);
            if (c) c.restart_policy = previousPolicies[id] || c.restart_policy;
          });
        }
        button.textContent = currentEnabled ? "Auto-start: Habilitado" : "Auto-start: Desabilitado";
        button.className = `group-autostart-toggle ${currentEnabled ? 'enabled' : 'disabled'}`;
      }
      button.disabled = false;
    });
    header.appendChild(autostartButton);

    const headerActions = document.createElement("div");
    headerActions.className = "group-card-header-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost small";
    deleteButton.textContent = "Excluir";
    deleteButton.addEventListener("click", () => deleteGroup(name));
    headerActions.appendChild(deleteButton);
    header.appendChild(headerActions);
    card.appendChild(header);

    const list = document.createElement("ul");
    // Editor de apelido (escondido até clicar no lápis)
    const aliasForm = document.createElement("form");
    aliasForm.className = "alias-form";
    aliasForm.classList.remove("visible");
    const aliasInput = document.createElement("input");
    aliasInput.type = "text";
    aliasInput.placeholder = "Apelido (opcional)";
    const aliasMetaForm = aliasMeta;
    aliasInput.value =
      aliasMetaForm && typeof aliasMetaForm === "object" ? aliasMetaForm.alias || "" : aliasMetaForm || "";

    const aliasRowGroup = document.createElement("div");
    aliasRowGroup.className = "icon-row";

    const aliasSpacerGroup = document.createElement("button");
    aliasSpacerGroup.type = "button";
    aliasSpacerGroup.className = "ghost small upload-placeholder";
    aliasSpacerGroup.textContent = "📤 Upload";
    aliasSpacerGroup.tabIndex = -1;
    aliasSpacerGroup.setAttribute("aria-hidden", "true");

    aliasRowGroup.appendChild(aliasInput);
    aliasRowGroup.appendChild(aliasSpacerGroup);

    const iconInput = document.createElement("input");
    iconInput.type = "text";
    iconInput.placeholder = "Ícone (URL) ex: http://icons.casaos.local/...";
    iconInput.value = aliasMetaForm && typeof aliasMetaForm === "object" ? aliasMetaForm.icon || "" : "";

    // Container para o campo de ícone e botão de upload (groups)
    const iconContainerGroup = document.createElement("div");
    iconContainerGroup.className = "icon-row";

    // Botão de upload para grupos
    const uploadButtonGroup = document.createElement("button");
    uploadButtonGroup.type = "button";
    uploadButtonGroup.className = "ghost small";
    uploadButtonGroup.textContent = "📤 Upload";
    uploadButtonGroup.title = "Upload icon image";

    // Input file oculto para grupos
    const fileInputGroup = document.createElement("input");
    fileInputGroup.type = "file";
    fileInputGroup.accept = "image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp,image/x-icon";
    fileInputGroup.style.display = "none";

    uploadButtonGroup.addEventListener("click", () => fileInputGroup.click());

    fileInputGroup.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        showToast("Arquivo muito grande. Máximo: 5MB", true);
        return;
      }

      try {
        uploadButtonGroup.disabled = true;
        uploadButtonGroup.textContent = "⏳ Enviando...";

        const formData = new FormData();
        formData.append("icon", file);

        const response = await fetch("/api/upload-icon", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Erro ao fazer upload");
        }

        iconInput.value = data.url;
        showToast("Ícone enviado com sucesso!", false);
      } catch (error) {
        showToast(error.message || "Erro ao fazer upload do ícone", true);
      } finally {
        uploadButtonGroup.disabled = false;
        uploadButtonGroup.textContent = "📤 Upload";
        fileInputGroup.value = "";
      }
    });

    iconContainerGroup.appendChild(iconInput);
    iconContainerGroup.appendChild(uploadButtonGroup);
    iconContainerGroup.appendChild(fileInputGroup);

    const saveAlias = document.createElement("button");
    saveAlias.type = "submit";
    saveAlias.className = "ghost small";
    saveAlias.textContent = "Salvar";
    const cancelAlias = document.createElement("button");
    cancelAlias.type = "button";
    cancelAlias.className = "ghost small";
    cancelAlias.textContent = "Cancelar";

    const actionsRowGroup = document.createElement("div");
    actionsRowGroup.className = "alias-actions";
    actionsRowGroup.appendChild(saveAlias);
    actionsRowGroup.appendChild(cancelAlias);

    aliasForm.appendChild(aliasRowGroup);
    aliasForm.appendChild(iconContainerGroup);
    aliasForm.appendChild(actionsRowGroup);
    card.appendChild(aliasForm);

    renameButton.addEventListener("click", () => {
      aliasForm.classList.add("visible");
      aliasInput.focus();
    });
    cancelAlias.addEventListener("click", () => {
      const meta = state.groupAliases[name];
      aliasInput.value =
        meta && typeof meta === "object" ? meta.alias || "" : meta || "";
      iconInput.value = meta && typeof meta === "object" ? meta.icon || "" : "";
      aliasForm.classList.remove("visible");
    });
    aliasForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const trimmed = aliasInput.value.trim();
      const iconTrimmed = iconInput.value.trim();
      try {
        await renameGroup(name, trimmed, iconTrimmed);
        aliasForm.classList.remove("visible");
      } catch (error) {
        showToast(error.message || "Erro ao renomear grupo.", true);
      }
    });

    (state.groups[name] || []).forEach((containerId) => {
      const info = containerMap.get(containerId);
      const item = document.createElement("li");

      const line = document.createElement("div");
      line.className = "name-with-icon";
      const displayInfo = info ? containerDisplay(info) : { main: containerId, original: "" };
      const title = document.createElement("span");
      title.textContent = displayInfo.main;
      line.appendChild(title);
      if (displayInfo.original) {
        const original = document.createElement("span");
        original.className = "meta-line small";
        original.textContent = `(${displayInfo.original})`;
        line.appendChild(original);
      }
      item.appendChild(line);

      if (info) {
        if (info.image) {
          const imgLine = document.createElement("div");
          imgLine.className = "meta-line";
          imgLine.textContent = info.image;
          item.appendChild(imgLine);
        }
        if (info.command) {
          const cmdLine = document.createElement("div");
          cmdLine.className = "meta-line meta-mono";
          cmdLine.textContent = truncateText(info.command, 60);
          item.appendChild(cmdLine);
        }
        const mountText = formatMount(info.mounts);
        if (mountText) {
          const mountLine = document.createElement("div");
          mountLine.className = "meta-line";
          mountLine.textContent = mountText;
          item.appendChild(mountLine);
        }
        if (info.ports) {
          const portsLine = document.createElement("div");
          portsLine.className = "meta-line";
          portsLine.textContent = `Ports: ${info.ports}`;
          item.appendChild(portsLine);
        }
      }

      const remove = document.createElement("button");
      remove.textContent = "x";
      remove.addEventListener("click", () => removeFromGroup(name, containerId));
      item.appendChild(remove);
      list.appendChild(item);
    });

    const hasAvailable = getGroupContainerIds(name).length > 0;
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.textContent = "Nenhum container neste grupo.";
      card.appendChild(renderGroupActionRow(name, hasAvailable));
      card.appendChild(empty);
    } else {
      card.appendChild(renderGroupActionRow(name, hasAvailable));
      card.appendChild(list);
    }
    dom.groupsList.appendChild(card);
  });
}

// ============================================
// Cards View Rendering (v2.0)
// ============================================

function renderCards() {
  if (!dom.cardsContainer) return;

  dom.cardsContainer.innerHTML = '';

  const allVisibleContainers = getVisibleContainers();
  if (!allVisibleContainers.length) {
    const empty = document.createElement('div');
    empty.style.textAlign = 'center';
    empty.style.padding = '2rem';
    empty.style.opacity = '0.6';
    empty.textContent = 'Nenhum container encontrado';
    dom.cardsContainer.appendChild(empty);
    return;
  }

  // Organize containers by group
  const selectedGroups = invertGroups();
  const groupedIds = new Set();

  // Renderizar grupos como cards
  Object.keys(state.groups).forEach(groupName => {
    const containerIds = state.groups[groupName] || [];
    if (containerIds.length === 0) return;

    const groupCard = createGroupCard(groupName, containerIds);
    dom.cardsContainer.appendChild(groupCard);

    // Mark containers as grouped
    containerIds.forEach(id => groupedIds.add(id));
  });

  // Renderizar containers sem grupo
  const standaloneContainers = allVisibleContainers.filter(c => !groupedIds.has(c.id));
  standaloneContainers.forEach(container => {
    const card = createStandaloneCard(container);
    dom.cardsContainer.appendChild(card);
  });
}

function createGroupCard(groupName, containerIds) {
  const card = document.createElement('div');
  card.className = 'group-card-glass';

  const aliasMeta = state.groupAliases?.[groupName];
  const displayName = groupLabel(groupName);

  // Ícone do grupo: preferir ícone definido no alias, senão primeiro container com ícone
  const groupIconAlias = aliasMeta && typeof aliasMeta === "object" ? aliasMeta.icon : "";
  const containerMap = buildContainerMap();
  const groupIconContainer = containerIds
    .map((id) => containerMap.get(id))
    .find((c) => c && c.icon)?.icon;
  const groupIcon = groupIconAlias || groupIconContainer;

  const isGroupEnabled = state.autostart.groups.includes(groupName);

  // Header
  const header = document.createElement('div');
  header.className = 'group-card-glass-header';

  if (groupIcon) {
    const icon = document.createElement('img');
    icon.src = groupIcon;
    icon.className = 'group-card-glass-icon';
    icon.alt = '';
    header.appendChild(icon);
  }

  const info = document.createElement('div');
  info.className = 'group-card-glass-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'group-card-glass-name';
  nameEl.textContent = displayName;
  info.appendChild(nameEl);

  const badge = document.createElement('span');
  badge.className = 'group-card-glass-badge';
  badge.textContent = `${containerIds.length} container${containerIds.length > 1 ? 's' : ''}`;
  info.appendChild(badge);

  header.appendChild(info);

  // Auto-start button (clicável, igual à página de Grupos)
  const autostartButton = document.createElement('button');
  autostartButton.className = `group-autostart-toggle ${isGroupEnabled ? 'enabled' : 'disabled'}`;
  autostartButton.textContent = isGroupEnabled ? 'Auto-start: Habilitado' : 'Auto-start: Desabilitado';
  autostartButton.title = 'Clique para alterar auto-start do grupo';
  autostartButton.addEventListener('click', async (event) => {
    const currentEnabled = state.autostart.groups.includes(groupName);
    const button = event.target;
    const previousGroups = [...state.autostart.groups];
    const previousPolicies = {};
    containerIds.forEach((id) => {
      const c = containerMap.get(id);
      previousPolicies[id] = (c && c.restart_policy) || 'no';
    });

    // Atualizar estado (optimista)
    if (currentEnabled) {
      state.autostart.groups = state.autostart.groups.filter((g) => g !== groupName);
    } else {
      state.autostart.groups.push(groupName);
    }
    const newEnabled = !currentEnabled;
    button.disabled = true;
    button.textContent = newEnabled ? 'Auto-start: Habilitado' : 'Auto-start: Desabilitado';
    button.className = `group-autostart-toggle ${newEnabled ? 'enabled' : 'disabled'}`;

    try {
      await saveAutostart();
      // Ajustar restart policy dos containers do grupo para refletir no boot
      if (containerIds.length) {
        const newPolicy = newEnabled ? 'unless-stopped' : 'no';
        await Promise.all(containerIds.map((id) => setRestartPolicy(id, newPolicy)));
        containerIds.forEach((id) => {
          const c = containerMap.get(id);
          if (c) c.restart_policy = newPolicy;
        });
      }
      showToast(`Auto-start do grupo ${newEnabled ? 'habilitado' : 'desabilitado'}`);
    } catch (error) {
      showToast(error.message || 'Erro ao salvar', true);
      // Reverter grupo e restart policy (best effort)
      state.autostart.groups = previousGroups;
      if (containerIds.length) {
        const revertPolicy = currentEnabled ? 'unless-stopped' : 'no';
        await Promise.all(
          containerIds.map((id) =>
            setRestartPolicy(id, previousPolicies[id] || revertPolicy).catch(() => null)
          )
        );
        containerIds.forEach((id) => {
          const c = containerMap.get(id);
          if (c) c.restart_policy = previousPolicies[id] || c.restart_policy;
        });
      }
      button.textContent = currentEnabled ? 'Auto-start: Habilitado' : 'Auto-start: Desabilitado';
      button.className = `group-autostart-toggle ${currentEnabled ? 'enabled' : 'disabled'}`;
    }
    button.disabled = false;
  });
  header.appendChild(autostartButton);

  card.appendChild(header);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'group-card-glass-actions';

  const startBtn = createButton('▶ Iniciar Todos', 'ghost small', () => handleGroupAction(groupName, 'start'));
  const stopBtn = createButton('■ Parar Todos', 'ghost small', () => handleGroupAction(groupName, 'stop'));
  const restartBtn = createButton('⟳ Reiniciar', 'ghost small', () => handleGroupAction(groupName, 'restart'));
  const deleteBtn = createButton('🗑 Excluir', 'ghost small', () => deleteGroup(groupName));

  actions.appendChild(startBtn);
  actions.appendChild(stopBtn);
  actions.appendChild(restartBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(actions);

  // Container list
  const list = document.createElement('div');
  list.className = 'container-list-glass';

  containerIds.forEach(cid => {
    const container = containerMap.get(cid);
    if (!container) return;

    const item = createContainerItem(container);
    list.appendChild(item);
  });

  card.appendChild(list);
  return card;
}

function createContainerItem(container) {
  const item = document.createElement('div');
  item.className = 'container-item-glass';

  const display = containerDisplay(container);

  // Icons removed - only shown on group names, not individual containers

  const details = document.createElement('div');
  details.className = 'container-item-glass-details';

  const nameEl = document.createElement('div');
  nameEl.className = 'container-item-glass-name';
  nameEl.innerHTML = `${display.main} <span class="status-pill status-${container.state === 'running' ? 'running' : 'exited'}">${container.state}</span>`;
  details.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'container-item-glass-meta';
  meta.textContent = `${container.image} • Port: ${container.ports || '—'}`;
  details.appendChild(meta);

  item.appendChild(details);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'container-item-glass-actions';

  const isRunning = container.state === 'running';
  if (isRunning) {
    actions.appendChild(createButton('■', 'ghost small', () => handleAction(container.id, 'stop')));
    actions.appendChild(createButton('⟳', 'ghost small', () => handleAction(container.id, 'restart')));
  } else {
    actions.appendChild(createButton('▶', 'ghost small', () => handleAction(container.id, 'start')));
  }

  item.appendChild(actions);
  return item;
}

function createStandaloneCard(container) {
  const card = document.createElement('div');
  card.className = 'group-card-glass';

  const display = containerDisplay(container);

  // Header
  const header = document.createElement('div');
  header.className = 'group-card-glass-header';

  if (display.icon || container.icon) {
    const icon = document.createElement('img');
    icon.src = display.icon || container.icon;
    icon.className = 'group-card-glass-icon';
    icon.alt = '';
    header.appendChild(icon);
  }

  const info = document.createElement('div');
  info.className = 'group-card-glass-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'group-card-glass-name';
  nameEl.textContent = display.main;
  info.appendChild(nameEl);

  const statusBadge = document.createElement('span');
  statusBadge.className = `status-pill status-${container.state === 'running' ? 'running' : 'exited'}`;
  statusBadge.textContent = container.state;
  info.appendChild(statusBadge);

  header.appendChild(info);
  card.appendChild(header);

  // Details
  const details = document.createElement('div');
  details.style.padding = '1rem';

  const imageLine = document.createElement('div');
  imageLine.style.marginBottom = '0.5rem';
  imageLine.innerHTML = `<strong>Image:</strong> ${container.image}`;
  details.appendChild(imageLine);

  const portsLine = document.createElement('div');
  portsLine.style.marginBottom = '0.5rem';
  portsLine.innerHTML = `<strong>Ports:</strong> ${container.ports || '—'}`;
  details.appendChild(portsLine);

  card.appendChild(details);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'group-card-glass-actions';

  const isRunning = container.state === 'running';
  if (isRunning) {
    actions.appendChild(createButton('■ Parar', 'ghost small', () => handleAction(container.id, 'stop')));
    actions.appendChild(createButton('⟳ Reiniciar', 'ghost small', () => handleAction(container.id, 'restart')));
  } else {
    actions.appendChild(createButton('▶ Iniciar', 'ghost small', () => handleAction(container.id, 'start')));
  }

  card.appendChild(actions);
  return card;
}

function createButton(text, className, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

function renderGroupActionRow(groupName, hasAvailable) {
  const row = document.createElement("div");
  row.className = "group-action-row";
  const labels = {
    start: "Iniciar",
    stop: "Parar",
    restart: "Reiniciar",
  };
  const containerStates = getGroupContainerStates(groupName);
  const isRunning = containerStates.some((s) => s === "running");
  const actions = isRunning ? ["stop", "restart"] : ["start"];
  Object.entries(labels).forEach(([action, label]) => {
    if (!actions.includes(action)) return;
    const button = document.createElement("button");
    button.className = "ghost small";
    button.textContent = label;
    button.disabled = !hasAvailable;
    button.addEventListener("click", () => handleGroupAction(groupName, action));
    row.appendChild(button);
  });
  return row;
}

function renderSelectionInfo() {
  const count = state.selected.size;
  dom.selectionInfo.textContent = count
    ? `${count} container${count > 1 ? "es" : ""} selecionado${count > 1 ? "s" : ""}`
    : "";
}

function renderGroupFilterInfo() {
  // Filtro desativado para lista principal (grupos aparecem apenas na aba Grupos)
  if (dom.groupFilterInfo) {
    dom.groupFilterInfo.hidden = true;
  }
}

function toggleGroupFilter(name) {
  // Filtro por grupo desabilitado (containers de grupos ficam apenas na aba Grupos).
  state.activeGroup = null;
}

function setView(view) {
  state.currentView = view;
  updateViewVisibility();
}

function updateViewVisibility() {
  dom.viewPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.view !== state.currentView);
  });
  dom.navItems.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.currentView);
  });
}

function t(path, fallback = "") {
  const parts = path.split(".");
  let current = state.translations[state.currentLang] || {};
  for (const part of parts) {
    current = current?.[part];
    if (!current) break;
  }
  if (typeof current === "string") return current;
  // fallback pt-BR
  current = state.translations["pt-BR"];
  for (const part of parts) {
    current = current?.[part];
    if (!current) break;
  }
  return typeof current === "string" ? current : fallback || path;
}

function applyStaticTranslations() {
  if (dom.appTitle) dom.appTitle.textContent = t("app.title");
  if (dom.appSubtitle) dom.appSubtitle.textContent = t("app.subtitle");
  if (dom.navContainers) dom.navContainers.textContent = t("nav.containers");
  if (dom.navGroups) dom.navGroups.textContent = t("nav.groups");
  if (dom.navLanguageLabel) dom.navLanguageLabel.textContent = t("nav.language");
  if (dom.refresh) dom.refresh.textContent = t("app.refresh");
  if (dom.filterInput) dom.filterInput.placeholder = t("filters.search_placeholder");
  if (dom.labelRunningOnly) dom.labelRunningOnly.textContent = t("filters.running_only");
  if (dom.thName) dom.thName.textContent = t("table.name");
  if (dom.thImage) dom.thImage.textContent = t("table.image");
  if (dom.thStatus) dom.thStatus.textContent = t("table.status");
  if (dom.thPorts) dom.thPorts.textContent = t("table.ports");
  if (dom.thGroups) dom.thGroups.textContent = t("table.groups");
  if (dom.thAutostart) dom.thAutostart.textContent = t("table.autostart");
  if (dom.thActions) dom.thActions.textContent = t("table.actions");
  if (dom.groupsTitle) dom.groupsTitle.textContent = t("groups.title");
  if (dom.createGroupInput) dom.createGroupInput.placeholder = t("groups.create_placeholder");
  if (dom.createGroupBtn) dom.createGroupBtn.textContent = t("groups.create_button");
}

function autoGroupContainers() {
  applyAutoGrouping(false);
}

function applyAutoGrouping(silent = false) {
  const groupedMap = invertGroups();
  const ungrouped = state.containers.filter(
    (container) => !(groupedMap.get(container.id) || []).length
  );

  // Agrupa por projeto (Compose) ou prefixo do nome (antes do primeiro "_").
  const candidateGroups = new Map();
  ungrouped.forEach((container) => {
    const projectKey = (container.project || "").trim();
    const nameParts = (container.name || "").split("_");
    const nameKey = nameParts.length > 1 ? nameParts[0] : (container.name || "").trim();
    const key = projectKey || nameKey;
    if (!key) return;
    if (!candidateGroups.has(key)) candidateGroups.set(key, []);
    candidateGroups.get(key).push(container.id);
  });

  let created = 0;
  let updated = 0;
  candidateGroups.forEach((ids, key) => {
    if (ids.length < 2) return; // só cria se houver mais de um para agrupar
    if (!state.groups[key]) {
      state.groups[key] = [];
      created += 1;
    }
    const existing = new Set(state.groups[key]);
    const beforeSize = existing.size;
    ids.forEach((id) => existing.add(id));
    if (existing.size !== beforeSize) {
      updated += 1;
    }
    state.groups[key] = Array.from(existing);
  });

  if (created > 0 || updated > 0) {
    const message =
      created || updated
        ? `Agrupamento automático atualizado (${created} criado${created === 1 ? "" : "s"}, ${updated} preenchido${updated === 1 ? "" : "s"}).`
        : null;
    persistGroups(silent ? null : message).catch(
      (error) => showToast(error.message || "Erro ao agrupar automaticamente.", true)
    );
  }
}

function sortContainers(containers, sortBy, sortOrder, selectedGroups) {
  const sorted = [...containers].sort((a, b) => {
    let aValue, bValue;

    switch (sortBy) {
      case 'name':
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
        break;

      case 'image':
        aValue = a.image.toLowerCase();
        bValue = b.image.toLowerCase();
        break;

      case 'state':
        aValue = a.state.toLowerCase();
        bValue = b.state.toLowerCase();
        break;

      case 'groups':
        // Ordena pela quantidade de grupos
        const aGroups = selectedGroups.get(a.id) || [];
        const bGroups = selectedGroups.get(b.id) || [];
        aValue = aGroups.length;
        bValue = bGroups.length;
        break;

      case 'autostart':
        const aAutostart = getAutostartStatus(a, selectedGroups);
        const bAutostart = getAutostartStatus(b, selectedGroups);

        aValue = aAutostart.enabled ? 1 : 0;
        bValue = bAutostart.enabled ? 1 : 0;
        break;

      default:
        return 0;
    }

    // Comparação
    let comparison = 0;
    if (aValue < bValue) {
      comparison = -1;
    } else if (aValue > bValue) {
      comparison = 1;
    }

    // Aplicar ordem (asc ou desc)
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  return sorted;
}

function getVisibleContainers() {
  const term = state.filter;
  const runningOnly = state.runningOnly;
  const selectedGroups = invertGroups();
  const groupedIds = new Set(
    Object.values(state.groups)
      .flat()
      .map((id) => id)
  );

  let filtered = state.containers.filter((container) => {
    // Containers que pertencem a grupos ficam ocultos na lista principal
    if (groupedIds.has(container.id)) return false;

    if (runningOnly && container.state !== "running") {
      return false;
    }
    if (!term) {
      return true;
    }
    const haystack = [
      container.name,
      container.image,
      container.project,
      ...(selectedGroups.get(container.id) || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });

  // Aplicar ordenação se houver
  if (state.sortBy) {
    filtered = sortContainers(filtered, state.sortBy, state.sortOrder, selectedGroups);
  }

  return filtered;
}

function buildContainerMap() {
  const map = new Map();
  state.containers.forEach((container) => map.set(container.id, container));
  return map;
}

function invertGroups() {
  const inverted = new Map();
  Object.entries(state.groups).forEach(([name, ids]) => {
    ids.forEach((id) => {
      if (!inverted.has(id)) {
        inverted.set(id, []);
      }
      inverted.get(id).push(name);
    });
  });
  return inverted;
}

function truncateText(text, max = 60) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function formatMount(mounts) {
  if (!mounts) return "";
  const first = mounts.split(",")[0]?.trim();
  if (!first) return "";
  return `Local: ${truncateText(first, 60)}`;
}

function groupLabel(name) {
  const meta = state.groupAliases?.[name];
  const alias = meta?.alias || (typeof meta === "string" ? meta : "");
  if (alias) return alias;
  if (!name) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatContainerName(name) {
  if (!name) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function containerDisplay(container) {
  if (!container) return { main: "", original: "" };
  const base = formatContainerName(container.name);
  const meta = state.containerAliases?.[container.id];
  let alias = "";
  let icon = container.icon;
  if (meta && typeof meta === "object") {
    alias = meta.alias || "";
    icon = meta.icon || icon;
  } else if (typeof meta === "string") {
    alias = meta;
  }
  return {
    main: alias || base,
    original: alias ? base : "",
    icon,
  };
}

function getAutostartStatus(container, selectedGroups) {
  const groupsForContainer = selectedGroups.get(container.id) || [];
  const enabledGroups = groupsForContainer.filter((name) => state.autostart.groups.includes(name));
  const enabledIndividually = state.autostart.containers.includes(container.id);
  const dockerPolicy = (container.restart_policy || "").trim().toLowerCase();
  const dockerRestartPolicy = ["always", "unless-stopped", "on-failure"].includes(dockerPolicy)
    ? dockerPolicy
    : null;
  const enabledByDocker = Boolean(dockerRestartPolicy);

  return {
    enabled: enabledIndividually || enabledGroups.length > 0 || enabledByDocker,
    enabledIndividually,
    enabledGroups,
    dockerRestartPolicy,
    enabledByDocker,
  };
}

function applyAutostartButtonState(button, container, selectedGroups) {
  const status = getAutostartStatus(container, selectedGroups);
  let label = "Desabilitado";
  if (status.enabledIndividually) {
    label = "Habilitado (individual)";
  } else if (status.enabledGroups.length) {
    label = "Habilitado (grupo)";
  } else if (status.enabledByDocker) {
    label = "Habilitado (Docker)";
  }
  button.textContent = label;
  button.className = `autostart-toggle ${status.enabled ? "enabled" : "disabled"}`;

  if (status.enabledGroups.length || status.enabledIndividually) {
    const sources = [];
    if (status.enabledGroups.length) {
      sources.push(`grupo(s): ${status.enabledGroups.join(", ")}`);
    }
    if (status.enabledIndividually) {
      sources.push("individual");
    }
    if (status.enabledByDocker) {
      sources.push(`Docker (${status.dockerRestartPolicy})`);
    }
    button.title = `Habilitado via ${sources.join(" + ")}`;
  } else if (status.enabledByDocker) {
    button.title = `Habilitado pela restart policy do Docker (${status.dockerRestartPolicy}). Alterar aqui não muda o Docker.`;
  } else {
    button.title = "Clique para habilitar auto-start";
  }

  return status;
}

function renderAutostartCell(container, selectedGroups) {
  const cell = document.createElement("td");
  cell.style.textAlign = "center";
  const groupsForContainer = selectedGroups.get(container.id) || [];

  // Se faz parte de um grupo, controle deve ser feito apenas na aba de grupos.
  if (groupsForContainer.length) {
    const status = getAutostartStatus(container, selectedGroups);
    const badge = document.createElement("span");
    badge.className = `autostart-toggle read-only ${status.enabled ? "enabled" : "disabled"}`;
    badge.textContent = status.enabled ? "Habilitado (grupo)" : "Desabilitado (grupo)";
    badge.title = `Gerencie o auto-start deste container na aba de Grupos (${groupsForContainer.join(", ")}).`;
    badge.setAttribute("aria-disabled", "true");
    cell.appendChild(badge);
    return cell;
  }

  // Fora de grupos: habilita/desabilita individualmente e ajusta restart policy.
  const autostartButton = document.createElement("button");
  applyAutostartButtonState(autostartButton, container, selectedGroups);
  autostartButton.addEventListener("click", async (event) => {
    const button = event.target;
    const previous = [...state.autostart.containers];
    const previousPolicy = container.restart_policy;
    const isInList = state.autostart.containers.includes(container.id);

    if (isInList) {
      state.autostart.containers = state.autostart.containers.filter((id) => id !== container.id);
    } else {
      state.autostart.containers.push(container.id);
    }

    applyAutostartButtonState(button, container, selectedGroups);

    try {
      await saveAutostart();
      const newPolicy = state.autostart.containers.includes(container.id) ? "unless-stopped" : "no";
      container.restart_policy = await setRestartPolicy(container.id, newPolicy);
      const status = applyAutostartButtonState(button, container, selectedGroups);
      const toastMsg =
        status.enabledByDocker && !status.enabledIndividually && !status.enabledGroups.length
          ? "Auto-start ativo pelo Docker (restart policy)"
          : status.enabled
          ? "Auto-start habilitado"
          : "Auto-start desabilitado";
      showToast(toastMsg);
    } catch (error) {
      showToast(error.message || "Erro ao salvar", true);
      state.autostart.containers = previous;
      container.restart_policy = previousPolicy;
      applyAutostartButtonState(button, container, selectedGroups);
    }
  });
  cell.appendChild(autostartButton);
  return cell;
}

function cleanSelection() {
  const validIds = new Set(state.containers.map((container) => container.id));
  state.selected.forEach((id) => {
    if (!validIds.has(id)) {
      state.selected.delete(id);
    }
  });
}

function getGroupContainerIds(groupName) {
  const validIds = new Set(state.containers.map((container) => container.id));
  return (state.groups[groupName] || []).filter((id) => validIds.has(id));
}

function getGroupContainerStates(groupName) {
  const valid = new Map(state.containers.map((c) => [c.id, c.state]));
  return getGroupContainerIds(groupName).map((id) => valid.get(id));
}

function updateSelectAllState() {
  const visible = getVisibleContainers();
  const selectedCount = visible.filter((container) => state.selected.has(container.id))
    .length;
  dom.selectAll.indeterminate =
    selectedCount > 0 && selectedCount < visible.length;
  dom.selectAll.checked =
    visible.length > 0 && selectedCount === visible.length;
}

async function handleAction(containerId, action) {
  try {
    await controlContainer(containerId, action);
    showToast(`Ação "${action}" enviada.`);
    await loadContainersOnly();
  } catch (error) {
    showToast(error.message || "Falha ao executar ação.", true);
  }
}

async function handleBulkAction(action) {
  if (!state.selected.size) {
    showToast("Selecione ao menos um container.", true);
    return;
  }
  try {
    await Promise.all(
      Array.from(state.selected).map((id) => controlContainer(id, action))
    );
    showToast(`Ação ${action} aplicada.`);
    await loadContainersOnly();
  } catch (error) {
    showToast(error.message || "Erro ao executar ação.", true);
  }
}

async function handleGroupAction(groupName, action) {
  const ids = getGroupContainerIds(groupName);
  if (!ids.length) {
    showToast("Nenhum container disponível neste grupo.", true);
    return;
  }
  try {
    await Promise.all(ids.map((id) => controlContainer(id, action)));
    showToast(`Ação ${action} enviada para ${groupName}.`);
    await loadContainersOnly();
  } catch (error) {
    showToast(error.message || "Erro ao aplicar ação no grupo.", true);
  }
}

async function loadContainersOnly() {
  try {
    state.containers = await loadContainers();
    applyAutoGrouping(true);
    cleanSelection();
    renderTable();
    renderGroups();
    renderSelectionInfo();
  } catch (error) {
    showToast(error.message || "Falha ao atualizar containers.", true);
  }
}

async function refreshContainersView() {
  await loadContainersOnly();
}

async function refreshGroupsView() {
  try {
    const groupsResponse = await loadGroups();
    state.groups = groupsResponse.groups;
    state.groupAliases = groupsResponse.aliases || {};
    applyAutoGrouping(true);
    renderGroups();
    renderTable();
  } catch (error) {
    showToast(error.message || "Falha ao atualizar grupos.", true);
  }
}

async function controlContainer(id, action) {
  const response = await fetch(`/api/containers/${id}/${action}`, {
    method: "POST",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.details || data.error || "Erro ao comunicar com o Docker.");
  }
  return data;
}

async function deleteGroup(name) {
  delete state.groups[name];
  delete state.groupAliases[name];
  try {
    await persistGroups("Grupo removido.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function removeFromGroup(groupName, containerId) {
  const group = state.groups[groupName] || [];
  state.groups[groupName] = group.filter((id) => id !== containerId);
  try {
    await persistGroups("Container removido do grupo.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function renameGroup(name, aliasValue, iconValue) {
  const trimmed = (aliasValue || "").trim();
  const iconTrimmed = (iconValue || "").trim();
  if (!trimmed && !iconTrimmed) {
    delete state.groupAliases[name];
  } else {
    state.groupAliases[name] = {};
    if (trimmed) state.groupAliases[name].alias = trimmed;
    if (iconTrimmed) state.groupAliases[name].icon = iconTrimmed;
  }
  await persistGroups("Grupo renomeado (apelido/ícone atualizado).");
}

function showToast(message, isError = false) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("visible", true);
  dom.toast.style.borderColor = isError ? "#f87171" : "rgba(255,255,255,0.2)";
  dom.toast.style.color = isError ? "#fecaca" : "#f8fafc";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove("visible");
  }, 4000);
}

init();
