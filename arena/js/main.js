import { World } from './world.js';
import { Brain, BCOL } from './brain.js';
import { MushroomBody, valenceLabel } from './mb.js';
import { JevDriver, ACTIONS } from './jev.js';
import { Eye, DIR_BINS } from './eye.js';
import { Visuomotor } from './visuomotor.js';

const $ = (s) => document.querySelector(s);
const world = new World($('#world'), $('#world-labels'));
const brain = new Brain($('#brain-canvas'), $('#brain-labels'));

let circuits, mb, jev, eye, vm;
let eyeClock = 0, eyeDraw = 0, lastLoomSpike = -9;
let paused = true, clock = 0, tool = null, lastDecision = null;
let painCount = 0, feeding = false, edgeCount = 0, boostCount = 0;
const pop = { pinned: false, until: 0 };

// ------------------------------------------------------------------ sim-time waits
const waiters = [];
const wait = (s) => new Promise((r) => waiters.push({ at: clock + s, r }));
const waitUntil = (pred, max) => new Promise((r) => waiters.push({ at: clock + max, pred, r }));
function flushWaiters() {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (clock >= w.at || (w.pred && w.pred())) { waiters.splice(i, 1); w.r(); }
  }
}

// ------------------------------------------------------------------ HUD
const bars = {};
for (const [k, a] of Object.entries(ACTIONS)) {
  const row = document.createElement('div');
  row.className = 'bar';
  row.innerHTML = `<span>${a.label}</span><div class="tr"><div class="fl"></div></div><span class="p">—</span>`;
  $('#bars').appendChild(row);
  bars[k] = { row, fl: row.querySelector('.fl'), p: row.querySelector('.p') };
}

function showDecision(d) {
  for (const [k, b] of Object.entries(bars)) {
    const p = d.probabilities?.[k] ?? 0;
    b.fl.style.width = `${(p * 100).toFixed(1)}%`;
    b.p.textContent = `${Math.round(p * 100)}%`;
    b.row.classList.toggle('win', k === d.action);
  }
  $('#now-action').textContent = ACTIONS[d.action].label;
  $('#now-dn').textContent = ACTIONS[d.action].dn;
  $('#m-lat').textContent = d.latency;
  $('#m-count').textContent = jev.count.toLocaleString();
  $('#m-cost').textContent = `$${jev.cost.toFixed(3)}`;
}

// Latency lives in the decision panel; only surface connection trouble.
function setStatus({ ok, error }) {
  if (!ok) $('#now-dn').textContent = `jev offline · ${error || ''}`.slice(0, 48);
}

function showValence(o) {
  const v = mb.valence(o).value, root = $(`#val-${o}`);
  root.querySelector('.knob').style.left = `${50 + v * 50}%`;
  root.querySelector('.knob').style.background = v <= -0.08 ? 'var(--accent)' : v >= 0.08 ? 'var(--honey)' : 'var(--ink)';
  const t = root.querySelector('.txt');
  t.textContent = valenceLabel(v);
  t.className = `txt ${v <= -0.08 ? 'avoid' : v >= 0.08 ? 'approach' : ''}`;
}

let capTimer;
function caption(html, secs = 5) {
  const el = $('#caption');
  el.classList.remove('on');
  clearTimeout(capTimer);
  setTimeout(() => { el.innerHTML = html; el.classList.add('on'); }, 300);
  if (secs) capTimer = setTimeout(() => el.classList.remove('on'), secs * 1000);
}

function log(html) {
  const box = $('#brain-event');
  const line = document.createElement('div');
  line.innerHTML = html;
  box.appendChild(line);
  while (box.children.length > 3) box.firstChild.remove();
}

function step(p) {
  const order = ['naive', 'contact', 'learned', 'blocked'];
  const i = order.indexOf(p);
  document.querySelectorAll('#steps li').forEach((li, j) => { li.classList.toggle('now', j === i); li.classList.toggle('done', i > j); });
}

// ------------------------------------------------------------------ brain popup
function setPop(open) {
  $('#brain-pop').classList.toggle('open', open);
  $('[data-cmd=brain]').classList.toggle('on', open);
  brain.setVisible(open);
}
function peekBrain(secs, view) {
  if (view) brain.setView(view);
  pop.until = Math.max(pop.until, clock + secs);
  if (!$('#brain-pop').classList.contains('open')) setPop(true);
}

