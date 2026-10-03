// Robot simulation: a two-wheel SPIKE Prime drive base on the BioGlow mat.
// Heading is in degrees, clockwise from "north" (away from the home wall).

import { FW, FH, HOME_R, MODELS, DOCKS, LINES, MATCH_SECONDS, MECHANISMS, APPROACH, APPROACH_TOLERANCE, DEFAULT_APPROACH, DEFAULT_DOCKS } from './field.js';

// Robot-local coordinates: origin at the middle of the wheel axle, x to the right, y forward (mm).
export const DEFAULT_CONFIG = {
  wheel: 56,        // wheel diameter, mm
  track: 112,       // distance between wheels, mm
  top: 1000,        // wheel speed at 100 %, degrees per second
  ramp: 0,          // seconds for the wheels to reach full speed (0 = instant)
  robotW: 160, robotL: 200,
  axleBack: 100,    // distance from the back edge of the body to the wheel axle, mm
  pair: 'AB', colorPort: 'C', distPort: 'D', forcePort: 'none',
  color: { x: 0, y: 70 },                 // color sensor, looking down
  dist: { x: 0, y: 100, dir: 'front' },   // distance sensor and the way it faces
  // Arms: 'sweep' turns flat over the mat; 'lift' tilts up and down (0° = flat on the mat, 90° = straight up).
  arms: [{ id: 'a1', port: 'E', motion: 'lift', x: 0, y: 100, dir: 'front', len: 90, rest: 'up', cw: 'lowers', ratio: 1 }],
  yawCW: true,      // yaw grows when turning clockwise
  collide: true,    // models and pieces are solid (off = drive through everything)
  shove: false      // the robot can push fixed mission models too (not like the real field)
};

export const DIR_ANGLE = { front: 0, right: 90, back: 180, left: -90 };
const ARM_WIDTH = 16;      // mm, for collisions
const HOOK = 12;           // mm: how close a lift arm must be to a model to hook it when rising
const PULL_MAX = 80;       // mm a hooked arm drags a model before it slips off
const LIFT_SOLID = 30;     // a lift arm tilted at most this far up is low enough to hit things

// Fill in defaults and convert settings saved by older versions.
export function normalizeConfig(saved) {
  const cfg = Object.assign(structuredClone(DEFAULT_CONFIG), saved || {});
  if (saved && (saved.colorOff !== undefined || saved.colorSide !== undefined) && !saved.color) cfg.color = { x: saved.colorSide || 0, y: saved.colorOff ?? 70 };
  delete cfg.colorOff; delete cfg.colorSide;
  if (saved && saved.axleBack === undefined) cfg.axleBack = cfg.robotL / 2;
  return cfg;
}

// Where an arm points (degrees clockwise from the robot's front), how long it looks from above,
// and whether it is low enough to touch things, for a given motor angle.
export function armGeom(arm, motorDeg) {
  const base = DIR_ANGLE[arm.dir] || 0, turn = motorDeg * (arm.ratio || 1);
  if (arm.motion === 'sweep') {
    return { ang: base + (arm.cw === 'left' ? -turn : turn), proj: arm.len, solid: true, tilt: 0, raw: 0 };
  }
  const raw = (arm.rest === 'down' ? 0 : 90) + (arm.cw === 'raises' ? turn : -turn);
  const tilt = clamp(raw, 0, 90);
  return { ang: base, proj: arm.len * Math.cos(rad(tilt)), solid: tilt <= LIFT_SOLID, tilt, raw };
}

// Loose pieces start here; teams can drag them anywhere and add more.
export const LOOSE_DEFAULTS = [
  { id: 'keystone', n: 'K', name: 'Keystone species (your team builds it for M13)', x: 170, y: 160, w: 64, h: 64, r: 0, loose: true }
];

const DRIVE_S = { forward: 0, back: 0, clockwise: 100, counterclockwise: -100 };
const STEP = 0.004;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
const rad = (d) => d * Math.PI / 180;

export function axes(deg) { const a = rad(deg); return { f: [Math.sin(a), Math.cos(a)], r: [Math.cos(a), -Math.sin(a)] }; }

export function corners(b) {
  const { f, r } = axes(b.r); const hw = b.w / 2, hh = b.h / 2; const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push([b.x + r[0] * hw * sx + f[0] * hh * sy, b.y + r[1] * hw * sx + f[1] * hh * sy]);
  return out;
}

// Separating-axis test for two rotated rectangles.
export function overlap(A, B) {
  const ca = corners(A), cb = corners(B); const aa = axes(A.r), ab = axes(B.r);
  for (const ax of [aa.f, aa.r, ab.f, ab.r]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ca) { const d = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of cb) { const d = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// Minimum translation to separate B from A: { depth, axis } with axis pointing from A toward B, or null.
export function mtv(A, B) {
  const ca = corners(A), cb = corners(B); const aa = axes(A.r), ab = axes(B.r);
  let best = null;
  for (const ax of [aa.f, aa.r, ab.f, ab.r]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ca) { const d = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of cb) { const d = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return null;
    if (!best || o < best.depth) best = { depth: o, axis: ax };
  }
  if ((B.x - A.x) * best.axis[0] + (B.y - A.y) * best.axis[1] < 0) best.axis = [-best.axis[0], -best.axis[1]];
  return best;
}

export function inside(p, b) {
  const { f, r } = axes(b.r); const dx = p[0] - b.x, dy = p[1] - b.y;
  return Math.abs(dx * r[0] + dy * r[1]) <= b.w / 2 && Math.abs(dx * f[0] + dy * f[1]) <= b.h / 2;
}

function rayBox(o, d, b) {
  const { f, r } = axes(b.r); const rx = o[0] - b.x, ry = o[1] - b.y;
  const lx = rx * r[0] + ry * r[1], ly = rx * f[0] + ry * f[1];
  const dx = d[0] * r[0] + d[1] * r[1], dy = d[0] * f[0] + d[1] * f[1];
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, v, h] of [[lx, dx, b.w / 2], [ly, dy, b.h / 2]]) {
    if (Math.abs(v) < 1e-9) { if (p < -h || p > h) return null; continue; }
    let a = (-h - p) / v, c = (h - p) / v; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return t0 > 0 ? t0 : 0;
}

function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
}

export function matColor(pt) {
  const [x, y] = pt;
  if (x < 0 || x > FW || y < 0 || y > FH) return 'none';
  for (const L of LINES) for (let i = 0; i < L.length - 1; i++) if (segDist(pt, L[i], L[i + 1]) <= 10) return 'black';
  const dl = Math.hypot(x, y), dr = Math.hypot(x - FW, y);
  if (Math.abs(dl - HOME_R) <= 7) return 'red';
  if (Math.abs(dr - HOME_R) <= 7) return 'blue';
  if (dl < HOME_R || dr < HOME_R) return 'white';
  return 'green';
}

