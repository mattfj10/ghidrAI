const { IPC_CHANNELS } = require("../ipc-channels");
const { createBackendApi } = require("./shared/api-client");
const { invoke, exposeApi } = require("./shared/electron-api");

const backendApi = createBackendApi();

const api = {
  ...backendApi,
  launchDesktopProject: (project) => invoke(IPC_CHANNELS.launchDesktopProject, project),
  chooseCreateProjectDirectory: () => invoke(IPC_CHANNELS.chooseCreateProjectDirectory),
  chooseExistingProject: () => invoke(IPC_CHANNELS.chooseExistingProject),
  promptForProjectName: () => invoke(IPC_CHANNELS.promptForProjectName),
  promptForRename: (currentName) => invoke(IPC_CHANNELS.promptForRename, currentName),
  showAddBinariesModal: () => invoke(IPC_CHANNELS.showAddBinariesModal)
};

exposeApi(api);
