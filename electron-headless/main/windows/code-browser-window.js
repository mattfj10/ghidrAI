const path = require("node:path");

function createCodeBrowserWindow(BrowserWindow, binary) {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "main-window.js"),
      contextIsolation: false,
      sandbox: false
    }
  });

  const pagePath = path.join(__dirname, "..", "..", "renderer", "code-browser.html");
  const binaryName = binary && typeof binary.name === "string" ? binary.name : "";
  window.loadFile(pagePath, { query: { binaryName } });
  return window;
}

module.exports = {
  createCodeBrowserWindow
};
