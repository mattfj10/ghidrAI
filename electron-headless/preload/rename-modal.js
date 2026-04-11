const { IPC_CHANNELS } = require("../ipc-channels");
const { send, exposeApi } = require("./shared/electron-api");

const api = {
  submitRename: (value) => send(IPC_CHANNELS.promptRenameResult, value),
  cancelRename: () => send(IPC_CHANNELS.promptRenameResult, null)
};

exposeApi(api);
