// Dump a GLB's JSON chunk: animations, nodes, meshes, materials, skins.
const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
if (buf.toString('utf8', 0, 4) !== 'glTF') { console.error('not a GLB'); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

console.log('=== ' + file.split(/[\\/]/).pop() + ' ===');
console.log('animations:', (json.animations || []).map(a => a.name).join(', ') || '(none)');
console.log('skins:', (json.skins || []).length, ' images:', (json.images || []).length,
            ' meshes:', (json.meshes || []).length, ' materials:', (json.materials || []).length);
console.log('material names:', (json.materials || []).map(m => m.name).join(', '));
const names = (json.nodes || []).map(n => n.name || '?');
console.log('nodes (' + names.length + '):', names.join(', '));
