const state = {
  containers: [],
  groups: {},
  groupAliases: {},
  containerAliases: {},
  translations: {},
  currentLang: "pt-BR",
  filter: "",
  runningOnly: false,
  organizeMode: false,
  bingBackgroundEnabled: false,
  bingBackgroundTransparency: 15,
  bingBackgroundPanelOpen: false,
  autostart: { groups: [], containers: [] },
  pinnedEmptyGroups: [],
};

const PINNED_EMPTY_GROUPS_KEY = "dockerControlPinnedEmptyGroups";
const BING_BG_ENABLED_KEY = "dockerControlBingBackgroundEnabled";
const BING_BG_CACHE_KEY = "dockerControlBingWallpaperCache";
const BING_BG_TRANSPARENCY_KEY = "dockerControlBingBackgroundTransparency";

function loadPinnedEmptyGroups() {
  try {
    const raw = localStorage.getItem(PINNED_EMPTY_GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === "string" && name.trim()) : [];
  } catch {
    return [];
  }
}

function persistPinnedEmptyGroups() {
  try {
    localStorage.setItem(PINNED_EMPTY_GROUPS_KEY, JSON.stringify(state.pinnedEmptyGroups || []));
  } catch {
    // ignore
  }
}

function pinEmptyGroup(groupName) {
  if (!groupName) return;
  const name = String(groupName).trim();
  if (!name) return;
  if (!state.pinnedEmptyGroups.includes(name)) {
    state.pinnedEmptyGroups = [...state.pinnedEmptyGroups, name];
    persistPinnedEmptyGroups();
  }
}

function unpinGroup(groupName) {
  if (!groupName) return;
  const name = String(groupName).trim();
  if (!name) return;
  const next = (state.pinnedEmptyGroups || []).filter((g) => g !== name);
  if (next.length !== (state.pinnedEmptyGroups || []).length) {
    state.pinnedEmptyGroups = next;
    persistPinnedEmptyGroups();
  }
}

function reconcilePinnedEmptyGroups() {
  const names = new Set(Object.keys(state.groups || {}));
  const next = (state.pinnedEmptyGroups || []).filter((name) => {
    if (!names.has(name)) return false;
    return (state.groups?.[name] || []).length === 0;
  });
  if (next.length !== (state.pinnedEmptyGroups || []).length) {
    state.pinnedEmptyGroups = next;
    persistPinnedEmptyGroups();
  }
}

