const STATIC_ACCESS_CODE = "cliente2026";

const hostedMaterials = [
  /*
  Fallback para hospedagem sem servidor:
  {
    id: "guia-inicial",
    title: "Guia inicial",
    category: "Boas-vindas",
    description: "Material de apoio para começar.",
    file: "materiais/guia-inicial.pdf"
  }
  */
];

const state = {
  unlocked: false,
  role: "guest",
  apiAvailable: true,
  activeCategory: "Todos",
  activeId: null,
  materials: [],
  clientCodes: [],
};

const elements = {
  accessCode: document.querySelector("#accessCode"),
  accessButton: document.querySelector("#accessButton"),
  logoutButton: document.querySelector("#logoutButton"),
  accessMessage: document.querySelector("#accessMessage"),
  adminTools: document.querySelector("#adminTools"),
  uploadForm: document.querySelector("#uploadForm"),
  uploadMessage: document.querySelector("#uploadMessage"),
  pdfInput: document.querySelector("#pdfInput"),
  fileName: document.querySelector("#fileName"),
  titleInput: document.querySelector("#titleInput"),
  categoryInput: document.querySelector("#categoryInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  clientCodeForm: document.querySelector("#clientCodeForm"),
  clientNameInput: document.querySelector("#clientNameInput"),
  customCodeInput: document.querySelector("#customCodeInput"),
  clientCodeMessage: document.querySelector("#clientCodeMessage"),
  clientCodeList: document.querySelector("#clientCodeList"),
  clientCodeCount: document.querySelector("#clientCodeCount"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilters: document.querySelector("#categoryFilters"),
  materialList: document.querySelector("#materialList"),
  materialCount: document.querySelector("#materialCount"),
  viewerCategory: document.querySelector("#viewerCategory"),
  viewerTitle: document.querySelector("#viewerTitle"),
  viewerDescription: document.querySelector("#viewerDescription"),
  viewerStatus: document.querySelector("#viewerStatus"),
  pdfViewer: document.querySelector("#pdfViewer"),
  emptyState: document.querySelector("#emptyState"),
};

init();

async function init() {
  bindEvents();
  await restoreSession();
  renderCategories();
  renderMaterials();

  if (!state.unlocked) {
    lockPortal();
  }
}

function bindEvents() {
  elements.accessButton.addEventListener("click", unlockPortal);
  elements.logoutButton.addEventListener("click", logoutPortal);
  elements.accessCode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockPortal();
    }
  });

  elements.searchInput.addEventListener("input", renderMaterials);
  elements.uploadForm.addEventListener("submit", uploadPdf);
  elements.pdfInput.addEventListener("change", updateSelectedFileName);
  elements.clientCodeForm.addEventListener("submit", createClientCode);
}

async function restoreSession() {
  try {
    const session = await apiRequest("/api/session");
    if (!session.authenticated) {
      return;
    }

    state.unlocked = true;
    state.role = session.role;
    unlockUi();
    await refreshMaterials();
    await refreshClientCodes();
  } catch {
    state.apiAvailable = false;
    state.materials = await loadStaticMaterials();
  }
}

function lockPortal() {
  document.body.classList.add("is-locked");
  elements.adminTools.hidden = true;
  elements.accessButton.hidden = false;
  elements.logoutButton.hidden = true;
  elements.accessCode.disabled = false;
  elements.accessCode.focus();
}

async function unlockPortal() {
  const typedCode = elements.accessCode.value.trim();

  if (!typedCode) {
    elements.accessMessage.textContent = "Informe o código de acesso.";
    return;
  }

  if (state.apiAvailable) {
    try {
      const result = await apiRequest("/api/access", {
        method: "POST",
        body: JSON.stringify({ code: typedCode }),
      });

      state.role = result.role;
      state.unlocked = true;
      unlockUi();
      await refreshMaterials();
      await refreshClientCodes();
      return;
    } catch (error) {
      if (error.status === 401) {
        showInvalidCode();
        return;
      }

      state.apiAvailable = false;
      state.materials = await loadStaticMaterials();
    }
  }

  if (typedCode !== STATIC_ACCESS_CODE) {
    showInvalidCode();
    return;
  }

  state.role = window.location.search.includes("admin=1") ? "admin" : "client";
  state.unlocked = true;
  unlockUi();
  renderCategories();
  renderMaterials();
}

