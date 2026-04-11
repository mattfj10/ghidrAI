const path = require("node:path");

const { IPC_CHANNELS } = require("../../ipc-channels");
const { createModalWindow, waitForModalResult } = require("./modal-window");

function showAddBinariesModal(BrowserWindow, ipcMain, invokingWebContents) {
  const window = createModalWindow(BrowserWindow, invokingWebContents, {
    width: 520,
    height: 420,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "add-binaries-modal.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const resultPromise = waitForModalResult(ipcMain, window, IPC_CHANNELS.addBinariesResult);
  window.loadFile(path.join(__dirname, "..", "..", "renderer", "modals", "add-binaries", "index.html"));
  window.once("ready-to-show", () => {
    window.show();
  });
  return resultPromise;
}

module.exports = {
  showAddBinariesModal
};