// ------------------------------------------------------------------ wiring
function fireAction(name) {
  const a = circuits.actions[ACTIONS[name]?.circuit];
  if (!a) return;
  brain.flash(a.dn_idx, BCOL.dn, 1.4, 2.2);
  const paths = a.paths || [];
  for (let i = 0; i < Math.min(2, paths.length); i++) brain.firePath(paths[(Math.random() * paths.length) | 0], 1.3, i * 0.1);
}

function onDecision(d) {
  if (paused) return;
  const prev = lastDecision?.action;
  lastDecision = d;
  world.setProgram(d.action, d.arousal);
  showDecision(d);
  if (d.action !== prev) {
    fireAction(d.action);
    log(`jev → <b>${ACTIONS[d.action].dn}</b> ${ACTIONS[d.action].label.toLowerCase()} · ${Math.round((d.probabilities?.[d.action] ?? 0) * 100)}% · ${d.latency} ms`);
  }
}

world.onEvent = (e) => {
  if (!circuits) return;
  if (e.type === 'pain') {
    painCount++;
    if (mb.lesion.punishment) { log(`pain · <span class="a">${lesionNote.punishment}</span>`); return; }
    const d = circuits.dans.filter((x) => x.signal === 'punishment');
    d.forEach((x) => brain.flash(x.idx, BCOL.ppl1, 1.5, 1.2));
    const before = mb.strength(mb.approach[0], 'A');
    peekBrain(6, 'mb');
    wait(1.1).then(() => log(`<span class="a">PPL1 dopamine</span> · KC→${mb.approach[0]} (toxic smell) ${Math.round(before * 100)}% → <b>${Math.round(mb.strength(mb.approach[0], 'A') * 100)}%</b>`));
  }
  if (e.type === 'edge') {
    edgeCount++;
    log(`<span class="a">border hit</span> · pain (not paired with smell)`);
  }
  if (e.type === 'takeoff') {
    boostCount++;
    fireAction('takeoff');
    world.setCamera('hero');
    peekBrain(4, 'cns');
    log('<b>DNp01</b> giant fiber → boosters');
  }
  if (e.type === 'land') wait(0.9).then(() => world.setCamera('chase'));
};

function onFeedingChange(now) {
  if (now === feeding) return;
  feeding = now;
  if (!now) return;
  if (mb.lesion.reward) { log(`sugar · <span class="h">${lesionNote.reward}</span>`); return; }
  const d = circuits.dans.filter((x) => x.signal === 'reward');
  d.forEach((x) => brain.flash(x.idx, BCOL.pam, 1.4, 1.2));
  const before = mb.strength(mb.avoid[0], 'B');
  peekBrain(6, 'mb');
  wait(2).then(() => log(`<span class="h">PAM dopamine</span> · KC→${mb.avoid[0]} (honey smell) ${Math.round(before * 100)}% → <b>${Math.round(mb.strength(mb.avoid[0], 'B') * 100)}%</b>`));
}

// ------------------------------------------------------------------ controls
function setPaused(p) {
  paused = p;
  const btn = $('[data-cmd=play]');
  btn.innerHTML = p
    ? '<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg><span>Play</span>'
    : '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.8" width="3.2" height="10.4" rx="1" fill="currentColor"/><rect x="9.3" y="2.8" width="3.2" height="10.4" rx="1" fill="currentColor"/></svg><span>Pause</span>';
  if (p) jev?.stop();
  else jev?.start();
}