export class Sim {
  // pieces: layout of loose pieces (shared with the caller so drags persist across resets).
  constructor(config, start, pieces) {
    this.cfg = normalizeConfig(config);
    this.start = Object.assign({ x: 240, y: 240, h: 0 }, start);
    this.pieces = pieces || [];
    this.docks = Object.assign({}, DEFAULT_DOCKS); // which mission model sits on each dock
    this.approach = Object.assign({}, DEFAULT_APPROACH); // model key (or dock:M15) -> side pushes must come from
    this.matPhoto = null; // ([x, y]) -> { color, reflect } read from the mat photo, or null for the plain mat
    this.logLines = [];
    this.onLog = null;
    this.matchOn = false;
    this.matchT = 0;
    this.reset();
  }

  log(msg) {
    const line = (this.matchOn ? '[' + this.clockText() + '] ' : '') + msg;
    this.logLines.push(line);
    if (this.logLines.length > 8) this.logLines.shift();
    if (this.onLog) this.onLog(line);
  }

  clockText() {
    const left = Math.max(0, MATCH_SECONDS - this.matchT);
    return Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
  }

  // Field objects for this run: fixed models, docks, then loose pieces.
  resetObjects() {
    this.objects = MODELS.map(m => Object.assign({}, m))
      .concat(DOCKS.map(d => Object.assign({ dock: true, holds: this.docks[d.key] }, d)))
      .concat(this.pieces.map(p => Object.assign({}, p, { loose: true })));
  }

  // Put the robot at the start position without touching the rest of the field.
  placeRobot() {
    const s = this.start;
    this.pose = { x: s.x, y: s.y, h: s.h };
    this.yawZero = s.h; this.trail = []; this.seen = []; this.trailT = 0; this.hit = null;
    this.sens = this.readSensors(this.pose);
  }

  reset() {
    const s = this.start;
    this.resetObjects();
    this.pose = { x: s.x, y: s.y, h: s.h };
    this.yawZero = s.h;
    this.program = { stacks: [], procs: {}, vars: [] }; this.threads = []; this.running = false;
    this.drive = null; this.driveAction = null; this.motorActions = {}; this.motorRun = {};
    this.vars = {}; this.lists = {}; this.events = []; this.relZero = {}; this.cmPerRot = null; this.t = 0; this.timer0 = 0; this.noted = new Set();
    this.speedPct = 50;
    this.motorSpeed = { A: 75, B: 75, C: 75, D: 75, E: 75, F: 75 };
    this.arms = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    this.pair = this.cfg.pair;
    this.resetHub();
    this.trail = []; this.seen = []; this.trailT = 0;
    this.hit = null;
    this.resetMission();
    this.sens = this.readSensors(this.pose);
  }

  // --- mission mechanisms (simplified; see MECHANISMS in field.js) ---
  resetMission() {
    this.mission = { m10a: true, m10b: true, m02: 0, m06: 0, m13: false, m14a: 0 };
    this.mechDone = new Set(); this.holdT = {}; this.contacts = new Map(); this.missed = new Set(); this.contactSpeed = new Map(); this.pushSpeed = null;
    this.resting = {}; this.pullDist = {}; // lift arms lowered onto a model (by port), and how far each model was pulled
  }

  // Remember how the robot touched a model this step: 'push' (with the push direction and speed),
  // 'press' or 'lift'.
  touch(o, how, dir) {
    const k = o.dock ? 'dock:' + o.holds : o.key;
    if (!k) return;
    const key = k + '|' + how;
    if (!this.contacts.has(key)) this.contacts.set(key, []);
    if (dir) this.contacts.get(key).push(dir);
    if (how === 'push' || how === 'lift') this.contactSpeed.set(key, Math.max(this.contactSpeed.get(key) || 0, this.pushSpeed ?? this.driveSpeedPct()));
  }

  // How fast the wheels are turning, as a percentage of top speed.
  driveSpeedPct() {
    const v = this.vel || { L: 0, R: 0 };
    return Math.round((Math.abs(v.L) + Math.abs(v.R)) / 2 / this.cfg.top * 100);
  }

  // Does a push in one of these directions count for mechanism m?
  rightSide(m, dirs) {
    const side = APPROACH[this.approach[m.model || 'dock:' + m.dock]];
    if (!side || m.how !== 'push') return true;
    const c = Math.cos(APPROACH_TOLERANCE * Math.PI / 180);
    return dirs.some(d => d[0] * side[0] + d[1] * side[1] >= c);
  }

  runMechanisms(dt) {
    const now = this.contacts, speeds = this.contactSpeed; this.contacts = new Map(); this.contactSpeed = new Map();
    MECHANISMS.forEach((m, i) => {
      const k = m.model || 'dock:' + m.dock;
      let hit = m.how === 'touch' ? [...now.keys()].some(c => c.startsWith(k + '|')) : now.has(k + '|' + m.how);
      if (hit && m.pull && (this.pullDist[k] || 0) < m.pull) hit = false; // not pulled far enough yet
      if (hit && m.fast && (speeds.get(k + '|lift') || 0) < m.fast) {
        hit = false; // lifted too slowly: it rises a little and falls back
        if (!this.mechDone.has(i) && !this.missed.has('fall:' + k)) { this.missed.add('fall:' + k); this.log(m.says.split(':')[0] + ': it lifted a little and fell back down.'); }
      }
      if (hit && !this.rightSide(m, now.get(k + '|' + m.how))) {
        hit = false; // pushed from the wrong side: the real lever wouldn't move
        if (!this.mechDone.has(i) && !this.missed.has(m.model || m.dock)) { this.missed.add(m.model || m.dock); this.log(m.says.split(':')[0] + ': touched, but nothing happened.'); }
      }
      if (m.hold) { this.holdT[i] = hit ? (this.holdT[i] || 0) + dt : 0; if (this.holdT[i] < m.hold) return; }
      else if (!hit) return;
      if (this.mechDone.has(i)) return;
      this.mechDone.add(i);
      for (const key of m.sets || []) this.mission[key] = true;
      for (const key of m.clears || []) this.mission[key] = false;
      const model = this.objects.find(o => o.key === m.model);
      if (model) { if (m.how === 'touch') model.hurt = true; else model.done = true; }
      if (m.lifts) { const o = this.objects.find(x => x.key === m.lifts); if (o) o.lifted = true; }
      if (m.seeds && model) this.popSeeds(model, m.seeds);
      if (m.fragments) {
        // Slow and steady keeps the leaf fragments in the nest; a fast push scatters some.
        const speed = speeds.get(k + '|push') || 0;
        const kept = speed <= 35 ? m.fragments : speed <= 65 ? m.fragments - 1 : 1;
        this.mission[m.model] = kept;
        this.log(`${m.says} ${kept} of ${m.fragments} leaf fragments stayed in (pushed at ${speed}% speed). (simplified)`);
        return;
      }
      this.log(m.says + ' (simplified)');
    });
    // Counted from where pieces are: keystone species in the M13 dock, seeds in the M14 dock.
    const dockOf = (name) => this.objects.find(o => o.dock && o.holds === name);
    const inDock = (p, name) => { const d = dockOf(name); return !!d && inside([p.x, p.y], d); };
    this.mission.m13 = this.objects.some(o => o.loose && o.id === 'keystone' && inDock(o, 'M13'));
    this.mission.m14a = this.objects.filter(o => o.seed && inDock(o, 'M14')).length;
  }

