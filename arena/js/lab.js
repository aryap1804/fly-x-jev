// Memory Lab: classic Drosophila memory experiments run on the same mushroom-body
// model the arena uses (mb.js on real MaleCNS KC→MBON weights), no robot and no
// Jev calls. Each experiment is a timed protocol of smells, pain and sugar; the
// page shows every KC→MBON synapse, the valence Jev would read, and the brain.
// Lesions are manipulations of this model (dopamine withheld, MBON output
// excluded from the readout), the software stand-ins for genetic silencing.

import { Brain, BCOL } from './brain.js';
import { MushroomBody, valenceLabel } from './mb.js';

const $ = (s) => document.querySelector(s);
const meaning = (v) => (v <= -0.08 ? 'aversive' : v >= 0.08 ? 'attractive' : 'unknown');
const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

// ------------------------------------------------------------------ protocols
// Step: dur (sim s), speed (sim s per real s), odor {A,B}, pain/sugar [t0,t1] within
// the step, who (animal ids that get the pain/sugar; default all), silence (MBON
// types whose output is blocked for the readout), probe (snapshot name), caption.
const PAIN = [2, 3.2], SUGAR = [2, 3.5];
const rest = (dur = 2.5, o = {}) => ({ label: 'Rest', dur, hidden: true, ...o });
const toxicPain = (o = {}) => ({ label: 'Toxic smell + pain', dur: 6, odor: { A: 1 }, pain: PAIN, ...o });
const honeySugar = (o = {}) => ({ label: 'Honey smell + sugar', dur: 6, odor: { B: 1 }, sugar: SUGAR, ...o });
const test = (o = {}) => ({ label: 'Test both smells', dur: 5, odor: { A: 0.8, B: 0.8 }, probe: 'test', ...o });
const wait = (min, o = {}) => ({ label: `Wait ${min} min`, dur: min * 60, speed: min * 60 / 8, fast: `${min} min`, ...o });

