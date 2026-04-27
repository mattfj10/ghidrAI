const { IPC_CHANNELS } = require("../ipc-channels");
const { invoke, send, exposeApi } = require("./shared/electron-api");

const api = {
  chooseBinaryFiles: () => invoke(IPC_CHANNELS.chooseBinaryFiles),
  submitAddBinariesResult: (paths) => send(IPC_CHANNELS.addBinariesResult, paths),
  cancelAddBinariesResult: () => send(IPC_CHANNELS.addBinariesResult, null)
};

exposeApi(api);
