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
  throw new Error("Select a Ghidra project file (.gpr or .rep).");
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
