// Repack a GLB with replaced image files. Usage: node tools/glb-repack.js in.glb out.glb img0.jpg img1.jpg ...
const fs = require('fs');
const [,, inFile, outFile, ...imgFiles] = process.argv;
const buf = fs.readFileSync(inFile);
const jsonLen = buf.readUInt32LE(12);
const jsonBuf = buf.slice(20, 20 + jsonLen);
const j = JSON.parse(jsonBuf.toString('utf8'));
const binStart = 20 + jsonLen + 8;
const binBuf = buf.slice(binStart);

// collect original bufferView payloads
const views = j.bufferViews.map(bv => binBuf.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));

// replace image payloads
j.images.forEach((img, i) => {
  if (!imgFiles[i]) return;
  views[img.bufferView] = fs.readFileSync(imgFiles[i]);
  img.mimeType = 'image/jpeg';
});

// rebuild BIN with 4-byte alignment, re-point bufferViews
let offset = 0;
const chunks = [];
j.bufferViews.forEach((bv, i) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  bv.byteOffset = offset;
  bv.byteLength = views[i].length;
  chunks.push(views[i]);
  offset += views[i].length;
});
const pad = (4 - (offset % 4)) % 4;
if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
const newBin = Buffer.concat(chunks);
j.buffers[0].byteLength = newBin.length;

// re-serialize JSON (4-byte aligned, space-padded)
let jsonStr = JSON.stringify(j);
const jpad = (4 - (Buffer.byteLength(jsonStr) % 4)) % 4;
jsonStr += ' '.repeat(jpad);
const newJson = Buffer.from(jsonStr, 'utf8');

const total = 12 + 8 + newJson.length + 8 + newBin.length;
const head = Buffer.alloc(12);
head.write('glTF', 0);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(newJson.length, 0);
jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(newBin.length, 0);
bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(outFile, Buffer.concat([head, jh, newJson, bh, newBin]));
console.log('repacked:', outFile, (total / 1e6).toFixed(1), 'MB');
