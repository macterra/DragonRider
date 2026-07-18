// Fill empty accessors (no bufferView, no sparse) with zero buffers so older
// GLTFLoaders (three r128) don't choke on them. Usage: node tools/glb-fix-empty-accessors.js file.glb
const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
let bin = buf.slice(binStart);

const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
let fixed = 0;

j.accessors.forEach(acc => {
  if (acc.bufferView !== undefined || acc.sparse !== undefined) return;
  const size = (COMP[acc.componentType] || 4) * (TYPE[acc.type] || 1) * acc.count;
  const pad = (4 - (bin.length % 4)) % 4;
  if (pad) bin = Buffer.concat([bin, Buffer.alloc(pad)]);
  j.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: size });
  acc.bufferView = j.bufferViews.length - 1;
  bin = Buffer.concat([bin, Buffer.alloc(size)]);
  fixed++;
});

if (!fixed) { console.log('nothing to fix'); process.exit(0); }
j.buffers[0].byteLength = bin.length;
const bpad = (4 - (bin.length % 4)) % 4;
if (bpad) bin = Buffer.concat([bin, Buffer.alloc(bpad)]);

let jsonStr = JSON.stringify(j);
jsonStr += ' '.repeat((4 - (Buffer.byteLength(jsonStr) % 4)) % 4);
const newJson = Buffer.from(jsonStr, 'utf8');
const total = 12 + 8 + newJson.length + 8 + bin.length;
const head = Buffer.alloc(12);
head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(newJson.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(file, Buffer.concat([head, jh, newJson, bh, bin]));
console.log(`fixed ${fixed} empty accessor(s)`);
