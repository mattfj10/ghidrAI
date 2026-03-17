const healthEl = document.getElementById("health");
const projectsListEl = document.getElementById("projectsList");
const formMessageEl = document.getElementById("formMessage");
const createProjectBtnEl = document.getElementById("createProjectBtn");
const openProjectBtnEl = document.getElementById("openProjectBtn");
const api = window.headlessApi;
let busyState = false;

function requireApi() {
  if (!api) {
    throw new Error("Electron preload bridge is unavailable. Restart the app.");
  }
  return api;
}

function setHealth(text, online) {
  healthEl.textContent = text;
  healthEl.classList.toggle("online", online);
  healthEl.classList.toggle("offline", !online);
}

function setFormMessage(message, tone = "muted") {
  formMessageEl.textContent = message;
  formMessageEl.dataset.tone = tone;
}

function setBusy(nextBusyState) {
  busyState = Boolean(nextBusyState);
  createProjectBtnEl.disabled = busyState;
  openProjectBtnEl.disabled = busyState;
  for (const card of document.querySelectorAll(".project-card-action")) {
    card.disabled = busyState;
  }
}

async function refreshHealth() {
  try {
    const health = await requireApi().health();
    setHealth(`Backend ${health.data.status}`, true);
  } catch (error) {
    setHealth(`Backend offline: ${error.message}`, false);
  }
}

function formatProjectLocation(project) {
  const pathParts = project.projectPath.split(/[\\/]/);
  pathParts.pop();
  return pathParts.join("/") || project.projectPath;
}

async function launchRememberedProject(project) {
  if (!project.existsOnDisk) {
    setFormMessage(`Cannot open ${project.name}: project is missing on disk.`, "error");
    return;
  }

  setBusy(true);
  setFormMessage(`Launching ${project.name} in Ghidra...`, "muted");
  try {
    await requireApi().launchDesktopProject(project);
    setFormMessage(`Launched ${project.name} in Ghidra.`, "success");
  } finally {
    setBusy(false);
  }
}

function showContextMenu(event, project) {
  event.preventDefault();
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.dataset.projectId = project.projectId;

  const renameItem = document.createElement("button");
  renameItem.type = "button";
  renameItem.className = "context-menu-item";
  renameItem.textContent = "Rename";
  renameItem.addEventListener("click", () => {
    closeContextMenu();
    handleRenameProject(project);
  });

  const deleteItem = document.createElement("button");
  deleteItem.type = "button";
  deleteItem.className = "context-menu-item context-menu-item-danger";
  deleteItem.textContent = "Delete from list";
  deleteItem.addEventListener("click", () => {
    closeContextMenu();
    handleDeleteProject(project);
  });

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let left = event.clientX;
  let top = event.clientY;
  if (left + rect.width > viewportW) left = viewportW - rect.width - 8;
  if (top + rect.height > viewportH) top = viewportH - rect.height - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const closeOnClickOutside = (e) => {
    if (!menu.contains(e.target)) {
      closeContextMenu();
    }
    document.removeEventListener("click", closeOnClickOutside);
  };
  setTimeout(() => document.addEventListener("click", closeOnClickOutside), 0);
}

function closeContextMenu() {
  const existing = document.querySelector(".context-menu");
  if (existing) existing.remove();
}

async function handleRenameProject(project) {
  const newName = await requireApi().promptForRename(project.name);
  if (newName == null || newName.trim() === "") {
    return;
  }
  try {
    await requireApi().renameProject(project.projectId, newName.trim());
    await refreshProjects();
    setFormMessage(`Renamed project to "${newName.trim()}".`, "success");
  } catch (error) {
    setFormMessage(error.message, "error");
  }
}

async function handleDeleteProject(project) {
  if (
    !confirm(
      `Remove "${project.name}" from the remembered list? This will not delete the project from disk.`
    )
  ) {
    return;
  }
  try {
    await requireApi().deleteProject(project.projectId);
    await refreshProjects();
    setFormMessage(`Removed "${project.name}" from the remembered list.`, "success");
  } catch (error) {
    setFormMessage(error.message, "error");
  }
}

