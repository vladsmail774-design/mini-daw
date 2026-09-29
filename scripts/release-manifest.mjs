import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { extractFile } from "@electron/asar";
async function hash(file) { const digest = createHash("sha256"); for await (const block of createReadStream(file)) digest.update(block); return digest.digest("hex"); }
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const folder = resolve(`release/${pkg.version}`);
const name = `Mini-DAW-${pkg.version}-portable.exe`, exe = join(folder, name);
const bundles = [];
const packaging = JSON.parse(await readFile(join(folder, "packaging.json"), "utf8"));
if (packaging.sha256 !== await hash(exe)) throw new Error("Portable differs from packaging record");
const asar = join(folder, packaging.asar);
for (const item of await readdir("dist/assets")) if (/\.(js|css)$/.test(item)) {
  const path = `dist/assets/${item}`, sha256 = await hash(path);
  const packagedHash = createHash("sha256").update(extractFile(asar, join("dist", "assets", item))).digest("hex");
  if (packagedHash !== sha256) throw new Error(`Packaged bundle differs from current build: ${path}`);
  bundles.push({ path, sha256 });
}
const metadataEnv = { ...process.env, MINI_DAW_ARTIFACT: exe };
// Windows PowerShell must load its own modules, not inherited PowerShell 7 binaries.
for (const key of Object.keys(metadataEnv)) if (key.toLowerCase() === "psmodulepath") delete metadataEnv[key];
const windowsMetadata = process.platform === "win32" ? JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", "$artifact = Get-Item -LiteralPath $env:MINI_DAW_ARTIFACT; @{signatureStatus=(Get-AuthenticodeSignature -LiteralPath $artifact.FullName).Status.ToString(); fileVersion=$artifact.VersionInfo.FileVersion; productVersion=$artifact.VersionInfo.ProductVersion; productName=$artifact.VersionInfo.ProductName} | ConvertTo-Json -Compress"], { encoding: "utf8", env: metadataEnv })) : null;
const manifest = { appVersion: pkg.version, builtAt: packaging.builtAt, generatedAt: new Date().toISOString(), artifact: name, bytes: (await stat(exe)).size, sha256: await hash(exe), platform: process.platform, architecture: process.arch, node: process.version, electron: JSON.parse(await readFile("node_modules/electron/package.json", "utf8")).version, signed: windowsMetadata ? windowsMetadata.signatureStatus === "Valid" : null, windowsMetadata, bundles };
await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(join(folder, "SHA256SUMS.txt"), `${manifest.sha256}  ${name}\n`);
console.log(JSON.stringify(manifest, null, 2));
