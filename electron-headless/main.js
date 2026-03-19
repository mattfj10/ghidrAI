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

  function openWorkspaceWindow(project) {
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 640,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: false,
        sandbox: false
      }
    });

    window.loadFile(path.join(__dirname, "renderer", "workspace.html"));
    
    // We could pass the project data via webContents.send, but for now we just open it
    // window.webContents.once('did-finish-load', () => {
    //   window.webContents.send('load-project', project);
    // });
  }

  await app.whenReady();
  ipcMain.handle("headless:open-workspace", async (_event, project) => {
    openWorkspaceWindow(project);
    return { launched: true };
  });
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
  ipcMain.handle("headless:choose-binary-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "Add Binaries to Project",
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths;
  });
  ipcMain.handle("headless:launch-desktop-project", async (_event, project) => {
    return launchDesktopProject(project);
  });
  
  ipcMain.handle("headless:show-add-binaries-modal", () => {
    return new Promise((resolve) => {
      const addBinariesWindow = new BrowserWindow({
        width: 520,
        height: 420,
        parent: BrowserWindow.getFocusedWindow(),
        modal: true,
        show: false,
        resizable: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      });

      const addBinariesHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: "Inter", system-ui, sans-serif; background: #0a0a0a; color: #eeeeee; padding: 20px; margin: 0; }
            h3 { margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: 500; color: #fff; }
            .binary-list { max-height: 200px; overflow-y: auto; border: 1px solid #2a2a2a; border-radius: 4px; background: #161616; margin-bottom: 12px; padding: 8px; }
            .binary-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; background: #1e1e1e; font-size: 12px; }
            .binary-item:last-child { margin-bottom: 0; }
            .binary-name { font-weight: 500; color: #eeeeee; flex-shrink: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .binary-path { color: #888888; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
            .binary-remove { flex-shrink: 0; padding: 4px 8px; font-size: 11px; cursor: pointer; background: transparent; border: 1px solid rgba(191, 74, 106, 0.5); color: #ffb8c9; border-radius: 4px; transition: background 100ms ease; }
            .binary-remove:hover { background: rgba(191, 74, 106, 0.15); }
            .empty-msg { color: #888888; font-size: 12px; padding: 12px; text-align: center; }
            .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
            button { padding: 8px 14px; border: 1px solid #2a2a2a; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 100ms ease, border-color 100ms ease; }
            button.add { background: #333333; color: #eeeeee; }
            button.add:hover { background: #444444; border-color: #444; }
            button.create { background: #333333; color: #eeeeee; }
            button.create:hover { background: #444444; border-color: #444; }
            button.cancel { background: transparent; border: 1px solid #2a2a2a; color: #eeeeee; }
            button.cancel:hover { background: rgba(255, 255, 255, 0.05); }
          </style>
        </head>
        <body>
          <h3>Add Binaries to Project</h3>
          <p style="margin: 0 0 12px; font-size: 12px; color: #9e9e9e;">Optional: add files to import into the project. Leave empty to create an empty project.</p>
          <div class="binary-list" id="list">
            <div class="empty-msg" id="emptyMsg">No binaries added yet</div>
          </div>
          <div class="buttons">
            <button class="cancel" id="cancel">Cancel</button>
            <button class="add" id="add">Add Files</button>
            <button class="create" id="create">Create Project</button>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            const listEl = document.getElementById('list');
            const emptyMsg = document.getElementById('emptyMsg');
            let binaries = [];

            function render() {
              const items = listEl.querySelectorAll('.binary-item');
              items.forEach(i => i.remove());
              if (binaries.length === 0) {
                emptyMsg.style.display = 'block';
                return;
              }
              emptyMsg.style.display = 'none';
              binaries.forEach((b, idx) => {
                const div = document.createElement('div');
                div.className = 'binary-item';
                div.innerHTML = '<span class="binary-name" title="' + (b.path || '').replace(/"/g, '&quot;') + '">' + (b.name || b.path) + '</span><span class="binary-path" title="' + (b.path || '').replace(/"/g, '&quot;') + '">' + (b.path || '') + '</span><button class="binary-remove" data-idx="' + idx + '">Remove</button>';
                div.querySelector('.binary-remove').onclick = () => { binaries.splice(idx, 1); render(); };
                listEl.appendChild(div);
              });
            }

            document.getElementById('add').onclick = async () => {
              const paths = await ipcRenderer.invoke('headless:choose-binary-files');
              if (paths && paths.length) {
                paths.forEach(p => {
                  if (binaries.some(b => b.path === p)) return;
                  const name = p.split(/[\\\\/]/).pop() || p;
                  binaries.push({ name, path: p });
                });
                render();
              }
            };

            document.getElementById('create').onclick = () => {
              ipcRenderer.send('add-binaries-result', binaries.map(b => b.path));
            };

            document.getElementById('cancel').onclick = () => {
              ipcRenderer.send('add-binaries-result', null);
            };

            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') ipcRenderer.send('add-binaries-result', null);
            });

            render();
          </script>
        </body>
        </html>
      `;

      addBinariesWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(addBinariesHtml));

      addBinariesWindow.once('ready-to-show', () => {
        addBinariesWindow.show();
      });

      ipcMain.once('add-binaries-result', (_event, value) => {
        addBinariesWindow.close();
        resolve(value);
      });

      addBinariesWindow.on('closed', () => {
        try { ipcMain.removeAllListeners('add-binaries-result'); } catch (_) {}
        resolve(null);
      });
    });
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
            body { font-family: "Inter", system-ui, sans-serif; background: #0a0a0a; color: #eeeeee; padding: 20px; margin: 0; }
            h3 { margin-top: 0; margin-bottom: 15px; font-size: 14px; font-weight: 500; color: #fff; }
            input { width: 100%; padding: 8px 12px; margin-bottom: 15px; background: #161616; border: 1px solid #2a2a2a; color: #eeeeee; box-sizing: border-box; outline: none; border-radius: 4px; font-size: 13px; }
            input:focus { border-color: #555; }
            .buttons { text-align: right; }
            button { padding: 8px 14px; margin-left: 8px; border: 1px solid #2a2a2a; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 100ms ease, border-color 100ms ease; }
            button.ok { background: #333333; color: #eeeeee; }
            button.ok:hover { background: #444444; border-color: #444; }
            button.cancel { background: transparent; border: 1px solid #2a2a2a; color: #eeeeee; }
            button.cancel:hover { background: rgba(255, 255, 255, 0.05); }
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

  ipcMain.handle("headless:prompt-for-rename", async (_event, currentName) => {
    return new Promise((resolve) => {
      const defaultValue = typeof currentName === "string" ? currentName : "";
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
            body { font-family: "Inter", system-ui, sans-serif; background: #0a0a0a; color: #eeeeee; padding: 20px; margin: 0; }
            h3 { margin-top: 0; margin-bottom: 15px; font-size: 14px; font-weight: 500; color: #fff; }
            input { width: 100%; padding: 8px 12px; margin-bottom: 15px; background: #161616; border: 1px solid #2a2a2a; color: #eeeeee; box-sizing: border-box; outline: none; border-radius: 4px; font-size: 13px; }
            input:focus { border-color: #555; }
            .buttons { text-align: right; }
            button { padding: 8px 14px; margin-left: 8px; border: 1px solid #2a2a2a; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 100ms ease, border-color 100ms ease; }
            button.ok { background: #333333; color: #eeeeee; }
            button.ok:hover { background: #444444; border-color: #444; }
            button.cancel { background: transparent; border: 1px solid #2a2a2a; color: #eeeeee; }
            button.cancel:hover { background: rgba(255, 255, 255, 0.05); }
          </style>
        </head>
        <body>
          <h3>Rename Project</h3>
          <input type="text" id="name" value="${(defaultValue).replace(/"/g, "&quot;")}" autofocus />
          <div class="buttons">
            <button class="cancel" id="cancel">Cancel</button>
            <button class="ok" id="ok">Rename</button>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            const input = document.getElementById('name');
            input.select();
            document.getElementById('ok').onclick = () => ipcRenderer.send('prompt-rename-result', input.value);
            document.getElementById('cancel').onclick = () => ipcRenderer.send('prompt-rename-result', null);
            input.onkeydown = (e) => {
              if (e.key === 'Enter') ipcRenderer.send('prompt-rename-result', input.value);
              if (e.key === 'Escape') ipcRenderer.send('prompt-rename-result', null);
            };
          </script>
        </body>
        </html>
      `;

      promptWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(promptHtml));

      promptWindow.once('ready-to-show', () => {
        promptWindow.show();
      });

      ipcMain.once('prompt-rename-result', (_ev, value) => {
        promptWindow.close();
        resolve(value ? value.trim() : null);
      });

      promptWindow.on('closed', () => {
        try {
          ipcMain.removeAllListeners('prompt-rename-result');
        }
        catch (_) {}
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
    ipcMain.removeHandler("headless:choose-binary-files");
    ipcMain.removeHandler("headless:launch-desktop-project");
    ipcMain.removeHandler("headless:open-workspace");
    ipcMain.removeHandler("headless:prompt-for-project-name");
    ipcMain.removeHandler("headless:prompt-for-rename");
    ipcMain.removeHandler("headless:show-add-binaries-modal");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
