// Slim a GLB: keep only animations matching --keep <regex>, strip attribute --strip <name>.
// Rewrites the buffer tightly, dropping unreferenced accessors.
// Usage: node tools/glb-slim.js in.glb out.glb --keep "flying" --strip TEXCOORD_1
const fs = require('fs');
const [,, inFile, outFile, ...rest] = process.argv;
const opt = { keep: /./, strip: [] };
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] === '--keep') opt.keep = new RegExp(rest[i + 1], 'i');
  if (rest[i] === '--strip') opt.strip.push(rest[i + 1]);
}

const buf = fs.readFileSync(inFile);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
const binBuf = buf.slice(binStart);

const CS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const CB = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const elemSize = a => (CS[a.type] || 1) * (CB[a.componentType] || 1);

// extract one accessor's logical payload (deinterleaves if strided)
function accessorBytes(ai) {
  const a = j.accessors[ai];
  if (a.bufferView === undefined) return null;   // sparse-only accessor: keep as-is (unsupported)
  const bv = j.bufferViews[a.bufferView];
  const es = elemSize(a);
  const stride = bv.byteStride || es;
  if (stride === es) {
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    return binBuf.slice(off, off + es * a.count);
  }
  const out = Buffer.alloc(es * a.count);
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  for (let i = 0; i < a.count; i++) {
    binBuf.copy(out, i * es, base + i * stride, base + i * stride + es);
  }
  return out;
}

// filter animations + strip attributes
const keptAnims = (j.animations || []).filter(a => opt.keep.test(a.name));
const dropped = (j.animations || []).length - keptAnims.length;
j.animations = keptAnims;
for (const m of j.meshes || []) {
  for (const p of m.primitives) for (const s of opt.strip) delete p.attributes[s];
}

// collect referenced accessors in first-use order
const refAcc = [];
const mark = ai => { if (ai !== undefined && !refAcc.includes(ai)) refAcc.push(ai); };
for (const m of j.meshes || []) for (const p of m.primitives) {
  Object.values(p.attributes).forEach(mark);
  mark(p.indices);
  if (p.targets) p.targets.forEach(t => Object.values(t).forEach(mark));
}
for (const s of j.skins || []) mark(s.inverseBindMatrices);
for (const a of j.animations) for (const s of a.samplers) { mark(s.input); mark(s.output); }

// rebuild buffer: referenced accessors (as their own bufferViews) + image payloads
const newViews = [], newAccs = [], chunks = [];
let offset = 0;
const accMap = {};
function push(data, target) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  newViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target });
  chunks.push(data);
  offset += data.length;
  return newViews.length - 1;
}
for (const ai of refAcc) {
  const a = j.accessors[ai];
  const data = accessorBytes(ai);
  if (!data) { console.error('sparse accessor unsupported:', ai); process.exit(1); }
  const na = { ...a, byteOffset: 0 };
  delete na.byteStride;
  na.bufferView = push(data, a.bufferView !== undefined ? j.bufferViews[a.bufferView].target : undefined);
  accMap[ai] = newAccs.length;
  newAccs.push(na);
}
const imgViewMap = {};
for (const img of j.images || []) {
  if (img.bufferView === undefined) continue;
  if (imgViewMap[img.bufferView] !== undefined) { img.bufferView = imgViewMap[img.bufferView]; continue; }
  const bv = j.bufferViews[img.bufferView];
  const data = binBuf.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  img.bufferView = imgViewMap[img.bufferView] = push(data);
}

// remap accessor indices
const remap = o => { if (o !== undefined) return accMap[o]; };
for (const m of j.meshes || []) for (const p of m.primitives) {
  for (const k of Object.keys(p.attributes)) p.attributes[k] = remap(p.attributes[k]);
  p.indices = remap(p.indices);
  if (p.targets) p.targets.forEach(t => { for (const k of Object.keys(t)) t[k] = remap(t[k]); });
}
for (const s of j.skins || []) s.inverseBindMatrices = remap(s.inverseBindMatrices);
for (const a of j.animations) for (const s of a.samplers) { s.input = remap(s.input); s.output = remap(s.output); }

j.accessors = newAccs;
j.bufferViews = newViews;
const pad = (4 - (offset % 4)) % 4;
if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
const newBin = Buffer.concat(chunks);
j.buffers[0].byteLength = newBin.length;

let jsonStr = JSON.stringify(j);
jsonStr += ' '.repeat((4 - (Buffer.byteLength(jsonStr) % 4)) % 4);
const newJson = Buffer.from(jsonStr, 'utf8');
const total = 12 + 8 + newJson.length + 8 + newBin.length;
const head = Buffer.alloc(12);
head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(newJson.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(newBin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(outFile, Buffer.concat([head, jh, newJson, bh, newBin]));
console.log(`slim: ${(buf.length / 1e6).toFixed(1)} MB -> ${(total / 1e6).toFixed(1)} MB` +
  ` (dropped ${dropped} anims, stripped [${opt.strip}])`);
