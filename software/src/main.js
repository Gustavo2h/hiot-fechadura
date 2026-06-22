const tauriCore = window.__TAURI__?.core;

const state = {
  activeTab: "locks",
  locks: [],
  users: [],
  selectedLockId: null,
  selectedLock: null,
  selectedPermissions: [],
  selectedHistory: [],
};

const elements = {};
const screenTitles = {
  locks: "Fechaduras",
  users: "Usuários",
  activity: "Atividade",
};

// API helpers
// Envia uma requisição HTTP ao Node-RED
async function nodeRed(path, options = {}) {
  if (!tauriCore) {
    throw new Error("Tauri indisponível.");
  }

  return tauriCore.invoke("node_red_request", {
    method: options.method || "GET",
    path,
    body: options.body || null,
  });
}

// Atalhos para cada endpoint do Node-RED usado pelo app.
const api = {
  listLocks: () => nodeRed("/locks"),
  getLock: (id) => nodeRed(`/locks/${encodeURIComponent(id)}`),
  openLock: (id) => nodeRed(`/locks/${encodeURIComponent(id)}/open`),
  closeLock: (id) => nodeRed(`/locks/${encodeURIComponent(id)}/close`),
  lockHistory: (id) => nodeRed(`/locks/${encodeURIComponent(id)}/history`),
  listUsers: () => nodeRed("/users"),
  createUser: (body) => nodeRed("/users", { method: "POST", body }),
  deleteUser: (id) => nodeRed(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listPermissions: (lockId) => nodeRed(`/permissions/${encodeURIComponent(lockId)}`),
  createPermission: (lockId, body) => nodeRed(`/permissions/${encodeURIComponent(lockId)}`, { method: "POST", body }),
  deletePermission: (id, body) => nodeRed(`/permissions/${encodeURIComponent(id)}`, { method: "DELETE", body }),
};

// Data helpers
// Padroniza o código da tag NFC
function normalizeNfc(value = "") {
  return value.trim().toUpperCase();
}

// Extrai a lista de registros da resposta do Node-RED
function unwrapRows(data) {
  const source = data?.payload ?? data?.rows ?? data?.data ?? data?.result ?? data;

  if (Array.isArray(source)) {
    return source;
  }

  if (source && typeof source === "object") {
    return [source];
  }

  return [];
}

// Descobre o ID de um registro
function rowId(row) {
  return row?.id ?? row?._id ?? row?.id_fechadura ?? row?.lockId;
}

// Descobre o nome/descrição de um registro
function rowName(row, fallback) {
  return row?.nome || row?.name || row?.descricao || row?.description || fallback;
}

// Retorna a localização da fechadura
function lockLocation(lock) {
  return lock?.localizacao || lock?.location || "Sem localização";
}

// Retorna a tag NFC de um usuário
function userNfc(user) {
  return normalizeNfc(user?.id_nfc || user?.nfc || user?.nfc_id || user?.tag || user?.tag_id || "");
}

// Descobre o ID de uma permissão
function permissionId(permission) {
  return permission?.id ?? permission?.permission_id ?? permission?.id_permissao;
}

// Retorna a tag NFC ligada a uma permissão
function permissionNfc(permission) {
  return normalizeNfc(permission?.id_nfc || permission?.nfc || permission?.nfc_id || "");
}

// Retorna a tag NFC registrada em um evento do histórico.
function historyNfc(event) {
  return normalizeNfc(
    event?.id_nfc_escaneado || event?.id_nfc || event?.nfc || event?.nfc_id || event?.tag || event?.tag_id || "",
  );
}

// Retorna o tipo do evento
function historyEventType(event) {
  return String(event?.tipo_evento || event?.event_type || event?.type || "desconhecido").toLowerCase();
}

// Retorna a data/hora em que o evento aconteceu.
function historyDate(event) {
  return event?.data_ocorrencia || event?.created_at || event?.criado_em || event?.timestamp || event?.date || "";
}

// Procura, entre as fechaduras já carregadas, a que tem o ID informado
function findLock(id) {
  return state.locks.find((lock) => String(rowId(lock)) === String(id)) || null;
}

// Procura um usuário pela tag NFC
function findUserByNfc(nfc) {
  return state.users.find((user) => userNfc(user) === normalizeNfc(nfc));
}

// Converte uma data em texto
function formatDate(value) {
  if (!value) {
    return "Não informado";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

// Mensagens de erro
function friendlyError(error, context = "action") {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();

  if (context === "nfc") {
    if (lower.includes("not available") || lower.includes("não disponível") || lower.includes("nao disponivel")) {
      return "Este aparelho não parece ter leitura NFC disponível.";
    }

    if (lower.includes("cancel") || lower.includes("cancelado") || lower.includes("invalidate")) {
      return "Leitura cancelada. Toque em Ler e aproxime a tag novamente.";
    }

    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("tempo")) {
      return "Não consegui ler a tag a tempo. Mantenha a tag encostada por mais alguns segundos.";
    }

    if (lower.includes("connect") || lower.includes("tag")) {
      return "Não consegui ler essa tag. Encoste a tag no telefone e tente novamente.";
    }

    return "Não consegui ler essa tag. Tente novamente com a tag bem próxima do telefone.";
  }

  if (lower.includes("dns") || lower.includes("resolve") || lower.includes("network") || lower.includes("connect")) {
    return "Não foi possível falar com o Node-RED. Verifique a conexão do celular.";
  }

  if (lower.includes("404")) {
    return "O Node-RED não encontrou esse recurso.";
  }

  if (lower.includes("500") || lower.includes("sqlite")) {
    return "O Node-RED retornou um erro ao acessar o banco.";
  }

  return message || "Algo não saiu como esperado.";
}

// UI helpers
// Mostra uma mensagem de status
function setNotice(message, type = "idle") {
  elements.noticeMessage.textContent = message;
  elements.noticeDot.dataset.status = type;
}

// Liga/desliga o estado "ocupado"
function setBusy(button, busy, label = "Aguarde...") {
  if (!button) {
    return;
  }

  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

// Cria um parágrafo de "lista vazia"
function emptyState(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "empty-state";
  paragraph.textContent = text;
  return paragraph;
}

// Limpa um container
function setContainerMessage(container, text) {
  container.innerHTML = "";
  container.append(emptyState(text));
}

// Cria um botão
function createButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.dataset.label = text;
  button.addEventListener("click", onClick);
  return button;
}

// Adiciona um par "rótulo: valor" numa lista
function appendMeta(parent, label, value) {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  parent.append(term, description);
}

// Cria uma linha de lista com título, detalhe e um botão de ação
function createRow(titleText, detailText, action) {
  const item = document.createElement("article");
  item.className = "row-item";

  const content = document.createElement("div");
  const title = document.createElement("strong");
  const detail = document.createElement("small");

  title.textContent = titleText;
  detail.textContent = detailText;
  content.append(title, detail);
  item.append(content);

  if (action) {
    item.append(action);
  }

  return item;
}

// Troca a aba ativa e atualiza a tela
function switchTab(tab) {
  state.activeTab = tab;
  elements.screenTitle.textContent = screenTitles[tab];

  elements.tabButtons.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  elements.tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
    panel.classList.toggle("active", panel.dataset.tabPanel === tab);
  });

  if (tab === "activity") {
    renderHistory();
    if (state.selectedLockId) {
      loadHistory(state.selectedLockId, { quiet: true });
    }
  }
}