const PROTOCOLS = [
  {
    key: 'classic', name: 'Classic conditioning', sub: 'smell + pain, smell + sugar',
    cite: 'Tully & Quinn 1985 · Schwaerzel 2003',
    q: 'Pair one smell with pain and another with sugar. Does the same wiring store opposite memories?',
    animals: [{ id: 'fly', name: 'Fly' }],
    steps: [
      rest(3, { caption: 'A naive fly. <span class="d">Neither smell means anything yet.</span>' }),
      toxicPain({ caption: 'Toxic smell + pain → <em>PPL1 dopamine</em>. Its synapses onto the <em>approach</em> neurons fade.' }),
      rest(),
      honeySugar({ caption: 'Honey smell + sugar → <span class="h">PAM dopamine</span>. This time the <em>avoid</em> synapses fade.' }),
      rest(),
      test({ caption: 'Same neurons, different weights. <span class="d">One smell now reads aversive, the other attractive.</span>' }),
    ],
    verdict: (p) => `Toxic smell ${signed(p.test.fly.A)}, honey ${signed(p.test.fly.B)}. One pairing each, and the memories point in <em>opposite directions</em> because the two dopamine types weaken different output neurons.`,
  },
  {
    key: 'unpaired', name: 'Unpaired control', sub: 'same pain, wrong timing',
    cite: 'Tully & Quinn 1985 (explicitly unpaired control)',
    q: 'Same pain, same sugar, same smells as experiment 1, but never at the same time. Does anything get learned?',
    animals: [{ id: 'fly', name: 'Fly' }],
    steps: [
      rest(2, { caption: 'Same ingredients as experiment 1. <span class="d">Only the timing changes.</span>' }),
      { label: 'Pain, no smell', dur: 4, pain: [1, 2.2], caption: 'Pain with nothing in the air. <em>PPL1</em> fires, but no Kenyon cells are active.' },
      wait(2),
      { label: 'Toxic smell alone', dur: 6, odor: { A: 1 }, caption: 'Now the toxic smell alone. <span class="d">Nothing to pair it with.</span>' },
      { label: 'Sugar, no smell', dur: 4, sugar: [1, 2.5], caption: 'Sugar with no smell. <span class="h">PAM</span> fires into silence.' },
      wait(2),
      { label: 'Honey smell alone', dur: 6, odor: { B: 1 } },
      test({ caption: 'Nothing learned. <span class="d">Dopamine only rewrites the synapses of Kenyon cells active at that moment.</span>' }),
    ],
    verdict: (p) => `Toxic ${signed(p.test.fly.A)}, honey ${signed(p.test.fly.B)}: <em>no memory</em>. The same pain and sugar did nothing without a smell present at the same moment. The memory is associative: it needs coincidence.`,
  },
  {
    key: 'forget', name: 'Forgetting curve', sub: '1 pairing vs 3 pairings',
    cite: 'Tully et al. 1994 · Shuai et al. 2010',
    q: 'Train one fly once and another three times, then wait 20 minutes. Which memory lasts?',
    animals: [{ id: 'one', name: '1 pairing' }, { id: 'three', name: '3 pairings' }],
    steps: [
      rest(2, { caption: 'Two flies. <span class="d">One gets one pairing, the other gets three.</span>' }),
      toxicPain({ label: 'Pairing 1 (both flies)' }),
      rest(2),
      toxicPain({ label: 'Pairing 2 (3× fly only)', who: ['three'], caption: 'Only the second fly gets more training.' }),
      rest(2),
      toxicPain({ label: 'Pairing 3 (3× fly only)', who: ['three'] }),
      rest(2),
      wait(20, { watch: true, caption: 'Now wait 20 minutes. <span class="d">Unused synapses slowly recover.</span>' }),
      test(),
    ],
    verdict: (p, ev) => {
      const f = (id) => ev.forgot[id] != null ? `forgotten after <b>${(ev.forgot[id] / 60).toFixed(1)} min</b>` : 'still remembered at 20 min';
      return `1 pairing: ${f('one')}. 3 pairings: ${f('three')}. Both decay at the same rate, but the <em>deeper trace</em> takes longer to climb back to neutral.`;
    },
  },
  {
    key: 'reversal', name: 'Reversal learning', sub: 'swap what the smells mean',
    cite: 'Tully et al. 1990 · Wu et al. 2012',
    q: 'Teach toxic = bad and honey = good, then swap the outcomes. How fast does the fly change its mind?',
    animals: [{ id: 'fly', name: 'Fly' }],
    steps: [
      rest(2),
      toxicPain({ caption: 'First: toxic smell means pain…' }),
      honeySugar({ caption: '…and honey smell means sugar.' }),
      test({ probe: 'before', dur: 3, label: 'Test' }),
      { label: 'Toxic smell + sugar', dur: 6, odor: { A: 1 }, sugar: SUGAR, caption: 'Now <em>swap</em>: the toxic smell comes with sugar…' },
      { label: 'Honey smell + pain', dur: 6, odor: { B: 1 }, pain: PAIN, caption: '…and the honey smell comes with pain.' },
      test({ probe: 'mid', dur: 3, label: 'Test', caption: 'After one swapped pairing… <span class="d">both smells sit near neutral. Old and new memories nearly cancel.</span>' }),
      { label: 'Toxic smell + sugar', dur: 6, odor: { A: 1 }, sugar: SUGAR, caption: 'Again.' },
      { label: 'Honey smell + pain', dur: 6, odor: { B: 1 }, pain: PAIN },
      test({ probe: 'after', label: 'Test', caption: 'Now it has flipped. <span class="d">The toxic smell reads attractive.</span>' }),
    ],
    verdict: (p) => `Before: toxic ${signed(p.before.fly.A)}, honey ${signed(p.before.fly.B)}. After one swap: ${signed(p.mid.fly.A)} / ${signed(p.mid.fly.B)} (${meaning(p.mid.fly.A)} / ${meaning(p.mid.fly.B)}). After two: ${signed(p.after.fly.A)} / ${signed(p.after.fly.B)}. The old memory is not erased. A <em>second, opposing</em> memory is written on top of it.`,
  },
  {
    key: 'ppl1', name: 'Silence PPL1', sub: 'no pain dopamine',
    cite: 'Claridge-Chang et al. 2009 · Aso et al. 2010',
    q: 'Silence the PPL1 dopamine neurons and repeat experiment 1. Which memory survives?',
    animals: [{ id: 'ctl', name: 'Control' }, { id: 'ko', name: 'PPL1 silenced', lesion: { ppl1: true } }],
    steps: [
      rest(2, { caption: 'Two flies. <span class="d">In the second, PPL101 and PPL103 are silenced.</span>' }),
      toxicPain({ caption: 'Toxic smell + pain. <span class="d">Pain is felt, but no dopamine reaches the mushroom body.</span>' }),
      rest(),
      honeySugar({ caption: 'Honey + sugar. <span class="h">PAM</span> is untouched.' }),
      rest(),
      test({ caption: 'No PPL1, <em>no aversive memory</em>. The sugar memory is fine.' }),
    ],
    verdict: (p) => `Toxic smell: control ${signed(p.test.ctl.A)} vs silenced ${signed(p.test.ko.A)}. Honey: ${signed(p.test.ctl.B)} vs ${signed(p.test.ko.B)}. Knocking out <em>two cell types</em> (4 neurons) deletes one kind of memory and leaves the other intact.`,
  },
  {
    key: 'pam', name: 'Silence PAM', sub: 'no sugar dopamine',
    cite: 'Burke et al. 2012 · Liu et al. 2012',
    q: 'Silence the PAM dopamine neurons instead. Now which memory survives?',
    animals: [{ id: 'ctl', name: 'Control' }, { id: 'ko', name: 'PAM silenced', lesion: { pam: true } }],
    steps: [
      rest(2, { caption: 'Now silence the <span class="h">PAM</span> cluster instead <span class="d">(PAM01, 02, 05, 06).</span>' }),
      toxicPain(),
      rest(),
      honeySugar({ caption: 'It tastes the sugar. <span class="d">No reward dopamine follows.</span>' }),
      rest(),
      test({ caption: 'The mirror image: <em>pain memory intact</em>, sugar memory gone.' }),
    ],
    verdict: (p) => `Toxic: control ${signed(p.test.ctl.A)} vs silenced ${signed(p.test.ko.A)}. Honey: ${signed(p.test.ctl.B)} vs ${signed(p.test.ko.B)}. The <em>mirror image</em> of experiment 5: reward and punishment are written by separate dopamine neurons.`,
  },
  {
    key: 'readout', name: 'Memory without recall', sub: 'block the output neurons',
    cite: 'Dubnau et al. 2001 · McGuire et al. 2001',
    q: 'Train normally, then block the approach output neurons during the test. Is the memory gone, or just unreadable?',
    animals: [{ id: 'fly', name: 'Fly' }],
    steps: [
      rest(2),
      toxicPain({ caption: 'Train as usual: toxic smell + pain.' }),
      rest(),
      honeySugar(),
      rest(),
      test({ probe: 'blocked', dur: 6, label: 'Test, MBON11 + MBON12 blocked', silence: ['MBON11', 'MBON12'], caption: 'Block <em>MBON11</em> + <em>MBON12</em> output. <span class="d">The toxic smell now reads unknown…</span>' }),
      rest(2, { silence: ['MBON11', 'MBON12'] }),
      test({ probe: 'free', dur: 6, label: 'Test, output restored', caption: '…unblock them, and <em>the memory is back</em>. It was stored the whole time.' }),
    ],
    verdict: (p) => `Blocked: toxic ${signed(p.blocked.fly.A)} (${meaning(p.blocked.fly.A)}). Restored: ${signed(p.free.fly.A)} (${meaning(p.free.fly.A)}). The synapses held the memory throughout. <em>Storage and recall</em> are separate steps.`,
  },
];

