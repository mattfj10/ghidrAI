const path = require("node:path");
const { registerIpcHandlers } = require("./main/ipc");
const { wireAppLifecycle } = require("./main/lifecycle");
const { createMainWindow } = require("./main/windows/main-window");

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

  await app.whenReady();
  registerIpcHandlers({ BrowserWindow, dialog, ipcMain, repoRoot });
  wireAppLifecycle(app, BrowserWindow, ipcMain);
  createMainWindow(BrowserWindow);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
