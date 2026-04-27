function getIpcRenderer() {
  try {
    const { ipcRenderer } = require("electron");
    if (!ipcRenderer) {
      throw new Error("Electron IPC bridge is unavailable.");
    }
    return ipcRenderer;
  } catch (error) {
    throw new Error("Electron IPC bridge is unavailable.");
  }
}

function invoke(channel, ...args) {
  return getIpcRenderer().invoke(channel, ...args);
}

function send(channel, ...args) {
  return getIpcRenderer().send(channel, ...args);
}

function exposeApi(api) {
  try {
    const { contextBridge } = require("electron");
    if (contextBridge && process.contextIsolated) {
      contextBridge.exposeInMainWorld("headlessApi", api);
      return;
    }
  } catch (error) {
    console.error(error);
  }
  window.headlessApi = api;
}

module.exports = {
  invoke,
  send,
  exposeApi
};
