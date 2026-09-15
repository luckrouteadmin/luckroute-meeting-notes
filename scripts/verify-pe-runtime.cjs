"use strict";
const fs = require("node:fs/promises");

function getPEImports(buffer) {
  const fail = () => { throw new Error("Invalid native PE executable"); };
  const bounds = (offset, length) => { if (!Number.isInteger(offset) || offset < 0 || offset + length > buffer.length) fail(); };
  const u16 = (offset) => { bounds(offset, 2); return buffer.readUInt16LE(offset); };
  const u32 = (offset) => { bounds(offset, 4); return buffer.readUInt32LE(offset); };
  if (u16(0) !== 0x5a4d) fail();
  const pe = u32(0x3c);
  if (u32(pe) !== 0x4550) fail();
  const optional = pe + 24;
  const optionalSize = u16(pe + 20);
  const magic = u16(optional);
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : fail());
  const sections = optional + optionalSize;
  const sectionCount = u16(pe + 6);
  const headerSize = u32(optional + 60);
  const rvaOffset = (rva) => {
    if (rva < headerSize) { bounds(rva, 1); return rva; }
    for (let i = 0; i < sectionCount; i++) {
      const section = sections + i * 40;
      const address = u32(section + 12), size = u32(section + 16);
      if (rva >= address && rva - address < size) {
        const offset = u32(section + 20) + rva - address;
        bounds(offset, 1); return offset;
      }
    }
    fail();
  };
  const readName = (rva) => {
    const offset = rvaOffset(rva);
    const end = buffer.indexOf(0, offset);
    if (end < offset || end - offset > 260) fail();
    return buffer.subarray(offset, end).toString("ascii");
  };
  const names = [];
  for (const [index, entrySize, nameOffset] of [[1, 20, 12], [13, 32, 4]]) {
    if (directories + index * 8 + 8 > optional + optionalSize) continue;
    const rva = u32(directories + index * 8), size = u32(directories + index * 8 + 4);
    if (!rva || !size) continue;
    if (size > 1024 * 1024) fail();
    for (let offset = 0; offset + entrySize <= size; offset += entrySize) {
      const entry = rvaOffset(rva + offset);
      const name = u32(entry + nameOffset);
      if (!name) break;
      // Modern native builds use RVA-based delay imports; fail closed otherwise.
      if (index === 13 && !(u32(entry) & 1)) fail();
      names.push(readName(name));
    }
  }
  return names;
}

async function assertStaticRuntime(file) {
  const imports = getPEImports(await fs.readFile(file));
  const external = imports.filter(name => /^(?:vcruntime\d.*|msvcp\d.*|msvcr\d.*|concrt\d.*|vcomp\d.*|libomp.*|libgcc.*|libstdc\+\+.*|libwinpthread.*)\.dll$/i.test(name));
  if (external.length) throw new Error(`Native engine requires an unbundled runtime: ${external.join(", ")}`);
  return imports;
}

module.exports = { getPEImports, assertStaticRuntime };
