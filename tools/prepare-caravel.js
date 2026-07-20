// Optimize the caravel for embedding: strip glow/AO/MR maps, JPEG-compress
// textures, quantize geometry. 25.7 MB -> ~6.5 MB.
// Requires deps (not committed): npm i @gltf-transform/core @gltf-transform/functions sharp
// Usage: node tools/prepare-caravel.js
const { NodeIO } = require('@gltf-transform/core');
const { prune, dedup, quantize, textureCompress } = require('@gltf-transform/functions');
const sharp = require('sharp');

(async () => {
  const io = new NodeIO();
  const doc = await io.read('assets/caravel_ship.glb');
  const root = doc.getRoot();

  for (const mat of root.listMaterials()) {
    const t = [mat.getEmissiveTexture(), mat.getOcclusionTexture(), mat.getMetallicRoughnessTexture()];
    for (const tex of t) if (tex) tex.dispose();
    mat.setEmissiveFactor([0, 0, 0]);
    mat.setMetallicFactor(0);          // wood/sails: scalar MR (map renders black in r128)
    mat.setRoughnessFactor(0.8);
    mat.setAlphaMode('OPAQUE');        // no cutout alpha in any baseColor (min alpha 179/255)
  }
  for (const a of root.listAnimations()) a.dispose();   // turntable "Sail" clip

  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 80, slots: /^baseColorTexture$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 85, slots: /^normalTexture$/, resize: [512, 512] }),
    quantize(),
    prune(),
  );
  await io.write('assets/caravel.glb', doc);
  const fs = require('fs');
  console.log('caravel.glb:', (fs.statSync('assets/caravel.glb').size / 1e6).toFixed(2), 'MB');
})().catch(e => { console.error(e); process.exit(1); });