function createProjectCard(project) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "project-card project-card-action";
  if (!project.existsOnDisk) {
    card.classList.add("is-missing");
  }
  card.disabled = busyState;
  card.innerHTML = `
    <div class="project-title">${project.name}</div>
    <div class="project-meta"><strong>Directory:</strong> ${formatProjectLocation(project)}</div>
    <div class="project-meta"><strong>Project Path:</strong> ${project.projectPath}</div>
    <div class="project-meta">
      <strong>Status:</strong> ${project.existsOnDisk ? "available" : "missing on disk"}
    </div>
    <div class="project-hint">
      ${project.existsOnDisk ? "Open this project in desktop Ghidra" : "This remembered project is no longer available on disk"}
    </div>
  `;
  card.addEventListener("click", async () => {
    try {
      await launchRememberedProject(project);
    } catch (error) {
      setFormMessage(error.message, "error");
    }
  });
  card.addEventListener("contextmenu", (e) => showContextMenu(e, project));
  return card;
}

function renderProjects(projects) {
  projectsListEl.innerHTML = "";
  if (!projects.length) {
    projectsListEl.innerHTML = `
      <div class="project-card empty-state">
        <div class="project-title">No remembered projects yet</div>
        <div class="project-meta">
          Create a new project or open an existing one to see it listed here.
        </div>
      </div>
    `;
    return;
  }

  for (const project of projects) {
    projectsListEl.appendChild(createProjectCard(project));
  }
}

async function refreshProjects() {
  const response = await requireApi().listProjects();
  renderProjects(response.data.projects || []);
}

async function createProject() {
  const projectPath = await requireApi().chooseCreateProjectDirectory();
  if (!projectPath) {
    setFormMessage("Project creation cancelled.", "muted");
    return;
  }

  const projectName = await requireApi().promptForProjectName();
  if (!projectName) {
    setFormMessage("Project creation cancelled.", "muted");
    return;
  }

  const binaryPaths = await requireApi().showAddBinariesModal();
  if (binaryPaths === null) {
    setFormMessage("Project creation cancelled.", "muted");
    return;
  }

  setBusy(true);
  setFormMessage("Creating project...", "muted");
  const slowMessageTimer = setTimeout(() => {
    setFormMessage(
      "Creating project... (Ghidra is initializing — this may take a minute on first run)",
      "muted"
    );
  }, 5000);
  try {
    const response = await requireApi().createProject(projectPath, projectName);
    const project = response.data.project;
    if (binaryPaths && binaryPaths.length > 0) {
      setFormMessage("Importing binaries...", "muted");
      await requireApi().importAndAnalyze(project.projectId, binaryPaths);
      setFormMessage(
        `Created ${project.name} and imported ${binaryPaths.length} binary(s). Analysis may continue in the background.`,
        "success"
      );
    } else {
      setFormMessage(
        `Created ${project.name} at ${project.projectPath}.`,
        "success"
      );
    }
    await refreshProjects();
  } finally {
    clearTimeout(slowMessageTimer);
    setBusy(false);
  }
}

async function openProject() {
  const selectedProject = await requireApi().chooseExistingProject();
  if (!selectedProject) {
    setFormMessage("Open project cancelled.", "muted");
    return;
  }

  setBusy(true);
  setFormMessage("Opening project...", "muted");
  try {
    const response = await requireApi().openProject(
      selectedProject.projectPath,
      selectedProject.projectName
    );
    await refreshProjects();
    setFormMessage(
      `Opened ${response.data.project.name} from ${response.data.project.projectPath}.`,
      "success"
    );
  } finally {
    setBusy(false);
  }
}

createProjectBtnEl.addEventListener("click", async () => {
  try {
    await createProject();
  } catch (error) {
    setFormMessage(error.message, "error");
  }
});

openProjectBtnEl.addEventListener("click", async () => {
  try {
    await openProject();
  } catch (error) {
    setFormMessage(error.message, "error");
  }
});

refreshHealth();
refreshProjects().catch((error) => {
  setFormMessage(error.message, "error");
});
