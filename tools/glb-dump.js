// Deep-dump a GLB: materials, mesh nodes, skins, animation targets.
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));

console.log('--- materials ---');
for (const m of json.materials || []) console.log(JSON.stringify(m));
console.log('--- mesh/skin nodes ---');
for (const n of json.nodes || []) {
  if (n.mesh !== undefined || n.skin !== undefined) {
    console.log(JSON.stringify({ name: n.name, mesh: n.mesh, skin: n.skin,
      t: n.translation, r: n.rotation, s: n.scale }));
  }
}
console.log('--- scene roots ---');
for (const i of json.scenes[0].nodes || []) {
  const n = json.nodes[i];
  console.log(JSON.stringify({ i, name: n.name, t: n.translation, r: n.rotation, s: n.scale,
    children: (n.children || []).length }));
}
console.log('--- skeleton root chain (first 3 joints of skin 0) ---');
for (const i of (json.skins && json.skins[0] ? json.skins[0].joints.slice(0, 3) : [])) {
  const n = json.nodes[i];
  console.log(JSON.stringify({ i, name: n.name, t: n.translation, r: n.rotation, s: n.scale }));
}
console.log('--- animations ---');
for (const a of json.animations || []) {
  const targets = [...new Set(a.channels.map(c => json.nodes[c.target.node].name + ':' + c.target.path))];
  console.log(a.name, '| channels:', a.channels.length, '|', targets.slice(0, 6).join(', '), '…');
}
console.log('--- mesh primitives ---');
for (const m of json.meshes || []) {
  console.log(m.name, m.primitives.map(p =>
    'mat' + p.material + ' [' + Object.keys(p.attributes).join(' ') + ']').join(' '));
}
