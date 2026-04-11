const { registerDialogIpc, removeDialogIpc } = require("./dialogs");
const { registerProjectIpc, removeProjectIpc } = require("./projects");
const { registerWindowIpc, removeWindowIpc } = require("./windows");

function registerIpcHandlers({ BrowserWindow, dialog, ipcMain, repoRoot }) {
  registerDialogIpc(ipcMain, dialog);
  registerProjectIpc(ipcMain, repoRoot);
  registerWindowIpc(ipcMain, BrowserWindow);
}

function removeIpcHandlers(ipcMain) {
  removeDialogIpc(ipcMain);
  removeProjectIpc(ipcMain);
  removeWindowIpc(ipcMain);
}

module.exports = {
  registerIpcHandlers,
  removeIpcHandlers
};
