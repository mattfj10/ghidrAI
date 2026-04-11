const path = require("node:path");

function createMainWindow(BrowserWindow) {
  const window = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "main-window.js"),
      contextIsolation: false,
      sandbox: false
    }
  });

  window.loadFile(path.join(__dirname, "..", "..", "renderer", "home", "index.html"));
  return window;
}

module.exports = {
  createMainWindow
};
