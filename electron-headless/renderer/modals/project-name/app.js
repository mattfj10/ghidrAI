const api = window.headlessApi;
const inputEl = document.getElementById("name");
const okBtnEl = document.getElementById("ok");
const cancelBtnEl = document.getElementById("cancel");

function requireApi() {
  if (!api) {
    throw new Error("Electron preload bridge is unavailable. Restart the app.");
  }
  return api;
}

function submit() {
  requireApi().submitProjectName(inputEl.value);
}

okBtnEl.addEventListener("click", submit);
cancelBtnEl.addEventListener("click", () => {
  requireApi().cancelProjectName();
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submit();
  }
  if (event.key === "Escape") {
    requireApi().cancelProjectName();
  }
});
