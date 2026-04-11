const path = require("node:path");

const { IPC_CHANNELS } = require("../../ipc-channels");
const { createModalWindow, waitForModalResult } = require("./modal-window");

function promptForProjectName(BrowserWindow, ipcMain, invokingWebContents) {
  const window = createModalWindow(BrowserWindow, invokingWebContents, {
    width: 400,
    height: 180,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "project-name-modal.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const resultPromise = waitForModalResult(ipcMain, window, IPC_CHANNELS.promptResult);
  window.loadFile(path.join(__dirname, "..", "..", "renderer", "modals", "project-name", "index.html"));
  window.once("ready-to-show", () => {
    window.show();
  });
  return resultPromise;
}

module.exports = {
  promptForProjectName
};
