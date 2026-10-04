import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
app.setName("Squeek Layout Preview");
app.setPath("userData", join(app.getPath("temp"), "squeek-layout-preview"));

app.whenReady().then(async () => {
  const preview = new BrowserWindow({
    width: 360,
    height: 760,
    frame: false,
    backgroundColor: "#f7f4ec",
    title: "Squeek — sample layout",
    webPreferences: {
      preload: join(root, "preview-layout-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  ipcMain.on("squeek-preview:close", (event) => {
    if (event.sender === preview.webContents) preview.close();
  });
  preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  preview.webContents.on("will-navigate", (event) => event.preventDefault());
  await preview.loadFile(join(root, "../dist/desktop/index.html"));
  await preview.webContents.executeJavaScript(`
    const note = document.createElement("p");
    note.className = "small secondary";
    note.textContent = "Layout preview · Sample data";
    document.querySelector(".panel-content").prepend(note);
    document.getElementById("latest-check").click();
  `);
  preview.show();
  preview.focus();
});
app.on("window-all-closed", () => app.quit());
