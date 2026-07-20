const s = require('fs').readFileSync('js/vendor/three.min.js', 'utf8');
const m = s.match(/REVISION\s*=\s*"([^"]+)"/) || s.match(/revision:(\d+)/i);
console.log('three r' + (m && m[1]));
