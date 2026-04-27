async function main() {
  const params = new URLSearchParams(window.location.search);
  const binaryName = params.get("binaryName") || "";
  const titleEl = document.getElementById("title");
  const outEl = document.getElementById("output");

  titleEl.textContent = binaryName ? `Disassembly — ${binaryName}` : "Disassembly";

  if (!binaryName) {
    outEl.textContent = "No binary selected.";
    return;
  }

  if (!window.headlessApi || !window.headlessApi.getActiveDisassembly) {
    outEl.textContent = "Backend API is not available.";
    outEl.classList.add("error");
    return;
  }

  try {
    const payload = await window.headlessApi.getActiveDisassembly(binaryName);
    const text =
      payload.data && payload.data.disassembly != null ? String(payload.data.disassembly) : "";
    outEl.textContent = text || "(empty)";
  } catch (e) {
    outEl.textContent = e.message || String(e);
    outEl.classList.add("error");
  }
}

document.addEventListener("DOMContentLoaded", main);