  // Seeds fly off the stalk and land around it as loose pieces the robot can collect.
  popSeeds(model, count) {
    let n = 0;
    for (let a = 0; a < 360 && n < count; a += 40) {
      const r = rad(a + 20);
      const seed = { id: 'seed' + (this.objects.length + n), n: 'S', name: 'Seed', x: model.x + Math.cos(r) * 110, y: model.y + Math.sin(r) * 110, w: 30, h: 30, r: a, loose: true, seed: true };
      if (this.objectBlocked(seed) || this.solidBoxes(this.pose).some(b => overlap(b, seed))) continue;
      this.objects.push(seed); n++;
    }
    this.mission.m02 += n;
  }

  // Robot-local point (x right, y forward from the axle middle) to field coordinates.
  toWorld(p, lx, ly) { const { f, r } = axes(p.h); return [p.x + r[0] * lx + f[0] * ly, p.y + r[1] * lx + f[1] * ly]; }

  bodyBox(p) {
    const c = this.cfg; const [x, y] = this.toWorld(p, 0, c.robotL / 2 - c.axleBack);
    return { x, y, w: c.robotW, h: c.robotL, r: p.h, part: 'robot' };
  }
  robotBox(p) { return this.bodyBox(p); }

  // Top-view rectangle of an arm, or null when it is too short to matter.
  // touching: only arms low enough to hit things (sweep arms always, lift arms when lowered).
  armBox(p, arm, motorDeg, touching = true) {
    const g = armGeom(arm, motorDeg);
    if ((touching && !g.solid) || g.proj < 5) return null;
    const a = rad(g.ang);
    const [x, y] = this.toWorld(p, arm.x + Math.sin(a) * g.proj / 2, arm.y + Math.cos(a) * g.proj / 2);
    return { x, y, w: ARM_WIDTH, h: g.proj, r: p.h + g.ang, part: 'arm ' + arm.port, lift: arm.motion !== 'sweep' };
  }

  solidBoxes(p) {
    const out = [this.bodyBox(p)];
    for (const arm of this.cfg.arms || []) { const b = this.armBox(p, arm, this.arms[arm.port] || 0); if (b) out.push(b); }
    return out;
  }

  pushable(o) { return o.loose || (this.cfg.shove && !o.dock); }