function unlockUi() {
  document.body.classList.remove("is-locked");
  elements.adminTools.hidden = state.role !== "admin";
  elements.accessButton.hidden = true;
  elements.logoutButton.hidden = false;
  elements.accessCode.disabled = true;
  elements.accessMessage.textContent =
    state.role === "admin" ? "Acesso administrativo liberado." : "Acesso liberado.";
  elements.accessCode.value = "";
}

async function logoutPortal() {
  if (state.apiAvailable) {
    try {
      await apiRequest("/api/logout", { method: "POST" });
    } catch {
      // The local UI can still be reset if the session endpoint is unavailable.
    }
  }

  state.unlocked = false;
  state.role = "guest";
  state.activeId = null;
  state.activeCategory = "Todos";
  state.materials = [];
  state.clientCodes = [];
  elements.accessMessage.textContent = "Sessão encerrada.";
  closeViewer();
  renderCategories();
  renderMaterials();
  renderClientCodes();
  lockPortal();
}

function showInvalidCode() {
  elements.accessMessage.textContent = "Código inválido.";
  elements.accessCode.select();
}

async function refreshMaterials() {
  if (state.apiAvailable) {
    state.materials = await apiRequest("/api/materials");
  }

  renderCategories();
  renderMaterials();
}

async function refreshClientCodes() {
  if (!state.apiAvailable || state.role !== "admin") {
    state.clientCodes = [];
    renderClientCodes();
    return;
  }

  state.clientCodes = await apiRequest("/api/client-codes");
  renderClientCodes();
}

async function loadStaticMaterials() {
  try {
    const response = await fetch("materiais.json", { cache: "no-store" });
    if (!response.ok) {
      return hostedMaterials;
    }

    const data = await response.json();
    return Array.isArray(data) ? data : hostedMaterials;
  } catch {
    return hostedMaterials;
  }
}

async function uploadPdf(event) {
  event.preventDefault();

  const file = elements.pdfInput.files[0];
  if (!file) {
    elements.uploadMessage.textContent = "Selecione um PDF.";
    return;
  }

  if (!state.apiAvailable) {
    attachLocalPdf(file);
    return;
  }

  const formData = new FormData(elements.uploadForm);
  elements.uploadMessage.textContent = "Publicando...";

  try {
    const material = await apiRequest("/api/materials", {
      method: "POST",
      body: formData,
      headers: {},
    });

    elements.uploadForm.reset();
    updateSelectedFileName();
    elements.uploadMessage.textContent = "PDF publicado.";
    await refreshMaterials();
    openMaterial(material.id);
  } catch {
    elements.uploadMessage.textContent = "Não foi possível publicar o PDF.";
  }
}

function attachLocalPdf(file) {
  const id = `local-${file.name}-${file.lastModified}`;
  const material = {
    id,
    title: elements.titleInput.value.trim() || cleanFileName(file.name),
    category: elements.categoryInput.value.trim() || "Anexado",
    description: elements.descriptionInput.value.trim() || "PDF adicionado nesta sessão.",
    file: URL.createObjectURL(file),
    local: true,
  };

  state.materials = [material, ...state.materials];
  elements.uploadForm.reset();
  updateSelectedFileName();
  elements.uploadMessage.textContent = "PDF anexado nesta sessão.";
  renderCategories();
  renderMaterials();
  openMaterial(id);
}

async function createClientCode(event) {
  event.preventDefault();

  if (!state.apiAvailable) {
    elements.clientCodeMessage.textContent = "Recurso disponível apenas com o servidor ativo.";
    return;
  }

  const clientName = elements.clientNameInput.value.trim();
  const code = elements.customCodeInput.value.trim();

  if (!clientName) {
    elements.clientCodeMessage.textContent = "Informe o nome do cliente.";
    return;
  }

  elements.clientCodeMessage.textContent = "Gerando código...";

  try {
    const clientCode = await apiRequest("/api/client-codes", {
      method: "POST",
      body: JSON.stringify({ clientName, code }),
    });

    elements.clientCodeForm.reset();
    elements.clientCodeMessage.textContent = `Código criado: ${clientCode.code}`;
    await refreshClientCodes();
  } catch (error) {
    elements.clientCodeMessage.textContent = error.message || "Não foi possível criar o código.";
  }
}