// Renderers
// Redesenha todas as áreas da tela
function renderAll() {
  renderLocks();
  renderUsers();
  renderLockDetail();
  renderHistory();
}

// Desenha a lista de fechaduras
function renderLocks() {
  elements.lockCount.textContent = String(state.locks.length);
  elements.locksList.innerHTML = "";

  if (state.locks.length === 0) {
    elements.locksList.append(emptyState("Nenhuma fechadura encontrada."));
    return;
  }

  state.locks.forEach((lock, index) => {
    const id = String(rowId(lock));
    const button = document.createElement("button");
    const content = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    const badge = document.createElement("code");

    button.type = "button";
    button.className = id === String(state.selectedLockId) ? "select-item active" : "select-item";
    button.dataset.label = rowName(lock, `Fechadura ${index + 1}`);
    button.addEventListener("click", () => selectLock(id));

    title.textContent = rowName(lock, `Fechadura ${index + 1}`);
    detail.textContent = lockLocation(lock);
    badge.textContent = `#${id}`;

    content.append(title, detail);
    button.append(content, badge);
    elements.locksList.append(button);
  });
}

// Desenha a lista de usuários cadastrados
function renderUsers() {
  elements.userCount.textContent = String(state.users.length);
  elements.usersList.innerHTML = "";

  if (state.users.length === 0) {
    elements.usersList.append(emptyState("Nenhum usuário cadastrado."));
    return;
  }

  state.users.forEach((user, index) => {
    const id = rowId(user);
    const name = rowName(user, `Usuário ${index + 1}`);
    const nfc = userNfc(user) || "Sem NFC";
    const deleteButton = createButton("Excluir", "danger-button", () => deleteUser(user));
    deleteButton.disabled = id === undefined || id === null;
    elements.usersList.append(createRow(name, nfc, deleteButton));
  });
}

