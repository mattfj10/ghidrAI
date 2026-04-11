const { IPC_CHANNELS } = require("../../ipc-channels");
const { showAddBinariesModal } = require("../windows/add-binaries-modal");
const { promptForProjectName } = require("../windows/project-name-modal");
const { promptForRename } = require("../windows/rename-modal");

function registerWindowIpc(ipcMain, BrowserWindow) {
  ipcMain.handle(IPC_CHANNELS.showAddBinariesModal, (event) =>
    showAddBinariesModal(BrowserWindow, ipcMain, event.sender)
  );
  ipcMain.handle(IPC_CHANNELS.promptForProjectName, (event) =>
    promptForProjectName(BrowserWindow, ipcMain, event.sender)
  );
  ipcMain.handle(IPC_CHANNELS.promptForRename, (event, currentName) =>
    promptForRename(BrowserWindow, ipcMain, event.sender, currentName)
  );
}

function removeWindowIpc(ipcMain) {
  ipcMain.removeHandler(IPC_CHANNELS.showAddBinariesModal);
  ipcMain.removeHandler(IPC_CHANNELS.promptForProjectName);
  ipcMain.removeHandler(IPC_CHANNELS.promptForRename);
}

module.exports = {
  registerWindowIpc,
  removeWindowIpc
};