  // A pushed object may not leave the mat or overlap a fixed model or another piece.
  // Docks are low platforms, so pieces can slide onto them.
  objectBlocked(o) {
    for (const q of corners(o)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return true;
    for (const other of this.objects) if (other !== o && !other.dock && !other.lifted && overlap(o, other)) return true;
    return false;
  }

  // Push loose objects out of `boxes`. Returns the name of what blocked, or null (pushes kept).
  pushOut(boxes) {
    for (const box of boxes) for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return 'the wall';
    if (!this.cfg.collide) return null;
    const moved = [];
    const undo = () => { for (const [o, s] of moved) Object.assign(o, s); };
    for (const box of boxes) for (const o of this.objects) {
      if (o.lifted || (box.lift && o.under)) continue; // a low lift arm slides under flat parts
      const m = mtv(box, o); if (!m) continue;
      this.touch(o, 'push', m.axis);
      if (!this.pushable(o)) { undo(); return o.name; }
      const saved = { x: o.x, y: o.y, r: o.r };
      const push = m.depth + 0.5;
      // Where the robot touches the object (before the push), for turning it when pushed off-center.
      const pts = corners(box).filter(q => inside(q, o)).concat(corners(o).filter(q => inside(q, box)));
      o.x += m.axis[0] * push; o.y += m.axis[1] * push;
      if (pts.length) {
        const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length - saved.x, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length - saved.y;
        const cross = cx * m.axis[1] * push - cy * m.axis[0] * push;
        const r2 = (o.w * o.w + o.h * o.h) / 4;
        o.r -= (cross / r2) * 0.6 * 180 / Math.PI;
      }
      if (this.objectBlocked(o)) {
        o.r = saved.r;
        if (this.objectBlocked(o)) { Object.assign(o, saved); undo(); return o.name; }
      }
      moved.push([o, saved]);
    }
    return null;
  }

  // Try to move the robot (body and lowered arms) to pose p.
  tryMove(p) { return this.pushOut(this.solidBoxes(p)); }

  // Try to turn the motor on `port` to motorDeg. Returns what stopped the arm, or null.
  tryArm(port, motorDeg) {
    const arm = (this.cfg.arms || []).find(a => a.port === port);
    if (!arm) return null;
    const g = armGeom(arm, motorDeg);
    if (arm.motion !== 'sweep' && (g.raw < -0.01 || g.raw > 90.01)) return g.raw < 0 ? 'the mat' : 'its top stop';
    // A low lift arm that rises right against a model (or under a flat part) lifts it.
    const was = armGeom(arm, this.arms[port] || 0), rising = arm.motion !== 'sweep' && g.tilt > was.tilt;
    if (arm.motion !== 'sweep' && this.cfg.collide) {
      const hook = this.armBox(this.pose, arm, this.arms[port] || 0);
      if (hook && rising) {
        const reach = Object.assign({}, hook, { w: hook.w + 2 * HOOK, h: hook.h + 2 * HOOK });
        // How fast the arm itself rises, as a % of top speed (gearing included).
        this.pushSpeed = Math.round(Math.abs(this.motorSpeed[port] ?? 75) * Math.abs(arm.ratio || 1));
        for (const o of this.objects) if (!o.lifted && !o.loose && overlap(reach, o)) this.touch(o, 'lift');
        this.pushSpeed = null;
      }
      if (g.tilt > was.tilt) delete this.resting[port]; // raising the arm unhooks it
    }
    const box = this.armBox(this.pose, arm, motorDeg);
    if (!box) return null;
    if (arm.motion === 'sweep') {
      this.pushSpeed = Math.abs(this.motorSpeed[port] ?? 75);
      try { return this.pushOut([box]); } finally { this.pushSpeed = null; }
    }
    // A lift arm coming down presses on whatever is under it instead of shoving it aside.
    for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return 'the wall';
    if (this.cfg.collide) for (const o of this.objects) if (!o.lifted && !(rising && o.under) && overlap(box, o)) {
      this.touch(o, 'press');
      if (!o.loose && !o.dock) this.resting[port] = o; // resting on the model: driving away now pulls it
      return o.name;
    }
    return null;
  }

  // Lift arms resting on a model pull it as the robot drives away. A hook lets go after PULL_MAX mm,
  // or if the robot drives back toward the model.
  dragHooks(p0, p1) {
    for (const [port, o] of Object.entries(this.resting)) {
      const d0 = Math.hypot(p0.x - o.x, p0.y - o.y), d1 = Math.hypot(p1.x - o.x, p1.y - o.y);
      if (d1 < d0 - 0.5) { delete this.resting[port]; continue; }
      if (d1 <= d0) continue;
      this.pullDist[o.key] = (this.pullDist[o.key] || 0) + (d1 - d0);
      this.touch(o, 'pull');
      if (this.pullDist[o.key] >= PULL_MAX) delete this.resting[port];
    }
  }

  collides(p) {
    for (const box of this.solidBoxes(p)) {
      for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return 'the wall';
      if (this.cfg.collide) for (const o of this.objects) if (!(box.lift && o.under) && overlap(box, o)) return o.name;
    }
    return null;
  }

  // The robot, including any arm sticking out, is completely inside one of the home areas.
  inHome(p = this.pose) {
    const boxes = [this.bodyBox(p)];
    for (const arm of this.cfg.arms || []) { const b = this.armBox(p, arm, this.arms[arm.port] || 0, false); if (b) boxes.push(b); }
    const pts = boxes.flatMap(corners);
    const within = (cx) => pts.every(q => Math.hypot(q[0] - cx, q[1]) <= HOME_R);
    return within(0) || within(FW);
  }

  readSensors(p) {
    const c = this.cfg;
    const sp = this.toWorld(p, c.color.x, c.color.y);
    const o = this.toWorld(p, c.dist.x, c.dist.y);
    const dirAng = p.h + (DIR_ANGLE[c.dist.dir] || 0); const { f } = axes(dirAng);
    let t = Infinity;
    if (f[0] > 1e-9) t = Math.min(t, (FW - o[0]) / f[0]);
    if (f[0] < -1e-9) t = Math.min(t, -o[0] / f[0]);
    if (f[1] > 1e-9) t = Math.min(t, (FH - o[1]) / f[1]);
    if (f[1] < -1e-9) t = Math.min(t, -o[1] / f[1]);
    for (const b of this.objects || []) { if (b.lifted || b.under) continue; const h = rayBox(o, f, b); if (h !== null) t = Math.min(t, h); } // flat parts on the mat (b.under) are below the beam
    let yaw = p.h - (this.yawZero === undefined ? p.h : this.yawZero);
    yaw = ((yaw % 360) + 540) % 360 - 180;
    if (!c.yawCW) yaw = -yaw;
    const ph = this.matPhoto ? this.matPhoto(sp) : null;
    const color = this.matPhoto ? (ph ? ph.color : 'none') : matColor(sp);
    return { color, reflect: ph ? ph.reflect : REFLECT[color] ?? 0, spot: sp, dist: t <= 2000 ? Math.max(0, t) / 10 : null, rayLen: Math.min(Math.max(0, t), 2000), origin: o, dirAng, yaw };
  }

  // ---------- running programs ----------
  // Each "when program starts" stack runs as its own thread (a generator). Every physics step
  // each thread runs until it has to wait (a move, a motor, a wait, or the next loop pass).

  // Launch a program tree. Outside a match every run starts on a fresh field.
  // In a match the field stays as it is and the robot relaunches from home.
  run(program) {
    if (!this.matchOn) this.reset();
    else {
      if (!this.inHome()) { this.log('Relaunch from home: robot moved back to the start position.'); this.placeRobot(); }
      this.yawZero = this.pose.h;
    }
    this.stopMotion();
    this.program = program;
    this.vars = {}; for (const v of program.vars || []) this.vars[v] = 0;
    this.lists = {}; for (const l of program.lists || []) this.lists[l] = [];
    this.speedPct = 50; this.pair = this.cfg.pair; this.cmPerRot = null;
    this.motorSpeed = { A: 75, B: 75, C: 75, D: 75, E: 75, F: 75 };
    this.t = 0; this.timer0 = 0; this.noted = new Set();
    this.resetHub();
    this.threads = (program.stacks || []).filter(s => s.length).map(stack => this.spawn(stack));
    this.running = true;
    // Other start blocks fire when their condition turns true (not if it is already true at launch).
    this.events = (program.events || []).map(ev => ({ ev, thread: null, prev: ev.hat.t === 'whenBroadcast' ? null : this.hatValue(ev.hat) }));
    this.log('Launched.');
  }

  spawn(body) {
    const th = { cur: null, done: false, stopped: false, depth: 0 };
    th.gen = this.execList(body, th, { args: {} });
    return th;
  }

  // Hub light matrix (25 pixels, 0-100 %), text, center button light, buttons and sound.
  resetHub() {
    this.matrix = new Array(25).fill(0); this.display = ''; this.brightness = 100; this.centerLight = 'white';
    this.volume = 100; this.buttons = this.buttons || { left: false, right: false };
  }
  sound(ev) { if (this.onSound) this.onSound(ev); }
  setButton(name, down) { this.buttons[name] = !!down; }

  // Current value of an event start block's condition.
  hatValue(h) {
    const scope = { args: {} };
    switch (h.t) {
      case 'whenColor': return this.val({ t: 'isColor', port: h.port, color: h.color }, scope);
      case 'whenDistance': return this.val({ t: 'isDistance', port: h.port, cmp: h.cmp, val: h.val }, scope);
      case 'whenPressed': { const p = h.port === this.cfg.forcePort && this.pressed(); return h.opt === 'released' ? !p : p; }
      case 'whenButton': return h.event === 'released' ? !this.buttons[h.button] : !!this.buttons[h.button];
      case 'whenTimer': return (this.t - this.timer0) > this.num(h.val, scope);
      case 'whenCondition': return this.bool(h.cond, scope);
      default: return false;
    }
  }

  // Start (or restart) every "when I receive" stack for a message; returns their threads.
  broadcast(msg) {
    const started = [];
    for (const e of this.events) {
      if (e.ev.hat.t !== 'whenBroadcast' || String(e.ev.hat.msg).toLowerCase() !== String(msg).toLowerCase()) continue;
      if (e.thread && !e.thread.done) e.thread.stopped = true;
      e.thread = this.spawn(e.ev.body); this.threads.push(e.thread); started.push(e.thread);
    }
    return started;
  }

  // Fire event stacks whose condition just turned true. Already-running stacks keep going.
  checkEvents() {
    for (const e of this.events) {
      if (e.ev.hat.t === 'whenBroadcast') continue;
      const now = !!this.hatValue(e.ev.hat);
      if (now && !e.prev && (!e.thread || e.thread.done)) { e.thread = this.spawn(e.ev.body); this.threads.push(e.thread); }
      e.prev = now;
    }
  }

  // Returns true when the stop costs a precision token (interrupted outside home during a match).
  stop() {
    const was = this.running || this.drive || Object.keys(this.motorRun).length;
    this.running = false; this.stopMotion(); this.sound({ type: 'stop' });
    if (was && this.matchOn && !this.inHome()) { this.log('Interrupted outside home: lost a precision token.'); return true; }
    if (was) this.log('Stopped.');
    return false;
  }

  stopMotion() {
    this.drive = null;
    if (this.driveAction) this.driveAction.done = true;
    this.driveAction = null;
    for (const a of Object.values(this.motorActions || {})) a.done = true;
    this.motorActions = {}; this.motorRun = {};
  }

  finish(msg) { this.running = false; this.stopMotion(); this.sound({ type: 'stop' }); this.log(msg); }

  startMatch() { this.reset(); this.matchT = 0; this.matchOn = true; this.logLines = []; this.log('Match started. Press Run to launch.'); }
  endMatch() { this.matchOn = false; this.running = false; this.stopMotion(); this.log('Match stopped.'); }

  // Ids of the blocks running right now (one per active stack), for highlighting.
  activeIds() { return this.running ? this.threads.filter(t => !t.done && t.cur).map(t => t.cur) : []; }

  // --- values (Scratch rules: numbers and text convert freely) ---
  val(e, scope) {
    if (!e) return '';
    const N = (x) => this.num(x, scope), S = (x) => this.str(x, scope), B = (x) => this.bool(x, scope);
    const s = this.sens, cfg = this.cfg;
    switch (e.t) {
      case 'num': case 'text': return e.v;
      case 'var': return this.vars[e.name] ?? 0;
      case 'arg': return scope.args[e.name] ?? '';
      case 'add': return N(e.a) + N(e.b);
      case 'sub': return N(e.a) - N(e.b);
      case 'mul': return N(e.a) * N(e.b);
      case 'div': return N(e.b) === 0 ? (N(e.a) === 0 ? NaN : Infinity * Math.sign(N(e.a))) : N(e.a) / N(e.b);
      case 'mod': { const a = N(e.a), b = N(e.b); return b === 0 ? NaN : ((a % b) + b) % b; }
      case 'random': {
        const a = N(e.a), b = N(e.b), lo = Math.min(a, b), hi = Math.max(a, b);
        const ints = Number.isInteger(a) && Number.isInteger(b) && !String(this.val(e.a, scope)).includes('.') && !String(this.val(e.b, scope)).includes('.');
        return ints ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo);
      }
      case 'round': return Math.round(N(e.a));
      case 'mathop': return mathop(e.fn, N(e.a));
      case 'gt': return compare(this.val(e.a, scope), this.val(e.b, scope)) > 0;
      case 'lt': return compare(this.val(e.a, scope), this.val(e.b, scope)) < 0;
      case 'eq': return compare(this.val(e.a, scope), this.val(e.b, scope)) === 0;
      case 'and': return B(e.a) && B(e.b);
      case 'or': return B(e.a) || B(e.b);
      case 'not': return !B(e.a);
      case 'join': return S(e.a) + S(e.b);
      case 'letterOf': return S(e.b).charAt(N(e.a) - 1);
      case 'length': return S(e.a).length;
      case 'contains': return S(e.a).toLowerCase().includes(S(e.b).toLowerCase());
      case 'isColor': return e.port === cfg.colorPort && s.color === e.color;
      case 'isReflection': return e.port === cfg.colorPort && cmp(s.reflect, e.cmp, N(e.val));
      case 'isDistance': return e.port === cfg.distPort && (s.dist === null ? e.cmp === '>' : cmp(s.dist, e.cmp, N(e.val)));
      case 'isPressed': return e.port === cfg.forcePort && this.pressed();
      case 'color': return e.port === cfg.colorPort ? (COLOR_ID[s.color] ?? -1) : -1;
      case 'reflection': return e.port === cfg.colorPort ? s.reflect : 0;
      case 'distance': return e.port !== cfg.distPort ? -1 : s.dist === null ? 200 : Math.round(s.dist * 10) / 10;
      case 'angle': return e.axis === 'yaw' ? Math.round(s.yaw) : 0;
      case 'timer': return Math.round((this.t - this.timer0) * 1000) / 1000;
      case 'motorPos': { const a = this.arms[e.port] || 0; return Math.round(((a % 360) + 360) % 360); }
      case 'motorRel': return Math.round((this.arms[e.port] || 0) - (this.relZero[e.port] || 0));
      case 'volume': return this.volume;
      case 'buttonPressed': return !!this.buttons[e.button];
      case 'listContents': {
        const l = this.lists[e.list] || [];
        return l.every(x => String(x).length === 1) ? l.join('') : l.join(' ');
      }
      case 'listItem': { const l = this.lists[e.list] || [], i = listIndex(this.val(e.index, scope), l.length); return i ? l[i - 1] : ''; }
      case 'listIndexOf': { const l = this.lists[e.list] || [], x = this.val(e.item, scope); return l.findIndex(v => compare(v, x) === 0) + 1; }
      case 'listLength': return (this.lists[e.list] || []).length;
      case 'listContains': { const x = this.val(e.item, scope); return (this.lists[e.list] || []).some(v => compare(v, x) === 0); }
      default: return 0; // noteR and anything unknown
    }
  }
  num(e, scope) { const v = this.val(e, scope); if (v === true) return 1; if (v === false) return 0; const n = Number(v); return isFinite(n) || Math.abs(n) === Infinity ? n : 0; }
  str(e, scope) { const v = this.val(e, scope); return typeof v === 'number' ? fmtNum(v) : String(v); }
  bool(e, scope) {
    if (!e) return false;
    const v = this.val(e, scope);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    const t = String(v).toLowerCase(); return t !== '' && t !== '0' && t !== 'false';
  }

