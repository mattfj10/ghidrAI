const fs = require("node:fs");
const path = require("node:path");

function normalizeProjectSelection(selectedPath) {
  const basename = path.basename(selectedPath);
  if (basename.endsWith(".gpr")) {
    return {
      selectedPath,
      projectDirectory: path.dirname(selectedPath),
      projectName: basename.slice(0, -".gpr".length)
    };
  }
  if (basename.endsWith(".rep")) {
    return {
      selectedPath,
      projectDirectory: path.dirname(selectedPath),
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
        projectDirectory: selectedPath,
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
  if (!project) {
    throw new Error("Missing remembered project.");
  }

  let projectDirectory = null;
  if (typeof project.projectDirectory === "string" && project.projectDirectory.trim()) {
    projectDirectory = project.projectDirectory.trim();
  }

  let projectName = null;
  if (typeof project.projectName === "string" && project.projectName.trim()) {
    projectName = project.projectName.trim();
  } else if (typeof project.name === "string" && project.name.trim()) {
    projectName = project.name.trim();
  }

  if (
    !projectDirectory &&
    typeof project.projectPath === "string" &&
    project.projectPath.trim()
  ) {
    const legacyProjectPath = path.resolve(project.projectPath.trim());
    projectDirectory = path.dirname(legacyProjectPath);
    if (!projectName) {
      const basename = path.basename(legacyProjectPath, path.extname(legacyProjectPath));
      projectName = basename;
    }
  }

  if (!projectDirectory) {
    throw new Error("Missing remembered project directory.");
  }

  if (!projectName) {
    throw new Error("Missing remembered project name.");
  }

  return path.resolve(path.join(projectDirectory, `${projectName}.gpr`));
}

module.exports = {
  normalizeProjectSelection,
  toProjectFilePath
};
