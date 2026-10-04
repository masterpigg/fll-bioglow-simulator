import { FW, FH, HOME_R, LINES, MISSIONS, TOKEN_PTS, missionPoints, totalScore, DOCKS, DEFAULT_DOCKS, AUTO_KEYS, MECHANISMS, APPROACH, DEFAULT_APPROACH } from './field.js';
import { PORTS, PAIRS, DEMO, flatToAst, emptyProgram } from './blocks.js';
import { programToJson, jsonToProgram } from './blocks-json.js';
import { createWorkspace, registerNames, foldingToolbox } from './workspace.js';
import { Sim, normalizeConfig, LOOSE_DEFAULTS, inside, calibrateWheel, calibrateTrack, calibrateTop } from './sim.js';
import { drawRobot } from './robot-view.js';
import { photoSampler } from './mat-photo.js';
import { importProject, exportLlsp3 } from './spike-io.js';
import { parseRepo, listProjects, fetchProject } from './github.js';
import { shareUrl, decodeShare, codeFromHash, LONG_LINK, robotUrl, robotCodeFromHash, decodeRobot } from './share.js';

const SWATCH = { black: '#111111', violet: '#7A4FD6', white: '#F5F5F0', red: '#D9342B', blue: '#1E6FD9', green: '#2F8F4E', yellow: '#E8C21E', none: '#5B7066', magenta: '#C2329E', azure: '#3FA9F5' };
const demoProgram = () => DEMO();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- state (program, robot and score survive a reload) ----------

const STORE = 'bioglow-sim-v2';
function load() {
  try {
    const v2 = JSON.parse(localStorage.getItem(STORE));
    if (v2) return v2;
    // Carry over settings (and the program) saved by the previous version.
    const v1 = JSON.parse(localStorage.getItem('bioglow-sim-v1'));
    if (v1) { delete v1.ws; if (Array.isArray(v1.program)) v1.program = flatToAst(v1.program); return v1; }
  } catch { /* storage unavailable or unreadable */ }
  return {};
}
const saved = load();
const state = {
  tab: 'code',
  program: saved.program && saved.program.stacks ? saved.program : demoProgram(),
  sounds: saved.sounds || {}, soundOn: saved.soundOn ?? true,
  ws: saved.ws || null,
  cfg: normalizeConfig(saved.cfg), sel: 'color',
  start: Object.assign({ x: 240, y: 240, h: 0 }, saved.start),
  pieces: Array.isArray(saved.pieces) ? saved.pieces : structuredClone(LOOSE_DEFAULTS),
  score: saved.score || {}, tokens: saved.tokens ?? 6, inspection: !!saved.inspection,
  grid: saved.grid ?? true, scale: 1,
  autoScore: saved.autoScore ?? true, docks: Object.assign({}, DEFAULT_DOCKS, saved.docks), hints: saved.hints ?? true,
  approach: Object.assign({}, DEFAULT_APPROACH, saved.approach), showSides: !!saved.showSides,
  mat: saved.mat === 'plain' ? 'plain' : 'photo'
};
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      program: state.program, ws: state.ws, sounds: state.sounds, soundOn: state.soundOn, cfg: state.cfg, start: state.start, pieces: state.pieces,
      score: state.score, tokens: state.tokens, inspection: state.inspection, grid: state.grid, autoScore: state.autoScore, docks: state.docks, hints: state.hints, approach: state.approach, showSides: state.showSides, mat: state.mat
    }));
  } catch { /* storage unavailable: keep working without it */ }
}

const sim = new Sim(state.cfg, state.start, state.pieces);
sim.cfg = state.cfg; // share the object so Robot tab edits apply immediately
sim.docks = state.docks; sim.approach = state.approach; sim.reset();
sim.onLog = () => renderLog();

// ---------- hub: light matrix, center light, buttons, variables, sound ----------

const matrixCells = [];
for (let i = 0; i < 25; i++) { const c = document.createElement('span'); $('r-matrix').appendChild(c); matrixCells.push(c); }
let lastVars = '';
function drawHub() {
  sim.matrix.forEach((b, i) => { matrixCells[i].style.background = b > 0 ? `rgba(255, 244, 214, ${0.25 + 0.75 * b / 100})` : '#2C2C2C'; });
  $('r-center').style.background = SWATCH[sim.centerLight] || '#F5F5F0';
  const lines = Object.entries(sim.vars).map(([k, v]) => `${k} = ${typeof v === 'number' ? +v.toFixed(3) : v}`)
    .concat(Object.entries(sim.lists).map(([k, l]) => `${k}: [${l.slice(0, 20).join(', ')}${l.length > 20 ? ', …' : ''}]`));
  const text = lines.join('\n');
  if (text !== lastVars) { lastVars = text; $('r-vars').textContent = text; $('r-vars-card').hidden = !text; }
}
for (const side of ['left', 'right']) {
  const b = $('hub-' + side);
  const set = (down) => { sim.setButton(side, down); b.classList.toggle('down', down); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => set(false));
  b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } });
  b.addEventListener('keyup', () => set(false));
}

// Beeps play as tones. Sounds from SPIKE's library play a short stand-in chirp for their length.
let audio = null, beepVoice = null;
const voices = new Set();
function audioCtx() { if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); } return audio; }
function tone(freq, seconds, volume, type) {
  const a = audioCtx(); if (!a || !state.soundOn) return null;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq; g.gain.value = 0.08 * volume / 100;
  o.connect(g).connect(a.destination); o.start();
  if (seconds) o.stop(a.currentTime + seconds / state.scale);
  voices.add(o); o.onended = () => voices.delete(o);
  return o;
}
sim.onSound = (e) => {
  if (e.type === 'stop') { for (const o of voices) { try { o.stop(); } catch { /* already stopped */ } } voices.clear(); beepVoice = null; return; }
  if (e.type === 'beep') {
    if (beepVoice) { try { beepVoice.stop(); } catch { /* already stopped */ } }
    beepVoice = tone(440 * Math.pow(2, (e.note - 69) / 12), e.seconds, e.volume, 'square');
  } else if (e.type === 'sound') {
    const secs = Math.min(e.seconds, 1.5), o = tone(500, secs, e.volume, 'triangle');
    if (o) o.frequency.exponentialRampToValueAtTime(1200, audioCtx().currentTime + secs / state.scale);
  }
};
function renderSoundToggle() {
  $('sound').setAttribute('aria-pressed', String(state.soundOn));
  $('sound').setAttribute('aria-label', state.soundOn ? 'Sound on' : 'Sound off');
}
$('sound').onclick = () => { state.soundOn = !state.soundOn; if (!state.soundOn) sim.onSound({ type: 'stop' }); renderSoundToggle(); save(); };
renderSoundToggle();
sim.log('Ready. Press Run to try the program.');

// ---------- field (SVG in millimetres; y flipped so +y points away from home) ----------

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const Y = (y) => FH - y;
const field = $('field');
const refs = {};

