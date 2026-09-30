// The test track the robot walks: sky, dusty rocky ground, an asphalt road with
// physical curbs and light strips, painted lines and distance numerals. Rocks are
// scenery only: the compound eye (eye.js) does not see them. The floor shader also draws smell fields, the rewarded center
// line and pain ripples.
import * as THREE from 'three';

export const HORIZON = new THREE.Color('#f2f0eb');
const SKY_TOP = new THREE.Color('#e1e4e7');
const GROUND = new THREE.Color('#d8ccb6');
const RUNWAY = new THREE.Color('#6e6f71');
const PAINT = new THREE.Color('#f4f1e8');
const ROCK_COLS = ['#a39b8f', '#8d867c', '#b8afa2', '#7a746c', '#c2b8a8'].map((c) => new THREE.Color(c));
const ROCK_SEG = 2, ROCKS_PER_SEG = 30, ROCK_SEGS = 13;
const INK = new THREE.Color('#1c1c1c');
const ACCENT = new THREE.Color('#E55B2B');
const HONEY = new THREE.Color('#c98a1c');
export const FOG_NEAR = 4, FOG_FAR = 13;

const NUM_EVERY = 2, NUM_N = 9;
const CURB_W = 0.05, CURB_H = 0.035;

export class Track {
  constructor(scene, { road, maxObj, sigma }) {
    Object.assign(this, { scene, road, maxObj, sigma });
    this.buildSky();
    this.buildFloor();
    this.buildCurbs();
    this.buildNumerals();
    this.buildRocks();
  }

  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: SKY_TOP.clone() }, uHorizon: { value: HORIZON.clone() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 uTop, uHorizon; varying vec3 vD;
        void main(){ float h = clamp(vD.y, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.55)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    }));
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);
  }

  buildFloor() {
    const R = this.road.toFixed(3), N = this.maxObj;
    this.floorU = {
      uTime: { value: 0 }, uFly: { value: new THREE.Vector2() },
      uObj: { value: Array.from({ length: N }, () => new THREE.Vector4()) }, uN: { value: 0 },
      uPain: { value: 0 }, uPainAt: { value: new THREE.Vector2() }, uReward: { value: 0 },
      uInk: { value: INK.clone() }, uAccent: { value: ACCENT.clone() }, uHoney: { value: HONEY.clone() },
      uGround: { value: GROUND.clone() }, uRunway: { value: RUNWAY.clone() }, uHorizon: { value: HORIZON.clone() }, uPaint: { value: PAINT.clone() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.floorU,
      vertexShader: /* glsl */`
        varying vec2 vW; varying float vDepth;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uN, uPain, uReward; uniform vec2 uFly, uPainAt;
        uniform vec4 uObj[${N}];
        uniform vec3 uInk, uAccent, uHoney, uGround, uRunway, uHorizon, uPaint;
        varying vec2 vW; varying float vDepth;
        float aa(float d, float w){ return 1.0 - smoothstep(-w, w, d); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
        void main(){
          vec2 p = vW;
          vec2 fw = fwidth(p);
          float ax = abs(p.x);
          bool runway = ax < ${R};
          // ---- base surfaces
          vec3 col;
          if (runway) {
            // asphalt: fine aggregate grain and a few darker patches
            float grain = (hash(floor(p * 260.0)) - 0.5) * 0.07 + (noise(p * 40.0) - 0.5) * 0.05;
            float blot = smoothstep(0.55, 0.8, noise(p * 0.9 + 7.0)) * 0.08;
            col = uRunway * (1.0 + grain - blot);
            float seam = aa(abs(fract(p.y / 1.0 + 0.5) - 0.5) - 0.0015, fw.y);   // expansion joints across the road
            col = mix(col, uInk, seam * 0.12);
            float off = clamp(ax / ${R}, 0.0, 1.0);                               // off-center pain, made visible
            col = mix(col, uInk, off * off * 0.08);
            float edge = aa(abs(ax - (${R} - 0.03)) - 0.0035, fw.x);              // solid white edge lines
            col = mix(col, uPaint, edge * 0.85);
          } else {
            // dusty ground: large soft mottling, gravel speckle, darker damp patches
            float mottle = (noise(p * 0.8) - 0.5) * 0.08 + (noise(p * 3.5) - 0.5) * 0.05;
            float speck = step(0.93, hash(floor(p * 90.0))) * (hash(floor(p * 90.0) + 3.1) - 0.3) * 0.22;
            float damp = smoothstep(0.6, 0.85, noise(p * 0.35 + 3.0)) * 0.06;
            col = uGround * (1.0 + mottle - speck - damp);
            col = mix(col, uInk, 0.1 * (1.0 - smoothstep(0.0, 0.14, ax - ${R})));   // soft shadow line at the curb foot
          }
          // ---- smell fields
          float cA = 0.0, cB = 0.0;
          for (int i = 0; i < ${N}; i++) {
            if (float(i) >= uN) break;
            vec4 o = uObj[i];
            vec2 d = p - o.xy;
            float c = o.w * exp(-dot(d, d) / (2.0 * ${(this.sigma * this.sigma).toFixed(4)}));
            if (o.z < 1.5) cA += c; else cB += c;
          }
          cA = min(cA, 1.0); cB = min(cB, 1.0);
          vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p / 0.034;
          float dl = length(fract(q) - 0.5);
          float dots = aa(dl - 0.44 * sqrt(cA), fwidth(dl)) * step(0.03, cA);
          col = mix(col, uInk, dots * (runway ? 0.6 : 0.34));
          float h = dot(p, vec2(0.5, 0.866)) / 0.026;
          float hatch = aa(abs(fract(h) - 0.5) - 0.2 * cB, fwidth(h)) * step(0.03, cB);
          col = mix(col, mix(uInk, uHoney, 0.7), hatch * 0.3);
          // ---- rewarded center line: dashes glow ahead of the robot while it earns reward
          if (runway) {
            float dash = step(0.42, fract(p.y / 0.16));
            float line = aa(ax - 0.0022, fw.x) * dash;
            float ahead = p.y - uFly.y;
            float glow = uReward * smoothstep(-0.3, 0.1, ahead) * (1.0 - smoothstep(0.4, 2.2, ahead));
            col = mix(col, mix(uPaint, uAccent, glow), line * mix(0.8, 0.95, glow));
          }
          // ---- pain ripple
          float pr = length(p - uPainAt);
          float ring = uPain * aa(abs(pr - (1.0 - uPain) * 0.5 - 0.12) - 0.004, fwidth(pr));
          col = mix(col, uAccent, ring * 0.9);
          // ---- haze into the horizon
          col = mix(col, uHorizon, smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, vDepth));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat);
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor);

    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);
  }

  buildCurbs() {
    const len = 44;
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.55 });
    this.curbs = [];
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      const curb = new THREE.Mesh(new THREE.BoxGeometry(CURB_W, CURB_H, len), curbMat);
      curb.position.set(s * (this.road + CURB_W / 2), CURB_H / 2, 0);
      curb.castShadow = true; curb.receiveShadow = true;
      g.add(curb);
      // light strip on the inner face: flashes where the robot hits it
      const u = { uHitZ: { value: -999 }, uFlash: { value: 0 }, uBase: { value: new THREE.Color('#d6d3cb') }, uAccent: { value: ACCENT.clone() } };
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.007, len), new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: 'varying float vZ; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vZ = w.z; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform float uHitZ, uFlash; uniform vec3 uBase, uAccent; varying float vZ;
          void main(){ float d = vZ - uHitZ; float g = uFlash * exp(-d * d / 0.35);
            gl_FragColor = vec4(mix(uBase, uAccent, clamp(g, 0.0, 1.0)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }));
      strip.position.set(s * (this.road - 0.001), CURB_H * 0.72, 0);
      g.add(strip);
      this.scene.add(g);
      this.curbs.push({ side: s, g, u });
    }
  }

  buildNumerals() {
    this.numCache = new Map();
    this.fontReady = false;
    document.fonts?.load('600 180px "Inter"').then(() => { this.fontReady = true; this.numCache.clear(); }).catch(() => { this.fontReady = true; });
    const geo = new THREE.PlaneGeometry(0.62, 0.31);
    this.numerals = [];
    for (let i = 0; i < NUM_N; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.4, color: PAINT, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.rotation.set(-Math.PI / 2, 0, Math.PI);          // lies flat, reads from behind the robot
      m.visible = false;
      this.scene.add(m);
      this.numerals.push({ m, n: null });
    }
  }

  // Scattered rocks beside the road, regenerated per 2-unit segment from a seeded hash so they stay put.
  buildRocks() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
    const max = ROCKS_PER_SEG * ROCK_SEGS;
    this.rocks = [new THREE.IcosahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0)].map((g) => {
      const m = new THREE.InstancedMesh(g, mat, max);
      m.castShadow = true; m.receiveShadow = true; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      return m;
    });
    this.rockSeg = null;
  }

  updateRocks(z) {
    const seg0 = Math.floor(z / ROCK_SEG) - 3;
    if (seg0 === this.rockSeg) return;
    this.rockSeg = seg0;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
    const n = [0, 0];
    for (let s = seg0; s < seg0 + ROCK_SEGS; s++) {
      let a = (s * 2654435761) ^ 0x9e3779b9;
      const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (let k = 0; k < ROCKS_PER_SEG; k++) {
        const side = rnd() < 0.5 ? -1 : 1, far = rnd() ** 1.6;
        const x = side * (this.road + CURB_W + 0.06 + far * 4.2);
        const big = rnd() < 0.08 + far * 0.25;
        const size = big ? 0.1 + rnd() * 0.22 : 0.015 + rnd() * 0.05;
        P.set(x, size * 0.28, s * ROCK_SEG + rnd() * ROCK_SEG);
        Q.setFromEuler(E.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
        S.set(size * (0.8 + rnd() * 0.5), size * (0.5 + rnd() * 0.35), size * (0.8 + rnd() * 0.5));
        const mi = rnd() < 0.5 ? 0 : 1, m = this.rocks[mi];
        m.setMatrixAt(n[mi], M.compose(P, Q, S));
        m.setColorAt(n[mi], C.copy(ROCK_COLS[(rnd() * ROCK_COLS.length) | 0]).multiplyScalar(0.9 + rnd() * 0.2));
        n[mi]++;
      }
    }
    this.rocks.forEach((m, i) => {
      m.count = n[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  numeralTexture(n) {
    const key = `${n}:${this.fontReady}`;
    if (this.numCache.has(key)) return this.numCache.get(key);
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 180px Inter, ui-sans-serif, system-ui, sans-serif';
    g.fillText(String(n).padStart(2, '0'), 256, 140);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    if (this.numCache.size > 60) this.numCache.clear();
    this.numCache.set(key, t);
    return t;
  }

  flashCurb(side, z) {
    const c = this.curbs.find((k) => k.side === side);
    if (c) { c.u.uHitZ.value = z; c.u.uFlash.value = 1; }
  }

  // fly: { x, z }, reward 0..1
  update(dt, fly, reward, camera) {
    const snap = (v, s) => Math.round(v / s) * s;
    this.floor.position.set(snap(fly.x, 5), 0, snap(fly.z, 5));
    this.shadowFloor.position.set(snap(fly.x, 5), 0.0005, snap(fly.z, 5));
    this.sky.position.copy(camera.position);
    this.floorU.uFly.value.set(fly.x, fly.z);
    this.floorU.uReward.value += (reward - this.floorU.uReward.value) * (1 - Math.exp(-dt * 4));
    for (const c of this.curbs) {
      c.g.position.z = snap(fly.z, 5) + 12;
      c.u.uFlash.value = Math.max(0, c.u.uFlash.value - dt * 1.4);
    }
    this.updateRocks(fly.z);
    // painted distance numerals on the right half of the runway
    const n0 = Math.floor((fly.z - 2) / NUM_EVERY);
    this.numerals.forEach((N, i) => {
      const k = n0 + i, z = k * NUM_EVERY;
      if (k < 1) { N.m.visible = false; return; }
      if (N.n !== k || N.font !== this.fontReady) {
        N.n = k; N.font = this.fontReady;
        N.m.material.alphaMap = this.numeralTexture(k * NUM_EVERY);
        N.m.material.needsUpdate = true;
      }
      N.m.visible = true;
      N.m.position.set(-(this.road - 0.34), 0.0012, z);
    });
  }
}