function renderClientCodes() {
  elements.clientCodeList.innerHTML = "";
  elements.clientCodeCount.textContent = state.clientCodes.length;

  if (state.role !== "admin") {
    return;
  }

  if (!state.apiAvailable) {
    elements.clientCodeList.innerHTML =
      '<div class="empty-list">Inicie o servidor para gerenciar códigos individuais.</div>';
    return;
  }

  if (state.clientCodes.length === 0) {
    elements.clientCodeList.innerHTML =
      '<div class="empty-list">Nenhum código individual criado.</div>';
    return;
  }

  state.clientCodes.forEach((clientCode) => {
    const item = document.createElement("article");
    item.className = "client-code-item";
    item.classList.toggle("is-inactive", !clientCode.active);
    item.innerHTML = `
      <div>
        <h3>${escapeHtml(clientCode.clientName)}</h3>
        <code>${escapeHtml(clientCode.code)}</code>
        <p>${formatClientCodeMeta(clientCode)}</p>
      </div>
      <div class="client-code-actions">
        <button type="button" class="copy-button">Copiar</button>
        <button type="button" class="toggle-code-button">
          ${clientCode.active ? "Desativar" : "Ativar"}
        </button>
        <button type="button" class="remove-code-button">Remover</button>
      </div>
    `;

    item.querySelector(".copy-button").addEventListener("click", () => {
      copyClientCode(clientCode.code);
    });

    item.querySelector(".toggle-code-button").addEventListener("click", () => {
      toggleClientCode(clientCode);
    });

    item.querySelector(".remove-code-button").addEventListener("click", () => {
      removeClientCode(clientCode);
    });

    elements.clientCodeList.append(item);
  });
}

async function copyClientCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    elements.clientCodeMessage.textContent = "Código copiado.";
  } catch {
    elements.clientCodeMessage.textContent = `Código: ${code}`;
  }
}

async function toggleClientCode(clientCode) {
  if (clientCode.active) {
    const confirmed = window.confirm(
      `Desativar o código de ${clientCode.clientName}? O cliente não conseguirá mais entrar com este código.`,
    );

    if (!confirmed) {
      return;
    }
  }

  try {
    const nextActive = !clientCode.active;
    await apiRequest(`/api/client-codes/${encodeURIComponent(clientCode.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: nextActive }),
    });
    elements.clientCodeMessage.textContent = nextActive
      ? "Código ativado."
      : "Código desativado.";
    await refreshClientCodes();
  } catch {
    elements.clientCodeMessage.textContent = "Não foi possível atualizar o código.";
  }
}

async function removeClientCode(clientCode) {
  const confirmed = window.confirm(
    `Remover o código de ${clientCode.clientName}? O cliente perderá acesso por este código.`,
  );

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/api/client-codes/${encodeURIComponent(clientCode.id)}`, {
      method: "DELETE",
    });
    elements.clientCodeMessage.textContent = "Código removido.";
    await refreshClientCodes();
  } catch {
    elements.clientCodeMessage.textContent = "Não foi possível remover o código.";
  }
}

function renderCategories() {
  const categories = [
    "Todos",
    ...new Set(state.materials.map((material) => material.category || "Sem categoria")),
  ];

  elements.categoryFilters.innerHTML = "";

  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = "category-chip";
    button.type = "button";
    button.textContent = category;
    button.setAttribute("aria-pressed", String(category === state.activeCategory));
    button.addEventListener("click", () => {
      state.activeCategory = category;
      renderCategories();
      renderMaterials();
    });
    elements.categoryFilters.append(button);
  });
}

