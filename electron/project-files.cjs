const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function atomicWrite(target, bytes) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  const backup = `${target}.bak`;
  let handle;
  try {
    handle = await fs.open(temp, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try { await fs.copyFile(target, backup); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    // Same-volume rename replaces the destination atomically. Old destination remains on failure.
    await fs.rename(temp, target);
  } finally {
    if (handle) await handle.close();
    await fs.rm(temp, { force: true });
  }
}
module.exports = { atomicWrite };
