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

function createBackendApi() {
  return {
    baseUrl,
    health: () => jsonRequest("/api/v1/health"),
    listProjects: () => jsonRequest("/api/v1/projects"),
    createProject: (projectPath, projectName) =>
      jsonRequest("/api/v1/projects", "POST", { projectPath, projectName }),
    importAndAnalyze: (projectId, inputPaths) =>
      jsonRequest(`/api/v1/projects/${projectId}/import-and-analyze`, "POST", { inputPaths }),
    openProject: (projectPath, projectName) =>
      jsonRequest("/api/v1/projects/open", "POST", { projectPath, projectName }),
    clearProjects: () => jsonRequest("/api/v1/projects", "DELETE"),
    deleteProject: (projectId) =>
      jsonRequest(`/api/v1/projects/${encodeURIComponent(projectId)}`, "DELETE"),
    renameProject: (projectId, newName) =>
      jsonRequest(`/api/v1/projects/${encodeURIComponent(projectId)}`, "PATCH", {
        name: newName
      })
  };
}

module.exports = {
  baseUrl,
  jsonRequest,
  createBackendApi
};
