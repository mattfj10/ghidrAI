const healthEl = document.getElementById("health");
const projectsListEl = document.getElementById("projectsList");
const formMessageEl = document.getElementById("formMessage");
const createProjectBtnEl = document.getElementById("createProjectBtn");
const openProjectBtnEl = document.getElementById("openProjectBtn");
const refreshProjectsBtnEl = document.getElementById("refreshProjectsBtn");
const clearProjectsBtnEl = document.getElementById("clearProjectsBtn");
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
  refreshProjectsBtnEl.disabled = busyState;
  clearProjectsBtnEl.disabled = busyState;
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
    await refreshProjects();
    setFormMessage(
      `Created ${response.data.project.name} at ${response.data.project.projectPath}.`,
      "success"
    );
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

refreshProjectsBtnEl.addEventListener("click", async () => {
  try {
    await refreshProjects();
    setFormMessage("Remembered project locations refreshed.", "muted");
  } catch (error) {
    setFormMessage(error.message, "error");
  }
});

clearProjectsBtnEl.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to clear all projects from the index? This will not delete the projects from disk, only remove them from the remembered list.")) {
    return;
  }
  setBusy(true);
  setFormMessage("Clearing projects...", "muted");
  try {
    const response = await requireApi().clearProjects();
    console.log("Clear projects response:", response);
    await refreshProjects();
    const projectsAfter = await requireApi().listProjects();
    console.log("Projects after clear:", projectsAfter);
    setFormMessage("All projects cleared from index.", "success");
  } catch (error) {
    console.error("Error clearing projects:", error);
    setFormMessage(`Error: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
});

refreshHealth();
refreshProjects().catch((error) => {
  setFormMessage(error.message, "error");
});
