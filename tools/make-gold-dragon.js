// Create assets/dragon_gold.glb from dragon_red.glb: hue-shift the diffuse
// texture red -> gold (Syrax, the Golden Queen). Geometry/normals shared.
// Requires deps (not committed): npm i @gltf-transform/core @gltf-transform/extensions sharp
// Usage: node tools/make-gold-dragon.js
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const sharp = require('sharp');

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read('assets/dragon_red.glb');
  for (const mat of doc.getRoot().listMaterials()) {
    const sg = mat.getExtension('KHR_materials_pbrSpecularGlossiness');
    const tex = (sg && sg.getDiffuseTexture()) || mat.getBaseColorTexture();
    if (!tex) continue;
    const out = await sharp(Buffer.from(tex.getImage()))
      .modulate({ hue: 40, brightness: 1.7, saturation: 1.25 })
      .jpeg({ quality: 82 })
      .toBuffer();
    tex.setImage(out).setMimeType('image/jpeg');
    console.log('hue-shifted', tex.getName() || 'baseColor', tex.getImage().byteLength / 1024 | 0, 'KB');
  }
  await io.write('assets/dragon_gold.glb', doc);
  const fs = require('fs');
  console.log('dragon_gold.glb:', (fs.statSync('assets/dragon_gold.glb').size / 1e6).toFixed(2), 'MB');
})().catch(e => { console.error(e); process.exit(1); });