// Monta o painel de detalhes da fechadura selecionada
function renderLockDetail() {
  elements.lockDetail.innerHTML = "";

  if (!state.selectedLockId) {
    const empty = document.createElement("div");
    empty.className = "detail-empty";
    empty.innerHTML = '<p class="eyebrow">Detalhes</p><h2>Selecione uma fechadura</h2>';
    elements.lockDetail.append(empty);
    return;
  }

  const lock = state.selectedLock || findLock(state.selectedLockId) || {};
  const lockName = rowName(lock, "Fechadura");
  const header = document.createElement("div");
  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  const title = document.createElement("h2");
  const location = document.createElement("span");
  const actions = document.createElement("div");
  const meta = document.createElement("dl");
  const permissions = document.createElement("section");
  const permissionsHeader = document.createElement("div");
  const permissionsTitle = document.createElement("h3");
  const permissionsCount = document.createElement("span");
  const permissionList = document.createElement("div");
  const permissionForm = document.createElement("form");
  const select = document.createElement("select");
  const submit = document.createElement("button");

  header.className = "detail-header";
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Gerenciar fechadura";
  title.textContent = lockName;
  location.textContent = lockLocation(lock);
  heading.append(eyebrow, title, location);
  header.append(heading);

  actions.className = "split-actions";
  actions.append(
    createButton("Abrir", "primary-button", (event) => controlLock("open", event.currentTarget)),
    createButton("Fechar", "secondary-button", (event) => controlLock("close", event.currentTarget)),
  );

  meta.className = "meta-grid";
  appendMeta(meta, "ID", state.selectedLockId);
  appendMeta(meta, "Local", lockLocation(lock));
  appendMeta(meta, "Criada em", formatDate(lock.criado_em || lock.created_at));
  appendMeta(meta, "Atualizada em", formatDate(lock.atualizado_em || lock.updated_at));

  permissions.className = "permission-section";
  permissionsHeader.className = "section-heading compact";
  permissionsTitle.textContent = "Permissões";
  permissionsCount.className = "count-pill";
  permissionsCount.textContent = String(state.selectedPermissions.length);
  permissionsHeader.append(permissionsTitle, permissionsCount);

  permissionList.className = "permission-list";
  renderPermissionList(permissionList);

  permissionForm.className = "permission-form";
  permissionForm.addEventListener("submit", assignPermission);
  select.id = "permission-user";
  select.required = true;
  fillAvailableUsers(select);

  submit.id = "assign-button";
  submit.className = "primary-button";
  submit.type = "submit";
  submit.textContent = "Adicionar usuário";
  submit.dataset.label = submit.textContent;
  submit.disabled = select.disabled;

  permissionForm.append(select, submit);
  permissions.append(permissionsHeader, permissionList, permissionForm);
  elements.lockDetail.append(header, actions, meta, permissions);
}