function buildField() {
  field.innerHTML = '';
  // Two looks: the official mat photo (cropped to the play area), or plain green with the home areas and lines drawn.
  refs.photo = svgEl('image', { href: 'assets/mat.jpg', x: 0, y: 0, width: FW, height: FH, preserveAspectRatio: 'none' }, field);
  refs.plain = svgEl('g', {}, field);
  svgEl('rect', { x: 0, y: 0, width: FW, height: FH, fill: '#2D5A3B' }, refs.plain);
  svgEl('path', { d: `M0 ${FH} L0 ${FH - HOME_R} A${HOME_R} ${HOME_R} 0 0 1 ${HOME_R} ${FH} Z`, fill: '#F3F1EA', stroke: '#D9342B', 'stroke-width': 8 }, refs.plain);
  svgEl('path', { d: `M${FW} ${FH} L${FW} ${FH - HOME_R} A${HOME_R} ${HOME_R} 0 0 0 ${FW - HOME_R} ${FH} Z`, fill: '#F3F1EA', stroke: '#1E6FD9', 'stroke-width': 8 }, refs.plain);
  refs.grid = svgEl('g', { 'pointer-events': 'none' }, field);
  for (let x = 200; x < FW; x += 200) svgEl('line', { x1: x, y1: 0, x2: x, y2: FH, stroke: 'rgba(255,255,255,.18)', 'stroke-width': 2 }, refs.grid);
  for (let y = 200; y < FH; y += 200) svgEl('line', { x1: 0, y1: Y(y), x2: FW, y2: Y(y), stroke: 'rgba(255,255,255,.18)', 'stroke-width': 2 }, refs.grid);
  'ABCDEFGHIJ'.split('').forEach((c, i) => { const t = svgEl('text', { x: i * 200 + 100, y: FH - 14, 'text-anchor': 'middle', class: 'gl' }, refs.grid); t.textContent = c; });
  for (let r = 1; r <= 6; r++) { const t = svgEl('text', { x: 18, y: Y(r === 6 ? 1071 : r * 200 - 100) + 8, 'text-anchor': 'middle', class: 'gl' }, refs.grid); t.textContent = r; }
  for (const L of LINES) svgEl('polyline', { points: L.map(([x, y]) => `${x},${Y(y)}`).join(' '), fill: 'none', stroke: '#0A0A0A', 'stroke-width': 20, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, refs.plain);
  setMat(state.mat);
  refs.objs = svgEl('g', {}, field); refs.objEls = [];
  refs.hints = svgEl('g', { 'pointer-events': 'none' }, field); refs.hintKey = '';
  refs.trail = svgEl('polyline', { fill: 'none', stroke: '#8FE3B0', 'stroke-width': 6, 'stroke-opacity': .7, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round', 'pointer-events': 'none' }, field);
  refs.seen = svgEl('g', { 'pointer-events': 'none' }, field); refs.seenPaths = {};
  refs.beam = svgEl('line',{ stroke: 'rgba(143,227,176,.6)', 'stroke-width': 4, 'pointer-events': 'none' }, field);
  refs.robot = svgEl('g', { 'pointer-events': 'none' }, field);
  const style = svgEl('style', {}, field);
  style.textContent = '.gl{font:600 26px "JetBrains Mono",monospace;fill:rgba(255,255,255,.55)} .model-l{font:700 28px "JetBrains Mono",monospace;fill:#3B2F1E} .dock-l{font:700 32px "JetBrains Mono",monospace;fill:#FFE3A6} .dock-s{font:700 20px "JetBrains Mono",monospace;fill:#FFFFFF} .piece{cursor:grab;touch-action:none} .piece-l{font:700 28px "JetBrains Mono",monospace;fill:#2A1747} .dial-l{font:700 22px "JetBrains Mono",monospace;fill:#1A1A1A} .arm-l{font:700 20px "JetBrains Mono",monospace;fill:#fff} .hint-l{font:700 22px "JetBrains Mono",monospace}';
}

// Mission models, docks and loose pieces come from the simulation, since they can move.
function drawObject(o) {
  const g = svgEl('g', {});
  if (o.dock) {
    // Dark plate with a bright double outline so docks stand out on the busy mat photo.
    svgEl('rect', { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h, rx: 10, fill: 'rgba(16,12,6,.72)', stroke: '#1A1208', 'stroke-width': 12 }, g);
    svgEl('rect', { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h, rx: 10, fill: 'none', stroke: '#FFD27A', 'stroke-width': 5, 'stroke-dasharray': '16 8' }, g);
    g.label = svgEl('g', {}, g);
    const big = svgEl('text', { 'text-anchor': 'middle', y: 4, class: 'dock-l' }, g.label); big.textContent = o.holds;
    const small = svgEl('text', { 'text-anchor': 'middle', y: 28, class: 'dock-s' }, g.label); small.textContent = o.key;
    svgEl('title', {}, g).textContent = `${o.holds} on the ${o.name}`;
    return g;
  }
  const shape = o.round ? svgEl('ellipse', { rx: o.w / 2, ry: o.h / 2 }, g) : svgEl('rect', { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h, rx: 6 }, g);
  // Mission state: done (green), disturbed (red), lifted off the mat (dashed outline).
  shape.setAttribute('fill', o.loose ? (o.seed ? '#E2B07A' : '#C9A3FF') : o.done ? '#9BE3B8' : o.hurt ? '#F2A6A0' : o.lifted ? 'none' : '#E9DDBF');
  shape.setAttribute('stroke', o.loose ? '#2A1747' : o.done ? '#1E7A45' : o.hurt ? '#9B2C24' : '#3B2F1E'); shape.setAttribute('stroke-width', 4);
  if (o.lifted) shape.setAttribute('stroke-dasharray', '8 6');
  if (o.loose) g.setAttribute('class', 'piece');
  svgEl('title', {}, g).textContent = o.name + (o.loose ? ' (drag to move)' : '');
  if (o.n) { g.label = svgEl('text', { 'text-anchor': 'middle', y: 9, class: o.loose ? 'piece-l' : 'model-l' }, g); g.label.textContent = o.n; }
  return g;
}

function syncObjects() {
  const objs = sim.objects;
  const look = (o) => (o.done ? 1 : 0) + (o.hurt ? 2 : 0) + (o.lifted ? 4 : 0);
  if (refs.objEls.length !== objs.length || refs.objEls.some((g, i) => g.obj !== objs[i] || g.look !== look(objs[i]))) {
    refs.objs.innerHTML = '';
    refs.objEls = objs.map(o => { const g = drawObject(o); g.obj = o; g.look = look(o); refs.objs.appendChild(g); return g; });
  }
  for (const g of refs.objEls) {
    const o = g.obj;
    g.setAttribute('transform', `translate(${o.x.toFixed(1)} ${Y(o.y).toFixed(1)}) rotate(${o.r.toFixed(1)})`);
    if (g.label) g.label.setAttribute('transform', `rotate(${(-o.r).toFixed(1)})`);
  }
}

function drawField() {
  const p = sim.pose, s = sim.sens;
  syncObjects();
  syncMission();
  drawHints();
  refs.robot.setAttribute('transform', `translate(${p.x} ${Y(p.y)}) rotate(${p.h})`);
  drawRobot(refs.robot, state.cfg, sim.arms, { stroke: sim.hit ? '#F2A6A0' : sim.running ? '#8FE3B0' : '#1A1A1A', colorFill: SWATCH[s.color] || '#5B7066' });
  refs.trail.setAttribute('points', sim.trail.map(([x, y]) => `${x.toFixed(0)},${Y(y).toFixed(0)}`).join(' '));
  // Dots where the color sensor saw something other than plain mat (one path per color).
  const byColor = {};
  for (const [x, y, c] of sim.seen) (byColor[c] = byColor[c] || []).push(`M${x.toFixed(0)} ${Y(y).toFixed(0)}h0`);
  for (const c of new Set(Object.keys(byColor).concat(Object.keys(refs.seenPaths)))) {
    if (!refs.seenPaths[c]) refs.seenPaths[c] = svgEl('path', { fill: 'none', stroke: SWATCH[c] || '#999', 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-opacity': .9 }, refs.seen);
    refs.seenPaths[c].setAttribute('d', (byColor[c] || []).join(''));
  }
  const a = s.dirAng * Math.PI / 180, o = s.origin;
  refs.beam.setAttribute('x1', o[0]); refs.beam.setAttribute('y1', Y(o[1]));
  refs.beam.setAttribute('x2', o[0] + Math.sin(a) * s.rayLen); refs.beam.setAttribute('y2', Y(o[1] + Math.cos(a) * s.rayLen));
  refs.grid.style.display = state.grid ? '' : 'none';

  $('r-cport').textContent = state.cfg.colorPort; $('r-dport').textContent = state.cfg.distPort;
  $('r-swatch').style.background = SWATCH[s.color] || '#5B7066'; $('r-color').textContent = s.color;
  $('r-dist').textContent = s.dist === null ? 'none (over 200 cm)' : s.dist.toFixed(1) + ' cm';
  $('r-yaw').textContent = Math.round(s.yaw) + '°';
  $('r-arms').textContent = Math.round(sim.arms.E) + '° · ' + Math.round(sim.arms.F) + '°';
  $('r-display').textContent = sim.display || '—';
  drawHub();
  $('pos').textContent = `Or click the mat. Now at x ${(p.x / 10).toFixed(1)} cm, y ${(p.y / 10).toFixed(1)} cm, heading ${Math.round(((p.h % 360) + 360) % 360)}°`;
  const left = 150 - sim.matchT;
  $('clock').textContent = sim.clockText();
  $('clock').classList.toggle('low', sim.matchOn && left <= 15);
  $('match').classList.toggle('on', sim.matchOn);
  $('match-label').textContent = sim.matchOn ? 'End match' : 'Start 2:30 match';
  // Light up the block that is running.
  const lit = new Set(sim.activeIds());
  if (ws && [...lit].join() !== [...lastLit].join()) {
    for (const id of lastLit) { const b = !lit.has(id) && ws.getBlockById(id); if (b) b.getSvgRoot().classList.remove('sim-running'); }
    for (const id of lit) { const b = ws.getBlockById(id); if (b) b.getSvgRoot().classList.add('sim-running'); }
    lastLit = lit;
  }
}

// ---------- what to do on each model ----------

const HOW = {
  push: ['PUSH', 'Drive the robot into it, or swing a sweep arm into it.'],
  press: ['PRESS', 'Bring a lift arm down on top of it.'],
  lift: ['LIFT', 'Get a lift arm low, right against it (or under it), then raise the arm.'],
  pull: ['HOOK & PULL', 'Raise a lift arm, drive up, lower the arm onto it (behind the handle), then drive backwards.'],
  touch: ['DON’T TOUCH', 'Leave it alone: it scores only if nothing touches it.']
};
const missionIds = (o) => o.dock ? [o.holds] : ((o.n || (o.name.match(/^M(\d+)/) || [])[1] || '')).split(' ').filter(Boolean).map(n => n.startsWith('M') ? n : 'M' + n);

// The simulated actions on a model or dock: [{ label, tip, done, bad }].
function actionsOf(o) {
  if (o.loose) return o.id === 'keystone' ? [{ label: 'TO DOCK 13', tip: 'Push the keystone species into the M13 dock.', done: sim.mission.m13 }] : [];
  const acts = [];
  MECHANISMS.forEach((m, i) => {
    if (o.dock ? m.dock !== o.holds : m.model !== o.key) return;
    const [label, tip] = m.bad ? ['DON’T BUMP', 'Only an arm coming down from above should touch it. Driving or sweeping into it costs points.'] : HOW[m.how];
    const harm = m.how === 'touch' || m.bad;
    acts.push({ label: m.hold ? `HOLD ${m.hold} S` : m.again ? label + ' AGAIN' : label,
      tip: m.hold ? `Keep pushing for ${m.hold} second${m.hold > 1 ? 's' : ''}.` : m.again ? 'Back off, then do it again.' : tip,
      result: m.says.replace(/^M\d+: /, ''), done: !harm && sim.mechDone.has(i), bad: harm && sim.mechDone.has(i) });
  });
  if (o.dock && o.holds === 'M13') acts.push({ label: 'BRING K', tip: 'Push the keystone species (K) into this dock.', done: sim.mission.m13 });
  if (o.dock && o.holds === 'M14') acts.push({ label: 'BRING SEEDS' + (sim.mission.m14a ? ' ×' + sim.mission.m14a : ''), tip: 'Push seeds into this dock. M02 drops seeds when you push it.', done: sim.mission.m14a > 0 });
  return acts;
}

// A tag above each model saying how to score it; green when done, red when disturbed.
function drawHints() {
  const show = state.hints;
  const objs = show ? sim.objects.filter(o => actionsOf(o).length) : [];
  const key = show + '|' + state.showSides + JSON.stringify(state.approach) + '|' + objs.map(o => [o.key || o.id, Math.round(o.x), Math.round(o.y), actionsOf(o).map(a => a.label + a.done + a.bad)].join()).join(';');
  if (key === refs.hintKey) return;
  refs.hintKey = key; refs.hints.textContent = '';
  const placed = [];
  for (const o of objs) {
    const acts = actionsOf(o);
    const text = acts.map(a => (a.done ? '✓ ' : a.bad ? '✗ ' : '') + a.label).join(' · ');
    const bad = acts.some(a => a.bad), done = !bad && acts.every(a => a.done);
    const w = text.length * 13.2 + 20, h = 34;
    const reach = Math.hypot(o.w, o.h) / 2 + 24;
    const below = o.y + reach + h > FH;
    const cx = Math.max(w / 2 + 4, Math.min(FW - w / 2 - 4, o.x));
    let cy = Y(below ? o.y - reach : o.y + reach);
    // Step away from tags already placed (neighbouring models), in the same direction.
    const hits = (y) => placed.some(q => Math.abs(q.x - cx) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < h + 4);
    for (let n = 0; n < 6 && hits(cy); n++) cy += below ? h + 6 : -(h + 6);
    placed.push({ x: cx, y: cy, w });
    const g = svgEl('g', { transform: `translate(${cx.toFixed(0)} ${cy.toFixed(0)})` }, refs.hints);
    svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 17, fill: bad ? '#9B2C24' : done ? '#1E7A45' : '#3B2F1E', stroke: bad ? '#F2A6A0' : done ? '#8FE3B0' : '#F2C48A', 'stroke-width': 3, opacity: .95 }, g);
    const t = svgEl('text', { y: 8, 'text-anchor': 'middle', class: 'hint-l', fill: bad ? '#FFE3E0' : done ? '#E6FFF0' : '#F2C48A' }, g);
    t.textContent = text;
  }
  if (state.showSides) for (const o of sim.objects) {
    const side = APPROACH[state.approach[modelKey(o)]];
    if (!side || o.loose) continue;
    // An arrow outside the model, on the side the robot comes from, pointing at it.
    const reach = Math.hypot(o.w, o.h) / 2 + 20;
    const tip = [o.x - side[0] * reach, o.y - side[1] * reach];
    const ang = Math.atan2(-side[1], side[0]) * 180 / Math.PI;
    const g = svgEl('g', { transform: `translate(${tip[0].toFixed(0)} ${Y(tip[1]).toFixed(0)}) rotate(${ang.toFixed(0)})` }, refs.hints);
    svgEl('line', { x1: -90, y1: 0, x2: -22, y2: 0, stroke: '#8FE3B0', 'stroke-width': 12, 'stroke-linecap': 'round' }, g);
    svgEl('path', { d: 'M0 0 L-34 -22 L-34 22 Z', fill: '#8FE3B0', stroke: '#0C1411', 'stroke-width': 3 }, g);
  }
}

const modelKey = (o) => o.dock ? 'dock:' + o.holds : o.key;
const SIDE_NAMES = { any: 'Any side', south: 'From the south (home wall)', north: 'From the north (back wall)', west: 'From the west (red side)', east: 'From the east (blue side)' };

// Mission details for a tapped model or dock.
function showMissionCard(o) {
  const card = $('mission-card');
  const ids = missionIds(o);
  const ms = MISSIONS.filter(m => ids.includes(m.id));
  const acts = actionsOf(o);
  const dock = o.dock ? DOCKS.find(d => d.key === o.key) : null;
  card.innerHTML = `
    <div class="mc-head"><strong>${esc(dock ? dock.name[0].toUpperCase() + dock.name.slice(1) + ' — holds ' + o.holds : o.name)}</strong>
      <button type="button" class="btn small" data-close aria-label="Close">✕</button></div>
    ${acts.map(a => `<div class="mc-do">${a.done ? '✓ ' : a.bad ? '✗ ' : ''}<b>${esc(a.label)}</b>: ${esc(a.tip)}${a.result ? ' <span class="muted">→ ' + esc(a.result) + '</span>' : ''}</div>`).join('')
      || '<div class="mc-do">The simulator doesn’t model this one yet: score it yourself on the Score tab.</div>'}
    ${ms.map(m => `<div><span class="mid">${m.id}</span><b>${esc(m.name)}</b> · ${missionPoints(m, state.score)} pts now<ul>${m.items.map(it => `<li class="${state.score[it.k] ? 'done' : ''}">${esc(it.label)} — ${it.zero ? '×0' : it.count ? it.pts + ' each' : it.pts}</li>`).join('')}</ul></div>`).join('')}
    ${dock ? '<div class="fine">Change which model sits here on the Field tab.</div>' : ''}
    ${MECHANISMS.some(m => m.how === 'push' && !m.bad && (m.model || 'dock:' + m.dock) === modelKey(o)) ? `<details><summary>Coach: which side must the robot push from?</summary>
      <div class="fine">Set this from the real model. A push from any other side does nothing (the log only says “touched, but nothing happened”). Kids only see the direction if “Show approach directions” is on. Saved on this device and included in share links.</div>
      <div class="seg" data-approach="${esc(modelKey(o))}">${Object.entries(SIDE_NAMES).map(([k, label]) => `<button type="button" data-side="${k}" aria-pressed="${(state.approach[modelKey(o)] || 'any') === k}">${esc(label)}</button>`).join('')}</div>
    </details>` : ''}
    <div class="fine">Simplified: the real model has levers and hinges; the simulator only checks how the robot touches it.</div>`;
  card.hidden = false;
}
$('mission-card').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { $('mission-card').hidden = true; return; }
  const b = e.target.closest('[data-approach] [data-side]'); if (!b) return;
  const key = b.parentElement.dataset.approach;
  if (b.dataset.side === 'any') delete state.approach[key]; else state.approach[key] = b.dataset.side;
  b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  save(); drawField();
});

// ---------- missions 13-15 docks ----------

const DOCK_MODELS = ['M13', 'M14', 'M15'];
const missionName = (id) => (MISSIONS.find(m => m.id === id) || {}).name || id;

// Each model sits on one dock: choosing a model swaps it with the dock that had it.
function setDock(dockKey, model) {
  const other = Object.keys(state.docks).find(k => state.docks[k] === model);
  if (other) state.docks[other] = state.docks[dockKey];
  state.docks[dockKey] = model;
  if (!sim.running) { sim.reset(); drawField(); }
  save(); renderDocks(); renderScore();
}

function renderDocks() {
  $('dock-selects').innerHTML = DOCKS.map(d => `<label>${esc(d.name[0].toUpperCase() + d.name.slice(1))}
    <select data-dock="${d.key}">${DOCK_MODELS.map(m => `<option value="${m}"${state.docks[d.key] === m ? ' selected' : ''}>${m} ${esc(missionName(m))}</option>`).join('')}</select></label>`).join('');
  $('hints').checked = state.hints; $('sides').checked = state.showSides; $('grid').checked = state.grid;
}
$('dock-selects').addEventListener('change', (e) => { if (e.target.dataset.dock) setDock(e.target.dataset.dock, e.target.value); });
$('hints').onchange = (e) => { state.hints = e.target.checked; save(); drawField(); };
$('sides').onchange = (e) => { state.showSides = e.target.checked; save(); drawField(); };
$('grid').onchange = (e) => { state.grid = e.target.checked; save(); drawField(); };

// With the photo shown, the color sensor reads the photo under it. Its pixels load once in the
// background; until then (or if the browser won't share them) it sees the plain mat's colors.
let photoSample = null;
const matImg = new Image();
matImg.onload = () => {
  try {
    const w = matImg.naturalWidth, h = matImg.naturalHeight, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(matImg, 0, 0);
    photoSample = photoSampler(g.getImageData(0, 0, w, h).data, w, h, FW, FH);
  } catch (e) { return; }
  setMat(state.mat); drawField();
};
matImg.src = 'assets/mat.jpg';

function setMat(look) {
  state.mat = look;
  sim.matPhoto = look === 'photo' ? photoSample : null;
  sim.sens = sim.readSensors(sim.pose);
  refs.photo.style.display = look === 'photo' ? '' : 'none';
  refs.plain.style.display = look === 'photo' ? 'none' : '';
  document.querySelectorAll('#mat-style button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mat === look)));
}
$('mat-style').addEventListener('click', (e) => { const b = e.target.closest('[data-mat]'); if (b) { setMat(b.dataset.mat); save(); drawField(); } });

function renderLog() { $('log').innerHTML = sim.logLines.map(l => `<div>${esc(l)}</div>`).join(''); }

function renderStart() {
  $('sx').value = +(state.start.x / 10).toFixed(1); $('sy').value = +(state.start.y / 10).toFixed(1); $('sh').value = state.start.h;
  const left = state.start.x < FW / 2;
  document.querySelectorAll('#side button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.side === 'left') === left)));
}

function setStart(patch) {
  Object.assign(state.start, patch); sim.start = state.start; save(); renderStart();
  if (!sim.running) { sim.placeRobot(); drawField(); }
}

// Mirror the start position onto the other half of the table (same spot in the other home).
const normDeg = (d) => { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
$('side').addEventListener('click', (e) => {
  const b = e.target.closest('[data-side]'); if (!b || sim.running) return;
  const left = state.start.x < FW / 2;
  if ((b.dataset.side === 'left') !== left) setStart({ x: FW - state.start.x, h: normDeg(-state.start.h) });
});

// ---------- code tab (drag-and-drop blocks) ----------

let ws = null, toolbox = null, lastLit = new Set(), loadingWs = false;

// Show a program in the block editor (after an import, the demo, or Clear).
function showProgram(program) {
  if (!ws) { state.program = program; save(); return; }
  registerNames(program);
  loadingWs = true;
  try { window.Blockly.serialization.workspaces.load(programToJson(program), ws); } finally { loadingWs = false; }
  syncProgram();
}

// Statements in the program (stacks and My Blocks), for the status line.
function countBlocks(prog) {
  const count = (list) => list.reduce((n, s) => n + 1 + count(s.body || []) + count(s.else || []), 0);
  return prog.stacks.reduce((n, st) => n + count(st), 0) + Object.values(prog.procs).reduce((n, p) => n + count(p.body), 0);
}

// Read the program back out of the editor whenever the kids change it.
function syncProgram() {
  const json = window.Blockly.serialization.workspaces.save(ws);
  const res = jsonToProgram(json);
  res.program.sounds = state.sounds; // sound lengths from the last imported file
  state.program = res.program; state.ws = json;
  const n = countBlocks(res.program);
  $('code-status').textContent = `${n} block${n === 1 ? '' : 's'}` + (res.warn.length ? ' · ' + res.warn[0] : '');
  save();
}

function initCode() {
  $('tab-code').innerHTML = `
    <div class="code-head">
      <span class="muted" id="code-status"></span>
      <div class="row"><button type="button" class="ghost" data-act="demo">Demo</button><button type="button" class="ghost" data-act="clear">Clear</button></div>
    </div>
    <div class="blockly-wrap"><div id="blockly"></div><button type="button" class="blocks-toggle" id="blocks-toggle" aria-expanded="false">+ Blocks</button></div>
    <div class="fine">Drag blocks out of the menu and snap them under “when program starts”. Drag a block back to the menu to delete it.</div>`;
  try { ws = createWorkspace($('blockly')); }
  catch (err) { $('blockly').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  let loaded = false;
  if (state.ws) {
    try { registerNames(state.program); loadingWs = true; window.Blockly.serialization.workspaces.load(state.ws, ws); loaded = true; }
    catch { /* saved layout from an older version: rebuild from the program */ }
    finally { loadingWs = false; }
  }
  if (loaded) syncProgram(); else showProgram(state.program);
  ws.addChangeListener((e) => { if (!e.isUiEvent && !loadingWs) syncProgram(); });
  // The editor fills whatever space its box gets (window size, phone layout, screen turned).
  new ResizeObserver(() => window.Blockly.svgResize(ws)).observe($('blockly'));
  toolbox = foldingToolbox(ws, (shown) => {
    $('blocks-toggle').setAttribute('aria-expanded', String(shown));
    $('blocks-toggle').textContent = shown ? 'Done' : '+ Blocks';
  });
  toolbox.setFolding(isPhone());
  $('blocks-toggle').onclick = () => toolbox.toggle();
}

$('tab-code').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  if (btn.dataset.act === 'demo') { showProgram(demoProgram()); setStart({ x: 240, y: 240, h: 0 }); }
  else if (btn.dataset.act === 'clear') showProgram(emptyProgram());
});

// ---------- score tab ----------

// Copy what the simulated models did onto the score sheet.
let lastMission = '';
function syncMission() {
  if (!state.autoScore) return;
  const now = JSON.stringify(AUTO_KEYS.map(k => sim.mission[k]));
  if (now === lastMission) return;
  lastMission = now;
  for (const k of AUTO_KEYS) state.score[k] = sim.mission[k] ?? false;
  save(); renderScore();
}

function renderScore() {
  const sc = state.score;
  const total = totalScore(sc, state.tokens, state.inspection);
  $('total-tab').textContent = total;
  $('tab-score').innerHTML = `
    <div class="score-total"><div><div class="section-h">Match score</div><div class="fine">${state.autoScore ? 'Items marked “sim” fill in from the simulation; tick the rest yourself.' : 'Tick what your robot actually achieved.'}</div></div><div class="big">${total}</div></div>
    <label class="line"><input type="checkbox" data-auto${state.autoScore ? ' checked' : ''}><span class="grow">Fill in from the simulation (simplified: a push or press on the right model completes it)</span></label>
    <div class="line docks"><span class="grow">Docks for missions 13–15</span>${DOCKS.map(d => `<label>${d.key}<select data-dock="${d.key}">${['M13', 'M14', 'M15'].map(m => `<option${state.docks[d.key] === m ? ' selected' : ''}>${m}</option>`).join('')}</select></label>`).join('')}</div>
    <label class="line"><input type="checkbox" data-insp${state.inspection ? ' checked' : ''}><span class="grow">Equipment inspection: everything fits in one launch area, under 305 mm</span><span class="mono">20</span></label>
    <div class="line"><span class="grow">Precision tokens left (lose one per interruption outside home)</span>
      <button type="button" class="step" data-tok="-1" aria-label="Remove a precision token">−</button><span class="mono">${state.tokens}</span>
      <button type="button" class="step" data-tok="1" aria-label="Add a precision token">+</button><span class="mono">${TOKEN_PTS[state.tokens]}</span></div>
    ${MISSIONS.map(m => `<div class="mission">
      <div class="mission-h"><span class="mid">${m.id}</span><strong class="grow">${esc(m.name)}</strong>${m.noEquip ? '<span class="tag">not touching equipment</span>' : ''}<span class="mono">${missionPoints(m, sc)}</span></div>
      ${m.items.map(it => `<div class="mitem">${state.autoScore && AUTO_KEYS.includes(it.k) ? '<span class="tag sim">sim</span>' : ''}${it.count
        ? `<span class="grow">${esc(it.label)}</span><button type="button" class="step" data-cnt="${it.k}" data-d="-1" aria-label="Fewer">−</button><span class="mono">${sc[it.k] || 0}</span><button type="button" class="step" data-cnt="${it.k}" data-d="1" aria-label="More">+</button>`
        : `<label><input type="checkbox" data-chk="${it.k}" data-group="${it.group || ''}"${sc[it.k] ? ' checked' : ''}><span>${esc(it.label)}</span></label>`
      }<span class="pts">${it.zero ? '×0' : it.count ? it.pts + ' ea' : it.pts}</span></div>`).join('')}
    </div>`).join('')}
    <button type="button" class="btn" data-clear-score>Clear score sheet</button>
    <div class="fine">Point values from the 2026–27 BioGlow Robot Game Rulebook. Check the official Challenge Updates for changes. Gracious Professionalism® points are scored separately.</div>`;
}
$('tab-score').addEventListener('change', (e) => {
  const t = e.target;
  if (t.hasAttribute('data-insp')) state.inspection = t.checked;
  else if (t.hasAttribute('data-auto')) { state.autoScore = t.checked; lastMission = ''; syncMission(); }
  else if (t.dataset.dock) { setDock(t.dataset.dock, t.value); return; }
  else if (t.dataset.chk) {
    if (t.checked && t.dataset.group) for (const m of MISSIONS) for (const it of m.items) if (it.group === t.dataset.group) state.score[it.k] = false;
    state.score[t.dataset.chk] = t.checked;
  }
  save(); renderScore();
});
$('tab-score').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.tok) state.tokens = Math.max(0, Math.min(6, state.tokens + +t.dataset.tok));
  else if (t.dataset.cnt) state.score[t.dataset.cnt] = Math.max(0, Math.min(20, (state.score[t.dataset.cnt] || 0) + +t.dataset.d));
  else if (t.hasAttribute('data-clear-score')) { state.score = {}; state.inspection = false; state.tokens = 6; }
  else return;
  save(); renderScore();
});

