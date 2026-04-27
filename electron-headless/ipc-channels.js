const IPC_CHANNELS = {
  chooseCreateProjectDirectory: "headless:choose-create-project-directory",
  chooseExistingProject: "headless:choose-existing-project",
  chooseBinaryFiles: "headless:choose-binary-files",
  launchDesktopProject: "headless:launch-desktop-project",
  openWorkspace: "headless:open-workspace",
  openCodeBrowser: "headless:open-code-browser",
  showAddBinariesModal: "headless:show-add-binaries-modal",
  promptForProjectName: "headless:prompt-for-project-name",
  promptForRename: "headless:prompt-for-rename",
  addBinariesResult: "add-binaries-result",
  promptResult: "prompt-result",
  promptRenameResult: "prompt-rename-result"
};

module.exports = {
  IPC_CHANNELS
};