function renderMaterials() {
  const materials = getFilteredMaterials();
  elements.materialList.innerHTML = "";
  elements.materialCount.textContent = state.unlocked ? materials.length : 0;

  if (!state.unlocked) {
    elements.materialList.innerHTML =
      '<div class="empty-list">Informe o código de acesso para ver os materiais.</div>';
    return;
  }

  if (materials.length === 0) {
    elements.materialList.innerHTML =
      '<div class="empty-list">Nenhum material encontrado.</div>';
    return;
  }

  materials.forEach((material) => {
    const card = document.createElement("article");
    card.className = "material-card";
    card.classList.toggle("is-active", material.id === state.activeId);

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <h3>${escapeHtml(material.title)}</h3>
      <p>${escapeHtml(material.description || "Material em PDF")}</p>
      <div class="material-meta">
        <span>${escapeHtml(material.category || "PDF")}</span>
        <span>${material.local ? "Sessão" : "Online"}</span>
      </div>
    `;
    button.addEventListener("click", () => openMaterial(material.id));
    card.append(button);

    if (state.role === "admin" && !material.local) {
      const actions = document.createElement("div");
      actions.className = "material-actions";
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.type = "button";
      deleteButton.textContent = "Remover";
      deleteButton.addEventListener("click", () => deleteMaterial(material.id));
      actions.append(deleteButton);
      card.append(actions);
    }

    elements.materialList.append(card);
  });
}

function openMaterial(id) {
  if (!state.unlocked) {
    return;
  }

  const material = state.materials.find((item) => item.id === id);
  if (!material) {
    return;
  }

  const pdfUrl = material.file || `/api/materials/${encodeURIComponent(material.id)}/pdf`;

  state.activeId = id;
  elements.viewerCategory.textContent = material.category || "PDF";
  elements.viewerTitle.textContent = material.title;
  elements.viewerDescription.textContent = material.description || "";
  elements.viewerStatus.textContent = material.local ? "Prévia local" : "Visualização online";
  elements.emptyState.hidden = true;
  elements.pdfViewer.hidden = false;
  elements.pdfViewer.src = `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`;
  renderMaterials();
}

async function deleteMaterial(id) {
  const material = state.materials.find((item) => item.id === id);
  if (!material) {
    return;
  }

  const confirmed = window.confirm(`Remover "${material.title}"?`);
  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/api/materials/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (state.activeId === id) {
      closeViewer();
    }
    await refreshMaterials();
  } catch {
    elements.uploadMessage.textContent = "Não foi possível remover o PDF.";
  }
}

function closeViewer() {
  state.activeId = null;
  elements.pdfViewer.hidden = true;
  elements.pdfViewer.removeAttribute("src");
  elements.emptyState.hidden = false;
  elements.viewerCategory.textContent = "PDF";
  elements.viewerTitle.textContent = "Selecione um material";
  elements.viewerDescription.textContent = "";
  elements.viewerStatus.textContent = "Visualização online";
}

function updateSelectedFileName() {
  const file = elements.pdfInput.files[0];
  elements.fileName.textContent = file ? file.name : "Nenhum arquivo escolhido";
}

function formatClientCodeMeta(clientCode) {
  const status = clientCode.active ? "Ativo" : "Inativo";
  const uses = `${clientCode.uses || 0} acesso${clientCode.uses === 1 ? "" : "s"}`;
  const lastUsed = clientCode.lastUsedAt
    ? `ultimo uso em ${formatDate(clientCode.lastUsedAt)}`
    : "sem uso ainda";

  return `${status} - ${uses} - ${lastUsed}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getFilteredMaterials() {
  const term = elements.searchInput.value.trim().toLowerCase();

  return state.materials.filter((material) => {
    const matchesCategory =
      state.activeCategory === "Todos" ||
      (material.category || "Sem categoria") === state.activeCategory;

    const searchable = [material.title, material.category, material.description]
      .join(" ")
      .toLowerCase();

    return matchesCategory && searchable.includes(term);
  });
}

async function apiRequest(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...options.headers,
  };

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(payload?.message || "Falha na requisição.");
    error.status = response.status;
    throw error;
  }

  return payload;
}

function cleanFileName(fileName) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
