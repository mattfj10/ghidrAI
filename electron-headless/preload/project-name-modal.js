const { IPC_CHANNELS } = require("../ipc-channels");
const { send, exposeApi } = require("./shared/electron-api");

const api = {
  submitProjectName: (value) => send(IPC_CHANNELS.promptResult, value),
  cancelProjectName: () => send(IPC_CHANNELS.promptResult, null)
};

exposeApi(api);
