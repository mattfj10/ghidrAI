const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { toProjectFilePath } = require("./projects");

function getDesktopLauncherPath(repoRoot) {
  if (process.platform === "linux") {
    return path.join(repoRoot, "Ghidra", "RuntimeScripts", "Linux", "ghidraRun");
  }
  if (process.platform === "win32") {
    return path.join(repoRoot, "Ghidra", "RuntimeScripts", "Windows", "ghidraRun.bat");
  }
  throw new Error(`Desktop Ghidra launch is not supported on ${process.platform}.`);
}

function launchDesktopProject(project, repoRoot) {
  const projectFilePath = toProjectFilePath(project);
  if (!fs.existsSync(projectFilePath)) {
    throw new Error(`Project file not found: ${projectFilePath}`);
  }

  const launcherPath = getDesktopLauncherPath(repoRoot);
  if (!fs.existsSync(launcherPath)) {
    throw new Error(`Could not find Ghidra launcher: ${launcherPath}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(launcherPath, [projectFilePath], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ launched: true, projectFilePath });
    });
  });
}

module.exports = {
  launchDesktopProject
};
