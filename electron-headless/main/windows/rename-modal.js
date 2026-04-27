const path = require("node:path");

const { IPC_CHANNELS } = require("../../ipc-channels");
const { createModalWindow, waitForModalResult } = require("./modal-window");

function promptForRename(BrowserWindow, ipcMain, invokingWebContents, currentName) {
  const defaultValue = typeof currentName === "string" ? currentName : "";
  const window = createModalWindow(BrowserWindow, invokingWebContents, {
    width: 400,
    height: 180,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "rename-modal.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const resultPromise = waitForModalResult(ipcMain, window, IPC_CHANNELS.promptRenameResult);
  window.loadFile(
    path.join(__dirname, "..", "..", "renderer", "modals", "rename-project", "index.html"),
    {
      query: { currentName: defaultValue }
    }
  );
  window.once("ready-to-show", () => {
    window.show();
  });
  return resultPromise;
}

module.exports = {
  promptForRename
};