// ------------------------------------------------------------------ state
const brain = new Brain($('#brain-canvas'), $('#brain-labels'));
let circuits, P, animals = [], focus;
let steps = [], si = 0, st = 0, playT = 0, total = 1, running = false, finished = false;
let samples = [], probes = {}, events = {}, userSpeed = 1, silenced = new Set();
let now = { conc: { A: 0, B: 0 }, pain: false, sugar: false };

function readValence(mb, odor, silence) {
  const mean = (list) => {
    const l = list.filter((t) => !silence.has(t));
    return l.length ? l.reduce((a, t) => a + mb.strength(t, odor), 0) / l.length : 1;
  };
  return Math.max(-1, Math.min(1, mean(mb.approach) - mean(mb.avoid)));
}

function select(i) {
  P = PROTOCOLS[i];
  animals = P.animals.map((a) => ({ ...a, lesion: a.lesion || {}, mb: new MushroomBody(circuits) }));
  focus = animals.at(-1);
  steps = P.steps; si = 0; st = 0; playT = 0; finished = false;
  total = steps.reduce((s, x) => s + x.dur / (x.speed || 1), 0);
  samples = []; probes = {}; events = { forgot: {} }; silenced = new Set(steps[0].silence || []);
  now = { conc: { A: 0, B: 0 }, pain: false, sugar: false };
  document.querySelectorAll('#exp-list li').forEach((li, j) => li.classList.toggle('on', j === i));
  $('#exp-cite').textContent = P.cite;
  $('#exp-q').textContent = P.q;
  $('#exp-steps').innerHTML = steps.filter((s) => !s.hidden).map((s) => `<li>${s.label}</li>`).join('');
  $('#syn-who').textContent = focus.name;
  $('#trace-legend').innerHTML = animals.map((a, k) => `<b style="opacity:${a === focus ? 1 : 0.55}">${k === 0 && animals.length > 1 ? '- - ' : '— '}${a.name}</b>`).join('');
  startStep();
  sample();
  showResult();
  history.replaceState(null, '', `?exp=${i + 1}`);
}