function setTool(t) {
  tool = tool === t ? null : t;
  document.querySelectorAll('#dock [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  document.body.classList.toggle('armed', !!tool);
  if (tool) $('#arm-what').textContent = { honey: 'honey', toxic: 'toxic waste', barrier: 'a barrier' }[tool];
}

function reset() {
  demoRun++;
  world.clearObjects();
  world.resetTrail();
  mb.reset();
  world.motor.reset();
  vm?.reset();
  painCount = 0; edgeCount = 0; boostCount = 0;
  step(null);
  showManip();
  log('memory reset · all KC→MBON synapses back to naive');
}

// ------------------------------------------------------------------ experiments
// Manipulations of the mushroom body (mb.lesion, mb.silenced), shown on the readout card.
const lesionNote = { punishment: 'PPL1 silenced · no dopamine', reward: 'PAM silenced · no dopamine' };
function showManip() {
  const tags = [];
  if (mb.lesion.punishment && !mb.silenced.size) tags.push(lesionNote.punishment.split(' · ')[0]);
  if (mb.lesion.reward) tags.push(lesionNote.reward.split(' · ')[0]);
  if (mb.silenced.size) tags.push(`${[...mb.silenced].join(' + ')} blocked`);
  const el = $('#manip');
  el.textContent = tags.join(' · ');
  el.classList.toggle('on', tags.length > 0);
}

function begin() {
  reset();
  const run = ++demoRun;
  setPaused(false);
  setPop(false); pop.pinned = false;
  return () => run === demoRun;
}
const inPath = () => world.body.x * 0.4;
// First toxic encounter: keep dropping waste where the robot will walk until it touches one.
async function firstContact(alive) {
  const b = world.body;
  for (let i = 0; i < 3 && painCount === 0; i++) {
    world.drop('toxic', inPath(), b.z + 2.3);
    await waitUntil(() => painCount > 0, 10); if (!alive()) return false;
  }
  return painCount > 0;
}
// Toxic waste straight ahead; returns how many pain events it caused.
async function meetToxic(alive, secs = 7) {
  const b = world.body, p0 = painCount;
  world.drop('toxic', b.x, b.z + 2.5);
  await wait(secs);
  return alive() ? painCount - p0 : null;
}
const spend = () => `${jev.count} decisions · ~${jev.avgLatency} ms each · <em>$${jev.cost.toFixed(4)}</em>`;
// last caption, then pause so Jev stops being called once the experiment is over
async function finish(alive, html) {
  caption(html, 0);
  await wait(6);
  if (alive()) setPaused(true);
}
const valA = () => mb.valence('A').value, valB = () => mb.valence('B').value;

const EXPERIMENTS = {
  demo: { name: 'Classic demo', sub: 'toxic, honey, barrier', run: () => demo() },

  ppl1: {
    name: 'Silence PPL1', sub: 'no pain dopamine',
    async run() {
      const alive = begin();
      mb.lesion.punishment = true; showManip();
      caption('Same robot, same brain. <span class="d">But its <em>PPL1</em> pain-dopamine neurons are silenced.</span>', 5);
      await wait(5.5); if (!alive()) return;
      caption('Toxic waste. <span class="d">It has never smelled this before.</span>', 5);
      if (!await firstContact(alive)) return;
      caption('Pain is felt… <span class="d">but no dopamine reaches the mushroom body. No synapse changes.</span>', 6);
      await wait(6.5); if (!alive()) return;
      caption('Same toxic smell again.', 4);
      const n = await meetToxic(alive, 8); if (n == null) return;
      caption(n > 0 ? 'It walks straight back in. <em>No PPL1, no memory.</em>' : `It avoided it anyway <span class="d">(toxic smell reads ${valenceLabel(valA())})</span>.`, 6);
      await wait(6.5); if (!alive()) return;
      await finish(alive, `${painCount} toxic contacts, and the smell still reads <b>${valenceLabel(valA())}</b>. ${spend()}`);
    },
  },

  pam: {
    name: 'Silence PAM', sub: 'no sugar dopamine',
    async run() {
      const alive = begin();
      const b = world.body;
      mb.lesion.reward = true; showManip();
      caption('This time the <span class="h">PAM</span> sugar-dopamine neurons are silenced.', 5);
      await wait(5.5); if (!alive()) return;
      caption('Honey. <span class="d">A new smell. It goes to taste it.</span>', 5);
      for (let i = 0; i < 3 && !feeding; i++) {
        world.drop('honey', inPath(), b.z + 2.2);
        await waitUntil(() => feeding, 10); if (!alive()) return;
      }
      if (!feeding) { await finish(alive, 'It never tasted the honey. <span class="d">Run it again.</span>'); return; }
      caption('Sugar… <span class="d">but no PAM dopamine. The honey smell stays meaningless.</span>', 5);
      await waitUntil(() => !feeding, 8); if (!alive()) return;
      await wait(2); if (!alive()) return;
      world.drop('honey', b.x > 0 ? -0.34 : 0.34, b.z + 2.6);
      caption('Honey off to the side. <span class="d">Does it remember?</span>', 5);
      await waitUntil(() => feeding, 11); if (!alive()) return;
      caption(feeding ? 'It found it anyway.' : 'It walks right past. <em>No PAM, no sugar memory.</em>', 6);
      await wait(6.5); if (!alive()) return;
      await finish(alive, `Honey smell reads <b>${valenceLabel(valB())}</b>. ${spend()}`);
    },
  },

  forget: {
    name: 'Forgetting', sub: 'train once, let time pass',
    async run() {
      const alive = begin();
      caption('Teach it once. Then let time pass.', 4);
      await wait(4.5); if (!alive()) return;
      caption('Toxic waste. <span class="d">First contact.</span>', 4);
      if (!await firstContact(alive)) return;
      caption('Pain → <em>PPL1 dopamine</em> → a memory.', 5);
      await wait(5.5); if (!alive()) return;
      caption('Same smell, a few seconds later.', 4);
      const n1 = await meetToxic(alive, 7); if (n1 == null) return;
      caption(n1 === 0 ? 'It steers around it. <em>It remembers.</em>' : 'It touched it again.', 4.5);
      await wait(5); if (!alive()) return;
      // fast-forward: the only thing that changes is the synapses relaxing back (τ = 420 s in mb.js)
      const el = $('#caption');
      clearTimeout(capTimer); el.classList.add('on');
      let secs = 0;
      const none = { A: 0, B: 0 }, noDA = { punishment: 0, reward: 0 };
      while (valA() <= -0.08 && secs < 40 * 60) {
        for (let k = 0; k < 4; k++) { mb.step(3, none, noDA); secs += 3; }
        el.innerHTML = `⏩ ${Math.floor(secs / 60)} min later… <span class="d">the weakened synapses slowly recover</span>`;
        await wait(0.04); if (!alive()) return;
      }
      caption(`${Math.round(secs / 60)} minutes later, the toxic smell reads <b>${valenceLabel(valA())}</b> again.`, 5);
      await wait(5.5); if (!alive()) return;
      const n2 = await meetToxic(alive, 8); if (n2 == null) return;
      caption(n2 > 0 ? 'It walks straight back in. <em>Forgotten.</em>' : 'It still avoids it.', 6);
      await wait(6.5); if (!alive()) return;
      await finish(alive, spend());
    },
  },

  recall: {
    name: 'Memory without recall', sub: 'block the output neurons',
    async run() {
      const alive = begin();
      caption('Teach it that the toxic smell hurts.', 4);
      await wait(4.5); if (!alive()) return;
      if (!await firstContact(alive)) return;
      caption('Pain → <em>PPL1 dopamine</em> → the synapses onto <em>MBON11</em> weaken.', 5);
      await wait(5.5); if (!alive()) return;
      // block the approach MBONs for the test; the test is unreinforced, as in the lab
      mb.silenced.add('MBON11'); mb.silenced.add('MBON12');
      mb.lesion.punishment = true; lesionNote.punishment = 'test trial · no dopamine (unreinforced)';
      showManip();
      caption('Now block the output of <em>MBON11</em> and <em>MBON12</em>. <span class="d">The synapses keep the memory.</span>', 6);
      await wait(6.5); if (!alive()) return;
      const n1 = await meetToxic(alive, 8); if (n1 == null) return;
      caption(n1 > 0 ? 'It walks right in. <span class="d">It cannot read its own memory.</span>' : 'It avoided it even with the output blocked.', 5);
      await wait(5.5); if (!alive()) return;
      mb.silenced.clear(); mb.lesion.punishment = false; lesionNote.punishment = 'PPL1 silenced · no dopamine';
      showManip();
      caption('Unblock them.', 3);
      await wait(3.5); if (!alive()) return;
      const n2 = await meetToxic(alive, 8); if (n2 == null) return;
      caption(n2 === 0 ? 'It steers around it. <em>The memory was there all along.</em>' : 'It touched it again.', 6);
      await wait(6.5); if (!alive()) return;
      await finish(alive, spend());
    },
  },
};

function runExperiment(key) {
  setMenu(false);
  lesionNote.punishment = 'PPL1 silenced · no dopamine';
  document.querySelectorAll('#exp-menu [data-exp]').forEach((b) => b.classList.toggle('on', b.dataset.exp === key));
  EXPERIMENTS[key]?.run();
}
function setMenu(open) {
  $('#exp-menu').classList.toggle('open', open);
  $('[data-cmd=experiments]').classList.toggle('on', open);
}

let demoRun = 0;
async function demo() {
  const alive = begin();
  const b = world.body;

  step('naive');
  caption('A robot fly with a real fly’s brain. It walks forward, forever.', 4.5);
  await wait(5); if (!alive()) return;

  caption('Toxic waste on the road. <span class="d">It has never smelled this before.</span>', 5);
  for (let i = 0; i < 3 && painCount === 0; i++) {
    world.drop('toxic', inPath(), b.z + 2.3);
    await waitUntil(() => painCount > 0, 10); if (!alive()) return;
  }
  step('contact');
  caption('Pain → <em>PPL1 dopamine</em> → the synapses for that smell weaken. A memory, in real wiring.', 6);
  await wait(6.5); if (!alive()) return;

  caption('Honey. <span class="d">Another new smell. Curious, it goes to taste it.</span>', 5);
  for (let i = 0; i < 3 && !feeding; i++) {
    world.drop('honey', inPath(), b.z + 2.2);
    await waitUntil(() => feeding, 10); if (!alive()) return;
  }
  if (feeding) caption('Sugar → <span class="h">PAM dopamine</span>. Now that smell means food.', 5);
  await waitUntil(() => !feeding, 8); if (!alive()) return;
  await wait(1.5); if (!alive()) return;

  step('learned');
  caption('Same toxic smell. This time it never touches it.', 6);
  world.drop('toxic', b.x, b.z + 2.5);
  await wait(7); if (!alive()) return;
  caption('<em>Jev</em> only reads the mushroom-body output. Nobody told it what toxic means.', 5.5);
  await wait(3); if (!alive()) return;

  world.drop('honey', b.x > 0 ? -0.34 : 0.34, b.z + 2.6);
  caption('Honey off to the side. <span class="d">Does it remember?</span>', 5);
  await waitUntil(() => feeding, 11); if (!alive()) return;
  if (feeding) caption('It goes out of its way for honey. <em>Learned.</em>', 4.5);
  await waitUntil(() => !feeding, 8); if (!alive()) return;
  await wait(1); if (!alive()) return;

  step('blocked');
  caption('Now block the whole road. <span class="d">It has never used its boosters.</span>', 5);
  world.drop('barrier', 0, b.z + 2.6);
  await waitUntil(() => !!b.flight, 60); if (!alive()) return;
  caption('Walking into it hurt. Veering got nowhere. The frustrated pathways weakened, and the giant fiber won.', 5);
  await waitUntil(() => !b.flight, 6); if (!alive()) return;
  await wait(1.2); if (!alive()) return;
  caption('Its <em>LC4 / LPLC2 → DNp01</em> pathway just got stronger. That is the memory.', 4.5);
  await wait(3.5); if (!alive()) return;
  caption('Block it again.', 3);
  world.drop('barrier', 0, b.z + 2.8);
  const t0 = clock;
  await waitUntil(() => !!b.flight, 20); if (!alive()) return;
  caption(`No trial and error this time: boosters after ${(clock - t0).toFixed(1)} s. <em>Learned.</em>`, 5);
  await waitUntil(() => !b.flight, 6); if (!alive()) return;
  await wait(2.5); if (!alive()) return;
  caption(`${jev.count} decisions · ~${jev.avgLatency} ms each · <em>$${jev.cost.toFixed(4)}</em>`, 0);
}

const commands = {
  play: () => setPaused(!paused),
  demo: () => runExperiment('demo'),
  experiments: () => setMenu(!$('#exp-menu').classList.contains('open')),
  brain: () => { pop.pinned = !$('#brain-pop').classList.contains('open'); if (pop.pinned) brain.setView('cns'); setPop(pop.pinned); pop.until = 0; },
  reset,
};
document.querySelectorAll('#dock [data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));
document.querySelectorAll('#dock [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#exp-menu').innerHTML = Object.entries(EXPERIMENTS).map(([k, e]) => `<button data-exp="${k}"><b>${e.name}</b><span>${e.sub}</span></button>`).join('');
document.querySelectorAll('#exp-menu [data-exp]').forEach((b) => b.addEventListener('click', () => runExperiment(b.dataset.exp)));
$('#pop-close').addEventListener('click', () => { pop.pinned = false; pop.until = 0; setPop(false); });

$('#world').addEventListener('pointerdown', (e) => {
  if (!tool || !circuits) return;
  const p = world.pick(e.clientX, e.clientY);
  if (!p) return;
  world.drop(tool, p.x, p.z);
  if (paused) setPaused(false);
});

addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); runExperiment('demo'); }
  else if (e.key === 'e' || e.key === 'E') commands.experiments();
  else if (e.key === 'p' || e.key === 'P') setPaused(!paused);
  else if (e.key === 'b' || e.key === 'B') commands.brain();
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('rec');
  else if (e.key === '1') setTool('honey');
  else if (e.key === '2') setTool('toxic');
  else if (e.key === '3') setTool('barrier');
  else if (e.key === 'Escape') { tool = 'x'; setTool('x'); setMenu(false); }
});

