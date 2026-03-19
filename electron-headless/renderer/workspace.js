// Track the selected binary for the Code Browser button
let selectedBinary = null;

function openCodeBrowser(binary) {
  if (typeof headlessApi !== "undefined" && headlessApi.openCodeBrowser) {
    headlessApi.openCodeBrowser(binary);
  }
}

// Mock data for the tree view
const mockProjectData = {
  name: "test",
  children: [
    {
      name: "test",
      type: "folder",
      children: [
        { name: "setup.exe", type: "file" }
      ]
    }
  ]
};

document.addEventListener("DOMContentLoaded", () => {
  const treeRoot = document.getElementById("project-tree");
  
  function renderTreeItem(item, depth = 0) {
    const li = document.createElement("li");
    
    // Create the item row
    const row = document.createElement("div");
    row.className = "tree-item";
    if (item.type === "folder") {
      row.classList.add("expanded");
    }
    
    // Indentation
    for (let i = 0; i < depth; i++) {
      const indent = document.createElement("span");
      indent.className = "tree-indent";
      row.appendChild(indent);
    }
    
    // Chevron (only for folders)
    const chevron = document.createElement("span");
    chevron.className = "tree-chevron";
    if (item.type === "folder") {
      chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    }
    row.appendChild(chevron);
    
    // Icon
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    if (item.type === "folder") {
      icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #dcb67a;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    } else {
      icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #cccccc;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    }
    row.appendChild(icon);
    
    // Label
    const label = document.createElement("span");
    label.textContent = item.name;
    row.appendChild(label);
    
    li.appendChild(row);
    
    // Interaction
    row.addEventListener("click", () => {
      // Handle selection
      document.querySelectorAll(".tree-item").forEach(el => el.classList.remove("selected"));
      row.classList.add("selected");
      
      if (item.type === "file") {
        selectedBinary = { name: item.name };
      } else {
        selectedBinary = null;
      }
      
      // Handle expand/collapse for folders
      if (item.type === "folder") {
        row.classList.toggle("expanded");
      }
    });
    
    row.addEventListener("dblclick", () => {
      if (item.type === "file") {
        openCodeBrowser({ name: item.name });
      }
    });
    
    // Render children if it's a folder
    if (item.type === "folder" && item.children) {
      const childrenContainer = document.createElement("ul");
      childrenContainer.className = "tree-children";
      item.children.forEach(child => {
        childrenContainer.appendChild(renderTreeItem(child, depth + 1));
      });
      li.appendChild(childrenContainer);
    }
    
    return li;
  }

  // Render the initial mock data
  mockProjectData.children.forEach(child => {
    treeRoot.appendChild(renderTreeItem(child, 0));
  });

  // Tab switching logic
  const tabTree = document.getElementById("tab-tree");
  const tabTable = document.getElementById("tab-table");
  
  tabTree.addEventListener("click", () => {
    tabTree.classList.add("active");
    tabTable.classList.remove("active");
  });
  
  tabTable.addEventListener("click", () => {
    tabTable.classList.add("active");
    tabTree.classList.remove("active");
  });

  // Code Browser tool button - opens code browser for selected binary (or empty)
  document.getElementById("tool-codebrowser").addEventListener("click", () => {
    openCodeBrowser(selectedBinary);
  });
});