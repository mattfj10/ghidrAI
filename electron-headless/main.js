const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function loadElectronMain() {
  try {
    return require("electron");
  } catch (error) {
    // Fall through to alternate module shapes used by some Electron builds.
  }
  try {
    const mod = await import("electron/main");
    return mod.default ?? mod;
  } catch (error) {
    const mod = await import("electron");
    return mod.default ?? mod;
  }
}

async function main() {
  const electron = await loadElectronMain();
  const { app, BrowserWindow, dialog, ipcMain } = electron;
  if (!app || !BrowserWindow || !dialog || !ipcMain) {
    throw new Error("Electron main-process APIs are unavailable.");
  }

  const repoRoot = path.resolve(__dirname, "..");

  function createWindow() {
    const window = new BrowserWindow({
      width: 1060,
      height: 760,
      minWidth: 900,
      minHeight: 640,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: false,
        sandbox: false
      }
    });

    window.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

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

  function getDesktopLauncherPath() {
    if (process.platform === "linux") {
      return path.join(repoRoot, "Ghidra", "RuntimeScripts", "Linux", "ghidraRun");
    }
    if (process.platform === "win32") {
      return path.join(repoRoot, "Ghidra", "RuntimeScripts", "Windows", "ghidraRun.bat");
    }
    throw new Error(`Desktop Ghidra launch is not supported on ${process.platform}.`);
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

  function launchDesktopProject(project) {
    const projectFilePath = toProjectFilePath(project);
    if (!fs.existsSync(projectFilePath)) {
      throw new Error(`Project file not found: ${projectFilePath}`);
    }

    const launcherPath = getDesktopLauncherPath();
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

  await app.whenReady();
  ipcMain.handle("headless:choose-create-project-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose New Project Location",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("headless:choose-existing-project", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open Ghidra Project",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Ghidra Projects", extensions: ["gpr", "rep"] }]
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return normalizeProjectSelection(result.filePaths[0]);
  });
  ipcMain.handle("headless:launch-desktop-project", async (_event, project) => {
    return launchDesktopProject(project);
  });
  
  ipcMain.handle("headless:prompt-for-project-name", async () => {
    // We use a simple prompt window since Electron doesn't have a built-in text prompt dialog
    return new Promise((resolve) => {
      const promptWindow = new BrowserWindow({
        width: 400,
        height: 180,
        parent: BrowserWindow.getFocusedWindow(),
        modal: true,
        show: false,
        resizable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      });

      const promptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: "Segoe UI", sans-serif; background: #252526; color: #ccc; padding: 20px; margin: 0; }
            h3 { margin-top: 0; margin-bottom: 15px; font-size: 14px; font-weight: 500; color: #fff; }
            input { width: 100%; padding: 8px; margin-bottom: 15px; background: #3c3c3c; border: 1px solid #3c3c3c; color: #fff; box-sizing: border-box; outline: none; border-radius: 2px; }
            input:focus { border-color: #007fd4; }
            .buttons { text-align: right; }
            button { padding: 6px 16px; margin-left: 8px; border: none; border-radius: 2px; cursor: pointer; }
            button.ok { background: #007fd4; color: white; }
            button.cancel { background: transparent; border: 1px solid #454545; color: #ccc; }
          </style>
        </head>
        <body>
          <h3>Project Name</h3>
          <input type="text" id="name" autofocus />
          <div class="buttons">
            <button class="cancel" id="cancel">Cancel</button>
            <button class="ok" id="ok">Create</button>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            const input = document.getElementById('name');
            document.getElementById('ok').onclick = () => ipcRenderer.send('prompt-result', input.value);
            document.getElementById('cancel').onclick = () => ipcRenderer.send('prompt-result', null);
            input.onkeydown = (e) => {
              if (e.key === 'Enter') ipcRenderer.send('prompt-result', input.value);
              if (e.key === 'Escape') ipcRenderer.send('prompt-result', null);
            };
          </script>
        </body>
        </html>
      `;

      promptWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(promptHtml));
      
      promptWindow.once('ready-to-show', () => {
        promptWindow.show();
      });

      ipcMain.once('prompt-result', (event, value) => {
        promptWindow.close();
        resolve(value ? value.trim() : null);
      });

      promptWindow.on('closed', () => {
        // If closed via X button without submitting
        resolve(null);
      });
    });
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("will-quit", () => {
    ipcMain.removeHandler("headless:choose-create-project-directory");
    ipcMain.removeHandler("headless:choose-existing-project");
    ipcMain.removeHandler("headless:launch-desktop-project");
    ipcMain.removeHandler("headless:prompt-for-project-name");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
