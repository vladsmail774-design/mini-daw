import { spawn } from "node:child_process";
import { mkdir, readFile, copyFile, rename, writeFile } from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const output = resolve("release", version);
// A fresh staging directory avoids stale Windows handles locking win-unpacked
// during a repeat build. Existing portable profiles and EXEs are never removed.
const staging = join(output, `build-${Date.now()}`);
await mkdir(staging, { recursive: true });
// Electron resolves (and, if needed, installs) the version in package-lock.json.
// Reuse its runtime instead of racing Windows file scanning during re-extraction.
const electronDirectory = dirname(createRequire(import.meta.url)("electron"));
const child = spawn(process.execPath, [resolve("node_modules/electron-builder/out/cli/cli.js"), "--win", "portable", `--config.directories.output=${staging}`, `--config.electronDist=${electronDirectory}`], { stdio: "inherit", windowsHide: true });
const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
if (code !== 0) throw new Error(`Portable packaging failed (${code}); previous artifact preserved`);
const name = `Mini-DAW-${version}-portable.exe`, source = join(staging, name), target = join(output, name), temporary = `${target}.tmp`;
await copyFile(source, temporary);
await rename(temporary, target);
const sha256 = createHash("sha256").update(await readFile(target)).digest("hex");
await writeFile(join(output, "packaging.json"), JSON.stringify({ builtAt: new Date().toISOString(), version, artifact: name, sha256, staging: relative(output, staging), asar: relative(output, join(staging, "win-unpacked/resources/app.asar")) }, null, 2));
console.log(`Portable ready: ${target}`);