// Desenha a lista de usuários que têm permissão na fechadura selecionada
function renderPermissionList(parent) {
  parent.innerHTML = "";

  if (state.selectedPermissions.length === 0) {
    parent.append(emptyState("Nenhum usuário tem acesso a esta fechadura."));
    return;
  }

  state.selectedPermissions.forEach((permission) => {
    const nfc = permissionNfc(permission);
    const user = findUserByNfc(nfc);
    const name = user ? rowName(user, "Usuário") : "Tag não vinculada";
    const removeButton = createButton("Remover", "danger-button", () => deletePermission(permission));
    parent.append(createRow(name, nfc || "Sem NFC", removeButton));
  });
}

// Preenche o seletor com os usuários que ainda não têm permissão nessa fechadura
function fillAvailableUsers(select) {
  const permissionNfcs = new Set(state.selectedPermissions.map(permissionNfc));
  const availableUsers = state.users.filter((user) => {
    const nfc = userNfc(user);
    return nfc && !permissionNfcs.has(nfc);
  });
  const placeholder = document.createElement("option");

  select.innerHTML = "";
  placeholder.value = "";
  placeholder.textContent = availableUsers.length === 0 ? "Nenhum usuário disponível" : "Adicionar usuário";
  select.append(placeholder);

  availableUsers.forEach((user, index) => {
    const option = document.createElement("option");
    option.value = userNfc(user);
    option.textContent = `${rowName(user, `Usuário ${index + 1}`)} - ${userNfc(user)}`;
    select.append(option);
  });

  select.disabled = availableUsers.length === 0;
}

// Desenha o histórico de eventos da fechadura selecionada
function renderHistory() {
  const lock = state.selectedLock || findLock(state.selectedLockId);
  elements.historyTitle.textContent = lock ? rowName(lock, "Histórico") : "Histórico";
  elements.historyCount.textContent = String(state.selectedHistory.length);
  elements.historyList.innerHTML = "";

  if (!state.selectedLockId) {
    elements.historyList.append(emptyState("Selecione uma fechadura para ver a atividade."));
    return;
  }

  if (state.selectedHistory.length === 0) {
    elements.historyList.append(emptyState("Nenhum evento registrado."));
    return;
  }

  state.selectedHistory.forEach((event) => {
    const nfc = historyNfc(event);
    const user = findUserByNfc(nfc);
    const eventType = historyEventType(event);
    const item = document.createElement("article");
    const content = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const chip = document.createElement("span");

    item.className = "row-item";
    content.className = "history-main";
    title.textContent = user ? rowName(user, "Usuário") : nfc || "Tag desconhecida";
    detail.textContent = `${nfc || "Sem NFC"} · ${formatDate(historyDate(event))}`;
    chip.className = "event-chip";
    chip.dataset.event = eventType;
    chip.textContent = eventType;

    content.append(title, detail);
    item.append(content, chip);
    elements.historyList.append(item);
  });
}

// Actions
// Busca fechaduras e usuários no Node-RED e atualiza a tela
async function loadData({ quiet = false } = {}) {
  setBusy(elements.refreshButton, true, "...");
  if (!quiet) {
    setNotice("Sincronizando dados...", "loading");
    setContainerMessage(elements.locksList, "Carregando fechaduras...");
    setContainerMessage(elements.usersList, "Carregando usuários...");
  }

  try {
    const [locksResponse, usersResponse] = await Promise.all([api.listLocks(), api.listUsers()]);
    state.locks = unwrapRows(locksResponse);
    state.users = unwrapRows(usersResponse);

    if (state.selectedLockId && !findLock(state.selectedLockId)) {
      clearSelectedLock();
    }

    renderLocks();
    renderUsers();

    if (state.selectedLockId) {
      await loadLockData(state.selectedLockId, { quiet: true });
    } else {
      renderLockDetail();
      renderHistory();
    }

    if (!quiet) {
      setNotice("Tudo atualizado.", "ok");
    }
  } catch (error) {
    console.error(error);
    if (!state.locks.length) {
      setContainerMessage(elements.locksList, "Não consegui carregar as fechaduras.");
    }
    if (!state.users.length) {
      setContainerMessage(elements.usersList, "Não consegui carregar os usuários.");
    }
    setNotice(friendlyError(error), "error");
  } finally {
    setBusy(elements.refreshButton, false);
  }
}

