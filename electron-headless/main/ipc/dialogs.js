const { IPC_CHANNELS } = require("../../ipc-channels");
const { normalizeProjectSelection } = require("../services/projects");

async function chooseCreateProjectDirectory(dialog) {
  const result = await dialog.showOpenDialog({
    title: "Choose New Project Location",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return result.filePaths[0];
}

async function chooseExistingProject(dialog) {
  const result = await dialog.showOpenDialog({
    title: "Open Ghidra Project",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Ghidra Projects", extensions: ["gpr", "rep"] }]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return normalizeProjectSelection(result.filePaths[0]);
}

async function chooseBinaryFiles(dialog) {
  const result = await dialog.showOpenDialog({
    title: "Add Binaries to Project",
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return result.filePaths;
}

function registerDialogIpc(ipcMain, dialog) {
  ipcMain.handle(IPC_CHANNELS.chooseCreateProjectDirectory, () => chooseCreateProjectDirectory(dialog));
  ipcMain.handle(IPC_CHANNELS.chooseExistingProject, () => chooseExistingProject(dialog));
  ipcMain.handle(IPC_CHANNELS.chooseBinaryFiles, () => chooseBinaryFiles(dialog));
}

function removeDialogIpc(ipcMain) {
  ipcMain.removeHandler(IPC_CHANNELS.chooseCreateProjectDirectory);
  ipcMain.removeHandler(IPC_CHANNELS.chooseExistingProject);
  ipcMain.removeHandler(IPC_CHANNELS.chooseBinaryFiles);
}

module.exports = {
  registerDialogIpc,
  removeDialogIpc
};