// ---------- robot tab ----------

// Robot parts are placed on a LEGO grid: 1 stud = 8 mm, snapping to half studs.
const STUD = 8, SNAP = 4, REACH = 260;
const studs = (mm) => +(mm / STUD).toFixed(1);
const FACES = ['front', 'right', 'back', 'left'];
const WHEELS = [[56, '56 mm (SPIKE Prime wheel)'], [88, '88 mm (large wheel)'], [62.4, '62.4 mm'], [43.2, '43.2 mm'], ['custom', 'Other size…']];
const NUM_FIELDS = [['track', 'Wheel spacing (mm)'], ['robotW', 'Robot width (mm)'], ['robotL', 'Robot length (mm)'], ['axleBack', 'Wheels from back edge (mm)'], ['top', 'Top wheel speed (°/s)'], ['ramp', 'Speed-up time (s)']];
const opt = (opts, cur, label = (o) => o) => opts.map(o => `<option value="${o}"${String(o) === String(cur) ? ' selected' : ''}>${esc(label(o))}</option>`).join('');

function renderRobot() {
  const c = state.cfg;
  const preset = WHEELS.some(([d]) => d === c.wheel) ? c.wheel : 'custom';
  $('tab-robot').innerHTML = `
    <div class="section-h">Robot layout</div>
    <div class="fine">Drag the wheels, color sensor (circle), distance sensor (eyes) and arms (orange, blue pivot). Tap a part to change it. Each grid square is 1 LEGO stud (8 mm).</div>
    <svg id="robot-editor" viewBox="${-REACH} ${-REACH} ${REACH * 2} ${REACH * 2}" role="img" aria-label="Top view of the robot. Drag parts to place them."></svg>
    <div class="row"><button type="button" class="btn small" data-add-arm>Add arm</button><button type="button" class="btn small" data-share-robot>Share this robot</button><button type="button" class="btn small red" data-reset-robot>Reset robot</button><span class="muted" id="ed-pos"></span></div>
    <div id="part-props" class="props"></div>

    <div class="section-h">Drive base</div>
    <div class="form-grid">
      <label>Wheels<select data-wheel>${opt(WHEELS.map(w => w[0]), preset, (v) => WHEELS.find(w => w[0] === v)[1])}</select></label>
      <label>Wheel diameter (mm)<input type="number" step="any" data-cfgnum="wheel" value="${c.wheel}"></label>
      ${NUM_FIELDS.map(([k, label]) => `<label>${label}<input type="number" step="any" data-cfgnum="${k}" value="${c[k]}"></label>`).join('')}
      <label>Drive motors (left, right)<select data-cfg="pair">${opt(PAIRS, c.pair)}</select></label>
      <label>Force sensor port (front bumper)<select data-cfg="forcePort">${opt(['none'].concat(PORTS), c.forcePort)}</select></label>
    </div>

    <details class="calib">
      <summary>Calibrate from the real robot</summary>
      <div class="fine">Run each test program on the real robot on the mat, measure, and press Apply. The simulator then uses what your robot really does.</div>
      <div class="calib-step">
        <strong>1 · Distance</strong>
        <div class="fine">Program: <code>move forward for <input type="number" data-cal="n1" value="5" aria-label="Rotations"> rotations</code></div>
        <label>Distance it moved (cm)<input type="number" step="any" data-cal="d1" placeholder="e.g. 87"></label>
        <button type="button" class="btn small" data-apply="1">Apply</button><span class="muted" data-out="1"></span>
      </div>
      <div class="calib-step">
        <strong>2 · Turning</strong>
        <div class="fine">Program: <code>move clockwise for <input type="number" data-cal="n2" value="2" aria-label="Rotations"> rotations</code>, then read the yaw angle (or measure the turn).</div>
        <label>How far it turned (degrees)<input type="number" step="any" data-cal="d2" placeholder="e.g. 355"></label>
        <button type="button" class="btn small" data-apply="2">Apply</button><span class="muted" data-out="2"></span>
      </div>
      <div class="calib-step">
        <strong>3 · Speed</strong>
        <div class="fine">Program: <code>set movement speed to <input type="number" data-cal="p3" value="50" aria-label="Speed percent"> %</code>, then <code>move forward for <input type="number" data-cal="t3" value="2" aria-label="Seconds"> seconds</code></div>
        <label>Distance it moved (cm)<input type="number" step="any" data-cal="d3" placeholder="e.g. 52"></label>
        <button type="button" class="btn small" data-apply="3">Apply</button><span class="muted" data-out="3"></span>
      </div>
    </details>

    <label class="check"><input type="checkbox" data-cfgbool="yawCW"${c.yawCW ? ' checked' : ''}>Yaw angle increases when turning clockwise</label>
    <label class="check"><input type="checkbox" data-cfgbool="collide"${c.collide ? ' checked' : ''}>Models and pieces are solid (off: drive through everything)</label>
    <label class="check"><input type="checkbox" data-cfgbool="shove"${c.shove ? ' checked' : ''}>Robot can shove fixed mission models (just for fun; real ones are held down)</label>
    <div class="fine">Importing a SPIKE file sets the drive motors and sensor ports from its blocks. Arms push loose pieces and stop when they press on a model or the mat. Model positions are traced from the wireframe and are approximate.</div>`;
  renderEditor(); renderProps();
}