function startStep() {
  const s = steps[si];
  silenced = new Set(s.silence || []);
  if (s.caption) caption(s.caption, 0);
  const vis = steps.filter((x) => !x.hidden), k = vis.indexOf(s);
  const visBefore = steps.slice(0, si).filter((x) => !x.hidden).length;
  document.querySelectorAll('#exp-steps li').forEach((li, j) => {
    li.classList.toggle('now', j === k);
    li.classList.toggle('done', k >= 0 ? j < k : j < visBefore);
  });
}

function endStep() {
  const s = steps[si];
  if (s.probe) probes[s.probe] = Object.fromEntries(animals.map((a) => [a.id, { A: readValence(a.mb, 'A', silenced), B: readValence(a.mb, 'B', silenced) }]));
  si++; st = 0;
  if (si >= steps.length) {
    finished = true; running = false; si = steps.length - 1; st = steps[si].dur;
    setPlayBtn();
    showResult();
    return;
  }
  startStep();
}

// ------------------------------------------------------------------ simulation
function advance(realDt) {
  let real = realDt * userSpeed;
  while (real > 1e-9 && !finished) {
    const s = steps[si], speed = s.speed || 1;
    const use = Math.min(real, (s.dur - st) / speed);
    integrate(s, st, use * speed);
    st += use * speed; playT += use; real -= use;
    if (st >= s.dur - 1e-9) endStep();
  }
}

function integrate(s, t0, adv) {
  if (adv <= 0) return;
  const stim = s.pain || s.sugar;
  const n = Math.max(1, Math.ceil(adv / (stim ? 0.02 : 0.25))), h = adv / n;
  const conc = { A: s.odor?.A || 0, B: s.odor?.B || 0 };
  for (let k = 0; k < n; k++) {
    const t = t0 + (k + 0.5) * h;
    const pain = !!s.pain && t >= s.pain[0] && t < s.pain[1];
    const sugar = !!s.sugar && t >= s.sugar[0] && t < s.sugar[1];
    for (const a of animals) {
      const gets = !s.who || s.who.includes(a.id);
      a.mb.step(h, conc, { punishment: pain && gets && !a.lesion.ppl1 ? 1 : 0, reward: sugar && gets && !a.lesion.pam ? 1 : 0 });
    }
    if (s.watch) {
      for (const a of animals) if (events.forgot[a.id] == null && readValence(a.mb, 'A', silenced) > -0.08) events.forgot[a.id] = t0 + (k + 1) * h;
    }
    now = { conc, pain, sugar, step: s };
  }
}

function sample() {
  samples.push({ x: playT, v: animals.map((a) => ({ A: readValence(a.mb, 'A', silenced), B: readValence(a.mb, 'B', silenced) })) });
}

// ------------------------------------------------------------------ synapse map
const MB_ORDER = ['MBON11', 'MBON12', 'MBON01', 'MBON04'];
let syn;
function buildSynapseMap() {
  const c = circuits;
  const shared = new Set(c.odors.A.kc_idx.filter((k) => c.odors.B.kc_idx.includes(k)));
  const mbons = MB_ORDER.map((t) => c.mbons.find((m) => m.type === t)).filter(Boolean);
  const blocks = [];
  for (const o of ['A', 'B']) {
    for (const m of mbons) {
      const e = c.kc_mbon[m.type]?.[o] || { kc: [], w: [] };
      const w = new Map(e.kc.map((k, j) => [k, e.w[j]]));
      const wmax = Math.max(...e.w, 1);
      blocks.push({ o, m, slots: c.odors[o].kc_idx.map((k) => ({ k, w: w.get(k) || 0, r: Math.sqrt((w.get(k) || 0) / wmax), shared: shared.has(k) })) });
    }
  }
  const dans = Object.fromEntries(mbons.map((m) => [m.type, c.dans.filter((d) => d.targets?.includes(m.type))]));
  syn = { blocks, mbons, dans, shared };
}

function fitCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

const INK = '28,28,28', ACC = '229,91,43', HON = '201,138,28';
const INK_RGB = [28, 28, 28], DA_RGB = { punishment: [229, 91, 43], reward: [201, 138, 28] };
function drawSynapses() {
  const { g, w, h } = fitCanvas($('#syn-canvas'));
  const left = 128, top = 74, pad = 20, gapX = 16, gapY = 34;
  const bw = (w - left - pad - gapX * 3) / 4, bh = (h - top - pad - gapY - 22) / 2;
  const n = circuits.odors.A.kc_idx.length;
  const COLS = Math.max(8, Math.round(Math.sqrt((n * bw) / bh))), ROWS = Math.ceil(n / COLS), cell = Math.min(bw / COLS, bh / ROWS);
  const mbF = focus.mb;
  const da = { punishment: now.pain && !focus.lesion.ppl1 && (!now.step?.who || now.step.who.includes(focus.id)), reward: now.sugar && !focus.lesion.pam && (!now.step?.who || now.step.who.includes(focus.id)) };

  // column headers: approach / avoid groups, MBON names, DANs
  g.textBaseline = 'alphabetic';
  syn.mbons.forEach((m, j) => {
    const x = left + j * (bw + gapX);
    if (j % 2 === 0) {
      g.fillStyle = '#77756f'; g.font = '600 10.5px Inter'; g.letterSpacing = '1.2px';
      g.fillText(m.role === 'approach' ? 'APPROACH OUTPUT' : 'AVOID OUTPUT', x, 14);
      g.letterSpacing = '0px';
      g.strokeStyle = 'rgba(28,28,28,0.12)'; g.beginPath(); g.moveTo(x, 20); g.lineTo(x + bw * 2 + gapX, 20); g.stroke();
    }
    const blocked = silenced.has(m.type);
    g.fillStyle = blocked ? '#bdbbb5' : '#1c1c1c'; g.font = '700 16px Inter';
    g.fillText(m.type, x, 42);
    const tw = g.measureText(m.type).width;
    g.fillStyle = '#77756f'; g.font = '400 12px Inter';
    g.fillText(m.compartment, x + tw + 7, 42);
    // dopamine neurons for this compartment
    const ds = syn.dans[m.type] || [];
    const sig = ds[0]?.signal;
    const lesioned = sig === 'punishment' ? focus.lesion.ppl1 : focus.lesion.pam;
    const active = sig && da[sig] && !lesioned;
    g.font = '500 11.5px "Geist Mono"';
    g.fillStyle = lesioned ? '#bdbbb5' : active ? `rgb(${sig === 'punishment' ? ACC : HON})` : '#77756f';
    const names = ds.map((d) => d.type).join(' ');
    g.fillText(`${active ? '▼ ' : ''}${names} ${lesioned ? '' : sig === 'punishment' ? 'pain DA' : 'sugar DA'}`, x, 60);
    if (lesioned) {
      const tw2 = g.measureText(names).width;
      g.strokeStyle = '#bdbbb5'; g.beginPath(); g.moveTo(x, 56); g.lineTo(x + tw2, 56); g.stroke();
      g.fillStyle = `rgb(${ACC})`; g.fillText('silenced', x + tw2 + 7, 60);
    }
  });

  // row labels
  ['A', 'B'].forEach((o, r) => {
    const y = top + r * (bh + gapY + 22);
    g.fillStyle = o === 'A' ? '#1c1c1c' : `rgb(${HON})`;
    g.beginPath(); g.arc(6, y + 12, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1c1c1c'; g.font = '600 15px Inter';
    g.fillText(o === 'A' ? 'Toxic smell' : 'Honey smell', 18, y + 17);
    g.fillStyle = '#77756f'; g.font = '400 12px Inter';
    g.fillText(`${circuits.odors[o].kc_idx.length} Kenyon cells`, 18, y + 35);
    const v = readValence(mbF, o, silenced);
    g.font = '600 13px Inter';
    g.fillStyle = v <= -0.08 ? `rgb(${ACC})` : v >= 0.08 ? `rgb(${HON})` : '#77756f';
    g.fillText(valenceLabel(v), 18, y + 56);
    if (now.conc[o] > 0) {
      g.fillStyle = '#77756f'; g.font = '500 11px "Geist Mono"';
      g.fillText('● in the air', 18, y + 76);
    }
  });

  // blocks
  for (const b of syn.blocks) {
    const j = syn.mbons.indexOf(b.m), r = b.o === 'A' ? 0 : 1;
    const x0 = left + j * (bw + gapX), y0 = top + r * (bh + gapY + 22);
    const present = now.conc[b.o] > 0;
    const sig = syn.dans[b.m.type]?.[0]?.signal;
    const writing = present && sig && da[sig];
    const blocked = silenced.has(b.m.type);
    const gmap = mbF.gain[b.m.type];
    g.fillStyle = writing ? `rgba(${sig === 'punishment' ? ACC : HON},0.08)` : present ? 'rgba(28,28,28,0.035)' : 'rgba(28,28,28,0.015)';
    roundRect(g, x0, y0, bw, bh, 10); g.fill();
    const ox = x0 + (bw - cell * COLS) / 2, oy = y0 + (bh - cell * ROWS) / 2;
    b.slots.forEach((s, i) => {
      const cx = ox + (i % COLS + 0.5) * cell, cy = oy + (((i / COLS) | 0) + 0.5) * cell;
      if (!s.w) { g.fillStyle = 'rgba(28,28,28,0.07)'; g.beginPath(); g.arc(cx, cy, 1, 0, Math.PI * 2); g.fill(); return; }
      const gain = gmap?.get(s.k) ?? 1;
      const rad = Math.max(cell * 0.12, cell * 0.44 * s.r);
      // a weakened synapse takes the colour of the dopamine that weakened it
      const dcol = sig === 'punishment' ? DA_RGB.punishment : DA_RGB.reward, k = writing ? 1 : Math.min(1, (1 - gain) * 2.5);
      const rgb = INK_RGB.map((v, q) => Math.round(v + (dcol[q] - v) * k)).join(',');
      const alpha = blocked ? 0.1 + 0.25 * gain : (0.3 + 0.7 * gain) * (present || writing ? 1 : 0.85);
      g.fillStyle = `rgba(${rgb},${alpha})`;
      g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
      if (s.shared) { g.strokeStyle = 'rgba(74,111,165,0.85)'; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, Math.max(rad, cell * 0.28) + 1.6, 0, Math.PI * 2); g.stroke(); }
    });
    if (blocked) {
      g.save(); roundRect(g, x0, y0, bw, bh, 10); g.clip();
      g.strokeStyle = 'rgba(28,28,28,0.08)'; g.lineWidth = 6;
      for (let d = -bh; d < bw; d += 16) { g.beginPath(); g.moveTo(x0 + d, y0 + bh); g.lineTo(x0 + d + bh, y0); g.stroke(); }
      g.restore();
      g.fillStyle = '#1c1c1c'; g.font = '700 13px Inter'; g.textAlign = 'center';
      g.fillText('OUTPUT BLOCKED', x0 + bw / 2, y0 + bh / 2 + 4); g.textAlign = 'left';
    }
    // strength relative to naive
    const str = mbF.strength(b.m.type, b.o);
    g.font = '500 12px "Geist Mono"';
    g.fillStyle = str < 0.97 ? `rgb(${ACC})` : '#77756f';
    g.fillText(`${Math.round(str * 100)}%`, x0, y0 + bh + 17);
    g.fillStyle = '#bdbbb5'; g.font = '400 11.5px Inter';
    g.fillText(`${b.slots.filter((s) => s.w).length} synapses`, x0 + 44, y0 + bh + 17);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ------------------------------------------------------------------ trace
function drawTrace() {
  const { g, w, h } = fitCanvas($('#trace-canvas'));
  const L = 92, R = 24, T = 14, B = 30;
  const X = (x) => L + (x / total) * (w - L - R), Y = (v) => T + ((1 - v) / 2) * (h - T - B);
  // step bands
  let x = 0;
  for (const s of steps) {
    const x1 = x + s.dur / (s.speed || 1);
    if (s.odor) {
      const both = s.odor.A && s.odor.B;
      g.fillStyle = both ? 'rgba(28,28,28,0.05)' : s.odor.A ? 'rgba(28,28,28,0.07)' : `rgba(${HON},0.14)`;
      g.fillRect(X(x), T, X(x1) - X(x), h - T - B);
    }
    if (s.silence) { g.fillStyle = 'rgba(28,28,28,0.04)'; g.fillRect(X(x), T, X(x1) - X(x), h - T - B); }
    for (const [k, col] of [['pain', ACC], ['sugar', HON]]) {
      if (!s[k]) continue;
      const a = X(x + s[k][0] / (s.speed || 1)), b = X(x + s[k][1] / (s.speed || 1));
      g.fillStyle = `rgba(${col},0.9)`; g.fillRect(a, T, Math.max(2, b - a), 5);
      g.fillStyle = `rgba(${col},0.1)`; g.fillRect(a, T, Math.max(2, b - a), h - T - B);
    }
    if (s.fast) {
      g.fillStyle = '#77756f'; g.font = '500 12px "Geist Mono"'; g.textAlign = 'center';
      g.fillText(`⏩ ${s.fast}`, (X(x) + X(x1)) / 2, h - 10); g.textAlign = 'left';
      g.strokeStyle = 'rgba(28,28,28,0.1)'; g.setLineDash([2, 4]);
      for (const xx of [x, x1]) { g.beginPath(); g.moveTo(X(xx), T); g.lineTo(X(xx), h - B); g.stroke(); }
      g.setLineDash([]);
    }
    x = x1;
  }
  // axes: what Jev reads
  g.strokeStyle = 'rgba(28,28,28,0.14)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(w - R, Y(0)); g.stroke();
  g.setLineDash([3, 4]); g.strokeStyle = 'rgba(28,28,28,0.12)';
  for (const v of [0.08, -0.08]) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); }
  g.setLineDash([]);
  g.font = '600 12px Inter'; g.textAlign = 'right';
  g.fillStyle = `rgb(${HON})`; g.fillText('attractive', L - 12, Y(0.75) + 4);
  g.fillStyle = '#77756f'; g.fillText('unknown', L - 12, Y(0) + 4);
  g.fillStyle = `rgb(${ACC})`; g.fillText('aversive', L - 12, Y(-0.75) + 4);
  g.textAlign = 'left';

  // traces
  animals.forEach((a, k) => {
    const main = a === focus;
    for (const o of ['A', 'B']) {
      g.strokeStyle = o === 'A' ? `rgba(${INK},${main ? 1 : 0.45})` : `rgba(${HON},${main ? 1 : 0.55})`;
      g.lineWidth = main ? 2.4 : 1.8;
      g.setLineDash(main ? [] : [6, 5]);
      g.beginPath();
      samples.forEach((s, i) => { const px = X(s.x), py = Y(s.v[k][o]); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
    }
  });
  g.setLineDash([]);
  // end labels
  const last = samples.at(-1);
  if (last) {
    animals.forEach((a, k) => {
      for (const o of ['A', 'B']) {
        const v = last.v[k][o];
        if (Math.abs(v) < 0.02 && a !== focus) continue;
        g.fillStyle = o === 'A' ? '#1c1c1c' : `rgb(${HON})`;
        g.beginPath(); g.arc(X(last.x), Y(v), a === focus ? 4 : 3, 0, Math.PI * 2); g.fill();
      }
    });
    g.strokeStyle = 'rgba(229,91,43,0.5)'; g.beginPath(); g.moveTo(X(playT), T); g.lineTo(X(playT), h - B); g.stroke();
  }
}

// ------------------------------------------------------------------ result card
function showResult() {
  const rows = animals.map((a) => {
    const vals = ['A', 'B'].map((o) => {
      const v = readValence(a.mb, o, silenced);
      const cls = v <= -0.08 ? 'avoid' : v >= 0.08 ? 'approach' : '';
      return `<div class="rrow"><div class="row"><span class="name"><i class="ico ${o === 'A' ? 'toxic' : 'honey'}"></i>${o === 'A' ? 'Toxic' : 'Honey'} smell</span><span class="txt ${cls}">${meaning(v)} <span class="who">${signed(v)}</span></span></div>
        <div class="track"><b class="mid"></b><b class="knob" style="left:${50 + v * 50}%;background:${v <= -0.08 ? 'var(--accent)' : v >= 0.08 ? 'var(--honey)' : 'var(--ink)'}"></b></div></div>`;
    }).join('');
    return `${animals.length > 1 ? `<div class="who">${a.name}</div>` : ''}${vals}`;
  }).join('');
  const verdict = finished ? `<div class="verdict">${P.verdict(probes, events)}</div>` : '';
  $('#res-body').innerHTML = rows + verdict;
}

// ------------------------------------------------------------------ caption, controls
let capTimer;
function caption(html, secs = 5) {
  const el = $('#caption');
  el.classList.remove('on');
  clearTimeout(capTimer);
  setTimeout(() => { el.innerHTML = html; el.classList.add('on'); }, 250);
  if (secs) capTimer = setTimeout(() => el.classList.remove('on'), secs * 1000);
}

function setPlayBtn() {
  $('[data-cmd=play]').innerHTML = `<span>${running ? 'Pause' : finished ? 'Replay' : 'Play'}</span>`;
}
function play() {
  if (finished) select(PROTOCOLS.indexOf(P));
  running = !running;
  setPlayBtn();
}
const SPEEDS = [1, 2, 4];
const commands = {
  play,
  restart: () => { select(PROTOCOLS.indexOf(P)); running = true; setPlayBtn(); },
  speed: () => { userSpeed = SPEEDS[(SPEEDS.indexOf(userSpeed) + 1) % SPEEDS.length]; $('#speed-btn').textContent = `${userSpeed}×`; },
};
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]()));
addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); play(); }
  else if (e.key === 'r' || e.key === 'R') commands.restart();
  else if (e.key === 's' || e.key === 'S') commands.speed();
  else if (/^[1-9]$/.test(e.key) && PROTOCOLS[+e.key - 1]) { select(+e.key - 1); running = true; setPlayBtn(); }
});
addEventListener('resize', () => brain.resize());

