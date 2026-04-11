const fs = require("node:fs");
const path = require("node:path");

function normalizeProjectSelection(selectedPath) {
  const basename = path.basename(selectedPath);
  if (basename.endsWith(".gpr")) {
    return {
      selectedPath,
      projectPath: path.dirname(selectedPath),
      projectName: basename.slice(0, -".gpr".length)
    };
  }
  if (basename.endsWith(".rep")) {
    return {
      selectedPath,
      projectPath: path.dirname(selectedPath),
      projectName: basename.slice(0, -".rep".length)
    };
  }
  if (fs.existsSync(selectedPath) && fs.lstatSync(selectedPath).isDirectory()) {
    const entries = fs.readdirSync(selectedPath);
    const projectNames = entries
      .filter((entry) => entry.endsWith(".gpr"))
      .map((entry) => entry.slice(0, -".gpr".length))
      .filter((name) => entries.includes(`${name}.rep`));
    if (projectNames.length === 1) {
      return {
        selectedPath,
        projectPath: selectedPath,
        projectName: projectNames[0]
      };
    }
    if (projectNames.length > 1) {
      throw new Error(
        "The selected folder contains multiple Ghidra projects. Select a specific .gpr file or .rep directory."
      );
    }
  }
  throw new Error(
    "Select a Ghidra project file (.gpr), project directory (.rep), or a folder containing exactly one project."
  );
}

function toProjectFilePath(project) {
  if (!project || typeof project.projectPath !== "string" || !project.projectPath.trim()) {
    throw new Error("Missing remembered project path.");
  }
  const normalizedProjectPath = project.projectPath.endsWith(".gpr")
    ? project.projectPath
    : `${project.projectPath}.gpr`;
  return path.resolve(normalizedProjectPath);
}

module.exports = {
  normalizeProjectSelection,
  toProjectFilePath
};