// The learned pathway that has changed most from its starting strength.
const PATH_NAME = { walk_forward: 'walk', veer_left: 'veer L', veer_right: 'veer R', walk_backward: 'back', takeoff: 'boosters' };
function showPathway() {
  if (!vm) return;
  // a strengthened pathway (something learned to work) outranks weakened ones (frustration)
  let best = null;
  for (const a of vm.actions) {
    const base = a === 'takeoff' ? 0.5 : 1, ratio = vm.pathGain(a) / base;
    const score = ratio > 1.1 ? 10 + ratio : Math.abs(Math.log(ratio));
    if (!best || score > best.score) best = { a, ratio, score };
  }
  const mt = $('#motor-txt');
  if (!best || Math.abs(Math.log(best.ratio)) < 0.12) { mt.textContent = 'innate'; mt.classList.remove('learned'); return; }
  mt.textContent = `${vm.topTypes(best.a).join('/')} → ${PATH_NAME[best.a]} ×${best.ratio.toFixed(1)}`;
  mt.classList.toggle('learned', best.ratio > 1);
}

// ------------------------------------------------------------------ compound eye card
function buildEyeBins() {
  const box = $('#eye-bins');
  for (let i = 0; i < DIR_BINS; i++) box.appendChild(Object.assign(document.createElement('b'), { title: 'LC/LPLC activity' }));
}

