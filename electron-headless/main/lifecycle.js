const { createMainWindow } = require("./windows/main-window");
const { removeIpcHandlers } = require("./ipc");

function wireAppLifecycle(app, BrowserWindow, ipcMain) {
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(BrowserWindow);
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("will-quit", () => {
    removeIpcHandlers(ipcMain);
  });
}

module.exports = {
  wireAppLifecycle
};
