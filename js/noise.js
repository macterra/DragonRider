'use strict';
/* Deterministic seeded value-noise + fBm. No dependencies. */

const Noise = (() => {
  function hash2(ix, iz) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + 1013904223) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function fade(t) { return t * t * (3 - 2 * t); }

  // 2D value noise, output in [0, 1]
  function noise2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const a = hash2(ix, iz),     b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    const u = fade(fx), v = fade(fz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // fractal Brownian motion, output in [0, 1]
  function fbm2(x, z, oct = 4, lac = 2.02, gain = 0.5) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise2(x * f, z * f);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  return { noise2, fbm2 };
})();