// Work out wheel size, wheel spacing or top speed from a real test run.
function calibrate(step) {
  const v = (k) => parseFloat($('tab-robot').querySelector(`[data-cal="${k}"]`).value);
  const c = state.cfg, out = $('tab-robot').querySelector(`[data-out="${step}"]`);
  if (step === 1) {
    const n = v('n1'), d = v('d1');
    if (!(n > 0 && d > 0)) { out.textContent = 'Enter the rotations and the distance.'; return; }
    c.wheel = Math.round(calibrateWheel(n, d) * 10) / 10;
    out.textContent = `Wheel works like ${c.wheel} mm across.`;
  } else if (step === 2) {
    const n = v('n2'), deg = v('d2');
    if (!(n > 0 && deg > 0)) { out.textContent = 'Enter the rotations and the angle.'; return; }
    c.track = Math.round(calibrateTrack(n, deg, c.wheel) * 10) / 10;
    out.textContent = `Wheels act ${c.track} mm apart.`;
  } else {
    const pct = v('p3'), t = v('t3'), d = v('d3');
    if (!(pct > 0 && t > 0 && d > 0)) { out.textContent = 'Enter the speed, time and distance.'; return; }
    c.top = Math.round(calibrateTop(pct, t, d, c.wheel, c.ramp || 0));
    out.textContent = `Top wheel speed ${c.top} °/s.`;
  }
  save(); sim.sens = sim.readSensors(sim.pose); drawField(); renderEditor();
  for (const k of ['wheel', 'track', 'top']) { const i = $('tab-robot').querySelector(`[data-cfgnum="${k}"]`); if (i) i.value = c[k]; }
}