  // Front of the robot (force sensor) is pushing on something.
  pressed() {
    const { f } = axes(this.pose.h);
    const box = this.bodyBox({ x: this.pose.x + f[0] * 3, y: this.pose.y + f[1] * 3, h: this.pose.h });
    for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return true;
    return this.objects.some(o => !o.dock && overlap(box, o));
  }

  // --- statements ---
  *execList(list, th, scope) {
    for (const s of list) {
      if (!this.running || th.stopped) return;
      yield* this.exec(s, th, scope);
    }
  }

  *exec(s, th, scope) {
    th.cur = s.id || th.cur;
    const N = (x) => this.num(x, scope), B = (x) => this.bool(x, scope);
    const ports = (p) => String(p || '').split('').filter(x => this.arms[x] !== undefined);
    switch (s.t) {
      case 'move': yield* this.driveFor(this.dirFactors(s.dir), N(s.val), s.unit); break;
      case 'steer': yield* this.driveFor(this.steerFactors(N(s.steer)), N(s.val), s.unit); break;
      case 'tank': yield* this.driveFor({ L: clamp(N(s.left), -100, 100), R: clamp(N(s.right), -100, 100) }, N(s.val), s.unit); break;
      case 'startMove': this.setDrive(this.dirFactors(s.dir)); break;
      case 'startSteer': this.setDrive(this.steerFactors(N(s.steer))); break;
      case 'startTank': this.setDrive({ L: clamp(N(s.left), -100, 100), R: clamp(N(s.right), -100, 100) }); break;
      case 'stopMove': this.setDrive(null); break;
      case 'speed': this.speedPct = clamp(N(s.pct), -100, 100); break;
      case 'pair': this.pair = String(s.pair || this.cfg.pair); break;
      case 'setDistance': { const cm = N(s.cm); this.cmPerRot = cm > 0 ? cm : null; break; }
      case 'motor': yield* this.motorFor(ports(s.port), s.dir === 'counterclockwise' ? -1 : 1, N(s.val), s.unit); break;
      case 'motorGoTo': yield* this.motorGoTo(ports(s.port), s.dir, N(s.pos)); break;
      case 'motorStart':
        for (const p of ports(s.port)) { this.cancelMotor(p); this.motorRun[p] = s.dir === 'counterclockwise' ? -1 : 1; }
        break;
      case 'motorStop': for (const p of ports(s.port)) { this.cancelMotor(p); delete this.motorRun[p]; } break;
      case 'motorSpeed': for (const p of ports(s.port)) this.motorSpeed[p] = clamp(N(s.pct), -100, 100); break;
      case 'motorSetRel': for (const p of ports(s.port)) this.relZero[p] = (this.arms[p] || 0) - N(s.val); break;
      case 'show': this.display = this.str(s.text, scope); this.matrix.fill(0); break;
      case 'showImage': this.showImage(s.image); break;
      case 'showImageFor': this.showImage(s.image); yield* this.waitFor(N(s.val)); this.matrix.fill(0); break;
      case 'displayOff': this.matrix.fill(0); this.display = ''; break;
      case 'setBrightness': this.brightness = clamp(N(s.b), 0, 100); break;
      case 'setPixel': {
        const x = Math.round(N(s.x)), y = Math.round(N(s.y));
        if (x >= 1 && x <= 5 && y >= 1 && y <= 5) { this.matrix[(y - 1) * 5 + (x - 1)] = clamp(N(s.b), 0, 100); this.display = ''; }
        break;
      }
      case 'centerLight': this.centerLight = s.color; break;
      case 'wait': yield* this.waitFor(N(s.val)); break;
      case 'beep': this.sound({ type: 'beep', note: N(s.note), seconds: N(s.val), volume: this.volume }); yield* this.waitFor(N(s.val)); break;
      case 'beepStart': this.sound({ type: 'beep', note: N(s.note), seconds: null, volume: this.volume }); break;
      case 'playSound': case 'playSoundWait': {
        const secs = (this.program.sounds && this.program.sounds[s.sound]) || 1;
        this.sound({ type: 'sound', name: s.sound, seconds: secs, volume: this.volume });
        if (s.t === 'playSoundWait') yield* this.waitFor(secs);
        break;
      }
      case 'stopSound': this.sound({ type: 'stop' }); break;
      case 'setVolume': this.volume = clamp(N(s.v), 0, 100); break;
      case 'changeVolume': this.volume = clamp(this.volume + N(s.v), 0, 100); break;
      case 'broadcast': this.broadcast(s.msg); break;
      case 'broadcastWait': {
        const started = this.broadcast(s.msg);
        while (started.some(t => !t.done)) { yield; if (!this.running || th.stopped) return; }
        break;
      }
      case 'listAdd': { const l = this.list(s.list); if (l.length < 200000) l.push(this.val(s.item, scope)); break; }
      case 'listDelete': {
        const l = this.list(s.list), raw = this.val(s.index, scope);
        if (String(raw).toLowerCase() === 'all') l.length = 0;
        else { const i = listIndex(raw, l.length); if (i) l.splice(i - 1, 1); }
        break;
      }
      case 'listClear': this.list(s.list).length = 0; break;
      case 'listInsert': { const l = this.list(s.list), i = listIndex(this.val(s.index, scope), l.length + 1); if (i && l.length < 200000) l.splice(i - 1, 0, this.val(s.item, scope)); break; }
      case 'listReplace': { const l = this.list(s.list), i = listIndex(this.val(s.index, scope), l.length); if (i) l[i - 1] = this.val(s.item, scope); break; }
      case 'repeat': {
        const n = Math.round(N(s.times));
        for (let i = 0; i < n; i++) { yield* this.execList(s.body, th, scope); if (!this.running || th.stopped) return; yield; }
        break;
      }
      case 'forever':
        for (;;) { yield* this.execList(s.body, th, scope); if (!this.running || th.stopped) return; yield; }
      case 'repeatUntil':
        while (!B(s.cond)) { yield* this.execList(s.body, th, scope); if (!this.running || th.stopped) return; yield; }
        break;
      case 'if': if (B(s.cond)) yield* this.execList(s.body, th, scope); break;
      case 'ifElse': yield* this.execList(B(s.cond) ? s.body : s.else, th, scope); break;
      case 'waitUntil': while (!B(s.cond)) { yield; if (!this.running || th.stopped) return; } break;
      case 'stop':
        if (s.opt === 'all') { this.finish('A “stop all” block ended the program.'); return; }
        th.stopped = true; return;
      case 'resetYaw': this.yawZero = this.pose.h; this.sens = this.readSensors(this.pose); break;
      case 'resetTimer': this.timer0 = this.t; break;
      case 'setVar': this.vars[s.name] = this.val(s.val, scope); break;
      case 'changeVar': this.vars[s.name] = (Number(this.vars[s.name]) || 0) + N(s.val); break;
      case 'call': {
        const proc = this.program.procs && this.program.procs[s.name];
        if (!proc) { this.noteOnce(s, 'My Block “' + s.name + '” has no definition.'); break; }
        if (th.depth >= 200) { this.finish('Stopped: “' + s.name + '” calls itself too many times.'); return; }
        const args = {};
        for (const p of proc.params) args[p.name] = p.kind === 'b' ? B(s.args && s.args[p.name]) : this.val(s.args && s.args[p.name], scope);
        th.depth++;
        yield* this.execList(proc.body, th, { args });
        th.depth--;
        break;
      }
      case 'note': this.noteOnce(s, 'Skipped a block that isn’t simulated yet: ' + s.op); break;
      default: break;
    }
  }