// Limpa a fechadura selecionada e os dados ligados a ela
function clearSelectedLock() {
  state.selectedLockId = null;
  state.selectedLock = null;
  state.selectedPermissions = [];
  state.selectedHistory = [];
}

// Seleciona uma fechadura e carrega seus detalhes
async function selectLock(lockId) {
  state.selectedLockId = lockId;
  state.selectedLock = findLock(lockId);
  state.selectedPermissions = [];
  state.selectedHistory = [];
  renderLocks();
  renderLockDetail();
  renderHistory();
  await loadLockData(lockId);
}

// Carrega detalhes, permissões e histórico de uma fechadura
async function loadLockData(lockId, { quiet = false } = {}) {
  if (!quiet) {
    setNotice("Carregando fechadura...", "loading");
    setContainerMessage(elements.lockDetail, "Carregando detalhes...");
    setContainerMessage(elements.historyList, "Carregando atividade...");
  }

  try {
    const [lockResponse, permissionsResponse, historyResponse] = await Promise.all([
      api.getLock(lockId),
      api.listPermissions(lockId),
      api.lockHistory(lockId),
    ]);

    state.selectedLock = unwrapRows(lockResponse)[0] || state.selectedLock || findLock(lockId);
    state.selectedPermissions = unwrapRows(permissionsResponse);
    state.selectedHistory = unwrapRows(historyResponse);
    renderLockDetail();
    renderHistory();

    if (!quiet) {
      setNotice("Fechadura pronta para gerenciar.", "ok");
    }
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error), "error");
    if (!state.selectedLock) {
      setContainerMessage(elements.lockDetail, "Não consegui carregar esta fechadura.");
    } else {
      renderLockDetail();
    }
    if (!state.selectedHistory.length) {
      setContainerMessage(elements.historyList, "Não consegui carregar a atividade.");
    } else {
      renderHistory();
    }
  }
}

// Recarrega apenas o histórico de eventos de uma fechadura
async function loadHistory(lockId, { quiet = false } = {}) {
  if (!quiet) {
    setNotice("Atualizando atividade...", "loading");
    setContainerMessage(elements.historyList, "Carregando atividade...");
  }

  try {
    state.selectedHistory = unwrapRows(await api.lockHistory(lockId));
    renderHistory();

    if (!quiet) {
      setNotice("Atividade atualizada.", "ok");
    }
  } catch (error) {
    console.error(error);
    if (!state.selectedHistory.length) {
      setContainerMessage(elements.historyList, "Não consegui carregar a atividade.");
    }
    setNotice(friendlyError(error), "error");
  }
}

// Lê uma tag NFC pelo celular e preenche o campo do formulário
async function scanNfc() {
  if (!tauriCore) {
    setNotice("Abra o app no celular para usar a leitura NFC.", "error");
    return;
  }

  setBusy(elements.scanButton, true, "Lendo...");
  setNotice("Aproxime a tag NFC da parte superior do telefone.", "loading");

  try {
    const tag = await tauriCore.invoke("scan_rfid");
    elements.nfcId.value = normalizeNfc(tag.id || "");
    setBusy(elements.scanButton, false);
    setNotice("Tag lida.", "ok");
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error, "nfc"), "error");
  } finally {
    setBusy(elements.scanButton, false);
  }
}

// Cadastra um novo usuário (nome + tag NFC) no banco via Node-RED
async function createUser(event) {
  event.preventDefault();

  const nome = elements.userName.value.trim();
  const id_nfc = normalizeNfc(elements.nfcId.value);

  if (!nome || !id_nfc) {
    setNotice("Preencha o nome e leia ou digite a tag NFC.", "error");
    return;
  }

  setBusy(elements.saveUserButton, true, "Salvando...");
  setNotice("Salvando usuário...", "loading");

  try {
    await api.createUser({ nome, id_nfc });
    elements.userForm.reset();
    await loadData({ quiet: true });
    setNotice("Usuário cadastrado.", "ok");
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error), "error");
  } finally {
    setBusy(elements.saveUserButton, false);
  }
}