function renderEditor() {
  const svg = $('robot-editor'); if (!svg) return;
  svg.textContent = '';
  const NS = 'http://www.w3.org/2000/svg';
  const grid = document.createElementNS(NS, 'g'); svg.appendChild(grid);
  for (let i = -Math.floor(REACH / STUD); i <= Math.floor(REACH / STUD); i++) {
    const v = i * STUD, major = i % 5 === 0;
    for (const [x1, y1, x2, y2] of [[v, -REACH, v, REACH], [-REACH, v, REACH, v]]) {
      const l = document.createElementNS(NS, 'line');
      Object.entries({ x1, y1, x2, y2, stroke: major ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.05)', 'stroke-width': major ? 1.5 : 1 }).forEach(([k, val]) => l.setAttribute(k, val));
      grid.appendChild(l);
    }
  }
  const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
  drawRobot(g, state.cfg, {}, { editor: true, selected: state.sel });
}

function partOf(sel) {
  if (sel === 'color') return state.cfg.color;
  if (sel === 'dist') return state.cfg.dist;
  if (sel && sel.startsWith('arm:')) return state.cfg.arms.find(a => a.id === sel.slice(4));
  return null;
}

function renderProps() {
  const box = $('part-props'); if (!box) return;
  const c = state.cfg;
  if (state.sel === 'wheel') {
    box.innerHTML = `<div class="props-h">Wheels</div><div class="fine">Drag a wheel sideways to change the wheel spacing, or forward and back to move the axle. Spacing now: ${c.track} mm (${studs(c.track)} studs), wheels ${c.axleBack} mm from the back.</div>`;
    return;
  }
  const part = partOf(state.sel);
  if (!part) { box.innerHTML = '<div class="fine">Tap a part to edit it.</div>'; return; }
  const xy = `<label>Right of axle middle (studs)<input type="number" step="0.5" data-pp="x" value="${studs(part.x)}"></label>
              <label>Ahead of axle (studs)<input type="number" step="0.5" data-pp="y" value="${studs(part.y)}"></label>`;
  if (state.sel === 'color') {
    box.innerHTML = `<div class="props-h">Color sensor</div><div class="form-grid">
      <label>Port<select data-cfg="colorPort">${opt(PORTS, c.colorPort)}</select></label>${xy}</div>`;
  } else if (state.sel === 'dist') {
    box.innerHTML = `<div class="props-h">Distance sensor</div><div class="form-grid">
      <label>Port<select data-cfg="distPort">${opt(PORTS, c.distPort)}</select></label>
      <label>Faces<select data-pp="dir">${opt(FACES, part.dir)}</select></label>${xy}</div>`;
  } else {
    const lift = part.motion !== 'sweep';
    box.innerHTML = `<div class="props-h">Arm on motor ${esc(part.port)}</div><div class="form-grid">
      <label>Motor port<select data-pp="port">${opt(PORTS, part.port)}</select></label>
      <label>Movement<select data-pp="motion">${opt(['lift', 'sweep'], part.motion, o => o === 'lift' ? 'Lift / press (up and down)' : 'Sweep (side to side, flat)')}</select></label>
      <label>Points<select data-pp="dir">${opt(FACES, part.dir)}</select></label>
      <label>Length (studs)<input type="number" step="0.5" data-pp="len" value="${studs(part.len)}"></label>
      ${lift
        ? `<label>Starts<select data-pp="rest">${opt(['up', 'down'], part.rest)}</select></label>
           <label>Motor clockwise<select data-pp="cw">${opt(['lowers', 'raises'], part.cw)}</select></label>`
        : `<label>Motor clockwise swings<select data-pp="cw">${opt(['right', 'left'], part.cw)}</select></label>`}
      <label>Gear ratio (arm ° per motor °)<input type="number" step="any" data-pp="ratio" value="${part.ratio}"></label>
      ${xy}</div>
      <button type="button" class="btn small red" data-remove-arm>Remove this arm</button>`;
  }
}

function robotChanged() { save(); sim.sens = sim.readSensors(sim.pose); drawField(); renderEditor(); }

$('tab-robot').addEventListener('change', (e) => {
  const t = e.target, part = partOf(state.sel);
  if (t.dataset.cal) return;
  if (t.hasAttribute('data-wheel')) {
    if (t.value !== 'custom') { state.cfg.wheel = Number(t.value); const i = $('tab-robot').querySelector('[data-cfgnum="wheel"]'); if (i) i.value = state.cfg.wheel; }
  }
  else if (t.dataset.cfgnum) { const k = t.dataset.cfgnum, v = parseFloat(t.value); if (isFinite(v) && (v > 0 || (k === 'ramp' && v === 0))) state.cfg[k] = v; }
  else if (t.dataset.cfg) state.cfg[t.dataset.cfg] = t.value;
  else if (t.dataset.cfgbool) state.cfg[t.dataset.cfgbool] = t.checked;
  else if (t.dataset.pp && part) {
    const k = t.dataset.pp;
    if (['x', 'y', 'len'].includes(k)) {
      const v = parseFloat(t.value) * STUD;
      if (isFinite(v) && (k !== 'len' || v > 0)) part[k] = k === 'len' ? v : Math.max(-REACH + 10, Math.min(REACH - 10, v));
    } else if (k === 'ratio') { const v = parseFloat(t.value); if (v > 0) part.ratio = v; }
    else {
      part[k] = t.value;
      if (k === 'motion') part.cw = t.value === 'sweep' ? 'right' : 'lowers';
      renderProps();
    }
  }
  robotChanged();
});

$('tab-robot').addEventListener('click', (e) => {
  const apply = e.target.closest('[data-apply]');
  if (apply) { calibrate(Number(apply.dataset.apply)); return; }
  if (e.target.closest('[data-share-robot]')) { shareRobot(); return; }
  if (e.target.closest('[data-reset-robot]')) {
    if (!confirm('Reset the robot to the starting design? This replaces the wheels, sizes, sensors, arms and ports. To keep this one, tap “Share this robot” first and save the link.')) return;
    sim.stop();
    for (const k of Object.keys(state.cfg)) delete state.cfg[k];
    Object.assign(state.cfg, normalizeConfig({}));
    state.sel = 'color'; save(); sim.reset(); renderRobot(); drawField();
    showMsg('Robot reset to the starting design.');
    return;
  }
  if (e.target.closest('[data-add-arm]')) {
    const used = new Set(state.cfg.arms.map(a => a.port).concat(state.cfg.pair.split(''), [state.cfg.colorPort, state.cfg.distPort]));
    const port = ['E', 'F', 'D', 'C', 'B', 'A'].find(p => !used.has(p)) || 'F';
    const arm = { id: 'a' + Date.now().toString(36), port, motion: 'lift', x: 0, y: state.cfg.robotL - state.cfg.axleBack, dir: 'front', len: 88, rest: 'up', cw: 'lowers', ratio: 1 };
    state.cfg.arms.push(arm); state.sel = 'arm:' + arm.id; renderProps(); robotChanged();
  } else if (e.target.closest('[data-remove-arm]')) {
    state.cfg.arms = state.cfg.arms.filter(a => 'arm:' + a.id !== state.sel); state.sel = 'color'; renderProps(); robotChanged();
  }
});

// Dragging parts in the editor (mouse, pen or touch).
let edDrag = null;
const edPoint = (e) => {
  const svg = $('robot-editor'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: loc.x, y: -loc.y };
};
const snapMm = (v) => Math.max(-REACH + 10, Math.min(REACH - 10, Math.round(v / SNAP) * SNAP));
$('tab-robot').addEventListener('pointerdown', (e) => {
  const hit = e.target.closest('#robot-editor [data-part]'); if (!hit) return;
  const p = edPoint(e);
  if (hit.dataset.part.startsWith('wheel')) {
    state.sel = 'wheel';
    edDrag = { wheel: true, lastY: snapMm(p.y) };
  } else {
    state.sel = hit.dataset.part; const part = partOf(state.sel); if (!part) return;
    edDrag = { part, dx: part.x - p.x, dy: part.y - p.y };
  }
  try { $('robot-editor').setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
  e.preventDefault(); renderEditor(); renderProps();
});
$('tab-robot').addEventListener('pointermove', (e) => {
  if (!edDrag) return;
  const p = edPoint(e), c = state.cfg;
  if (edDrag.wheel) {
    // Sideways: wheel spacing. Forward/back: move the axle, keeping every other part where it is on the body.
    c.track = Math.max(40, Math.min(400, Math.round(Math.abs(p.x) * 2 / STUD) * STUD));
    const y = snapMm(p.y), dy = y - edDrag.lastY;
    if (dy && c.axleBack + dy >= 0 && c.axleBack + dy <= c.robotL) {
      c.axleBack += dy; edDrag.lastY = y;
      for (const part of [c.color, c.dist, ...c.arms]) part.y -= dy;
    }
    $('ed-pos').textContent = `wheels ${studs(c.track)} studs apart, ${studs(c.axleBack)} studs from the back`;
  } else {
    edDrag.part.x = snapMm(p.x + edDrag.dx); edDrag.part.y = snapMm(p.y + edDrag.dy);
    $('ed-pos').textContent = `${studs(edDrag.part.x)} studs right, ${studs(edDrag.part.y)} studs ahead of the axle`;
  }
  renderEditor(); drawField();
});
const edEnd = () => { if (!edDrag) return; edDrag = null; renderProps(); robotChanged(); };
$('tab-robot').addEventListener('pointerup', edEnd);
$('tab-robot').addEventListener('pointercancel', edEnd);

// ---------- tabs, toolbar, start position ----------

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  state.tab = b.dataset.tab;
  document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === state.tab)));
  for (const t of ['code', 'score', 'robot', 'field']) $('tab-' + t).hidden = t !== state.tab;
  if (state.tab === 'code' && ws) window.Blockly.svgResize(ws);
});

