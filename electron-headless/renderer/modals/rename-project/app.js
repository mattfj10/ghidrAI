const api = window.headlessApi;
const inputEl = document.getElementById("name");
const okBtnEl = document.getElementById("ok");
const cancelBtnEl = document.getElementById("cancel");
const searchParams = new URLSearchParams(window.location.search);

function requireApi() {
  if (!api) {
    throw new Error("Electron preload bridge is unavailable. Restart the app.");
  }
  return api;
}

function submit() {
  requireApi().submitRename(inputEl.value);
}

inputEl.value = searchParams.get("currentName") || "";
inputEl.select();

okBtnEl.addEventListener("click", submit);
cancelBtnEl.addEventListener("click", () => {
  requireApi().cancelRename();
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submit();
  }
  if (event.key === "Escape") {
    requireApi().cancelRename();
  }
});