function loadBingBackgroundEnabled() {
  try {
    return localStorage.getItem(BING_BG_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistBingBackgroundEnabled() {
  try {
    localStorage.setItem(BING_BG_ENABLED_KEY, state.bingBackgroundEnabled ? "1" : "0");
  } catch {
    // ignore
  }
}

function loadBingBackgroundTransparency() {
  try {
    const raw = localStorage.getItem(BING_BG_TRANSPARENCY_KEY);
    if (!raw) return 15;
    const num = Number(raw);
    if (!Number.isFinite(num)) return 15;
    return clamp(Math.trunc(num), 0, 90);
  } catch {
    return 15;
  }
}

function persistBingBackgroundTransparency() {
  try {
    localStorage.setItem(BING_BG_TRANSPARENCY_KEY, String(state.bingBackgroundTransparency));
  } catch {
    // ignore
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadBingWallpaperCache() {
  try {
    const raw = localStorage.getItem(BING_BG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.url !== "string" || !parsed.url.trim()) return null;
    return {
      url: parsed.url,
      title: typeof parsed.title === "string" ? parsed.title : "",
      copyright: typeof parsed.copyright === "string" ? parsed.copyright : "",
      fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
      mkt: typeof parsed.mkt === "string" ? parsed.mkt : "",
    };
  } catch {
    return null;
  }
}

function persistBingWallpaperCache(payload) {
  try {
    localStorage.setItem(
      BING_BG_CACHE_KEY,
      JSON.stringify({
        url: payload?.url || "",
        title: payload?.title || "",
        copyright: payload?.copyright || "",
        fetchedAt: Date.now(),
        mkt: payload?.mkt || "",
      })
    );
  } catch {
    // ignore
  }
}

const dom = {
  filterInput: document.getElementById("filter-input"),
  runningOnly: document.getElementById("running-only"),
  refreshContainers: document.getElementById("refresh-containers"),
  containersTitle: document.getElementById("containers-title"),
  toast: document.getElementById("toast"),
  langSelect: document.getElementById("lang-select"),
  navLanguageLabel: document.getElementById("nav-language-label"),
  appTitle: document.getElementById("app-title"),
  appSubtitle: document.getElementById("app-subtitle"),
  labelRunningOnly: document.getElementById("label-running-only"),
  cardsContainer: document.getElementById("cards-container"),
  newGroup: document.getElementById("new-group"),
  newFromDockerfile: document.getElementById("new-from-dockerfile"),
  newFromCommand: document.getElementById("new-from-command"),
  organizeToggle: document.getElementById("toggle-organize"),
  bingToggle: document.getElementById("toggle-bing-bg"),
  bingWallpaper: document.getElementById("bing-wallpaper"),
  bingControl: document.getElementById("bing-bg-control"),
  bingPanel: document.getElementById("bing-bg-panel"),
  bingEnabled: document.getElementById("bing-bg-enabled"),
  bingEnabledLabel: document.getElementById("bing-bg-enabled-label"),
  bingTransparency: document.getElementById("bing-bg-transparency"),
  bingTransparencyLabel: document.getElementById("bing-bg-transparency-label"),
  bingTransparencyValue: document.getElementById("bing-bg-transparency-value"),
};

let toastTimer;
const dragState = { draggingCard: null };
const defaultTranslations = {
  "pt-BR": {},
  en: {},
};

async function init() {
  await loadTranslations();
  state.pinnedEmptyGroups = loadPinnedEmptyGroups();
  state.bingBackgroundEnabled = loadBingBackgroundEnabled();
  state.bingBackgroundTransparency = loadBingBackgroundTransparency();
  applyContainersPanelOpacity();
  updateBingBackgroundUI();
  applyBingWallpaperFromCache();
  updateOrganizeModeUI();
  attachEvents();
  await loadAll();

  if (state.bingBackgroundEnabled) {
    refreshBingWallpaper({ silent: true }).catch(() => null);
  }
}

function attachEvents() {
  if (dom.filterInput) {
    dom.filterInput.addEventListener("input", (event) => {
      state.filter = (event.target.value || "").toLowerCase();
      render();
    });
  }

  if (dom.runningOnly) {
    dom.runningOnly.addEventListener("change", (event) => {
      state.runningOnly = Boolean(event.target.checked);
      render();
    });
  }

  if (dom.langSelect) {
    dom.langSelect.addEventListener("change", () => {
      state.currentLang = dom.langSelect.value;
      applyStaticTranslations();
      updateOrganizeModeUI();
      updateBingBackgroundUI();
      render();
      if (state.bingBackgroundEnabled) {
        refreshBingWallpaper({ silent: true }).catch(() => null);
      }
    });
  }

  if (dom.refreshContainers) {
    dom.refreshContainers.addEventListener("click", () => loadAll());
  }

  if (dom.newFromDockerfile) {
    dom.newFromDockerfile.addEventListener("click", openNewContainerFromDockerfile);
  }
  if (dom.newFromCommand) {
    dom.newFromCommand.addEventListener("click", openNewContainerFromCommand);
  }
  if (dom.newGroup) {
    dom.newGroup.addEventListener("click", openNewGroup);
  }

  if (dom.organizeToggle) {
    dom.organizeToggle.addEventListener("click", () => setOrganizeMode(!state.organizeMode));
  }

  if (dom.bingToggle) {
    dom.bingToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setBingBackgroundPanelOpen(!state.bingBackgroundPanelOpen);
    });
  }

  if (dom.bingEnabled) {
    dom.bingEnabled.addEventListener("change", () => {
      setBingBackgroundEnabled(Boolean(dom.bingEnabled.checked)).catch((error) =>
        showToast(error.message || t("errors.toggle_background", "Error toggling background."), true)
      );
    });
  }

  if (dom.bingTransparency) {
    dom.bingTransparency.addEventListener("input", () => {
      const value = clamp(Math.trunc(Number(dom.bingTransparency.value)), 0, 90);
      setBingBackgroundTransparency(value);
    });
  }

  document.addEventListener("click", (event) => {
    if (!state.bingBackgroundPanelOpen) return;
    const inside = event.target?.closest?.("#bing-bg-control");
    if (inside) return;
    setBingBackgroundPanelOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!state.bingBackgroundPanelOpen) return;
    setBingBackgroundPanelOpen(false);
  });

  if (dom.cardsContainer) {
    dom.cardsContainer.addEventListener("dragover", handleCardsContainerDragOver);
    dom.cardsContainer.addEventListener("drop", (event) => {
      if (state.organizeMode) event.preventDefault();
    });
  }
}

function parseOrderValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function updateOrganizeModeUI() {
  document.body.classList.toggle("organize-mode", state.organizeMode);

  if (dom.filterInput) dom.filterInput.disabled = state.organizeMode;
  if (dom.runningOnly) dom.runningOnly.disabled = state.organizeMode;

  if (dom.organizeToggle) {
    dom.organizeToggle.classList.toggle("active", state.organizeMode);
    dom.organizeToggle.textContent = state.organizeMode
      ? t("quick.organize_active", "✓ Organizing")
      : t("quick.organize", "↕ Organize");
    dom.organizeToggle.title = state.organizeMode
      ? t("quick.organize_exit_title", "Click to exit organize mode")
      : t("quick.organize_title", "Reorder cards (drag and drop)");
  }
}

function setOrganizeMode(enabled) {
  state.organizeMode = Boolean(enabled);

  if (state.organizeMode) {
    state.filter = "";
    if (dom.filterInput) dom.filterInput.value = "";
    state.runningOnly = false;
    if (dom.runningOnly) dom.runningOnly.checked = false;
  }

  updateOrganizeModeUI();
  render();

  showToast(
    state.organizeMode
      ? t("toast.organize_enabled", "Organize mode enabled: drag cards.")
      : t("toast.organize_disabled", "Organize mode disabled.")
  );
}

function updateBingBackgroundUI() {
  if (!dom.bingToggle) return;
  dom.bingToggle.classList.toggle("active", state.bingBackgroundEnabled);
  const baseLabel = t("bing.button", "🌄 Bing background");
  dom.bingToggle.textContent = state.bingBackgroundEnabled ? `${baseLabel} ✓` : baseLabel;
  dom.bingToggle.title = state.bingBackgroundEnabled
    ? t("bing.title_disable", "Click to disable Bing background")
    : t("bing.title_enable", "Click to enable Bing background");

  if (dom.bingEnabled) dom.bingEnabled.checked = state.bingBackgroundEnabled;
  if (dom.bingTransparency) dom.bingTransparency.value = String(state.bingBackgroundTransparency);
  if (dom.bingTransparencyValue) dom.bingTransparencyValue.textContent = `${state.bingBackgroundTransparency}%`;
}

function applyContainersPanelOpacity() {
  const opacity = 1 - clamp(state.bingBackgroundTransparency, 0, 90) / 100;
  document.documentElement.style.setProperty("--containers-panel-opacity", String(opacity));
}

function setBingBackgroundPanelOpen(open) {
  state.bingBackgroundPanelOpen = Boolean(open);
  if (dom.bingPanel) dom.bingPanel.hidden = !state.bingBackgroundPanelOpen;
}

function setBingBackgroundTransparency(value) {
  state.bingBackgroundTransparency = clamp(Math.trunc(Number(value)), 0, 90);
  persistBingBackgroundTransparency();
  applyContainersPanelOpacity();
  updateBingBackgroundUI();
}

function applyBingWallpaper(payload) {
  if (!dom.bingWallpaper) return;
  const url = String(payload?.url || "").trim();
  if (!url) return;
  dom.bingWallpaper.style.backgroundImage = `url(\"${url}\")`;
  dom.bingWallpaper.classList.add("visible");
  const credit = String(payload?.copyright || payload?.title || "").trim();
  if (credit) dom.bingWallpaper.title = credit;
}

function clearBingWallpaper() {
  if (!dom.bingWallpaper) return;
  dom.bingWallpaper.classList.remove("visible");
  dom.bingWallpaper.style.backgroundImage = "";
  dom.bingWallpaper.title = "";
}

function applyBingWallpaperFromCache() {
  if (!state.bingBackgroundEnabled) return;
  const cached = loadBingWallpaperCache();
  if (!cached) return;
  applyBingWallpaper(cached);
}

function getBingMarket() {
  if (state.currentLang === "pt-BR") return "pt-BR";
  return "en-US";
}

async function fetchBingWallpaper() {
  const market = getBingMarket();
  const response = await fetch(`/api/bing-wallpaper?mkt=${encodeURIComponent(market)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.details || data.error || t("errors.bing_fetch", "Failed to fetch Bing wallpaper."));
  }
  if (!data?.url) throw new Error(t("errors.bing_invalid", "Invalid wallpaper."));
  return data;
}

async function refreshBingWallpaper({ silent } = {}) {
  if (!state.bingBackgroundEnabled) return;
  const payload = await fetchBingWallpaper();
  applyBingWallpaper(payload);
  persistBingWallpaperCache(payload);
  if (!silent) showToast(t("toast.bing_updated", "Bing background updated."));
}

async function setBingBackgroundEnabled(enabled) {
  state.bingBackgroundEnabled = Boolean(enabled);
  persistBingBackgroundEnabled();
  updateBingBackgroundUI();

  if (!state.bingBackgroundEnabled) {
    clearBingWallpaper();
    setBingBackgroundPanelOpen(false);
    showToast(t("toast.bing_disabled", "Bing background disabled."));
    return;
  }

  applyBingWallpaperFromCache();
  const hasCachedWallpaper = Boolean(dom.bingWallpaper?.style?.backgroundImage);

  try {
    await refreshBingWallpaper({ silent: true });
    showToast(t("toast.bing_enabled", "Bing background enabled."));
  } catch (error) {
    if (hasCachedWallpaper) {
      showToast(error.message || t("errors.bing_update_failed", "Failed to update Bing background."), true);
      return;
    }
    state.bingBackgroundEnabled = false;
    persistBingBackgroundEnabled();
    updateBingBackgroundUI();
    clearBingWallpaper();
    throw error;
  }
}

function ensureGroupAliasObject(groupName) {
  const meta = state.groupAliases?.[groupName];
  if (meta && typeof meta === "object") return meta;
  if (typeof meta === "string" && meta.trim()) {
    state.groupAliases[groupName] = { alias: meta.trim() };
    return state.groupAliases[groupName];
  }
  state.groupAliases[groupName] = {};
  return state.groupAliases[groupName];
}

function ensureContainerAliasObject(containerId) {
  const meta = state.containerAliases?.[containerId];
  if (meta && typeof meta === "object") return meta;
  if (typeof meta === "string" && meta.trim()) {
    state.containerAliases[containerId] = { alias: meta.trim() };
    return state.containerAliases[containerId];
  }
  state.containerAliases[containerId] = {};
  return state.containerAliases[containerId];
}

function applyCardDragMeta(card, cardType, cardKey) {
  if (!card) return;
  card.dataset.cardType = cardType;
  card.dataset.cardKey = cardKey;

  const isPinnedEmpty = card.classList.contains("pinned-empty-group");
  card.draggable = state.organizeMode && !isPinnedEmpty;

  card.addEventListener("dragstart", (event) => {
    if (!state.organizeMode) return;
    if (card.classList.contains("pinned-empty-group")) {
      event.preventDefault();
      return;
    }

    dragState.draggingCard = card;
    card.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `${cardType}:${cardKey}`);
    }
  });

  card.addEventListener("dragend", () => {
    if (dragState.draggingCard === card) dragState.draggingCard = null;
    card.classList.remove("dragging");
    if (!state.organizeMode) return;
    persistCardOrderFromDom().catch((error) =>
      showToast(error.message || t("errors.save_order", "Error saving order."), true)
    );
  });
}

function handleCardsContainerDragOver(event) {
  if (!state.organizeMode) return;
  if (!dom.cardsContainer) return;

  event.preventDefault();

  const dragging = dragState.draggingCard;
  if (!dragging) return;

  const target = event.target?.closest?.(".group-card-glass");
  if (!target || target === dragging) return;
  if (target.classList.contains("pinned-empty-group")) return;

  const rect = target.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  dom.cardsContainer.insertBefore(dragging, insertAfter ? target.nextSibling : target);
}

async function persistCardOrderFromDom() {
  if (!dom.cardsContainer) return;

  const cards = Array.from(dom.cardsContainer.querySelectorAll(".group-card-glass")).filter(
    (card) =>
      !card.classList.contains("pinned-empty-group") &&
      card.dataset.cardType &&
      card.dataset.cardKey
  );

  if (!cards.length) return;

  const containerPayload = {};

  cards.forEach((card, index) => {
    const cardType = card.dataset.cardType;
    const cardKey = card.dataset.cardKey;
    const order = index;

    if (cardType === "group") {
      const meta = ensureGroupAliasObject(cardKey);
      meta.order = order;
      return;
    }

    if (cardType === "container") {
      const meta = ensureContainerAliasObject(cardKey);
      meta.order = order;
      containerPayload[cardKey] = meta;
    }
  });

  await Promise.all([
    persistGroups(null, { renderAfter: false }),
    saveContainerAliasesBatch(containerPayload),
  ]);

  showToast(t("toast.order_saved", "Order saved."));
}

async function loadAll() {
  try {
    const [containers, groupsResponse, autostart] = await Promise.all([
      loadContainers(),
      loadGroups(),
      loadAutostart(),
    ]);
    state.containers = containers;
    state.groups = groupsResponse.groups;
    state.groupAliases = groupsResponse.aliases || {};
    state.autostart = autostart;
    reconcilePinnedEmptyGroups();

    applyAutoGrouping(true);
    render();
  } catch (error) {
    showToast(error.message || t("errors.load_data", "Error loading data."), true);
  }
}

async function loadTranslations() {
  try {
    const response = await fetch("/static/translations.json");
    const data = await response.json();
    state.translations = { ...defaultTranslations, ...data };
  } catch {
    state.translations = defaultTranslations;
  }
  applyStaticTranslations();
}

function t(path, fallback = "") {
  const parts = path.split(".");
  let current = state.translations[state.currentLang] || {};
  for (const part of parts) {
    current = current?.[part];
    if (!current) break;
  }
  if (typeof current === "string") return current;
  current = state.translations["pt-BR"] || {};
  for (const part of parts) {
    current = current?.[part];
    if (!current) break;
  }
  return typeof current === "string" ? current : fallback || path;
}

function applyStaticTranslations() {
  document.documentElement.lang = state.currentLang === "en" ? "en" : "pt-BR";
  if (dom.appTitle) dom.appTitle.textContent = t("app.title");
  if (dom.appSubtitle) dom.appSubtitle.textContent = t("app.subtitle");
  if (dom.navLanguageLabel) dom.navLanguageLabel.textContent = t("nav.language");
  if (dom.containersTitle) dom.containersTitle.textContent = t("nav.containers", "Containers");
  if (dom.refreshContainers) dom.refreshContainers.title = t("panel.refresh_containers", "Refresh containers");
  if (dom.newGroup) dom.newGroup.textContent = t("quick.new_group", "➕ New group");
  if (dom.newFromDockerfile) dom.newFromDockerfile.textContent = t("quick.new_dockerfile", "➕ New via Dockerfile");
  if (dom.newFromCommand) dom.newFromCommand.textContent = t("quick.new_cli", "➕ New via CLI");
  if (dom.organizeToggle) {
    dom.organizeToggle.textContent = t("quick.organize", "↕ Organize");
    dom.organizeToggle.title = t("quick.organize_title", "Reorder cards (drag and drop)");
  }
  if (dom.bingToggle) {
    dom.bingToggle.textContent = t("bing.button", "🌄 Bing background");
    dom.bingToggle.title = t("bing.config_title", "Configure Bing background");
  }
  if (dom.bingEnabledLabel) dom.bingEnabledLabel.textContent = t("bing.enable", "Enable background");
  if (dom.bingTransparencyLabel) dom.bingTransparencyLabel.textContent = t("bing.transparency", "Transparency");
  if (dom.filterInput) dom.filterInput.placeholder = t("filters.search_placeholder");
  if (dom.labelRunningOnly) dom.labelRunningOnly.textContent = t("filters.running_only");
}

async function loadContainers() {
  const response = await fetch("/api/containers");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("errors.list_containers", "Failed to list containers."));
  }
  state.containerAliases = data.aliases || {};
  return data.containers || [];
}

async function loadGroups() {
  const response = await fetch("/api/groups");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("errors.load_groups", "Failed to load groups."));
  }
  return {
    groups: data.groups || {},
    aliases: data.aliases || {},
  };
}

async function persistGroups(successMessage, options = {}) {
  const renderAfter = options.renderAfter !== false;

  const response = await fetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groups: state.groups, aliases: state.groupAliases }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || t("errors.save_groups", "Failed to save groups."));
  }
  state.groups = body.groups || {};
  state.groupAliases = body.aliases || {};
  if (renderAfter) render();
  if (successMessage) showToast(successMessage);
}

async function loadAutostart() {
  const response = await fetch("/api/autostart");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("errors.load_autostart", "Failed to load auto-start."));
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
    throw new Error(body.error || t("errors.save_autostart", "Failed to save auto-start."));
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
    throw new Error(data.details || data.error || t("errors.restart_policy", "Failed to update restart policy."));
  }
  return data.restart_policy || policy;
}

async function saveContainerAlias(containerId, aliasValue, iconValue) {
  const existingMeta = state.containerAliases?.[containerId];
  const orderValue = existingMeta && typeof existingMeta === "object" ? parseOrderValue(existingMeta.order) : null;
  const payload = { alias: aliasValue || "", icon: iconValue || "" };
  if (orderValue !== null) payload.order = orderValue;

  const response = await fetch("/api/container-aliases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aliases: { [containerId]: payload },
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("errors.save_alias", "Failed to save alias."));
  }
  state.containerAliases = data.aliases || {};
}

async function saveContainerAliasesBatch(aliases) {
  const response = await fetch("/api/container-aliases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aliases: aliases || {} }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("errors.save_order", "Failed to save order."));
  }
  state.containerAliases = data.aliases || {};
}

function render() {
  renderCards();
}

function applyAutoGrouping(silent = false) {
  const groupedMap = invertGroups();
  const ungrouped = state.containers.filter(
    (container) => !(groupedMap.get(container.id) || []).length
  );

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
    if (ids.length < 2) return;
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
    const message = `Agrupamento automático atualizado (${created} criado${
      created === 1 ? "" : "s"
    }, ${updated} preenchido${updated === 1 ? "" : "s"}).`;
    persistGroups(silent ? null : message).catch((error) =>
      showToast(error.message || t("errors.auto_group", "Error auto-grouping."), true)
    );
  }
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
      if (!inverted.has(id)) inverted.set(id, []);
      inverted.get(id).push(name);
    });
  });
  return inverted;
}

function getVisibleContainers(includeGrouped = false) {
  const term = state.filter;
  const runningOnly = state.runningOnly;
  const selectedGroups = invertGroups();
  const groupedIds = new Set(Object.values(state.groups).flat());

  const filtered = state.containers.filter((container) => {
    if (!includeGrouped && groupedIds.has(container.id)) return false;
    if (runningOnly && container.state !== "running") return false;
    if (!term) return true;

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

  filtered.sort((a, b) =>
    containerDisplay(a).main.localeCompare(containerDisplay(b).main, undefined, {
      sensitivity: "base",
    })
  );

  return filtered;
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
  const trimmed = String(name).trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function containerDisplay(container) {
  if (!container) return { main: "", original: "", icon: "" };
  const baseName = formatContainerName(container.name);
  const fallbackName = baseName || (container.id ? String(container.id).slice(0, 12) : "");
  const meta = state.containerAliases?.[container.id];
  let alias = "";
  let icon = container.icon;
  if (meta && typeof meta === "object") {
    alias = meta.alias || "";
    icon = meta.icon || icon;
  } else if (typeof meta === "string") {
    alias = meta;
  }
  const main = alias || fallbackName;
  return {
    main,
    original: alias ? fallbackName : "",
    icon,
  };
}

function getContainerActions(container) {
  if (!container) return [];
  return container.state === "running" ? ["stop", "restart", "delete"] : ["start", "delete"];
}

function actionLabel(action) {
  switch (action) {
    case "start":
      return t("actions.start");
    case "stop":
      return t("actions.stop");
    case "restart":
      return t("actions.restart");
    case "delete":
      return t("actions.delete");
    default:
      return action;
  }
}

function actionIcon(action) {
  switch (action) {
    case "start":
      return "▶";
    case "stop":
      return "■";
    case "restart":
      return "⟳";
    case "delete":
      return "🗑";
    default:
      return action;
  }
}

function getGroupContainerIds(groupName) {
  const validIds = new Set(state.containers.map((container) => container.id));
  return (state.groups[groupName] || []).filter((id) => validIds.has(id));
}

function getGroupContainerStates(groupName) {
  const valid = new Map(state.containers.map((c) => [c.id, c.state]));
  return getGroupContainerIds(groupName).map((id) => valid.get(id));
}

function getGroupActions(groupName) {
  const states = getGroupContainerStates(groupName);
  if (!states.length) return ["delete"];
  const hasRunning = states.some((s) => s === "running");
  return hasRunning ? ["stop", "restart", "delete"] : ["start", "delete"];
}

function groupActionLabel(action) {
  switch (action) {
    case "start":
      return t("groups.actions.start_all", "Start all");
    case "stop":
      return t("groups.actions.stop_all", "Stop all");
    case "restart":
      return t("groups.actions.restart_all", "Restart all");
    case "delete":
      return t("groups.actions.delete_group", "Delete group");
    default:
      return action;
  }
}

function createButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function showToast(message, isError = false) {
  if (!dom.toast) {
    if (isError) console.error(message);
    return;
  }
  dom.toast.textContent = String(message);
  dom.toast.classList.toggle("visible", true);
  dom.toast.style.borderColor = isError ? "#f87171" : "rgba(255,255,255,0.2)";
  dom.toast.style.color = isError ? "#fecaca" : "#f8fafc";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast?.classList.remove("visible");
  }, 4000);
}

function openModal({ title, body, confirmText, onConfirm }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const modal = document.createElement("div");
  modal.className = "modal";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  modal.appendChild(h3);
  modal.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "ghost";
  cancelBtn.textContent = t("common.cancel", "Cancel");

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "ghost";
  confirmBtn.textContent = confirmText || t("common.save", "Save");

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  modal.appendChild(actions);

  cancelBtn.addEventListener("click", () => backdrop.remove());
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      await onConfirm();
      backdrop.remove();
    } catch (error) {
      showToast(error.message || t("errors.save", "Error saving"), true);
    } finally {
      confirmBtn.disabled = false;
    }
  });

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

function renderCards() {
  if (!dom.cardsContainer) return;

  dom.cardsContainer.innerHTML = "";

  reconcilePinnedEmptyGroups();

  const visibleContainers = getVisibleContainers(true);
  const visibleContainerIds = new Set(visibleContainers.map((c) => c.id));

  const hasTerm = Boolean(state.filter);
  const term = state.filter;

  const pinnedEmptyGroups = (state.pinnedEmptyGroups || []).filter(
    (name) => (state.groups?.[name] || []).length === 0
  );
  const pinnedSet = new Set(pinnedEmptyGroups);

  let hasAnyCard = false;

  // Grupos recém-criados e vazios: sempre no topo, ocupando a largura toda.
  pinnedEmptyGroups.forEach((groupName) => {
    const allGroupContainerIds = getGroupContainerIds(groupName);
    const visibleGroupContainerIds = allGroupContainerIds.filter((id) => visibleContainerIds.has(id));
    const groupCard = createGroupCard(groupName, visibleGroupContainerIds, allGroupContainerIds);
    groupCard.classList.add("pinned-empty-group");
    applyCardDragMeta(groupCard, "group", groupName);
    dom.cardsContainer.appendChild(groupCard);
    hasAnyCard = true;
  });

  const selectedGroups = invertGroups();
  const standaloneContainersOnly = getVisibleContainers(false);

  const cards = [];

  Object.keys(state.groups || {})
    .filter((name) => !pinnedSet.has(name))
    .forEach((groupName) => {
      const allGroupContainerIds = getGroupContainerIds(groupName);
      const visibleGroupContainerIds = allGroupContainerIds.filter((id) => visibleContainerIds.has(id));

      const label = groupLabel(groupName);
      const matchesGroupName =
        hasTerm &&
        [groupName, label]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term));

      const showGroup = hasTerm
        ? matchesGroupName || visibleGroupContainerIds.length > 0
        : state.runningOnly
        ? visibleGroupContainerIds.length > 0
        : true;

      if (!showGroup) return;

      cards.push({
        kind: "group",
        key: groupName,
        label,
        allGroupContainerIds,
        visibleGroupContainerIds,
      });
    });

  standaloneContainersOnly.forEach((container) => {
    const label = containerDisplay(container).main;
    cards.push({ kind: "container", key: container.id, label, container });
  });

  cards.sort((a, b) => {
    const orderA =
      a.kind === "group"
        ? parseOrderValue(state.groupAliases?.[a.key]?.order)
        : parseOrderValue(state.containerAliases?.[a.key]?.order);
    const orderB =
      b.kind === "group"
        ? parseOrderValue(state.groupAliases?.[b.key]?.order)
        : parseOrderValue(state.containerAliases?.[b.key]?.order);

    if (orderA !== null && orderB !== null) {
      if (orderA !== orderB) return orderA - orderB;
    } else if (orderA !== null) {
      return -1;
    } else if (orderB !== null) {
      return 1;
    } else {
      const typeRankA = a.kind === "group" ? 0 : 1;
      const typeRankB = b.kind === "group" ? 0 : 1;
      if (typeRankA !== typeRankB) return typeRankA - typeRankB;
    }

    const labelCompare = (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" });
    if (labelCompare !== 0) return labelCompare;
    return (a.key || "").localeCompare(b.key || "", undefined, { sensitivity: "base" });
  });

  cards.forEach((entry) => {
    if (entry.kind === "group") {
      const groupCard = createGroupCard(
        entry.key,
        entry.visibleGroupContainerIds,
        entry.allGroupContainerIds
      );
      applyCardDragMeta(groupCard, "group", entry.key);
      dom.cardsContainer.appendChild(groupCard);
    } else {
      const card = createStandaloneCard(entry.container, selectedGroups);
      applyCardDragMeta(card, "container", entry.key);
      dom.cardsContainer.appendChild(card);
    }
    hasAnyCard = true;
  });

  if (!hasAnyCard) {
    const empty = document.createElement("div");
    empty.style.textAlign = "center";
    empty.style.padding = "2rem";
    empty.style.opacity = "0.6";
    empty.textContent = t("cards.empty", "No containers found.");
    dom.cardsContainer.appendChild(empty);
  }
}

function computeGroupStatus(containerIds) {
  const containerMap = buildContainerMap();
  let running = 0;
  let total = 0;

  containerIds.forEach((id) => {
    const c = containerMap.get(id);
    if (!c) return;
    total += 1;
    if ((c.state || "").toLowerCase() === "running") {
      running += 1;
    }
  });

  if (total === 0) {
    return { running: 0, total: 0, label: t("groups.status.empty", "No containers"), className: "status-exited" };
  }
  if (running === total) {
    return {
      running,
      total,
      label: `${total}/${total} ${t("groups.status.running_suffix", "running")}`,
      className: "status-running",
    };
  }
  if (running === 0) {
    return {
      running,
      total,
      label: `${t("groups.status.stopped_prefix", "Stopped")} (${total})`,
      className: "status-exited",
    };
  }
  return {
    running,
    total,
    label: `${running}/${total} ${t("groups.status.running_suffix", "running")}`,
    className: "status-mixed",
  };
}

function openAddContainersToGroup(groupName) {
  const existingIds = new Set(getGroupContainerIds(groupName));
  const candidates = state.containers
    .filter((c) => c && c.id && !existingIds.has(c.id))
    .sort((a, b) =>
      containerDisplay(a).main.localeCompare(containerDisplay(b).main, undefined, {
        sensitivity: "base",
      })
    );

  if (!candidates.length) {
    showToast(t("groups.add.none_available", "No containers available to add."), true);
    return;
  }

  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.65rem";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = t("groups.add.search_placeholder", "Search containers…");
  body.appendChild(search);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "0.35rem";
  list.style.maxHeight = "50vh";
  list.style.overflow = "auto";
  body.appendChild(list);

  const checkboxById = new Map();

  const renderList = () => {
    list.innerHTML = "";
    const term = (search.value || "").trim().toLowerCase();
    const filtered = term
      ? candidates.filter((c) => {
          const display = containerDisplay(c);
          const haystack = [display.main, display.original, c.name, c.image, c.project]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        })
      : candidates;

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.75";
      empty.textContent = t("table.empty", "No containers found.");
      list.appendChild(empty);
      return;
    }

    filtered.forEach((c) => {
      const row = document.createElement("label");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "0.5rem";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkboxById.set(c.id, checkbox);

      const text = document.createElement("span");
      const display = containerDisplay(c);
      const stateLabel =
        (c.state || "").toLowerCase() === "running"
          ? t("status.running", "running")
          : t("status.stopped", "stopped");
      text.textContent = `${display.main} • ${stateLabel} • ${c.image || "—"}`;

      row.appendChild(checkbox);
      row.appendChild(text);
      list.appendChild(row);
    });
  };

  search.addEventListener("input", renderList);
  renderList();

  openModal({
    title: `${t("groups.add.modal_title_prefix", "Add containers to")} "${groupLabel(groupName)}"`,
    body,
    confirmText: t("common.add", "Add"),
    onConfirm: async () => {
      const chosen = [];
      candidates.forEach((c) => {
        const checkbox = checkboxById.get(c.id);
        if (checkbox?.checked) chosen.push(c.id);
      });

      if (!chosen.length) {
        showToast(t("groups.add.select_at_least_one", "Select at least one container."), true);
        return;
      }

      if (!state.groups[groupName]) state.groups[groupName] = [];
      const next = new Set(state.groups[groupName]);
      chosen.forEach((id) => next.add(id));
      state.groups[groupName] = Array.from(next);

      await persistGroups(t("groups.add.added_to_group", "Containers added to the group."));
    },
  });

  setTimeout(() => search.focus(), 0);
}

function createGroupCard(groupName, visibleContainerIds, allContainerIds) {
  const card = document.createElement("div");
  card.className = "group-card-glass";

  const groupContainerIds = Array.isArray(allContainerIds) ? allContainerIds : [];
  const containerMap = buildContainerMap();

  const aliasMeta = state.groupAliases?.[groupName];
  const displayName = groupLabel(groupName);

  const groupIconAlias = aliasMeta && typeof aliasMeta === "object" ? aliasMeta.icon : "";
  const groupIconContainer = groupContainerIds
    .map((id) => containerMap.get(id))
    .find((c) => c && c.icon)?.icon;
  const groupIcon = groupIconAlias || groupIconContainer;

  const header = document.createElement("div");
  header.className = "group-card-glass-header";

  if (groupIcon) {
    const icon = document.createElement("img");
    icon.src = groupIcon;
    icon.className = "group-card-glass-icon";
    icon.alt = "";
    header.appendChild(icon);
  }

  const info = document.createElement("div");
  info.className = "group-card-glass-info";

  const nameRow = document.createElement("div");
  nameRow.className = "group-card-glass-name-row";

  const nameEl = document.createElement("div");
  nameEl.className = "group-card-glass-name";
  nameEl.textContent = displayName;
  nameRow.appendChild(nameEl);

  const aliasEditor = createGroupAliasEditor(groupName, () => render());
  nameRow.appendChild(aliasEditor.button);
  info.appendChild(nameRow);

  const statsRow = document.createElement("div");
  statsRow.className = "group-card-stats-row";

  const badge = document.createElement("span");
  badge.className = "group-card-glass-badge";
  const containerWord =
    groupContainerIds.length === 1 ? t("cards.container_singular", "container") : t("cards.container_plural", "containers");
  badge.textContent = `${groupContainerIds.length} ${containerWord}`;
  statsRow.appendChild(badge);

  const groupStatus = computeGroupStatus(groupContainerIds);
  const statusPill = document.createElement("span");
  statusPill.className = `status-pill ${groupStatus.className}`;
  statusPill.textContent = groupStatus.label;
  statsRow.appendChild(statusPill);

  info.appendChild(statsRow);
  header.appendChild(info);

  const isGroupEnabled = state.autostart.groups.includes(groupName);
  const autostartButton = document.createElement("button");
  autostartButton.className = `group-autostart-toggle ${isGroupEnabled ? "enabled" : "disabled"}`;
  autostartButton.textContent = isGroupEnabled ? t("autostart.enabled") : t("autostart.disabled");
  autostartButton.title = t("autostart.group_toggle_title", "Toggle group auto-start");
  autostartButton.addEventListener("click", async (event) => {
    const currentEnabled = state.autostart.groups.includes(groupName);
    const button = event.target;
    const previousGroups = [...state.autostart.groups];
    const previousPolicies = {};
    groupContainerIds.forEach((id) => {
      const c = containerMap.get(id);
      previousPolicies[id] = (c && c.restart_policy) || "no";
    });

    if (currentEnabled) {
      state.autostart.groups = state.autostart.groups.filter((g) => g !== groupName);
    } else {
      state.autostart.groups.push(groupName);
    }
    const newEnabled = !currentEnabled;
    button.disabled = true;
    button.textContent = newEnabled ? t("autostart.enabled") : t("autostart.disabled");
    button.className = `group-autostart-toggle ${newEnabled ? "enabled" : "disabled"}`;

    try {
      await saveAutostart();
      if (groupContainerIds.length) {
        const newPolicy = newEnabled ? "unless-stopped" : "no";
        await Promise.all(groupContainerIds.map((id) => setRestartPolicy(id, newPolicy)));
        groupContainerIds.forEach((id) => {
          const c = containerMap.get(id);
          if (c) c.restart_policy = newPolicy;
        });
      }
      showToast(
        newEnabled ? t("autostart.group_enabled_toast", "Group auto-start enabled") : t("autostart.group_disabled_toast", "Group auto-start disabled")
      );
    } catch (error) {
      showToast(error.message || t("errors.save", "Error saving"), true);
      state.autostart.groups = previousGroups;
      if (groupContainerIds.length) {
        const revertPolicy = currentEnabled ? "unless-stopped" : "no";
        await Promise.all(
          groupContainerIds.map((id) =>
            setRestartPolicy(id, previousPolicies[id] || revertPolicy).catch(() => null)
          )
        );
        groupContainerIds.forEach((id) => {
          const c = containerMap.get(id);
          if (c) c.restart_policy = previousPolicies[id] || c.restart_policy;
        });
      }
      button.textContent = currentEnabled ? t("autostart.enabled") : t("autostart.disabled");
      button.className = `group-autostart-toggle ${currentEnabled ? "enabled" : "disabled"}`;
    }
    button.disabled = false;
  });
  header.appendChild(autostartButton);

  const expandBtn = document.createElement("button");
  expandBtn.className = "card-expand-btn";
  expandBtn.textContent = "▼";
  expandBtn.title = t("cards.expand_collapse", "Expand/collapse");

  const quickActions = document.createElement("div");
  quickActions.className = "card-quick-actions";

  const addQuickBtn = createButton("➕", "ghost small", (e) => {
    e.stopPropagation();
    openAddContainersToGroup(groupName);
  });
  addQuickBtn.title = t("groups.actions.add_container", "Add container");
  quickActions.appendChild(addQuickBtn);

  getGroupActions(groupName)
    .filter((a) => a !== "delete")
    .forEach((action) => {
      const btn = createButton(actionIcon(action), "ghost small", (e) => {
        e.stopPropagation();
        handleGroupAction(groupName, action);
      });
      btn.title = groupActionLabel(action);
      quickActions.appendChild(btn);
    });

  const exportBtn = createButton("⬇", "ghost small", (e) => {
    e.stopPropagation();
    exportGroup(groupName, false).catch((err) => showToast(err.message || t("errors.export", "Error exporting"), true));
  });
  exportBtn.title = t("common.export", "Export");
  quickActions.appendChild(exportBtn);

  const deleteQuickBtn = createButton("🗑", "ghost small danger", (e) => {
    e.stopPropagation();
    deleteGroup(groupName);
  });
  deleteQuickBtn.title = t("groups.actions.delete_group", "Delete group");
  quickActions.appendChild(deleteQuickBtn);

  const collapsible = document.createElement("div");
  collapsible.className = "card-collapsible";

  const list = document.createElement("div");
  list.className = "container-list-glass";

  visibleContainerIds.forEach((cid) => {
    const container = containerMap.get(cid);
    if (!container) return;
    list.appendChild(createContainerItem(container, groupName));
  });

  if (!list.childElementCount) {
    const empty = document.createElement("div");
    empty.style.opacity = "0.75";
    empty.textContent = groupContainerIds.length
      ? t("groups.empty_filtered", "No containers visible with current filters.")
      : t("groups.empty_group", "No containers in this group.");
    list.appendChild(empty);
  }

  collapsible.appendChild(list);

  const toggleExpanded = () => {
    const expanded = !card.classList.contains("expanded");
    card.classList.toggle("expanded", expanded);
    expandBtn.textContent = expanded ? "▲" : "▼";
  };

  header.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    toggleExpanded();
  });
  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExpanded();
  });

  card.appendChild(header);
  card.appendChild(aliasEditor.form);
  card.appendChild(quickActions);
  card.appendChild(expandBtn);
  card.appendChild(collapsible);

  return card;
}

function createContainerItem(container, groupName) {
  const item = document.createElement("div");
  item.className = "container-item-glass";

  const display = containerDisplay(container);

  const details = document.createElement("div");
  details.className = "container-item-glass-details";

  const nameEl = document.createElement("div");
  nameEl.className = "container-item-glass-name";
  nameEl.style.display = "flex";
  nameEl.style.alignItems = "center";
  nameEl.style.gap = "0.5rem";
  nameEl.style.flexWrap = "wrap";
  nameEl.textContent = display.main;

  const stateValue = (container.state || "").toLowerCase();
  const statusPill = document.createElement("span");
  statusPill.className = `status-pill status-${stateValue === "running" ? "running" : "exited"}`;
  statusPill.textContent = container.state || "unknown";
  nameEl.appendChild(statusPill);

  details.appendChild(nameEl);

  const meta = document.createElement("div");
  meta.className = "container-item-glass-meta";
  meta.textContent = `${container.image} • ${t("table.ports", "Ports")}: ${container.ports || "—"}`;
  details.appendChild(meta);

  item.appendChild(details);

  const actions = document.createElement("div");
  actions.className = "container-item-glass-actions";

  getContainerActions(container).forEach((action) => {
    const btn = createButton(actionIcon(action), `ghost small${action === "delete" ? " danger" : ""}`, () =>
      handleAction(container.id, action)
    );
    btn.title = actionLabel(action);
    actions.appendChild(btn);
  });

  const exportBtn = createButton("⬇", "ghost small", () =>
    exportContainer(container.id, false, container.name).catch((err) =>
      showToast(err.message || t("errors.export", "Error exporting"), true)
    )
  );
  exportBtn.title = t("common.export", "Export");
  actions.appendChild(exportBtn);

  const editBtn = createButton("✎", "ghost small", () => openDockerfileEditor(container.id, container.name));
  editBtn.title = t("containers.edit_dockerfile", "Edit Dockerfile");
  actions.appendChild(editBtn);

  if (groupName) {
    const removeBtn = createButton("⨯", "ghost small danger", (e) => {
      e.stopPropagation();
      removeFromGroup(groupName, container.id);
    });
    removeBtn.title = `${t("groups.actions.remove_from_group", "Remove from group")} "${groupLabel(groupName)}"`;
    actions.appendChild(removeBtn);
  }

  item.appendChild(actions);
  return item;
}

function createStandaloneCard(container, selectedGroups) {
  const card = document.createElement("div");
  card.className = "group-card-glass";

  const display = containerDisplay(container);

  const header = document.createElement("div");
  header.className = "group-card-glass-header";

  if (display.icon || container.icon) {
    const icon = document.createElement("img");
    icon.src = display.icon || container.icon;
    icon.className = "group-card-glass-icon";
    icon.alt = "";
    header.appendChild(icon);
  }

  const info = document.createElement("div");
  info.className = "group-card-glass-info";

  const nameRow = document.createElement("div");
  nameRow.className = "group-card-glass-name-row";

  const nameEl = document.createElement("div");
  nameEl.className = "group-card-glass-name";
  nameEl.textContent = display.main;
  nameRow.appendChild(nameEl);

  const aliasEditor = createAliasEditor(container, () => render());
  nameRow.appendChild(aliasEditor.button);
  info.appendChild(nameRow);

  const statusBadge = document.createElement("span");
  statusBadge.className = `status-pill status-${
    (container.state || "").toLowerCase() === "running" ? "running" : "exited"
  }`;
  statusBadge.textContent = container.state || "unknown";
  info.appendChild(statusBadge);

  const autostartControl = createAutostartToggle(container, selectedGroups);
  autostartControl.classList.add("autostart-inline");
  info.appendChild(autostartControl);

  header.appendChild(info);

  const quickActions = document.createElement("div");
  quickActions.className = "card-quick-actions";
  getContainerActions(container).forEach((action) => {
    const btn = createButton(actionIcon(action), `ghost small${action === "delete" ? " danger" : ""}`, (e) => {
      e.stopPropagation();
      handleAction(container.id, action);
    });
    btn.title = actionLabel(action);
    quickActions.appendChild(btn);
  });

  const exportBtn = createButton("⬇", "ghost small", (e) => {
    e.stopPropagation();
    exportContainer(container.id, false, container.name).catch((err) =>
      showToast(err.message || t("errors.export", "Error exporting"), true)
    );
  });
  exportBtn.title = t("common.export", "Export");
  quickActions.appendChild(exportBtn);

  const editBtn = createButton("✎", "ghost small", (e) => {
    e.stopPropagation();
    openDockerfileEditor(container.id, container.name);
  });
  editBtn.title = t("containers.edit_dockerfile", "Edit Dockerfile");
  quickActions.appendChild(editBtn);

  const expandBtn = document.createElement("button");
  expandBtn.className = "card-expand-btn";
  expandBtn.textContent = "▼";
  expandBtn.title = t("cards.expand_collapse", "Expand/collapse");

  const collapsible = document.createElement("div");
  collapsible.className = "card-collapsible";

  collapsible.appendChild(aliasEditor.form);

  const details = document.createElement("div");
  details.style.padding = "1rem";
  details.style.textAlign = "left";

  details.appendChild(createDetailRow(t("table.image", "Image"), container.image || "—"));
  details.appendChild(createDetailRow(t("table.ports", "Ports"), container.ports || "—"));

  collapsible.appendChild(details);

  const setExpanded = (expanded) => {
    card.classList.toggle("expanded", expanded);
    expandBtn.textContent = expanded ? "▲" : "▼";
  };

  const toggleExpanded = () => setExpanded(!card.classList.contains("expanded"));

  header.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    toggleExpanded();
  });
  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExpanded();
  });
  aliasEditor.button.addEventListener("click", () => setExpanded(true));

  card.appendChild(header);
  card.appendChild(quickActions);
  card.appendChild(expandBtn);
  card.appendChild(collapsible);

  return card;
}

function createDetailRow(label, value) {
  const row = document.createElement("div");
  row.style.marginBottom = "0.5rem";
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.appendChild(strong);
  row.appendChild(document.createTextNode(String(value)));
  return row;
}

function createAliasEditor(container, onSaved) {
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "icon-button";
  renameButton.title = t("alias.rename_icon_title", "Edit alias and icon");
  renameButton.textContent = "✎";

  const aliasForm = document.createElement("form");
  aliasForm.className = "alias-form";

  const aliasInput = document.createElement("input");
  aliasInput.type = "text";
  aliasInput.placeholder = t("alias.label", "Alias (optional)");
  const metaAlias = state.containerAliases[container.id];
  aliasInput.value = metaAlias && typeof metaAlias === "object" ? metaAlias.alias || "" : metaAlias || "";

  const aliasRow = document.createElement("div");
  aliasRow.className = "icon-row";

  const aliasSpacer = document.createElement("button");
  aliasSpacer.type = "button";
  aliasSpacer.className = "ghost small upload-placeholder";
  aliasSpacer.textContent = t("upload.button", "📤 Upload");
  aliasSpacer.tabIndex = -1;
  aliasSpacer.setAttribute("aria-hidden", "true");

  aliasRow.appendChild(aliasInput);
  aliasRow.appendChild(aliasSpacer);

  const iconInput = document.createElement("input");
  iconInput.type = "text";
  iconInput.placeholder = t("alias.icon_label", "Icon (URL)");
  iconInput.value = metaAlias && typeof metaAlias === "object" ? metaAlias.icon || "" : "";

  const iconContainer = document.createElement("div");
  iconContainer.className = "icon-row";

  const uploadButton = document.createElement("button");
  uploadButton.type = "button";
  uploadButton.className = "ghost small";
  uploadButton.textContent = t("upload.button", "📤 Upload");
  uploadButton.title = t("upload.title", "Upload icon image");

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp,image/x-icon";
  fileInput.style.display = "none";

  uploadButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast(t("upload.file_too_large", "File too large. Maximum: 5MB"), true);
      return;
    }
    try {
      uploadButton.disabled = true;
      uploadButton.textContent = t("upload.uploading", "⏳ Uploading...");

      const formData = new FormData();
      formData.append("icon", file);

      const response = await fetch("/api/upload-icon", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("upload.error", "Error uploading icon"));

      iconInput.value = data.url;
      showToast(t("upload.success", "Icon uploaded successfully!"));
    } catch (error) {
      showToast(error.message || t("upload.error", "Error uploading icon"), true);
    } finally {
      uploadButton.disabled = false;
      uploadButton.textContent = t("upload.button", "📤 Upload");
      fileInput.value = "";
    }
  });

  iconContainer.appendChild(iconInput);
  iconContainer.appendChild(uploadButton);
  iconContainer.appendChild(fileInput);

  const saveAlias = document.createElement("button");
  saveAlias.type = "submit";
  saveAlias.className = "ghost small";
  saveAlias.textContent = t("alias.save", "Save");

  const cancelAlias = document.createElement("button");
  cancelAlias.type = "button";
  cancelAlias.className = "ghost small";
  cancelAlias.textContent = t("alias.cancel", "Cancel");

  const actionsRow = document.createElement("div");
  actionsRow.className = "alias-actions";
  actionsRow.appendChild(saveAlias);
  actionsRow.appendChild(cancelAlias);

  aliasForm.appendChild(aliasRow);
  aliasForm.appendChild(iconContainer);
  aliasForm.appendChild(actionsRow);

  const resetForm = () => {
    const currentMeta = state.containerAliases[container.id];
    aliasInput.value =
      currentMeta && typeof currentMeta === "object" ? currentMeta.alias || "" : currentMeta || "";
    iconInput.value = currentMeta && typeof currentMeta === "object" ? currentMeta.icon || "" : "";
  };

  renameButton.addEventListener("click", (e) => {
    e.stopPropagation();
    aliasForm.classList.add("visible");
    aliasInput.focus();
  });

  cancelAlias.addEventListener("click", () => {
    resetForm();
    aliasForm.classList.remove("visible");
  });

  aliasForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const trimmed = aliasInput.value.trim();
    const iconTrimmed = iconInput.value.trim();
    try {
      await saveContainerAlias(container.id, trimmed, iconTrimmed);
      aliasForm.classList.remove("visible");
      if (onSaved) onSaved();
      else render();
    } catch (error) {
      showToast(error.message || t("errors.save_alias", "Error saving alias."), true);
    }
  });

  return { button: renameButton, form: aliasForm };
}

function createGroupAliasEditor(groupName, onSaved) {
  const aliasMeta = state.groupAliases?.[groupName];

  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.title = t("alias.rename_icon_title", "Edit alias and icon");
  button.textContent = "✎";

  const aliasForm = document.createElement("form");
  aliasForm.className = "alias-form";

  const aliasInput = document.createElement("input");
  aliasInput.type = "text";
  aliasInput.placeholder = t("alias.label", "Alias (optional)");
  aliasInput.value = aliasMeta && typeof aliasMeta === "object" ? aliasMeta.alias || "" : aliasMeta || "";

  const aliasRow = document.createElement("div");
  aliasRow.className = "icon-row";

  const aliasSpacer = document.createElement("button");
  aliasSpacer.type = "button";
  aliasSpacer.className = "ghost small upload-placeholder";
  aliasSpacer.textContent = t("upload.button", "📤 Upload");
  aliasSpacer.tabIndex = -1;
  aliasSpacer.setAttribute("aria-hidden", "true");

  aliasRow.appendChild(aliasInput);
  aliasRow.appendChild(aliasSpacer);

  const iconInput = document.createElement("input");
  iconInput.type = "text";
  iconInput.placeholder = t("alias.icon_label", "Icon (URL)");
  iconInput.value = aliasMeta && typeof aliasMeta === "object" ? aliasMeta.icon || "" : "";

  const iconContainer = document.createElement("div");
  iconContainer.className = "icon-row";

  const uploadButton = document.createElement("button");
  uploadButton.type = "button";
  uploadButton.className = "ghost small";
  uploadButton.textContent = t("upload.button", "📤 Upload");
  uploadButton.title = t("upload.title", "Upload icon image");

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp,image/x-icon";
  fileInput.style.display = "none";

  uploadButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast(t("upload.file_too_large", "File too large. Maximum: 5MB"), true);
      return;
    }
    try {
      uploadButton.disabled = true;
      uploadButton.textContent = t("upload.uploading", "⏳ Uploading...");

      const formData = new FormData();
      formData.append("icon", file);

      const response = await fetch("/api/upload-icon", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("upload.error", "Error uploading icon"));

      iconInput.value = data.url;
      showToast(t("upload.success", "Icon uploaded successfully!"));
    } catch (error) {
      showToast(error.message || t("upload.error", "Error uploading icon"), true);
    } finally {
      uploadButton.disabled = false;
      uploadButton.textContent = t("upload.button", "📤 Upload");
      fileInput.value = "";
    }
  });

  iconContainer.appendChild(iconInput);
  iconContainer.appendChild(uploadButton);
  iconContainer.appendChild(fileInput);

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "ghost small";
  saveBtn.textContent = t("alias.save", "Save");

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost small";
  cancelBtn.textContent = t("alias.cancel", "Cancel");

  const actionsRow = document.createElement("div");
  actionsRow.className = "alias-actions";
  actionsRow.appendChild(saveBtn);
  actionsRow.appendChild(cancelBtn);

  aliasForm.appendChild(aliasRow);
  aliasForm.appendChild(iconContainer);
  aliasForm.appendChild(actionsRow);

  const resetForm = () => {
    const currentMeta = state.groupAliases?.[groupName];
    aliasInput.value =
      currentMeta && typeof currentMeta === "object" ? currentMeta.alias || "" : currentMeta || "";
    iconInput.value = currentMeta && typeof currentMeta === "object" ? currentMeta.icon || "" : "";
  };

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    aliasForm.classList.add("visible");
    aliasInput.focus();
  });

  cancelBtn.addEventListener("click", () => {
    resetForm();
    aliasForm.classList.remove("visible");
  });

  aliasForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const trimmed = aliasInput.value.trim();
    const iconTrimmed = iconInput.value.trim();
    try {
      await renameGroup(groupName, trimmed, iconTrimmed);
      aliasForm.classList.remove("visible");
      if (onSaved) onSaved();
      else render();
    } catch (error) {
      showToast(error.message || t("errors.rename_group", "Error renaming group."), true);
    }
  });

  return { button, form: aliasForm };
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
  let label = t("autostart.status.disabled", "Disabled");
  if (status.enabledIndividually) {
    label = t("autostart.status.enabled_individual", "Enabled (individual)");
  } else if (status.enabledGroups.length) {
    label = t("autostart.status.enabled_group", "Enabled (group)");
  } else if (status.enabledByDocker) {
    label = t("autostart.status.enabled_docker", "Enabled (Docker)");
  }

  button.textContent = label;
  button.className = `autostart-toggle ${status.enabled ? "enabled" : "disabled"}`;

  if (status.enabledGroups.length || status.enabledIndividually) {
    const sources = [];
    if (status.enabledGroups.length) {
      sources.push(`${t("autostart.source_groups", "group(s)")}: ${status.enabledGroups.join(", ")}`);
    }
    if (status.enabledIndividually) sources.push(t("autostart.source_individual", "individual"));
    if (status.enabledByDocker) {
      sources.push(`${t("autostart.source_docker", "Docker")} (${status.dockerRestartPolicy})`);
    }
    button.title = `${t("autostart.title_enabled_via", "Enabled via")} ${sources.join(" + ")}`;
  } else if (status.enabledByDocker) {
    button.title = `${t(
      "autostart.title_enabled_by_docker_prefix",
      "Enabled by Docker restart policy"
    )} (${status.dockerRestartPolicy}). ${t(
      "autostart.title_enabled_by_docker_suffix",
      "Changing here does not change Docker."
    )}`;
  } else {
    button.title = t("autostart.title_click_to_enable", "Click to enable auto-start");
  }

  return status;
}

function createAutostartToggle(container, selectedGroups) {
  const groupsForContainer = selectedGroups.get(container.id) || [];

  if (groupsForContainer.length) {
    const status = getAutostartStatus(container, selectedGroups);
    const badge = document.createElement("span");
    badge.className = `autostart-toggle read-only ${status.enabled ? "enabled" : "disabled"}`;
    badge.textContent = status.enabled
      ? t("autostart.status.enabled_group", "Enabled (group)")
      : t("autostart.status.disabled_group", "Disabled (group)");
    badge.title = `${t(
      "autostart.title_manage_in_group_card",
      "Manage this container's auto-start in the group card"
    )} (${groupsForContainer.join(", ")}).`;
    badge.setAttribute("aria-disabled", "true");
    return badge;
  }

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
          ? t("autostart.toast.docker_only", "Auto-start enabled by Docker (restart policy)")
          : status.enabled
          ? t("autostart.toast.enabled", "Auto-start enabled")
          : t("autostart.toast.disabled", "Auto-start disabled");
      showToast(toastMsg);
    } catch (error) {
      showToast(error.message || t("errors.save", "Error saving"), true);
      state.autostart.containers = previous;
      container.restart_policy = previousPolicy;
      applyAutostartButtonState(button, container, selectedGroups);
    }
  });

  return autostartButton;
}

async function downloadFile(url, filename) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || t("errors.download_failed", "Failed to download file."));
  }
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function exportContainer(containerId, includeData = false, friendlyName = "") {
  const suffix = includeData ? "?includeData=1" : "";
  const safeName = friendlyName || containerId;
  await downloadFile(
    `/api/containers/${encodeURIComponent(containerId)}/export${suffix}`,
    `${safeName}-export.zip`
  );
}

async function exportGroup(groupName, includeData = false) {
  const suffix = includeData ? "?includeData=1" : "";
  await downloadFile(`/api/groups/${encodeURIComponent(groupName)}/export${suffix}`, `${groupName}-export.zip`);
}

async function openDockerfileEditor(containerId, displayName) {
  try {
    const res = await fetch(`/api/containers/${encodeURIComponent(containerId)}/dockerfile`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("dockerfile.load_failed", "Failed to load Dockerfile."));

    const textarea = document.createElement("textarea");
    textarea.value = data.content || "";
    const body = document.createElement("div");
    body.appendChild(textarea);

    openModal({
      title: `${t("dockerfile.modal_title_prefix", "Edit Dockerfile")} - ${displayName || containerId}`,
      body,
      confirmText: t("dockerfile.confirm_save_restart", "Save & restart"),
      onConfirm: async () => {
        const response = await fetch(`/api/containers/${encodeURIComponent(containerId)}/dockerfile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: textarea.value }),
        });
        const respData = await response.json();
        if (!response.ok) throw new Error(respData.error || t("dockerfile.save_failed", "Failed to save Dockerfile."));
        showToast(t("dockerfile.saved_restarted", "Dockerfile saved and container restarted."));
        await loadContainersOnly();
      },
    });
  } catch (error) {
    showToast(error.message || t("dockerfile.edit_failed", "Failed to edit Dockerfile."), true);
  }
}

