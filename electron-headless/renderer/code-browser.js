function formatInlineComment(comment) {
  if (!comment || !comment.text) {
    return "";
  }
  const kind = comment.kind || "COMMENT";
  if (comment.sourceAddress) {
    return `${kind}[${comment.sourceAddress}]: ${comment.text}`;
  }
  return `${kind}: ${comment.text}`;
}

function formatLine(line) {
  const address = line && line.address ? String(line.address) : "";
  const bytes = line && line.bytes ? String(line.bytes) : "";
  const instruction = line && line.instruction ? String(line.instruction) : "";
  const left = `${address.padEnd(18)} ${bytes.padEnd(24)} ${instruction}`;
  const comments = Array.isArray(line?.inlineComments)
    ? line.inlineComments.map(formatInlineComment).filter(Boolean)
    : [];
  if (!comments.length) {
    return left;
  }
  return `${left} ; ${comments.join(" | ")}`;
}

function renderStructuredDisassembly(data) {
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  if (!lines.length) {
    return "";
  }
  return lines.map(formatLine).join("\n");
}

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
    const data = payload?.data || {};
    const structured = renderStructuredDisassembly(data);
    const text =
      structured ||
      (data.disassembly != null ? String(data.disassembly) : "");
    outEl.textContent = text || "(empty)";
  } catch (e) {
    outEl.textContent = e.message || String(e);
    outEl.classList.add("error");
  }
}

document.addEventListener("DOMContentLoaded", main);