  list(name) { return this.lists[name] || (this.lists[name] = []); }
  showImage(digits) {
    const d = String(digits || '').padEnd(25, '0');
    for (let i = 0; i < 25; i++) this.matrix[i] = Math.round((Number(d[i]) || 0) / 9 * this.brightness);
    this.display = '';
  }

  noteOnce(s, msg) { const k = s.id || s.op || msg; if (!this.noted.has(k)) { this.noted.add(k); this.log(msg); } }

  *waitFor(sec) { let t = 0; while (t < sec) { t += (yield) || 0; if (!this.running) return; } }

  // Wheel speed factors (percent of top speed) for each movement style.
  dirFactors(dir) {
    const v = this.speedPct;
    return dir === 'back' ? { L: -v, R: -v } : dir === 'clockwise' ? { L: v, R: -v } : dir === 'counterclockwise' ? { L: -v, R: v } : { L: v, R: v };
  }
  steerFactors(steer) {
    const s = clamp(steer, -100, 100), v = this.speedPct, slow = v * (1 - 2 * Math.abs(s) / 100);
    return s >= 0 ? { L: v, R: slow } : { L: slow, R: v };
  }
  setDrive(f) {
    if (this.driveAction) { this.driveAction.done = true; this.driveAction = null; }
    this.lastBump = null;
    this.drive = f;
  }
  wheelDegrees(val, unit) {
    const circ = this.cmPerRot ? this.cmPerRot * 10 : Math.PI * this.cfg.wheel;
    return unit === 'cm' ? val * 10 / circ * 360 : unit === 'in' ? val * 25.4 / circ * 360 : unit === 'rotations' ? val * 360 : val;
  }
  *driveFor(f, val, unit) {
    if (val < 0) { val = -val; f = { L: -f.L, R: -f.R }; }
    this.setDrive(null);
    const a = { L: f.L, R: f.R, t: 0, prog: 0, stall: 0, done: false };
    if (unit === 'seconds') { a.mode = 'time'; a.target = val; } else { a.mode = 'deg'; a.target = this.wheelDegrees(val, unit); }
    if (a.mode === 'deg' && (a.target <= 0 || Math.max(Math.abs(a.L), Math.abs(a.R)) < 1e-6)) return;
    this.driveAction = a;
    while (!a.done) { yield; if (!this.running) return; }
    if (this.driveAction === a) this.driveAction = null;
  }
  cancelMotor(p) { const a = this.motorActions[p]; if (a) { a.done = true; delete this.motorActions[p]; } }
  *motorFor(ports, sign, val, unit) {
    if (ports.some(p => this.pair.includes(p))) this.noteOnce({ op: 'drive-motor' }, 'Note: a motor block uses a drive motor port; it only turns that motor’s dial here.');
    if (val < 0) { sign = -sign; val = -val; }
    const acts = ports.map(p => {
      this.cancelMotor(p); delete this.motorRun[p];
      const a = { sign, mode: unit === 'seconds' ? 'time' : 'deg', target: unit === 'seconds' ? val : unit === 'rotations' ? val * 360 : val, prog: 0, t: 0, stall: 0, done: false };
      this.motorActions[p] = a; return a;
    });
    while (acts.some(a => !a.done)) { yield; if (!this.running) return; }
  }
  *motorGoTo(ports, dir, pos) {
    const acts = ports.map(p => {
      const cur = (((this.arms[p] || 0) % 360) + 360) % 360, target = ((pos % 360) + 360) % 360, d = target - cur;
      const delta = dir === 'clockwise' ? ((d % 360) + 360) % 360 : dir === 'counterclockwise' ? -(((-d % 360) + 360) % 360) : ((d % 360) + 540) % 360 - 180;
      this.cancelMotor(p); delete this.motorRun[p];
      const a = { sign: delta < 0 ? -1 : 1, mode: 'deg', target: Math.abs(delta), prog: 0, t: 0, stall: 0, done: Math.abs(delta) < 0.5 };
      if (!a.done) this.motorActions[p] = a;
      return a;
    });
    while (acts.some(a => !a.done)) { yield; if (!this.running) return; }
  }

