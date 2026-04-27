const path = require("node:path");

function createWorkspaceWindow(BrowserWindow) {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "main-window.js"),
      contextIsolation: false,
      sandbox: false
    }
  });

  window.loadFile(path.join(__dirname, "..", "..", "renderer", "workspace.html"));
  return window;
}

module.exports = {
  createWorkspaceWindow
};
