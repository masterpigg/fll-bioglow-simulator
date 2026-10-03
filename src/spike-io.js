// Read and write LEGO Education SPIKE App 3 Word Blocks files (.llsp3).
// An .llsp3 is a zip holding manifest.json, icon.svg and scratch.sb3;
// scratch.sb3 is another zip holding a Scratch 3 project.json.

import { SPEC, lit, walkProgram } from './blocks.js';

// Names used by a program: variables, lists and broadcast messages.
export function namesIn(prog) {
  const vars = new Set(prog.vars || []), lists = new Set(prog.lists || []), msgs = new Set();
  walkProgram(prog, (n) => {
    if (n.t === 'var') vars.add(n.name);
    for (const [k, d] of Object.entries((SPEC[n.t] && SPEC[n.t].p) || {})) {
      if (d.kind === 'var') vars.add(n[k]); else if (d.kind === 'list') lists.add(n[k]); else if (d.kind === 'msg') msgs.add(n[k]);
    }
  });
  return { vars: [...vars], lists: [...lists], msgs: [...msgs] };
}


// ---------- zip ----------

let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Writes an uncompressed ("stored") zip.
export function makeZip(entries) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(12, 33, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(14, 33, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

export function readZip(buf) {
  const dv = new DataView(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {}; const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    files[name] = { method, data: new Uint8Array(buf, start, csize) };
    p += 46 + nlen + elen + clen;
  }
  return files;
}

async function unzipEntry(e) {
  if (e.method === 0) return e.data.slice();
  if (e.method === 8) {
    const s = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  throw new Error('Unsupported compression in file');
}

const findEntry = (files, test) => { for (const k in files) if (test(k.split('/').pop())) return files[k]; return null; };

// ---------- import ----------

// Accepts an .llsp3/.llsp, an .sb3, or a bare project.json.
export async function importProject(buf) {
  let proj;
  const files = readZip(buf);
  if (!files) proj = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
  else {
    let pj = findEntry(files, n => n === 'project.json');
    if (!pj) {
      const sb3 = findEntry(files, n => n.endsWith('.sb3'));
      if (sb3) { const inner = readZip((await unzipEntry(sb3)).buffer); pj = inner && findEntry(inner, n => n === 'project.json'); }
    }
    if (!pj) {
      if (findEntry(files, n => n === 'projectbody.json')) throw new Error('This looks like a SPIKE Python project. Only Word Blocks projects can be imported for now.');
      throw new Error('No block program found in this file.');
    }
    proj = JSON.parse(new TextDecoder().decode(await unzipEntry(pj)));
  }
  return convertProject(proj);
}

const OPCODE = {};
for (const [t, s] of Object.entries(SPEC)) for (const op of s.scratch || []) OPCODE[op] = t;
const procName = (code) => code.replace(/\s*%[sbn]/g, '').trim();
const procKinds = (code) => (code.match(/%[sbn]/g) || []).map(t => t === '%b' ? 'b' : 'n');

// Scratch 3 project.json -> { program, warn, cfg }. cfg holds robot settings found in the blocks.
export function convertProject(proj) {
  const targets = proj.targets || [];
  const target = targets.find(t => Object.values(t.blocks || {}).some(b => b && b.opcode === 'flipperevents_whenProgramStarts'));
  if (!target) throw new Error('No “when program starts” stack found.');
  const blocks = target.blocks;
  const warn = [], cfg = {}, skipped = {}, vars = new Set(), lists = new Set(), sounds = {};
  for (const t of targets) {
    for (const v of Object.values(t.variables || {})) vars.add(v[0]);
    for (const l of Object.values(t.lists || {})) lists.add(l[0]);
    for (const snd of t.sounds || []) if (snd.rate && snd.sampleCount) sounds[snd.name] = Math.round(snd.sampleCount / snd.rate * 100) / 100;
  }

  const literal = (v) => lit(v);
  const shadowValue = (sb) => { const f = sb.fields && Object.keys(sb.fields)[0]; return f ? String(sb.fields[f][0]) : ''; };
  const note = (op, reporter) => { skipped[op] = (skipped[op] || 0) + 1; return reporter ? { t: 'noteR', op } : { t: 'note', op }; };
  const learn = (t, n) => {
    if (t === 'pair' && !cfg.pair) cfg.pair = n.pair;
    if (['isColor', 'isReflection', 'color', 'reflection'].includes(t) && !cfg.colorPort) cfg.colorPort = n.port;
    if (['isDistance', 'distance'].includes(t) && !cfg.distPort) cfg.distPort = n.port;
    if (t === 'isPressed' && !cfg.forcePort) cfg.forcePort = n.port;
  };

  const menuValue = (b, key) => {
    const inp = b.inputs && b.inputs[key]; if (!inp) return undefined;
    for (const v of inp.slice(1)) {
      if (Array.isArray(v)) return String(v[1]);
      if (typeof v === 'string' && blocks[v]) return shadowValue(blocks[v]);
    }
    return undefined;
  };
  const exprInput = (b, key, def = '') => {
    const inp = b.inputs && b.inputs[key];
    if (!inp) return lit(def);
    const v = inp[1];
    if (Array.isArray(v)) return v[0] === 12 ? { t: 'var', name: String(v[1]) } : v[0] === 13 ? { t: 'listContents', list: String(v[1]) } : literal(v[1], v[0]);
    if (typeof v === 'string' && blocks[v]) return blocks[v].shadow ? lit(shadowValue(blocks[v])) : convExpr(blocks[v]);
    const sh = inp[2];
    if (Array.isArray(sh)) return literal(sh[1], sh[0]);
    if (typeof sh === 'string' && blocks[sh]) return lit(shadowValue(blocks[sh]));
    return lit(def);
  };
  const boolInput = (b, key) => {
    const inp = b.inputs && b.inputs[key];
    const id = inp && inp[1];
    return typeof id === 'string' && blocks[id] ? convExpr(blocks[id]) : null;
  };

  const fromSpec = (b, t) => {
    const spec = SPEC[t], n = { t };
    for (const [k, d] of Object.entries(spec.p || {})) {
      if (d.kind === 'menu') { const v = menuValue(b, d.key); n[k] = v === undefined ? d.opts[0] : d.map ? d.map.from(v) : v; }
      else if (d.kind === 'var' || d.kind === 'list' || (d.kind === 'msg' && d.asField)) {
        const f = b.fields && b.fields[d.key]; n[k] = f ? String(f[0]) : '';
        if (d.kind === 'var') vars.add(n[k]); else if (d.kind === 'list') lists.add(n[k]);
      }
      else if (d.kind === 'msg' || d.kind === 'matrix') n[k] = menuValue(b, d.key) ?? '';
      else if (d.kind === 'sound') { const v = menuValue(b, d.key) ?? ''; try { const o = JSON.parse(v); n[k] = String(o.name ?? v); } catch { n[k] = v; } }
      else if (d.kind === 'field') { const v = b.fields && b.fields[d.key] ? String(b.fields[d.key][0]) : d.opts[0]; n[k] = d.map ? d.map.from(v) : v; }
      else if (d.kind === 'bool') n[k] = boolInput(b, d.key);
      else n[k] = exprInput(b, d.key, d.def);
    }
    if (spec.body) n.body = stmtList(b.inputs && b.inputs[spec.body] && b.inputs[spec.body][1]);
    if (spec.else) n.else = stmtList(b.inputs && b.inputs[spec.else] && b.inputs[spec.else][1]);
    learn(t, n);
    return n;
  };

  const convExpr = (b) => {
    if (b.opcode === 'argument_reporter_string_number' || b.opcode === 'argument_reporter_boolean') return { t: 'arg', name: String(b.fields.VALUE[0]) };
    if (b.opcode === 'data_variable') return { t: 'var', name: String(b.fields.VARIABLE[0]) };
    const t = OPCODE[b.opcode];
    if (!t || !['n', 'b'].includes(SPEC[t].shape)) return note(b.opcode, true);
    return fromSpec(b, t);
  };

  // My Blocks: definitions first, so calls know their parameter names.
  const procs = {}, byCode = {};
  for (const b of Object.values(blocks)) {
    if (!b || b.opcode !== 'procedures_definition') continue;
    const proto = blocks[b.inputs.custom_block[1]];
    if (!proto || !proto.mutation) continue;
    const code = proto.mutation.proccode, names = JSON.parse(proto.mutation.argumentnames || '[]'), kinds = procKinds(code);
    byCode[code] = { name: procName(code), params: names.map((name, i) => ({ name: String(name), kind: kinds[i] || 'n' })), defId: b };
  }

  const convStmt = (b) => {
    if (b.opcode === 'procedures_call') {
      const code = b.mutation && b.mutation.proccode, def = byCode[code];
      if (!def) return note('procedures_call');
      const ids = JSON.parse(b.mutation.argumentids || '[]'), args = {};
      def.params.forEach((p, i) => { args[p.name] = p.kind === 'b' ? boolInput(b, ids[i]) : exprInput(b, ids[i], ''); });
      return { t: 'call', name: def.name, args };
    }
    const t = OPCODE[b.opcode];
    if (!t || SPEC[t].shape) return note(b.opcode);
    return fromSpec(b, t);
  };
  function stmtList(id) {
    const out = [];
    while (id && blocks[id] && out.length < 2000) { out.push(convStmt(blocks[id])); id = blocks[id].next; }
    return out;
  }

  for (const def of Object.values(byCode)) procs[def.name] = { params: def.params, body: stmtList(def.defId.next) };

  const tops = Object.values(blocks).filter(b => b && !Array.isArray(b) && b.topLevel).sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const stacks = tops.filter(b => b.opcode === 'flipperevents_whenProgramStarts').map(h => stmtList(h.next)).filter(s => s.length);
  const isEventHat = (b) => { const t = OPCODE[b.opcode]; return t && t !== 'start' && SPEC[t].shape === 'hat'; };
  const events = tops.filter(isEventHat).map(h => ({ hat: fromSpec(h, OPCODE[h.opcode]), body: stmtList(h.next) })).filter(e => e.body.length);
  const others = tops.filter(b => b.opcode !== 'flipperevents_whenProgramStarts' && b.opcode !== 'procedures_definition' && !isEventHat(b));
  if (!stacks.length) stacks.push([]);
  if (stacks.length > 1) warn.push(stacks.length + ' “when program starts” stacks run at the same time, like on the hub.');
  if (others.length) warn.push(others.length + ' loose stack' + (others.length > 1 ? 's' : '') + ' (not under a start block) left out.');

  const program = { stacks, events, procs, vars: [...vars], lists: [...lists], sounds };
  // Common mix-up: "if sensor … then stop moving" checks once, right away; it doesn't wait for the line.
  let checkOnce = 0;
  walkProgram(program, (n) => { if (n.t === 'if' && n.cond && ['isColor', 'isDistance', 'isReflection'].includes(n.cond.t) && n.body.length === 1 && n.body[0].t === 'stopMove') checkOnce++; });
  if (checkOnce) warn.push('Tip: “if … then stop moving” checks the sensor once, right away' + (checkOnce > 1 ? ' (' + checkOnce + ' places)' : '') + '. To stop on a line, use “start moving”, then “wait until … is color”, then “stop moving”.');
  const sk = Object.keys(skipped);
  if (sk.length) warn.push('Shown in gray, not simulated yet: ' + sk.map(k => k + (skipped[k] > 1 ? ' ×' + skipped[k] : '')).join(', ') + '.');
  return { program, warn, cfg };
}

// ---------- export ----------

// Program tree -> Scratch 3 project.json. Gray (unsupported) blocks are dropped.
export function buildProject(prog) {
  const blocks = {}; let n = 0, dropped = 0;
  const nid = () => 'sim' + (++n) + Math.random().toString(36).slice(2, 7);
  const mk = (opcode, parent, extra) => { const id = nid(); blocks[id] = Object.assign({ opcode, next: null, parent, inputs: {}, fields: {}, shadow: false, topLevel: false }, extra || {}); return id; };
  const shadow = (parent, opcode, value) => { const id = mk(opcode, parent, { shadow: true }); blocks[id].fields['field_' + opcode] = [String(value), null]; return id; };

  const names = namesIn(prog);
  const varIds = {}, variables = {}, listIds = {}, lists = {}, msgIds = {}, broadcasts = {};
  names.vars.forEach((name, i) => { varIds[name] = 'simvar' + i; variables['simvar' + i] = [name, 0]; });
  names.lists.forEach((name, i) => { listIds[name] = 'simlist' + i; lists['simlist' + i] = [name, []]; });
  names.msgs.forEach((name, i) => { msgIds[name] = 'simmsg' + i; broadcasts['simmsg' + i] = name; });

  let argKinds = {};
  const defaultInput = (parent, d) => d.shadow ? shadow(parent, d.shadow, d.def) : [d.numType || 10, String(d.def ?? '')];
  const valueInput = (parent, d, e) => {
    if (d.kind === 'bool') return e && e.t !== 'noteR' ? [2, exprBlock(e, parent)] : undefined;
    if (!e || e.t === 'num' || e.t === 'text' || e.t === 'noteR') {
      const v = e && e.t !== 'noteR' ? e.v : d.def ?? '';
      return d.shadow ? [1, shadow(parent, d.shadow, v)] : [1, [d.numType || 10, String(v)]];
    }
    if (e.t === 'var') return [3, [12, e.name, varIds[e.name]], defaultInput(parent, d)];
    if (e.t === 'listContents') return [3, [13, e.list, listIds[e.list]], defaultInput(parent, d)];
    return [3, exprBlock(e, parent), defaultInput(parent, d)];
  };
  const fill = (id, x) => {
    const spec = SPEC[x.t], b = blocks[id];
    for (const [k, d] of Object.entries(spec.p || {})) {
      const v = x[k];
      if (d.kind === 'menu' || d.kind === 'matrix' || d.kind === 'sound') b.inputs[d.key] = [1, shadow(id, d.shadow, d.map ? d.map.to(v) : v)];
      else if (d.kind === 'var') b.fields[d.key] = [v, varIds[v]];
      else if (d.kind === 'list') b.fields[d.key] = [v, listIds[v]];
      else if (d.kind === 'msg') { if (d.asField) b.fields[d.key] = [v, msgIds[v]]; else b.inputs[d.key] = [1, [11, v, msgIds[v]]]; }
      else if (d.kind === 'field') b.fields[d.key] = [d.map ? d.map.to(v) : v, null];
      else { const inp = valueInput(id, d, v); if (inp) b.inputs[d.key] = inp; }
    }
    for (const [k, v] of Object.entries(spec.fixed || {})) b.fields[k] = [v, null];
    if (spec.body) { const first = chain(x.body || [], id); if (first) b.inputs[spec.body] = [2, first]; }
    if (spec.else) { const first = chain(x.else || [], id); if (first) b.inputs[spec.else] = [2, first]; }
  };
  const exprBlock = (e, parent) => {
    if (e.t === 'arg') { const k = argKinds[e.name] === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number'; const id = mk(k, parent); blocks[id].fields.VALUE = [e.name, null]; return id; }
    const id = mk(SPEC[e.t].scratch[0], parent); fill(id, e); return id;
  };
  const procCode = (name, p) => name + p.params.map(q => q.kind === 'b' ? ' %b' : ' %s').join('');
  const procArgIds = {};
  Object.entries(prog.procs || {}).forEach(([name, p], i) => { procArgIds[name] = p.params.map((_, j) => 'simarg' + i + '_' + j); });

  const stmtBlock = (x, parent) => {
    if (x.t === 'call') {
      const p = prog.procs && prog.procs[x.name]; if (!p) { dropped++; return null; }
      const ids = procArgIds[x.name];
      const id = mk('procedures_call', parent, { mutation: { tagName: 'mutation', children: [], proccode: procCode(x.name, p), argumentids: JSON.stringify(ids), warp: 'false' } });
      p.params.forEach((q, i) => { const inp = valueInput(id, q.kind === 'b' ? { kind: 'bool' } : { kind: 'text', numType: 10, def: '' }, x.args && x.args[q.name]); if (inp) blocks[id].inputs[ids[i]] = inp; });
      return id;
    }
    const spec = SPEC[x.t];
    if (!spec || !spec.scratch || spec.shape) { dropped++; return null; }
    const id = mk(spec.scratch[0], parent); fill(id, x); return id;
  };
  // Link a statement list under `parent`; returns the first block's id.
  function chain(list, parent) {
    let first = null, prev = null;
    for (const x of list) {
      const id = stmtBlock(x, prev || parent);
      if (!id) continue;
      if (prev) blocks[prev].next = id; else first = id;
      prev = id;
    }
    return first;
  }

  (prog.stacks || []).forEach((stack, i) => {
    const hat = mk('flipperevents_whenProgramStarts', null, { topLevel: true, x: i * 420, y: 0 });
    const first = chain(stack, hat); if (first) blocks[hat].next = first;
  });
  (prog.events || []).forEach((e, i) => {
    const hat = mk(SPEC[e.hat.t].scratch[0], null, { topLevel: true, x: i * 420, y: 1200 });
    fill(hat, e.hat);
    const first = chain(e.body, hat); if (first) blocks[hat].next = first;
  });
  Object.entries(prog.procs || {}).forEach(([name, p], i) => {
    argKinds = Object.fromEntries(p.params.map(q => [q.name, q.kind]));
    const ids = procArgIds[name];
    const def = mk('procedures_definition', null, { topLevel: true, x: i * 420, y: 600 });
    const proto = mk('procedures_prototype', def, { shadow: true, mutation: { tagName: 'mutation', children: [], proccode: procCode(name, p), argumentids: JSON.stringify(ids), argumentnames: JSON.stringify(p.params.map(q => q.name)), argumentdefaults: JSON.stringify(p.params.map(q => q.kind === 'b' ? 'false' : '')), warp: 'false' } });
    p.params.forEach((q, j) => {
      const a = mk(q.kind === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number', proto, { shadow: true });
      blocks[a].fields.VALUE = [q.name, null];
      blocks[proto].inputs[ids[j]] = [1, a];
    });
    blocks[def].inputs.custom_block = [1, proto];
    const first = chain(p.body, def); if (first) blocks[def].next = first;
    argKinds = {};
  });

  const EMPTY = 'd41d8cd98f00b204e9800998ecf8427e'; // md5 of an empty file
  const costume = (name, cx, cy) => ({ assetId: EMPTY, name, bitmapResolution: 1, md5ext: EMPTY + '.svg', dataFormat: 'svg', rotationCenterX: cx, rotationCenterY: cy });
  const project = {
    targets: [
      { isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts, blocks: {}, comments: {}, currentCostume: 0, costumes: [costume('backdrop1', 47, 55)], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null },
      { isStage: false, name: 'BioGlowSim', variables, lists, broadcasts: {}, blocks, comments: {}, currentCostume: 0, costumes: [costume('costume1', 240, 180)], sounds: [], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' }
    ],
    monitors: [],
    extensions: ['flipperevents', 'flippermove', 'flippermotor', 'flippersensors', 'flipperlight', 'flippersound'],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: 'BioGlow Simulator' }
  };
  return { project, dropped };
}

export function exportLlsp3(program, name) {
  const { project, dropped } = buildProject(program);
  const now = new Date().toISOString();
  const sb3 = makeZip([
    { name: 'project.json', data: JSON.stringify(project) },
    { name: 'd41d8cd98f00b204e9800998ecf8427e.svg', data: new Uint8Array(0) }
  ]);
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const manifest = {
    type: 'word-blocks', autoDelete: false, created: now, id: uuid, lastsaved: now, size: 0, name,
    slotIndex: 0, workspaceX: 0, workspaceY: 0, zoomLevel: 0.675, showAllBlocks: false, version: 38, hardware: {},
    extensions: project.extensions,
    state: { playMode: 'download', canvasDrawerTab: 'monitorTab', canvasDrawerOpen: false, hasMonitors: false },
    extraFiles: [], lastConnectedHubType: 'flipper'
  };
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" rx="10" fill="#2D5A3B"/><circle cx="30" cy="30" r="12" fill="#8FE3B0"/></svg>';
  const zip = makeZip([
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'scratch.sb3', data: sb3 },
    { name: 'icon.svg', data: icon }
  ]);
  return { zip, dropped };
}