  // Advance the simulation by dt seconds (any size; it is split into small steps).
  advance(dt) {
    while (dt > 1e-9) { const h = Math.min(STEP, dt); this.step(h); dt -= h; }
  }

  step(dt) {
    const cfg = this.cfg;
    if (this.running) {
      this.t += dt;
      for (const th of this.threads) {
        if (th.done || !this.running) continue;
        try { if (th.gen.next(dt).done) th.done = true; }
        catch (err) { th.done = true; this.log('Error in program: ' + err.message); }
      }
      if (this.running) this.checkEvents();
      this.threads = this.threads.filter(th => !th.done);
      // A program with event start blocks keeps listening until it is stopped.
      const listening = this.events.some(e => e.ev.hat.t !== 'whenBroadcast');
      if (this.running && !this.threads.length && !listening) this.finish('Program finished.');
    }

    // Drive wheels.
    const a = this.driveAction && !this.driveAction.done ? this.driveAction : null;
    const cmd = a || this.drive;
    let fast = 0, stalled = false;
    if (!cmd) this.vel = { L: 0, R: 0 };
    if (cmd) {
      // Wheel degrees per second. With a speed-up ramp the wheels accelerate; slowing down is instant (brake).
      let L = cmd.L / 100 * cfg.top, R = cmd.R / 100 * cfg.top;
      if (cfg.ramp > 0) {
        const step = cfg.top / cfg.ramp * dt, v = this.vel || { L: 0, R: 0 };
        const toward = (cur, goal) => Math.abs(goal) <= Math.abs(cur) && Math.sign(goal) === Math.sign(cur) ? goal : cur + clamp(goal - cur, -step, step);
        L = toward(v.L, L); R = toward(v.R, R);
      }
      this.vel = { L, R };
      const k = Math.PI * cfg.wheel / 360;
      const vL = L * k, vR = R * k, v = (vL + vR) / 2, w = (vL - vR) / cfg.track;
      const h0 = rad(this.pose.h), h1 = h0 + w * dt, hm = (h0 + h1) / 2;
      const np = { x: this.pose.x + v * Math.sin(hm) * dt, y: this.pose.y + v * Math.cos(hm) * dt, h: h1 * 180 / Math.PI };
      const hit = this.tryMove(np);
      // Log a bump once per move, not every time the wheels grind against the same thing.
      if (hit) { stalled = true; if (this.lastBump !== hit) this.log('Bumped into ' + hit + '.'); this.hit = hit; this.lastBump = hit; }
      else {
        this.dragHooks(this.pose, np);
        this.pose = np; this.hit = null;
        fast = Math.max(Math.abs(L), Math.abs(R)) * dt;
        const [pl, pr] = this.pair.split('');
        if (pl in this.arms) this.arms[pl] += L * dt;
        if (pr in this.arms) this.arms[pr] += R * dt;
      }
      this.trailT += dt;
      if (!stalled && this.trailT > 0.06) {
        this.trailT = 0; this.trail.push([this.pose.x, this.pose.y]); if (this.trail.length > 2000) this.trail.shift();
      }
    }
    if (a) {
      a.t += dt;
      if (a.mode === 'time') { if (a.t >= a.target) a.done = true; }
      else { a.prog += fast; if (a.prog >= a.target) a.done = true; }
      if (stalled) { a.stall += dt; if (a.stall > 1) { a.done = true; this.log('Motors stalled for 1 s, moving to the next block.'); } }
      else a.stall = 0;
    }
    this.sens = this.readSensors(this.pose);
    // Remember where the color sensor saw something other than plain mat, to draw on the field.
    if (cmd && !stalled && this.sens.color !== 'green') {
      const last = this.seen[this.seen.length - 1], sp = this.sens.spot;
      if (!last || Math.hypot(last[0] - sp[0], last[1] - sp[1]) > 8) { this.seen.push([sp[0], sp[1], this.sens.color]); if (this.seen.length > 3000) this.seen.shift(); }
    }

    // Attachment motors: "run for" actions and motors started with "start motor".
    for (const p of Object.keys(this.arms)) {
      const act = this.motorActions[p], run = this.motorRun[p];
      if (!act && !run) continue;
      const spd = this.motorSpeed[p] ?? 75;
      const ds = Math.abs(spd) / 100 * cfg.top * dt;
      const sign = (act ? act.sign : run) * (spd < 0 ? -1 : 1);
      const st = act && act.mode === 'deg' ? Math.min(ds, act.target - act.prog) : ds;
      const next = this.arms[p] + sign * st;
      const hit = this.pair.includes(p) ? null : this.tryArm(p, next);
      if (hit) {
        // SPIKE motors end a "run for" block when they stall.
        if (act) {
          act.stall += dt;
          if (act.stall > 0.3) {
            act.done = true; delete this.motorActions[p];
            this.log(hit === 'the mat' ? 'Arm ' + p + ' pressed down on the mat.' : hit === 'its top stop' ? 'Arm ' + p + ' is all the way up.' : 'Arm ' + p + ' pressed against ' + hit + '.');
          }
        }
      } else {
        this.arms[p] = next;
        if (act) {
          act.stall = 0; act.t += dt;
          if (act.mode === 'time') { if (act.t >= act.target) act.done = true; }
          else { act.prog += st; if (act.prog >= act.target - 1e-6) act.done = true; }
          if (act.done) delete this.motorActions[p];
        }
      }
    }

    this.runMechanisms(dt);

    if (this.matchOn) {
      this.matchT += dt;
      if (this.matchT >= MATCH_SECONDS) {
        this.matchT = MATCH_SECONDS; this.matchOn = false;
        if (this.running) this.running = false;
        this.stopMotion();
        this.log('Match over. Score what is on the field.');
      }
    }
  }
}

