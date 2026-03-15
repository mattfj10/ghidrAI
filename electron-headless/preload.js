const { randomUUID } = require("node:crypto");

const baseUrl = process.env.GHIDRA_BACKEND_URL || "http://127.0.0.1:8089";

async function jsonRequest(path, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": randomUUID()
    }
  };
  if (body !== null) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }
  return payload;
}

const fallbackApi = {
  baseUrl,
  health: () => jsonRequest("/api/v1/health"),
  listProjects: () => jsonRequest("/api/v1/projects"),
  createProject: (projectPath, projectName) =>
    jsonRequest("/api/v1/projects", "POST", { projectPath, projectName }),
  openProject: (projectPath, projectName) =>
    jsonRequest("/api/v1/projects/open", "POST", { projectPath, projectName }),
  clearProjects: () => jsonRequest("/api/v1/projects", "DELETE"),
  chooseCreateProjectDirectory: async () => {
    throw new Error("Native create-project picker is not available.");
  },
  chooseExistingProject: async () => {
    throw new Error("Native open-project picker is not available.");
  },
  promptForProjectName: async () => {
    throw new Error("Native prompt is not available.");
  }
};

try {
  const { contextBridge, ipcRenderer } = require("electron");
  const api = {
    ...fallbackApi,
    clearProjects: () => fallbackApi.clearProjects(),
    chooseCreateProjectDirectory: () => {
      if (!ipcRenderer) {
        throw new Error("Electron IPC bridge is unavailable.");
      }
      return ipcRenderer.invoke("headless:choose-create-project-directory");
    },
    chooseExistingProject: () => {
      if (!ipcRenderer) {
        throw new Error("Electron IPC bridge is unavailable.");
      }
      return ipcRenderer.invoke("headless:choose-existing-project");
    },
    promptForProjectName: () => {
      if (!ipcRenderer) {
        throw new Error("Electron IPC bridge is unavailable.");
      }
      return ipcRenderer.invoke("headless:prompt-for-project-name");
    }
  };

  window.headlessApi = api;
  if (contextBridge && process.contextIsolated) {
    contextBridge.exposeInMainWorld("headlessApi", api);
  }
} catch (error) {
  console.error(error);
  window.headlessApi = fallbackApi;
}