// ---------- phone: one view at a time ----------
// The code (left) and the table (right) sit side by side, one screen wide each. Swipe sideways
// anywhere except on the block editor, the mat and the robot drawing (they use drags themselves),
// or tap Code / Table.

const isPhone = () => document.documentElement.classList.contains('phone');
const appEl = document.querySelector('.app'), views = [document.querySelector('.panel'), document.querySelector('.field-col')];
let view = 0;
function setView(v) {
  view = v;
  appEl.style.setProperty('--view', v);
  document.querySelectorAll('.views [data-view]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.view === v)));
  views.forEach((el, i) => { el.inert = isPhone() && i !== v; });
}
function layoutChanged() {
  // The footer note goes at the end of the table view on a phone, under the page otherwise.
  const foot = document.querySelector('.foot');
  if (isPhone()) views[1].append(foot); else document.body.insertBefore(foot, document.querySelector('body > script'));
  setView(view);
  if (toolbox) toolbox.setFolding(isPhone());
}
window.addEventListener('phonechange', layoutChanged);
layoutChanged();
document.querySelector('.views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(+b.dataset.view); });

let swipe = null;
const NO_SWIPE = '#blockly, #field, #robot-editor, input, select, textarea, dialog, .blocklyWidgetDiv, .blocklyDropDownDiv';
document.addEventListener('pointerdown', (e) => {
  swipe = null;
  if (!isPhone() || !e.isPrimary || e.pointerType === 'mouse' || e.target.closest(NO_SWIPE)) return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, on: false, dx: 0 };
});
document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // scrolling
    if (Math.abs(dx) < 12 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    swipe.on = true; appEl.classList.add('dragging');
  }
  // Follow the finger; past either end it only gives a little.
  swipe.dx = (view === 0 && dx > 0) || (view === 1 && dx < 0) ? dx / 4 : dx;
  appEl.style.setProperty('--drag', swipe.dx + 'px');
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe; swipe = null;
  if (!s.on) return;
  appEl.classList.remove('dragging');
  appEl.style.setProperty('--drag', '0px');
  if (e.type === 'pointercancel') return;
  const fast = Math.abs(s.dx) / Math.max(1, e.timeStamp - s.t) > 0.4;
  if ((s.dx < -innerWidth / 4 || (fast && s.dx < -30)) && view === 0) setView(1);
  else if ((s.dx > innerWidth / 4 || (fast && s.dx > 30)) && view === 1) setView(0);
  // A swipe that started on a button is not a tap on it.
  addEventListener('click', swallowClick, true);
  setTimeout(() => removeEventListener('click', swallowClick, true), 400);
}
function swallowClick(e) { e.stopPropagation(); e.preventDefault(); removeEventListener('click', swallowClick, true); }
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);