// Scratch list index: 1-based number, or "last" / "random" / "any". Returns 0 when out of range.
function listIndex(raw, length) {
  const t = String(raw).toLowerCase();
  if (t === 'last') return length;
  if (t === 'random' || t === 'any') return length ? 1 + Math.floor(Math.random() * length) : 0;
  const i = Math.floor(Number(raw));
  return i >= 1 && i <= length ? i : 0;
}

// Scratch-style comparison: numbers compare as numbers, anything else as text (ignoring case).
function compare(a, b) {
  const na = Number(a), nb = Number(b);
  const numeric = (v, n) => typeof v === 'number' || typeof v === 'boolean' || (String(v).trim() !== '' && !isNaN(n));
  if (numeric(a, na) && numeric(b, nb)) return na === nb ? 0 : na > nb ? 1 : -1;
  const sa = String(a).toLowerCase(), sb = String(b).toLowerCase();
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}
const cmp = (a, op, b) => op === '<' ? a < b : op === '>' ? a > b : Math.abs(a - b) < 1e-9;
const fmtNum = (n) => Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
function mathop(fn, x) {
  const d = Math.PI / 180;
  switch (fn) {
    case 'abs': return Math.abs(x); case 'floor': return Math.floor(x); case 'ceiling': return Math.ceil(x);
    case 'sqrt': return Math.sqrt(x);
    case 'sin': return Math.round(Math.sin(x * d) * 1e10) / 1e10;
    case 'cos': return Math.round(Math.cos(x * d) * 1e10) / 1e10;
    case 'tan': return Math.tan(x * d);
    case 'asin': return Math.asin(x) / d; case 'acos': return Math.acos(x) / d; case 'atan': return Math.atan(x) / d;
    case 'ln': return Math.log(x); case 'log': return Math.log10(x);
    case 'e ^': return Math.exp(x); case '10 ^': return Math.pow(10, x);
    default: return 0;
  }
}
// What the simulated color sensor reports. Reflected light values are rough guesses for the plain mat;
// on the mat photo they come from the photo (mat-photo.js).
const COLOR_ID = { black: 0, violet: 1, blue: 3, azure: 4, green: 6, yellow: 7, red: 9, white: 10, none: -1 };
const REFLECT = { black: 8, white: 98, red: 60, blue: 30, green: 25, yellow: 85, none: 0 };

// Calibration from test runs on the real robot (see the Robot tab).
// 1. "move forward for n rotations" went cm centimetres -> effective wheel diameter (mm).
export const calibrateWheel = (n, cm) => cm * 10 / (n * Math.PI);
// 2. "move clockwise for n rotations" turned deg degrees -> effective wheel spacing (mm).
//    Each wheel rolls n·π·D; a spin turns the robot by 2 × that ÷ spacing.
export const calibrateTrack = (n, deg, wheel) => 360 * n * wheel / deg;
// 3. "move forward for sec seconds" at pct % went cm centimetres -> wheel speed at 100 % (°/s).
//    The ramp is the time to reach full speed, so reaching pct % takes ramp × pct/100 and
//    loses about half of that.
export const calibrateTop = (pct, sec, cm, wheel, ramp = 0) => (cm * 10 / Math.max(0.1, sec - ramp * pct / 200)) / (Math.PI * wheel) * 360 / (pct / 100);
