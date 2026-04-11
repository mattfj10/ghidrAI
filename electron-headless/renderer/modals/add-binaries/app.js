const api = window.headlessApi;
const listEl = document.getElementById("list");
const emptyMsg = document.getElementById("emptyMsg");
const addBtnEl = document.getElementById("add");
const createBtnEl = document.getElementById("create");
const cancelBtnEl = document.getElementById("cancel");

let binaries = [];

function requireApi() {
  if (!api) {
    throw new Error("Electron preload bridge is unavailable. Restart the app.");
  }
  return api;
}

function render() {
  const items = listEl.querySelectorAll(".binary-item");
  items.forEach((item) => item.remove());

  if (binaries.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }

  emptyMsg.style.display = "none";
  binaries.forEach((binary, index) => {
    const item = document.createElement("div");
    item.className = "binary-item";
    item.innerHTML = `
      <span class="binary-name" title="${(binary.path || "").replace(/"/g, "&quot;")}">
        ${binary.name || binary.path}
      </span>
      <span class="binary-path" title="${(binary.path || "").replace(/"/g, "&quot;")}">
        ${binary.path || ""}
      </span>
      <button class="binary-remove" data-index="${index}" type="button">Remove</button>
    `;
    item.querySelector(".binary-remove").addEventListener("click", () => {
      binaries.splice(index, 1);
      render();
    });
    listEl.appendChild(item);
  });
}

addBtnEl.addEventListener("click", async () => {
  const paths = await requireApi().chooseBinaryFiles();
  if (!paths || !paths.length) {
    return;
  }

  paths.forEach((selectedPath) => {
    if (binaries.some((binary) => binary.path === selectedPath)) {
      return;
    }
    const name = selectedPath.split(/[\\/]/).pop() || selectedPath;
    binaries.push({ name, path: selectedPath });
  });
  render();
});

createBtnEl.addEventListener("click", () => {
  requireApi().submitAddBinariesResult(binaries.map((binary) => binary.path));
});

cancelBtnEl.addEventListener("click", () => {
  requireApi().cancelAddBinariesResult();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    requireApi().cancelAddBinariesResult();
  }
});

render();
