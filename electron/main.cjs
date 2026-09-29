const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { atomicWrite } = require("./project-files.cjs");
const DEV_SERVER = "http://127.0.0.1:5173";
const useDevServer = process.env.ELECTRON_DEV === "1" && !app.isPackaged;
const indexHtml = path.join(__dirname, "..", "dist", "index.html");
const appUrl = useDevServer ? DEV_SERVER : pathToFileURL(indexHtml).href;
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) app.setPath("userData", path.join(portableDir, "Mini DAW Data"));
// QA may isolate a development profile without touching the user's portable profile.
if (!app.isPackaged && process.env.MINI_DAW_TEST_PROFILE) app.setPath("userData", process.env.MINI_DAW_TEST_PROFILE);
const projectPaths = new Map();
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const filters = [{ name: "Mini DAW project (audio included)", extensions: ["mdaw"] }];

function trusted(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || !(useDevServer ? new URL(frame.url).origin === DEV_SERVER : frame.url === appUrl)) throw new Error("Untrusted project request");
  return BrowserWindow.fromWebContents(event.sender);
}
ipcMain.handle("project:open", async (event) => {
  const win = trusted(event);
  const choice = await dialog.showOpenDialog(win, { filters, properties: ["openFile"] });
  if (choice.canceled || !choice.filePaths[0]) return null;
  const file = choice.filePaths[0];
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Project exceeds the 1 GiB file limit");
  const bytes = await fs.readFile(file);
  projectPaths.set(event.sender.id, file);
  return { name: path.basename(file), bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
});
ipcMain.handle("project:save", async (event, bytes, suggestedName, saveAs) => {
  const win = trusted(event);
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12 || bytes.byteLength > MAX_FILE_BYTES || typeof suggestedName !== "string" || typeof saveAs !== "boolean") throw new Error("Invalid project save request");
  if (Buffer.from(bytes, 0, 8).toString() !== "MDAWPK02") throw new Error("Invalid project file");
  let file = projectPaths.get(event.sender.id);
  if (!file || saveAs) {
    const safeName = suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120) || "Project";
    const choice = await dialog.showSaveDialog(win, { filters, defaultPath: `${safeName}.mdaw` });
    if (choice.canceled || !choice.filePath) return null;
    file = choice.filePath;
  }
  await atomicWrite(file, Buffer.from(bytes));
  projectPaths.set(event.sender.id, file);
  return { name: path.basename(file) };
});
ipcMain.handle("project:reset-path", (event) => { trusted(event); projectPaths.delete(event.sender.id); });

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 560,
    title: `Mini DAW ${app.getVersion()}`, backgroundColor: "#0b0d10", icon: path.join(__dirname, "..", "build", "icon.ico"), show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => { if (url !== appUrl && url !== `${appUrl}/`) event.preventDefault(); });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  const contentsId = win.webContents.id;
  win.on("closed", () => projectPaths.delete(contentsId));
  win.once("ready-to-show", () => win.show());
  if (useDevServer) void win.loadURL(DEV_SERVER); else void win.loadFile(indexHtml);
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