// ------------------------------------------------------------------ loop
let last = performance.now(), hud = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (running) { advance(dt); sample(); }

  // connectome: odor → PN → KC, MBON output, dopamine
  const c = circuits;
  for (const o of ['A', 'B']) {
    const col = o === 'A' ? BCOL.odorA : BCOL.odorB, v = now.conc[o];
    brain.hold(c.odors[o].pn_idx, col, v * 1.2);
    brain.hold(c.odors[o].kc_idx, col, v);
  }
  const out = focus.mb.output(now.conc);
  for (const m of c.mbons) if (out[m.type] > 0.01 && !silenced.has(m.type)) brain.hold(m.idx, BCOL.approach, 0.35 + out[m.type]);
  for (const d of c.dans) {
    const on = d.signal === 'punishment' ? now.pain && !focus.lesion.ppl1 : now.sugar && !focus.lesion.pam;
    if (on) brain.hold(d.idx, d.signal === 'punishment' ? BCOL.ppl1 : BCOL.pam, 1.3);
  }
  brain.updateFan(focus.mb, now.conc);
  brain.update(dt);
  brain.render();

  drawSynapses();
  drawTrace();
  hud -= dt;
  if (hud <= 0) { hud = 0.15; if (running || !finished) showResult(); }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
(async () => {
  circuits = await brain.load('data/');
  brain.setVisible(true);
  brain.setView('mb', true);
  buildSynapseMap();
  $('#exp-list').innerHTML = PROTOCOLS.map((p) => `<li><span>${p.name}<small>${p.sub}</small></span></li>`).join('');
  document.querySelectorAll('#exp-list li').forEach((li, i) => li.addEventListener('click', () => { select(i); running = true; setPlayBtn(); }));
  const q = new URLSearchParams(location.search);
  const n = Math.max(1, Math.min(PROTOCOLS.length, +(q.get('exp') || 1))) - 1;
  select(n);
  running = q.has('play');
  setPlayBtn();
  $('#loader').classList.add('gone');
  window.lab = { PROTOCOLS, get animals() { return animals; }, get probes() { return probes; }, get events() { return events; }, select, run: (i) => { select(i); while (!finished) advance(0.05); return { probes, events }; } };
  requestAnimationFrame((t) => { last = t; frame(t); });
})().catch((err) => { $('#loader .ld').textContent = `failed to load: ${err.message}`; console.error(err); });
