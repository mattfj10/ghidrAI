function resolveModalParent(BrowserWindow, invokingWebContents) {
  if (invokingWebContents && !invokingWebContents.isDestroyed()) {
    return BrowserWindow.fromWebContents(invokingWebContents);
  }
  return BrowserWindow.getFocusedWindow();
}

function createModalWindow(BrowserWindow, invokingWebContents, options) {
  return new BrowserWindow({
    parent: resolveModalParent(BrowserWindow, invokingWebContents),
    modal: true,
    show: false,
    ...options
  });
}

function waitForModalResult(ipcMain, window, channel) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      ipcMain.removeListener(channel, onResult);
      window.removeListener("closed", onClosed);
    };

    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const onResult = (_event, value) => {
      if (!window.isDestroyed()) {
        window.close();
      }
      settle(value);
    };

    const onClosed = () => {
      settle(null);
    };

    ipcMain.once(channel, onResult);
    window.once("closed", onClosed);
  });
}

module.exports = {
  createModalWindow,
  waitForModalResult
};
