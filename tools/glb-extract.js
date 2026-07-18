// Extract embedded images from a GLB to files. Usage: node tools/glb-extract.js file.glb outPrefix
const fs = require('fs');
const [,, file, out] = process.argv;
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
j.images.forEach((img, i) => {
  const bv = j.bufferViews[img.bufferView];
  const data = buf.slice(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
  const ext = img.mimeType.includes('png') ? 'png' : 'jpg';
  fs.writeFileSync(`${out}${i}.${ext}`, data);
  console.log(`image ${i}: ${(bv.byteLength / 1e6).toFixed(2)} MB -> ${out}${i}.${ext}`);
});