// Read the blocks right before running/exporting, so the newest edits always count.
const latestProgram = () => { if (ws) syncProgram(); return state.program; };
$('run').onclick = () => { const a = audioCtx(); if (a && a.state === 'suspended') a.resume(); sim.run(latestProgram()); drawField(); };
$('stop').onclick = () => { if (sim.stop()) { state.tokens = Math.max(0, state.tokens - 1); save(); renderScore(); } drawField(); };
$('reset').onclick = () => { sim.reset(); sim.log('Robot back at the start position.'); drawField(); };
$('match').onclick = () => {
  if (sim.matchOn) sim.endMatch();
  else { sim.startMatch(); state.tokens = 6; save(); renderScore(); }
  renderLog(); drawField();
};
$('scales').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scale]'); if (!b) return;
  state.scale = +b.dataset.scale;
  document.querySelectorAll('#scales button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('sx').onchange = (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setStart({ x: Math.max(0, Math.min(FW, v * 10)) }); };
$('sy').onchange = (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setStart({ y: Math.max(0, Math.min(FH, v * 10)) }); };
$('sh').onchange = (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setStart({ h: v }); };
const toMm = (e) => { const r = field.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * FW, (1 - (e.clientY - r.top) / r.height) * FH]; };

// Drag loose pieces (any time the robot isn't running); tap a model for its mission; a plain click places the robot.
let drag = null, dragged = false, tapped = null;
field.addEventListener('pointerdown', (e) => {
  const pt = toMm(e);
  tapped = sim.objects.slice().reverse().find(o => !o.loose && inside(pt, o)) || null;
  if (sim.running) return;
  const o = sim.objects.slice().reverse().find(o => o.loose && inside(pt, o));
  if (!o) return;
  tapped = null;
  drag = { o, dx: o.x - pt[0], dy: o.y - pt[1] }; dragged = true; // a tap on a piece never moves the robot
  try { field.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  e.preventDefault();
});
field.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const pt = toMm(e); const o = drag.o;
  o.x = Math.max(o.w / 2, Math.min(FW - o.w / 2, pt[0] + drag.dx));
  o.y = Math.max(o.h / 2, Math.min(FH - o.h / 2, pt[1] + drag.dy));
  const lp = state.pieces.find(p => p.id === o.id); if (lp) { lp.x = Math.round(o.x); lp.y = Math.round(o.y); lp.r = Math.round(o.r); }
  dragged = true; drawField();
});
const endDrag = () => { if (!drag) return; drag = null; save(); sim.sens = sim.readSensors(sim.pose); drawField(); };
field.addEventListener('pointerup', endDrag);
field.addEventListener('pointercancel', endDrag);
field.addEventListener('click', (e) => {
  if (dragged) { dragged = false; return; }
  if (tapped) { showMissionCard(tapped); tapped = null; return; }
  if (sim.running) return;
  const [x, y] = toMm(e);
  setStart({ x: Math.round(x), y: Math.round(y) });
});

$('add-piece').onclick = () => {
  const k = state.pieces.length;
  const p = { id: 'p' + Date.now().toString(36), n: String(k), name: 'Loose piece ' + k, x: 820 + (k % 5) * 80, y: 900, w: 50, h: 50, r: 0 };
  state.pieces.push(p); sim.objects.push(Object.assign({}, p, { loose: true })); save(); drawField();
};
$('reset-pieces').onclick = () => {
  state.pieces = structuredClone(LOOSE_DEFAULTS); sim.pieces = state.pieces;
  if (!sim.running) sim.resetObjects();
  save(); drawField();
};

// ---------- import / export ----------

function showMsg(text, link) {
  const m = $('msg'); m.hidden = false; m.textContent = text;
  if (link) m.appendChild(link);
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
  try { await openProject(await file.arrayBuffer(), file.name); }
  catch (err) { showMsg(`Could not import “${file.name}”: ${err.message}`); }
});

// Load a SPIKE project file into the editor and set up the robot's ports from it.
async function openProject(buf, name) {
  try {
    const res = await importProject(buf);
    Object.assign(state.cfg, res.cfg);
    state.sounds = res.program.sounds || {};
    showProgram(res.program);
    const setup = [];
    if (res.cfg.pair) setup.push('drive motors ' + res.cfg.pair.split('').join(' + '));
    if (res.cfg.colorPort) setup.push('color sensor on ' + res.cfg.colorPort);
    if (res.cfg.distPort) setup.push('distance sensor on ' + res.cfg.distPort);
    if (res.cfg.forcePort) setup.push('force sensor on ' + res.cfg.forcePort);
    sim.reset(); renderRobot(); drawField();
    showMsg(`Imported “${name}”: ${countBlocks(res.program)} blocks.` + (setup.length ? ' Robot set to: ' + setup.join(', ') + '.' : '') + (res.warn.length ? '\n' + res.warn.slice(0, 6).join('\n') : ''));
    return true;
  } catch (err) { showMsg(`Could not import “${name}”: ${err.message}`); return false; }
}

// ---------- open from GitHub ----------
// The repo name and token are kept in this browser only (never in saved programs or exports).

const GH_STORE = 'bioglow-sim-github';
const gh = (() => { try { return JSON.parse(localStorage.getItem(GH_STORE)) || {}; } catch { return {}; } })();
let ghFiles = null;
const ghSave = () => { try { localStorage.setItem(GH_STORE, JSON.stringify({ repo: gh.repo || '', token: gh.token || '' })); } catch { /* not remembered */ } };
const ghStatus = (text, bad) => { const s = $('gh-status'); s.textContent = text; s.classList.toggle('bad', !!bad); };

function ghShowSetup() {
  $('gh-setup').hidden = false; $('gh-browse').hidden = true;
  $('gh-repo').value = gh.repo || ''; $('gh-token').value = gh.token || '';
}

async function ghBrowse() {
  const where = parseRepo(gh.repo);
  if (!where) { ghShowSetup(); return; }
  $('gh-setup').hidden = true; $('gh-browse').hidden = false;
  $('gh-where').textContent = `${where.owner}/${where.repo}` + (gh.token ? ' · token' : '');
  $('gh-forget').hidden = !gh.token;
  $('gh-list').textContent = ''; ghStatus('Loading the project list…');
  try {
    const { files, truncated, branch } = await listProjects(where, gh.token, fetch);
    ghFiles = files;
    $('gh-where').textContent = `${where.owner}/${where.repo} @ ${branch}` + (gh.token ? ' · token' : '');
    ghRenderList();
    ghStatus(files.length ? `${files.length} SPIKE project${files.length > 1 ? 's' : ''}. Tap one to open it.` + (truncated ? ' (The repo is very large; some files may be missing.)' : '')
      : 'No .llsp3 files in this repository.');
  } catch (err) { ghStatus(err.message, true); }
}