// Dá a um usuário permissão de acesso à fechadura selecionada
async function assignPermission(event) {
  event.preventDefault();

  const select = event.currentTarget.querySelector("select");
  const submit = event.currentTarget.querySelector("button");
  const id_nfc = select.value;

  if (!state.selectedLockId || !id_nfc) {
    setNotice("Escolha uma fechadura e um usuário.", "error");
    return;
  }

  setBusy(submit, true, "Adicionando...");
  setNotice("Atualizando permissões...", "loading");

  try {
    await api.createPermission(state.selectedLockId, {
      id_fechadura: Number(state.selectedLockId),
      id_nfc,
    });
    await loadLockData(state.selectedLockId, { quiet: true });
    setNotice("Permissão adicionada.", "ok");
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error), "error");
  } finally {
    setBusy(submit, false);
  }
}

// Remove a permissão de acesso de um usuário a uma fechadura
async function deletePermission(permission) {
  const id = permissionId(permission) ?? state.selectedLockId;
  const nfc = permissionNfc(permission);

  setNotice("Removendo permissão...", "loading");

  try {
    await api.deletePermission(id, {
      id: permissionId(permission),
      id_fechadura: Number(state.selectedLockId),
      id_nfc: nfc,
    });
    await loadLockData(state.selectedLockId, { quiet: true });
    setNotice("Permissão removida.", "ok");
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error), "error");
  }
}

// Exclui um usuário do sistema
async function deleteUser(user) {
  const id = rowId(user);
  const name = rowName(user, "este usuário");

  if (id === undefined || id === null) {
    return;
  }

  setNotice("Excluindo usuário...", "loading");

  try {
    await api.deleteUser(id);
    await loadData({ quiet: true });
    setNotice("Usuário excluído.", "ok");
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error), "error");
  }
}

// Envia o comando de abrir ou fechar a fechadura selecionada
async function controlLock(action, button) {
  if (!state.selectedLockId) {
    setNotice("Selecione uma fechadura primeiro.", "error");
    return;
  }

  const opening = action === "open";
  const loadingLabel = opening ? "Abrindo..." : "Fechando...";
  const success = opening ? "Comando de abertura enviado." : "Comando de fechamento enviado.";

  setBusy(button, true, loadingLabel);
  setNotice(loadingLabel, "loading");

  try {
    if (opening) {
      await api.openLock(state.selectedLockId);
    } else {
      await api.closeLock(state.selectedLockId);
    }

    await loadLockData(state.selectedLockId, { quiet: true });
    setNotice(success, "ok");
  } catch (error) {
    console.error(error);
    setNotice(friendlyError(error), "error");
  } finally {
    setBusy(button, false);
  }
}

// Boot
// Guarda as referências aos elementos da tela
function bindElements() {
  elements.screenTitle = document.querySelector("#screen-title");
  elements.noticeDot = document.querySelector("#notice-dot");
  elements.noticeMessage = document.querySelector("#notice-message");
  elements.refreshButton = document.querySelector("#refresh-button");
  elements.userForm = document.querySelector("#user-form");
  elements.userName = document.querySelector("#user-name");
  elements.nfcId = document.querySelector("#nfc-id");
  elements.scanButton = document.querySelector("#scan-button");
  elements.saveUserButton = document.querySelector("#save-user-button");
  elements.locksList = document.querySelector("#locks-list");
  elements.usersList = document.querySelector("#users-list");
  elements.lockDetail = document.querySelector("#lock-detail");
  elements.lockCount = document.querySelector("#lock-count");
  elements.userCount = document.querySelector("#user-count");
  elements.historyTitle = document.querySelector("#history-title");
  elements.historyCount = document.querySelector("#history-count");
  elements.historyList = document.querySelector("#history-list");
  elements.tabButtons = [...document.querySelectorAll("[data-tab]")];
  elements.tabPanels = [...document.querySelectorAll("[data-tab-panel]")];

  document.querySelectorAll("button").forEach((button) => {
    button.dataset.label = button.textContent;
  });
}

// Liga os eventos de clique/envio aos botões e formulários
function bindEvents() {
  elements.refreshButton.addEventListener("click", () => loadData());
  elements.scanButton.addEventListener("click", scanNfc);
  elements.userForm.addEventListener("submit", createUser);
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

// Inicializa o app assim que a página termina de carregar
window.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  renderAll();
  loadData();
});