// Unwrapped panorama: every dot is one real eye column at its viewing direction
// (x = azimuth, left eye on the left; y = elevation), shaded by what it sees.
function drawEye() {
  const cv = $('#eye-canvas');
  if (!cv || !eye) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const X = (az) => w / 2 - (az / 170) * (w / 2 - 6), Y = (el) => h / 2 - ((el - 5) / 70) * (h / 2 - 6);
  const r = Math.max(1.4, w / 150);
  for (let i = 0; i < eye.N; i++) {
    const L = eye.lum[i], v = Math.round(40 + 200 * L);
    g.fillStyle = eye.act[i] > 0.45 ? '#E55B2B' : `rgb(${v},${v},${v - 4})`;
    g.beginPath(); g.arc(X(eye.az[i]), Y(eye.el[i]), r, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([2, 3]);
  g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w / 2, h - 4); g.stroke(); g.setLineDash([]);
  const levels = eye.readout().levels;
  [...$('#eye-bins').children].forEach((b, i) => { b.style.height = `${4 + levels[i] * 3.2}px`; b.classList.toggle('hot', levels[i] >= 5); });
}

// ------------------------------------------------------------------ loop
let last = performance.now(), hud = 0, lastFrameAt = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; lastFrameAt = performance.now();
  if (!paused) {
    clock += dt;
    flushWaiters();
    world.update(dt);
    const s = world.sense();
    const conc = { A: (s.antennae.A.left + s.antennae.A.right) / 2, B: (s.antennae.B.left + s.antennae.B.right) / 2 };
    const eating = s.onSugar && world.body.program === 'feed';
    onFeedingChange(eating);
    const toxicPain = world.toxicPain > 0.3 ? world.toxicPain : 0;
    mb.step(dt, conc, { punishment: toxicPain, reward: eating ? 1 : 0 });

    // vision: real eye columns → real synapses → LC/LPLC neurons (20 Hz)
    eyeClock += dt;
    if (eyeClock >= 0.05) { eye.update(eyeClock, world); eyeClock = 0; }
    const colIdx = [], colLvl = [];
    for (let i = 0; i < eye.N; i++) {
      const a = eye.act[i];
      if (a < 0.12) continue;
      for (const k of eye.light[i]) { colIdx.push(k); colLvl.push(Math.min(1.2, a * 1.3)); }
    }
    if (colIdx.length) brain.holdEach(colIdx, colLvl, BCOL.vision, 1, 0.1);
    brain.holdEach(eye.targets.idx, eye.rate, BCOL.vision, 1.4);
    vm.update(dt, eye.rate, world.body.program, { pain: world.pain, stalled: world.body.program === 'feed' || world.body.onHoney ? 0 : world.stalled, z: world.body.z });
    const lm = eye.loom();
    if (Math.max(lm.L, lm.R) > 0.3 && clock - lastLoomSpike > 1.5) {
      lastLoomSpike = clock;
      const L = circuits.looming || {};
      brain.flash([...(L.lplc2_idx || []), ...(L.lc4_idx || [])], BCOL.dn, 1.2, 1.6);
      (L.paths || []).slice(0, 4).forEach((p, i) => brain.firePath(p, 1.3, i * 0.06));
      log(`<b>LPLC2 / LC4</b> looming ${lm.L > lm.R ? 'left' : 'right'} eye → DNp01 pathway`);
    }

    const c = circuits;
    for (const o of ['A', 'B']) {
      const col = o === 'A' ? BCOL.odorA : BCOL.odorB;
      brain.hold(c.odors[o].pn_idx, col, conc[o] * 1.2);
      brain.hold(c.odors[o].kc_idx, col, conc[o]);
    }
    const out = mb.output(conc);
    for (const m of c.mbons) if (out[m.type] > 0.01 && !mb.silenced.has(m.type)) brain.hold(m.idx, BCOL.approach, 0.35 + out[m.type]);
    for (const d of c.dans) {
      const lvl = mb.lesion[d.signal] ? 0 : d.signal === 'punishment' ? 1.3 * toxicPain : eating ? 1.3 : 0;
      brain.hold(d.idx, d.signal === 'punishment' ? BCOL.ppl1 : BCOL.pam, lvl);
    }
    brain.updateFan(mb, conc);
    brain.update(dt);

    if (!pop.pinned && pop.until && clock > pop.until) { pop.until = 0; setPop(false); }

    hud -= dt;
    if (hud <= 0) {
      hud = 0.15;
      showValence('A'); showValence('B');
      $('#st-dist').textContent = Math.max(0, Math.round(world.body.z / 0.16));
      $('#st-pain').textContent = `${Math.round(Math.max(world.pain, world.lanePain) * 100)}%`;
      $('#st-reward').textContent = `${Math.round(world.reward * 100)}%`;
      showPathway();
      $('#st-fed').textContent = `${Math.round(world.body.fed * 100)}%`;
      drawEye();
    }
  }
  world.render();
  brain.render();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
(async () => {
  circuits = await brain.load('data/');
  mb = new MushroomBody(circuits);
  $('#neuron-count').textContent = brain.N.toLocaleString();
  const [vj, wbuf] = await Promise.all([fetch('data/vision.json').then((r) => r.json()), fetch('data/vision_w.bin').then((r) => r.arrayBuffer())]);
  eye = new Eye(vj, wbuf);
  vm = new Visuomotor(vj);
  vm.onEvent = (e) => {
    const types = vm.topTypes(e.action).join(' / ');
    log(`<span class="a">pathway</span> ${types} → <b>${e.action}</b> strengthened ×${(e.after / e.before).toFixed(1)} (broke through)`);
  };
  $('#eye-n').textContent = `${eye.N.toLocaleString()} columns · ${eye.T.toLocaleString()} LC/LPLC`;
  buildEyeBins();
  jev = new JevDriver({ getSense: () => (performance.now() - lastFrameAt < 600 ? { ...world.sense(), vision: eye.readout(), visuomotor: vm.readout() } : null), mb, onDecision, onStatus: setStatus });
  world.update(1 / 60);
  setPaused(true);
  $('#loader').classList.add('gone');
  eye.update(0.05, world); drawEye();
  window.fj = { world, brain, mb, jev, eye, get vm() { return vm; }, get pain() { return painCount; }, get feeding() { return feeding; }, get paused() { return paused; }, pause: () => setPaused(true) };
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) runExperiment('demo');
  else if (EXPERIMENTS[q.get('exp')]) runExperiment(q.get('exp'));
  requestAnimationFrame((t) => { last = t; frame(t); });
})().catch((err) => { $('#loader .ld').textContent = `failed to load: ${err.message}`; console.error(err); });