function openNewGroup() {
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.65rem";

  const nameInput = document.createElement("input");
  nameInput.placeholder = t("groups.create_placeholder", "Group name");
  body.appendChild(nameInput);

  openModal({
    title: t("groups.create_title", "Create group"),
    body,
    confirmText: t("common.create", "Create"),
    onConfirm: async () => {
      const name = nameInput.value.trim();
      if (!name) {
        showToast(t("groups.create_required", "Group name is required."), true);
        return;
      }
      if (state.groups[name]) {
        showToast(t("groups.create_already_exists", "A group with this name already exists."), true);
        return;
      }

      state.filter = "";
      if (dom.filterInput) dom.filterInput.value = "";

      state.groups[name] = [];
      pinEmptyGroup(name);
      await persistGroups(t("groups.created_toast", "Group created."));
      setTimeout(() => openAddContainersToGroup(name), 0);
    },
  });

  setTimeout(() => nameInput.focus(), 0);
}

function openNewContainerFromDockerfile() {
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.65rem";

  const nameInput = document.createElement("input");
  nameInput.placeholder = t(
    "containers.create_dockerfile.name_placeholder",
    "Container name (used as tag and --name)"
  );
  const cmdInput = document.createElement("input");
  cmdInput.placeholder = t("containers.create_dockerfile.command_placeholder", "Command (optional)");
  const envInput = document.createElement("textarea");
  envInput.placeholder = t("containers.create_dockerfile.env_placeholder", ".env file (optional)");
  const dockerfileArea = document.createElement("textarea");
  dockerfileArea.placeholder = t("containers.create_dockerfile.dockerfile_placeholder", "Dockerfile");

  body.appendChild(nameInput);
  body.appendChild(cmdInput);
  body.appendChild(envInput);
  body.appendChild(dockerfileArea);

  openModal({
    title: t("containers.create_dockerfile.title", "Create container via Dockerfile"),
    body,
    confirmText: t("containers.create_dockerfile.confirm", "Build & Run"),
    onConfirm: async () => {
      const payload = {
        name: nameInput.value.trim(),
        dockerfile: dockerfileArea.value,
        command: cmdInput.value.trim(),
        env: envInput.value,
        files: [],
      };
      const response = await fetch("/api/containers/create-from-dockerfile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("errors.create_container", "Failed to create container."));
      showToast(t("toast.container_created", "Container created."));
      await loadContainersOnly();
    },
  });
}

function openNewContainerFromCommand() {
  const body = document.createElement("div");
  const textarea = document.createElement("textarea");
  textarea.placeholder = t(
    "containers.create_cli.placeholder",
    "docker run -d --name myapp -p 8080:80 image:tag"
  );
  body.appendChild(textarea);

  openModal({
    title: t("containers.create_cli.title", "Create container via CLI"),
    body,
    confirmText: t("common.run", "Run"),
    onConfirm: async () => {
      const response = await fetch("/api/containers/create-from-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: textarea.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("errors.run_command", "Failed to run command."));
      showToast(t("toast.command_sent", "Command sent."));
      await loadContainersOnly();
    },
  });
}

function confirmGroupAction(groupName, action) {
  const label = groupActionLabel(action);
  const displayName = groupLabel(groupName);
  if (action === "delete") {
    return confirm(
      `${t("confirm.delete_group", "Delete group")} "${displayName}"? ${t(
        "confirm.delete_group_note",
        "Containers remain in the system."
      )}`
    );
  }
  return confirm(`${label} ${t("confirm.for_group", "for group")} "${displayName}"?`);
}

async function handleAction(containerId, action) {
  if (action === "delete") {
    const container = state.containers.find((c) => c.id === containerId);
    const displayName = container ? containerDisplay(container).main : containerId;
    const confirmed = confirm(
      `${t("confirm.delete_container", "Delete container")} "${displayName}"? ${t(
        "confirm.cannot_undo",
        "This action cannot be undone."
      )}`
    );
    if (!confirmed) return;
  }

  try {
    await controlContainer(containerId, action);
    showToast(`${t("toast.action_sent", "Action sent")}: "${actionLabel(action)}".`);
    await loadContainersOnly();
  } catch (error) {
    showToast(error.message || t("errors.action_failed", "Failed to run action."), true);
  }
}

async function handleGroupAction(groupName, action) {
  if (!confirmGroupAction(groupName, action)) return;

  const ids = getGroupContainerIds(groupName);
  if (!ids.length) {
    showToast(t("groups.none_available", "No containers available in this group."), true);
    return;
  }

  try {
    await Promise.all(ids.map((id) => controlContainer(id, action)));
    showToast(`${t("toast.action_sent", "Action sent")}: ${groupActionLabel(action)} → ${groupLabel(groupName)}.`);
    await loadContainersOnly();
  } catch (error) {
    showToast(error.message || t("errors.group_action_failed", "Failed to run group action."), true);
  }
}

async function loadContainersOnly() {
  try {
    state.containers = await loadContainers();
    applyAutoGrouping(true);
    render();
  } catch (error) {
    showToast(error.message || t("errors.refresh_containers", "Failed to refresh containers."), true);
  }
}

async function controlContainer(id, action) {
  const response = await fetch(`/api/containers/${id}/${action}`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.details || data.error || t("errors.docker_communication", "Error communicating with Docker."));
  }
  return data;
}

async function deleteGroup(name) {
  if (!confirmGroupAction(name, "delete")) return;
  delete state.groups[name];
  delete state.groupAliases[name];
  unpinGroup(name);
  try {
    await persistGroups(t("groups.deleted_toast", "Group removed."));
  } catch (error) {
    showToast(error.message, true);
  }
}

async function removeFromGroup(groupName, containerId) {
  const group = state.groups[groupName] || [];
  state.groups[groupName] = group.filter((id) => id !== containerId);
  try {
    await persistGroups(t("groups.removed_container_toast", "Container removed from group."));
  } catch (error) {
    showToast(error.message, true);
  }
}

async function renameGroup(name, aliasValue, iconValue) {
  const trimmed = (aliasValue || "").trim();
  const iconTrimmed = (iconValue || "").trim();
  const existingMeta = state.groupAliases?.[name];
  const existingOrder =
    existingMeta && typeof existingMeta === "object" ? parseOrderValue(existingMeta.order) : null;

  if (!trimmed && !iconTrimmed) {
    if (existingOrder !== null) {
      state.groupAliases[name] = { order: existingOrder };
    } else {
      delete state.groupAliases[name];
    }
  } else {
    const next = {};
    if (trimmed) next.alias = trimmed;
    if (iconTrimmed) next.icon = iconTrimmed;
    if (existingOrder !== null) next.order = existingOrder;
    state.groupAliases[name] = next;
  }
  await persistGroups(t("groups.renamed_toast", "Group updated (alias/icon updated)."));
}

init();
