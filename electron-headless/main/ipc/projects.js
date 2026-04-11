const { IPC_CHANNELS } = require("../../ipc-channels");
const { launchDesktopProject } = require("../services/ghidra-launch");

function registerProjectIpc(ipcMain, repoRoot) {
  ipcMain.handle(IPC_CHANNELS.launchDesktopProject, (_event, project) =>
    launchDesktopProject(project, repoRoot)
  );
}

function removeProjectIpc(ipcMain) {
  ipcMain.removeHandler(IPC_CHANNELS.launchDesktopProject);
}

module.exports = {
  registerProjectIpc,
  removeProjectIpc
};