function ghRenderList() {
  const list = $('gh-list'); list.textContent = '';
  const q = $('gh-filter').value.trim().toLowerCase();
  let folder = null;
  for (const f of ghFiles || []) {
    if (q && !f.path.toLowerCase().includes(q)) continue;
    if (f.folder !== folder) {
      folder = f.folder;
      const h = document.createElement('div'); h.className = 'gh-folder'; h.textContent = (folder || '(top folder)') + '/';
      list.appendChild(h);
    }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'gh-file';
    const n = document.createElement('span'); n.textContent = f.name;
    const sz = document.createElement('span'); sz.className = 'fine'; sz.textContent = Math.max(1, Math.round(f.size / 1024)) + ' KB';
    b.append(n, sz);
    b.onclick = async () => {
      ghStatus(`Opening ${f.name}…`);
      try {
        const buf = await fetchProject(parseRepo(gh.repo), f, gh.token, fetch);
        if (await openProject(buf, f.name)) { $('gh').close(); ghStatus(''); }
        else ghStatus($('msg').textContent, true);
      } catch (err) { ghStatus(err.message, true); }
    };
    list.appendChild(b);
  }
}

$('gh-open').onclick = () => {
  ghStatus('');
  $('gh').showModal();
  if (!gh.repo) ghShowSetup();
  else if (ghFiles) { $('gh-setup').hidden = true; $('gh-browse').hidden = false; ghRenderList(); }
  else ghBrowse();
};
$('gh-close').onclick = () => $('gh').close();
$('gh').addEventListener('click', (e) => { if (e.target === $('gh')) $('gh').close(); }); // tap outside closes
$('gh-setup').onsubmit = (e) => {
  e.preventDefault();
  const where = parseRepo($('gh-repo').value);
  if (!where) { ghStatus('Enter the repository as owner/repo, or paste its github.com link.', true); return; }
  gh.repo = `${where.owner}/${where.repo}`; gh.token = $('gh-token').value.trim();
  ghSave(); ghFiles = null; ghBrowse();
};
$('gh-change').onclick = () => { ghShowSetup(); ghStatus(''); };
$('gh-forget').onclick = () => { gh.token = ''; ghSave(); ghFiles = null; ghShowSetup(); ghStatus('Token removed from this browser.'); };
$('gh-filter').oninput = () => ghRenderList();

let lastUrl = null;
$('export').onclick = () => {
  const { zip, dropped } = exportLlsp3(latestProgram(), 'BioGlow sim export');
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(new Blob([zip], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = lastUrl; a.download = 'bioglow-sim.llsp3'; a.className = 'btn save'; a.textContent = 'Save bioglow-sim.llsp3';
  showMsg('Export ready. Opening it in the SPIKE app is still untested; it re-imports here.' + (dropped ? ` ${dropped} gray (unsupported) block${dropped > 1 ? 's were' : ' was'} left out.` : '') + '\n', a);
  a.click();
};

// ---------- share ----------
// Share link: the program, robot and start position travel inside the link (nothing is uploaded).
// Share file: the .llsp3 through the device's share sheet, where the browser allows that file type.

const SHARE_NAME = 'bioglow-sim.llsp3';
const isCancel = (err) => err && err.name === 'AbortError';

$('share').onclick = async () => {
  const program = latestProgram();
  let url;
  try { url = await shareUrl(location.href, { program, cfg: state.cfg, start: state.start, approach: state.approach }); }
  catch (err) { showMsg('Could not make a share link: ' + err.message); return; }
  const { zip } = exportLlsp3(program, 'BioGlow sim export');
  const file = new File([zip], SHARE_NAME, { type: 'application/octet-stream' });
  // Work this out now: the share sheet has to open straight from the tap.
  const canFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));

  const box = document.createElement('div');
  const row = document.createElement('div'); row.className = 'share-row'; box.appendChild(row);
  const btn = (text, primary, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (primary ? ' save' : ''); b.textContent = text; b.onclick = fn; row.appendChild(b); return b; };
  const shown = document.createElement('a'); shown.className = 'share-link'; shown.href = url; shown.textContent = url;

  btn(navigator.share ? 'Share link' : 'Copy link', true, async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'BioGlow simulator program', text: 'Open this to load my program in the BioGlow simulator:', url });
      else { await navigator.clipboard.writeText(url); showMsg('Link copied. Paste it into an email or message.'); }
    } catch (err) {
      if (isCancel(err)) return;
      try { await navigator.clipboard.writeText(url); showMsg('Sharing didn’t work here, so the link was copied instead. Paste it into an email or message.'); }
      catch { showMsg('Copy this link and paste it into an email or message:', shown); }
    }
  });
  btn(canFile ? 'Share .llsp3 file' : 'Save .llsp3 file', false, async () => {
    if (canFile) {
      try { await navigator.share({ files: [file], title: SHARE_NAME }); return; }
      catch (err) { if (isCancel(err)) return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = SHARE_NAME; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    showMsg(`Saved ${SHARE_NAME} to Downloads.` + (canFile ? '' : ' This browser can’t attach SPIKE files to a share, so attach it from Downloads, or use Share link.'));
  });
  box.appendChild(shown);
  showMsg('Share link: opens this program, robot setup and start position in the simulator on any device. Nothing is uploaded; the program is inside the link.'
    + (url.length > LONG_LINK ? ` This link is long (${url.length} characters), so some apps may cut it off; the file is safer.` : '')
    + (canFile ? '' : '\nThis browser can only save the SPIKE file, not attach it to a share.') + '\n', box);
};

// Robot link: only the robot setup (sizes, wheels, sensors, arms, ports), not the program.
async function shareRobot() {
  let url;
  try { url = await robotUrl(location.href, state.cfg); } catch (err) { showMsg('Could not make a robot link: ' + err.message); return; }
  const shown = document.createElement('a'); shown.className = 'share-link'; shown.href = url; shown.textContent = url;
  try {
    if (navigator.share) { await navigator.share({ title: 'BioGlow simulator robot', text: 'Open this to load our robot in the BioGlow simulator:', url }); return; }
    await navigator.clipboard.writeText(url);
    showMsg('Robot link copied. Opening it loads this robot (not the program) on any device:', shown);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    showMsg('Copy this robot link. Opening it loads this robot (not the program) on any device:', shown);
  }
}

async function openSharedRobot(code) {
  history.replaceState(null, '', location.pathname + location.search);
  let robot;
  try { robot = await decodeRobot(code); } catch (err) { showMsg(err.message); return; }
  if (!confirm('Load the shared robot? It replaces the robot setup on this device. Your program stays.')) return;
  sim.stop();
  Object.assign(state.cfg, normalizeConfig(robot));
  save(); sim.reset(); renderRobot(); drawField();
  showMsg('Loaded a shared robot. Check it on the Robot tab.');
}

// Open a program from a share link (on load, or when a link is pasted into this tab).
async function openShared() {
  const robotCode = robotCodeFromHash(location.hash);
  if (robotCode) { await openSharedRobot(robotCode); return; }
  const code = codeFromHash(location.hash);
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search); // a reload shouldn't reopen it
  let data;
  try { data = await decodeShare(code); } catch (err) { showMsg(err.message); return; }
  if (countBlocks(latestProgram()) > 0 && !confirm('Open the shared program? It replaces the program, robot setup and start position here.')) return;
  sim.stop();
  if (data.cfg) Object.assign(state.cfg, normalizeConfig(data.cfg));
  state.sounds = data.program.sounds || {};
  showProgram(data.program);
  if (data.start) setStart(data.start);
  // Sides set by the sender replace ours; a link with none leaves this device's settings alone.
  if (data.approach && Object.keys(data.approach).length) { for (const k of Object.keys(state.approach)) delete state.approach[k]; Object.assign(state.approach, data.approach); save(); }
  sim.reset(); renderRobot(); drawField();
  showMsg(`Opened a shared program: ${countBlocks(data.program)} blocks.`);
}
window.addEventListener('hashchange', openShared);

// ---------- loop ----------

// Physics runs on a timer (not animation frames) so slow or throttled drawing doesn't slow the robot.
// Up to 0.25 s per tick keeps sim time real-time; longer gaps (a hidden tab) pause it.
let last = performance.now(), dirty = false;
setInterval(() => {
  const now = performance.now(); const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (sim.running || sim.matchOn) {
    const wasMatch = sim.matchOn;
    sim.advance(dt * state.scale); dirty = true;
    if (wasMatch && !sim.matchOn) renderLog();
  }
  if (dirty && now - lastDraw > 250) draw(); // animation frames starved: draw from here
}, 16);
let lastDraw = 0;
function draw() { dirty = false; lastDraw = performance.now(); drawField(); }
function frame() { if (dirty) draw(); requestAnimationFrame(frame); }

buildField(); renderStart(); renderDocks(); initCode(); renderScore(); renderRobot(); renderLog(); drawField();
openShared();
requestAnimationFrame(frame);
// Save the latest blocks when the page is hidden or closed.
document.addEventListener('visibilitychange', () => { if (document.hidden && ws) syncProgram(); });
window.addEventListener('pagehide', () => { if (ws) syncProgram(); });
