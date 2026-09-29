export function safeExportName(name: string) {
  const printable = Array.from(name.normalize("NFC"), character => character.charCodeAt(0) < 32 ? "_" : character).join("");
  const clean = printable.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
  return !clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean) ? `audio_${clean}` : clean;
}
