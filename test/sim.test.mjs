import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Sim, calibrateWheel, calibrateTrack, calibrateTop } from '../src/sim.js';
import { flatToAst, SPEC, node, lit } from '../src/blocks.js';
import { programToJson, jsonToProgram } from '../src/blocks-json.js';
import { importProject, exportLlsp3, makeZip, readZip, buildProject } from '../src/spike-io.js';
import { MISSIONS, totalScore } from '../src/field.js';

const prog = (list) => flatToAst(list.map(([t, o]) => Object.assign({ t }, o)));
const runToEnd = (sim, program, limit = 60) => { sim.run(program); let t = 0; while (sim.running && t < limit) { sim.advance(0.02); t += 0.02; } return t; };
// Program without block ids and gray note statements (export leaves those out).
const strip = (p) => JSON.parse(JSON.stringify(p, (k, v) => k === 'id' ? undefined : Array.isArray(v) ? v.filter(x => !(x && x.t === 'note')) : v));
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

test('moving forward 20 cm goes 20 cm', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  runToEnd(sim, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  assert.ok(Math.abs(sim.pose.y - 440) < 3, 'y was ' + sim.pose.y);
  assert.ok(Math.abs(sim.pose.x - 240) < 1);
});

test('spin until yaw > 90 turns clockwise about 90°', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  runToEnd(sim, prog([['startMove', { dir: 'clockwise' }], ['waitYaw', { cmp: '>', val: '90' }], ['stopMove', {}]]));
  assert.ok(sim.pose.h > 90 && sim.pose.h < 95, 'heading ' + sim.pose.h);
});

test('robot stalls against a wall instead of driving through it', () => {
  const sim = new Sim({}, { x: 1000, y: 300, h: 180 });
  runToEnd(sim, prog([['move', { dir: 'forward', val: '100', unit: 'cm' }]]));
  assert.ok(sim.pose.y >= 99, 'y ' + sim.pose.y);
  assert.ok(sim.logLines.some(l => l.includes('stalled')));
});

const piece = (x, y, extra) => Object.assign({ id: 'p', n: 'P', name: 'test piece', x, y, w: 60, h: 60, r: 0 }, extra);

test('the robot pushes a loose piece ahead of it', () => {
  const sim = new Sim({}, { x: 1600, y: 300, h: 0 }, [piece(1600, 500)]);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(Math.abs(sim.pose.y - 600) < 3, 'robot y ' + sim.pose.y);
  assert.ok(p.y > 725 && p.y < 735, 'piece y ' + p.y);
  assert.ok(Math.abs(p.r) < 1, 'straight push should not turn it: ' + p.r);
});

test('an off-center push turns the piece', () => {
  const sim = new Sim({}, { x: 1560, y: 300, h: 0 }, [piece(1655, 500)]);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(p.y > 520 || p.x > 1665, 'piece should have moved: ' + p.x + ',' + p.y);
  assert.ok(Math.abs(p.r) > 3, 'piece should have turned: ' + p.r);
});

test('a piece pinned against a fixed model stops the robot', () => {
  // M02 sits at (630, 540); pin a piece just below it.
  const sim = new Sim({}, { x: 630, y: 230, h: 0 }, [piece(630, 440)]);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(p.y < 480, 'piece y ' + p.y);
  assert.ok(sim.logLines.some(l => l.includes('Bumped')));
});

test('fixed models block the robot unless shove mode is on', () => {
  const fixed = new Sim({}, { x: 630, y: 300, h: 0 });
  runToEnd(fixed, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  assert.equal(fixed.objects.find(o => o.n === '02').y, 540);
  const shove = new Sim({ shove: true }, { x: 630, y: 300, h: 0 });
  runToEnd(shove, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  assert.ok(shove.objects.find(o => o.n === '02').y > 560);
});

test('a fresh run puts pushed pieces back; a match keeps them', () => {
  const layout = [piece(1600, 500)];
  const sim = new Sim({}, { x: 1600, y: 300, h: 0 }, layout);
  const push = prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]);
  runToEnd(sim, push);
  assert.ok(sim.objects.find(o => o.loose).y > 500);
  sim.run(prog([])); assert.equal(sim.objects.find(o => o.loose).y, 500);
  assert.equal(layout[0].y, 500, 'layout is never changed by the simulation');
  sim.startMatch(); runToEnd(sim, push);
  const moved = sim.objects.find(o => o.loose).y;
  sim.run(prog([])); assert.equal(sim.objects.find(o => o.loose).y, moved);
});

test('repeat runs its body N times and if skips when false', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  runToEnd(sim, prog([
    ['repeat', { val: '3' }], ['motor', { port: 'E', dir: 'clockwise', val: '10', unit: 'degrees' }], ['end', {}],
    ['ifColor', { port: 'C', color: 'black' }], ['motor', { port: 'E', dir: 'clockwise', val: '100', unit: 'degrees' }], ['end', {}]
  ]));
  assert.ok(Math.abs(sim.arms.E - 30) < 0.01, 'arm ' + sim.arms.E);
});

test('color sensor sees white in home and black on a mat line', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  assert.equal(sim.sens.color, 'white');
  const onLine = new Sim({ collide: false }, { x: 600, y: 892 - 70, h: 0 });
  assert.equal(onLine.sens.color, 'black');
});

test('driving onto a line with start moving + wait until black stops on it', () => {
  // The bottom-middle line runs from (940,422) to (1008,306); drive across it heading north.
  const sim = new Sim({}, { x: 975, y: 150, h: 0 }, []);
  sim.cfg.collide = false;
  runToEnd(sim, prog([['startMove', { dir: 'forward' }], ['waitColor', { port: 'C', color: 'black' }], ['stopMove', {}]]));
  assert.equal(sim.sens.color, 'black');
  assert.ok(sim.seen.some(s => s[2] === 'black'), 'black spot recorded for the field drawing');
});

test('the color sensor can sit left or right of center', () => {
  const sim = new Sim({ color: { x: -60, y: 70 } }, { x: 600, y: 500, h: 0 }, []);
  assert.ok(Math.abs(sim.sens.spot[0] - 540) < 0.01 && Math.abs(sim.sens.spot[1] - 570) < 0.01, JSON.stringify(sim.sens.spot));
  const old = new Sim({ colorOff: 50, colorSide: 20 }, { x: 600, y: 500, h: 0 }, []);
  assert.deepEqual(old.cfg.color, { x: 20, y: 50 }, 'settings from older versions carry over');
});

const lift = (extra) => Object.assign({ id: 'a', port: 'E', motion: 'lift', x: 0, y: 100, dir: 'front', len: 90, rest: 'up', cw: 'lowers', ratio: 1 }, extra);

test('a lift arm stops when it reaches the mat', () => {
  const sim = new Sim({ arms: [lift()] }, { x: 1600, y: 300, h: 0 }, []);
  runToEnd(sim, prog([['motor', { port: 'E', dir: 'clockwise', val: '1', unit: 'rotations' }]]));
  assert.ok(Math.abs(sim.arms.E - 90) < 1, 'arm stopped at flat: ' + sim.arms.E);
  assert.ok(sim.logLines.some(l => l.includes('pressed down on the mat')));
});

test('a lift arm coming down presses on a model and stops', () => {
  // M02 is 70 x 60 at (630, 540); the arm tip reaches 190 mm ahead of the axle.
  const sim = new Sim({ arms: [lift()] }, { x: 630, y: 370, h: 0 }, []);
  runToEnd(sim, prog([['motor', { port: 'E', dir: 'clockwise', val: '90', unit: 'degrees' }]]));
  assert.ok(sim.arms.E > 55 && sim.arms.E < 62, 'arm held up by the model at about 30°: ' + sim.arms.E);
  assert.ok(sim.logLines.some(l => l.includes('pressed against M02')));
});

test('a lowered arm pushes pieces when driving; a raised one passes over', () => {
  const run = (rest) => {
    const sim = new Sim({ arms: [lift({ rest })] }, { x: 1600, y: 300, h: 0 }, [piece(1600, 620)]);
    runToEnd(sim, prog([['move', { dir: 'forward', val: '15', unit: 'cm' }]]));
    return sim.objects.find(o => o.loose).y;
  };
  assert.ok(run('down') > 650, 'lowered arm pushes the piece');
  assert.equal(run('up'), 620, 'raised arm goes over it');
});

test('a sweep arm swings sideways and pushes a piece', () => {
  const arm = { id: 's', port: 'F', motion: 'sweep', x: 70, y: 100, dir: 'front', len: 100, cw: 'right', ratio: 1 };
  const sim = new Sim({ arms: [arm] }, { x: 1600, y: 300, h: 0 }, [piece(1730, 460)]);
  runToEnd(sim, prog([['motor', { port: 'F', dir: 'clockwise', val: '90', unit: 'degrees' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(Math.abs(sim.arms.F - 90) < 0.5, 'arm swung all the way: ' + sim.arms.F);
  assert.ok(p.x > 1730 || p.y < 460, 'piece moved: ' + p.x + ',' + p.y);
});

test('the distance sensor can face sideways', () => {
  const sim = new Sim({ dist: { x: 80, y: 0, dir: 'right' } }, { x: 1000, y: 900, h: 0 }, []);
  assert.ok(Math.abs(sim.sens.dist - (2000 - 1080) / 10) < 0.1, 'distance to the right wall: ' + sim.sens.dist);
});

test('interrupting outside home during a match costs a token', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  sim.startMatch();
  sim.run(prog([['move', { dir: 'forward', val: '60', unit: 'cm' }]]));
  sim.advance(2);
  assert.equal(sim.stop(), true);
});

// One of every block: statements in a stack, each reporter inside a slot, plus variables and a My Block.
function everything() {
  const main = [];
  const sensorCond = () => node('isColor', { port: 'C', color: 'red' });
  for (const [t, s] of Object.entries(SPEC)) {
    if (s.shape || s.end || ['note', 'setVar', 'changeVar'].includes(t)) continue;
    const n = node(t);
    if ('cond' in n) n.cond = sensorCond();
    if (n.body) n.body = [node('stopMove')];
    if (n.else) n.else = [node('resetTimer')];
    main.push(n);
  }
  for (const [t, s] of Object.entries(SPEC)) {
    if (!['n', 'b'].includes(s.shape) || t === 'noteR') continue;
    const e = node(t);
    for (const [k, d] of Object.entries(s.p || {})) if (d.kind === 'bool') e[k] = node('isPressed', { port: 'F' });
    main.push(s.shape === 'b' ? node('if', { cond: e, body: [node('beep')] }) : node('show', { text: e }));
  }
  main.push({ t: 'setVar', name: 'speed', val: lit(30) });
  main.push({ t: 'changeVar', name: 'speed', val: { t: 'add', a: { t: 'var', name: 'speed' }, b: lit(5) } });
  main.push({ t: 'call', name: 'jump', args: { height: { t: 'var', name: 'speed' }, fast: node('isPressed', { port: 'F' }) } });
  const events = Object.entries(SPEC).filter(([t, s]) => s.shape === 'hat' && t !== 'start').map(([t]) => {
    const hat = node(t); if ('cond' in hat) hat.cond = node('isPressed', { port: 'F' });
    return { hat, body: [node('beep')] };
  });
  return {
    stacks: [main, [node('forever', { body: [node('wait')] })], [node('stop', { opt: 'this stack' })]],
    events,
    procs: { jump: { params: [{ name: 'height', kind: 'n' }, { name: 'fast', kind: 'b' }], body: [node('ifElse', { cond: { t: 'arg', name: 'fast' }, body: [node('move', { val: { t: 'arg', name: 'height' } })], else: [node('wait')] })] } },
    vars: ['speed'], lists: ['my list'], sounds: {}
  };
}

test('every block survives SPIKE export and re-import', async () => {
  const all = everything();
  const { zip, dropped } = exportLlsp3(all, 'all blocks');
  assert.equal(dropped, 0);
  const back = await importProject(ab(zip));
  assert.deepEqual(strip(back.program), strip(all));
});

// Opens an exported .llsp3 the way the SPIKE App does: outer zip, manifest, inner scratch.sb3, project.json.
const openLlsp3 = (zip) => {
  const bytes = (e) => e.method === 8 ? zlib.inflateRawSync(e.data) : Buffer.from(e.data);
  const outer = readZip(ab(zip)), sb3 = bytes(outer['scratch.sb3']), inner = readZip(ab(sb3));
  const text = (e) => bytes(e).toString('utf8');
  return { outer, sb3, inner, manifest: JSON.parse(text(outer['manifest.json'])), project: JSON.parse(text(inner['project.json'])) };
};

test('SPIKE export has the SPIKE App 3 file layout', () => {
  const { outer, sb3, inner, manifest, project } = openLlsp3(exportLlsp3(everything(), 'all blocks').zip);
  assert.deepEqual(Object.keys(outer).sort(), ['icon.svg', 'manifest.json', 'scratch.sb3']);
  for (const e of [...Object.values(outer), ...Object.values(inner)]) assert.equal(e.method, 0);
  assert.ok(Buffer.from(outer['icon.svg'].data).toString().startsWith('<svg'));

  assert.equal(manifest.type, 'word-blocks');
  assert.equal(manifest.name, 'all blocks');
  for (const k of ['created', 'lastsaved']) assert.ok(!isNaN(Date.parse(manifest[k])), k);
  assert.equal(typeof manifest.id, 'string');
  assert.deepEqual(manifest.extensions, project.extensions);

  // Every asset the project names is in the sb3, named by the md5 of its bytes
  // (SPIKE's own files use an empty .svg for the stage and sprite too).
  assert.equal(project.meta.semver, '3.0.0');
  assert.equal(project.targets[0].isStage, true);
  for (const t of project.targets) for (const c of t.costumes) {
    const f = inner[c.md5ext];
    assert.ok(f, c.md5ext + ' missing');
    assert.equal(crypto.createHash('md5').update(f.data).digest('hex'), c.assetId);
  }

  // Block links point both ways and every opcode comes from a loaded extension or core Scratch.
  const core = new Set(['event', 'control', 'operator', 'data', 'procedures', 'argument', 'sound']);
  const stage = project.targets[0];
  for (const t of project.targets) for (const [id, b] of Object.entries(t.blocks)) {
    const ext = b.opcode.split('_')[0];
    assert.ok(core.has(ext) || project.extensions.includes(ext), b.opcode);
    if (b.topLevel) { assert.equal(b.parent, null); assert.equal(typeof b.x, 'number'); assert.equal(typeof b.y, 'number'); }
    else assert.ok(t.blocks[b.parent], id + ' parent');
    if (b.next) assert.equal(t.blocks[b.next].parent, id, id + ' next');
    for (const inp of Object.values(b.inputs)) for (const v of inp.slice(1)) {
      if (typeof v === 'string') assert.equal(t.blocks[v].parent, id, id + ' input');
      else if (Array.isArray(v) && v[0] === 12) assert.ok(t.variables[v[2]], 'variable ' + v[1]);
      else if (Array.isArray(v) && v[0] === 13) assert.ok(t.lists[v[2]], 'list ' + v[1]);
      else if (Array.isArray(v) && v[0] === 11) assert.equal(stage.broadcasts[v[2]], v[1]);
    }
    for (const [k, f] of Object.entries(b.fields)) {
      if (k === 'VARIABLE') assert.ok(t.variables[f[1]], 'variable ' + f[0]);
      if (k === 'LIST') assert.ok(t.lists[f[1]], 'list ' + f[0]);
      if (k === 'BROADCAST_OPTION') assert.equal(stage.broadcasts[f[1]], f[0]);
    }
  }
});

test('every block survives the block editor format', () => {
  const all = everything();
  all.stacks[0].push({ t: 'note', op: 'flipperlight_lightDisplayImageOn' }, node('show', { text: { t: 'noteR', op: 'flippersensors_force' } }));
  const back = jsonToProgram(programToJson(all));
  assert.deepEqual(JSON.parse(JSON.stringify(back.program)), JSON.parse(JSON.stringify(all)));
});

const runProgram = (program, opts = {}) => { const sim = new Sim(opts.cfg || {}, { x: 1000, y: 600, h: 0 }, []); sim.cfg.collide = false; runToEnd(sim, program, opts.limit || 30); return sim; };
const v = (name) => ({ t: 'var', name });

test('operators and variables follow Scratch rules', () => {
  const sim = runProgram({ stacks: [[
    { t: 'setVar', name: 'x', val: { t: 'mul', a: { t: 'add', a: lit(3), b: lit(4) }, b: lit(2) } },
    { t: 'changeVar', name: 'x', val: lit(-4) },
    { t: 'setVar', name: 'word', val: { t: 'join', a: lit('robot'), b: v('x') } },
    { t: 'setVar', name: 'third', val: node('letterOf', { a: 3, b: v('word') }) },
    { t: 'setVar', name: 'cmp', val: node('gt', { a: lit('10'), b: lit('9') }) },
    { t: 'setVar', name: 'mod', val: node('mod', { a: -7, b: 3 }) },
    { t: 'setVar', name: 'r', val: node('random', { a: 1, b: 6 }) },
    node('show', { text: v('word') })
  ]], procs: {}, vars: [] });
  assert.equal(sim.vars.x, 10);
  assert.equal(sim.vars.word, 'robot10');
  assert.equal(sim.vars.third, 'b');
  assert.equal(sim.vars.cmp, true, '"10" > "9" compares as numbers');
  assert.equal(sim.vars.mod, 2, 'mod takes the sign of the divisor');
  assert.ok(Number.isInteger(sim.vars.r) && sim.vars.r >= 1 && sim.vars.r <= 6);
  assert.equal(sim.display, 'robot10');
});

test('if-else, repeat until and stop all', () => {
  const sim = runProgram({ stacks: [[
    { t: 'setVar', name: 'n', val: lit(0) },
    node('repeatUntil', { cond: node('gt', { a: v('n'), b: '4' }), body: [{ t: 'changeVar', name: 'n', val: lit(1) }] }),
    node('ifElse', { cond: node('eq', { a: v('n'), b: '5' }), body: [node('show', { text: 'five' })], else: [node('show', { text: 'other' })] }),
    node('stop', { opt: 'all' }),
    node('show', { text: 'never' })
  ]], procs: {}, vars: [] });
  assert.equal(sim.vars.n, 5);
  assert.equal(sim.display, 'five');
  assert.ok(sim.logLines.some(l => l.includes('stop all')));
});

test('My Blocks take inputs, and runaway recursion is stopped', () => {
  const sim = runProgram({ stacks: [[{ t: 'call', name: 'twice', args: { n: lit(21) } }]], procs: {
    twice: { params: [{ name: 'n', kind: 'n' }], body: [{ t: 'setVar', name: 'out', val: node('mul', { a: { t: 'arg', name: 'n' }, b: 2 }) }] }
  }, vars: [] });
  assert.equal(sim.vars.out, 42);
  const loop = runProgram({ stacks: [[{ t: 'call', name: 'again', args: {} }]], procs: { again: { params: [], body: [{ t: 'call', name: 'again', args: {} }] } }, vars: [] });
  assert.ok(loop.logLines.some(l => l.includes('calls itself too many times')));
});

test('several "when program starts" stacks run at the same time', () => {
  const sim = new Sim({}, { x: 1000, y: 300, h: 0 }, []);
  sim.cfg.collide = false;
  const t = runToEnd(sim, { stacks: [
    [node('move', { dir: 'forward', val: 20, unit: 'cm' })],
    [node('motor', { port: 'E', dir: 'clockwise', val: 2, unit: 'seconds' })]
  ], procs: {}, vars: [] });
  assert.ok(Math.abs(sim.pose.y - 500) < 3, 'drove 20 cm: ' + sim.pose.y);
  assert.ok(t < 2.3, 'both together take about 2 s, not the sum: ' + t);
});

test('sensor and motor reporters', () => {
  const sim = runProgram({ stacks: [[
    node('motor', { port: 'F', dir: 'clockwise', val: 450, unit: 'degrees' }),
    { t: 'setVar', name: 'pos', val: node('motorPos', { port: 'F' }) },
    { t: 'setVar', name: 'rel', val: node('motorRel', { port: 'F' }) },
    node('startMove', { dir: 'clockwise' }),
    node('waitUntil', { cond: node('gt', { a: node('angle', { axis: 'yaw' }), b: '45' }) }),
    node('stopMove'),
    { t: 'setVar', name: 'yaw', val: node('angle', { axis: 'yaw' }) },
    node('wait', { val: 0.5 }),
    { t: 'setVar', name: 'time', val: node('timer') },
    { t: 'setVar', name: 'refl', val: node('reflection', { port: 'C' }) }
  ]], procs: {}, vars: [] }, { cfg: { arms: [] } });
  assert.equal(sim.vars.pos, 90);
  assert.equal(sim.vars.rel, 450);
  assert.ok(sim.vars.yaw >= 45 && sim.vars.yaw < 50, 'yaw ' + sim.vars.yaw);
  assert.ok(sim.vars.time > 0.5, 'timer ' + sim.vars.time);
  assert.equal(sim.vars.refl, 25, 'green mat reflects about 25 %');
});


const prog3 = (stacks, extra = {}) => Object.assign({ stacks, events: [], procs: {}, vars: [], lists: [], sounds: {} }, extra);

test('lists work like Scratch lists', () => {
  const L = 'items';
  const sim = runProgram(prog3([[
    node('listClear', { list: L }),
    node('listAdd', { item: 'a', list: L }), node('listAdd', { item: 'b', list: L }), node('listAdd', { item: 'c', list: L }),
    node('listInsert', { item: 'x', index: 2, list: L }),
    node('listReplace', { index: 'last', list: L, item: 'z' }),
    node('listDelete', { index: 1, list: L }),
    { t: 'setVar', name: 'len', val: node('listLength', { list: L }) },
    { t: 'setVar', name: 'second', val: node('listItem', { index: 2, list: L }) },
    { t: 'setVar', name: 'where', val: node('listIndexOf', { item: 'Z', list: L }) },
    { t: 'setVar', name: 'has', val: node('listContains', { list: L, item: 'b' }) },
    { t: 'setVar', name: 'all', val: { t: 'listContents', list: L } }
  ]], { lists: [L] }));
  assert.deepEqual(sim.lists[L], ['x', 'b', 'z']);
  assert.equal(sim.vars.len, 3);
  assert.equal(sim.vars.second, 'b');
  assert.equal(sim.vars.where, 3, 'item # ignores case');
  assert.equal(sim.vars.has, true);
  assert.equal(sim.vars.all, 'xbz', 'single letters join without spaces');
});

test('broadcast starts "when I receive" stacks; broadcast and wait waits for them', () => {
  const sim = runProgram(prog3([[
    node('broadcastWait', { msg: 'go' }),
    { t: 'setVar', name: 'after', val: { t: 'var', name: 'count' } }
  ]], { events: [{ hat: node('whenBroadcast', { msg: 'go' }), body: [node('wait', { val: 0.3 }), { t: 'changeVar', name: 'count', val: lit(1) }] }] }));
  assert.equal(sim.vars.count, 1);
  assert.equal(sim.vars.after, 1, 'the main stack waited for the receiver to finish');
});

test('event start blocks fire when their condition turns true', () => {
  // Drive north out of left home: the color sensor crosses the red home edge, then the timer passes 1 s.
  const sim = new Sim({}, { x: 240, y: 240, h: 0 }, []);
  sim.cfg.collide = false;
  const program = prog3([[node('move', { dir: 'forward', val: 40, unit: 'cm' }), node('wait', { val: 1 }), node('stop', { opt: 'all' })]], { events: [
    { hat: node('whenColor', { port: 'C', color: 'red' }), body: [{ t: 'changeVar', name: 'reds', val: lit(1) }] },
    { hat: node('whenTimer', { val: 1 }), body: [{ t: 'setVar', name: 'timer', val: lit('yes') }] },
    { hat: node('whenButton', { button: 'left', event: 'pressed' }), body: [{ t: 'setVar', name: 'button', val: lit('pressed') }] }
  ] });
  sim.run(program);
  let t = 0;
  while (sim.running && t < 10) { if (Math.abs(t - 0.5) < 0.01) sim.setButton('left', true); sim.advance(0.02); t += 0.02; }
  assert.equal(sim.vars.reds, 1, 'crossed the red edge once');
  assert.equal(sim.vars.timer, 'yes');
  assert.equal(sim.vars.button, 'pressed');
});

test('a program with event start blocks keeps listening until stopped', () => {
  const sim = new Sim({}, { x: 1000, y: 600, h: 0 }, []);
  sim.run(prog3([[node('wait', { val: 0.1 })]], { events: [{ hat: node('whenButton', { button: 'right', event: 'pressed' }), body: [node('show', { text: 'hi' })] }] }));
  sim.advance(1);
  assert.equal(sim.running, true);
  sim.setButton('right', true); sim.advance(0.1);
  assert.equal(sim.display, 'hi');
});

test('the light matrix shows images, pixels and brightness', () => {
  const sim = runProgram(prog3([[
    node('setBrightness', { b: 50 }),
    node('showImage', { image: '9000000000000000000000009' }),
    node('setPixel', { x: 3, y: 3, b: 100 }),
    node('centerLight', { color: 'blue' })
  ]]));
  assert.equal(sim.matrix[0], 50);
  assert.equal(sim.matrix[24], 50);
  assert.equal(sim.matrix[12], 100);
  assert.equal(sim.matrix[1], 0);
  assert.equal(sim.centerLight, 'blue');
  const timed = runProgram(prog3([[node('showImageFor', { image: '9'.repeat(25), val: 0.2 })]]));
  assert.ok(timed.matrix.every(v => v === 0), 'turned off after the time');
});

test('sounds play for their length and volume can change', () => {
  const sim = new Sim({}, { x: 1000, y: 600, h: 0 }, []);
  const heard = []; sim.onSound = (e) => heard.push(e);
  const t = runToEnd(sim, prog3([[
    node('setVolume', { v: 40 }), node('changeVolume', { v: -10 }),
    node('playSoundWait', { sound: 'Cat Meow 1' }),
    node('beep', { note: 72, val: 0.25 }),
    { t: 'setVar', name: 'vol', val: node('volume') }
  ]], { sounds: { 'Cat Meow 1': 1.25 } }));
  assert.equal(sim.vars.vol, 30);
  assert.deepEqual(heard.filter(e => e.type !== 'stop').map(e => e.type + ':' + (e.name || e.note) + ':' + e.volume), ['sound:Cat Meow 1:30', 'beep:72:30']);
  assert.ok(t > 1.45 && t < 1.7, 'waited for the sound and the beep: ' + t);
});


test('calibration recovers a robot\'s real wheel size, spacing and speed', () => {
  // A pretend real robot with odd numbers; "measure" it with the three calibration programs.
  const real = { wheel: 61, track: 131, top: 870, ramp: 0.3, collide: false };
  // Drive east along the middle of the mat so nothing is in the way.
  const measure = (program) => { const sim = new Sim(real, { x: 200, y: 750, h: 90 }, []); runToEnd(sim, program); return sim; };
  const fwd = measure(prog([['move', { dir: 'forward', val: '5', unit: 'rotations' }]]));
  const cm1 = (fwd.pose.x - 200) / 10;
  const spin = measure(prog([['move', { dir: 'clockwise', val: '2', unit: 'rotations' }]]));
  const timed = measure(prog([['speed', { pct: '50' }], ['move', { dir: 'forward', val: '2', unit: 'seconds' }]]));
  const cm3 = (timed.pose.x - 200) / 10;
  const wheel = calibrateWheel(5, cm1);
  const track = calibrateTrack(2, spin.pose.h - 90, wheel);
  const top = calibrateTop(50, 2, cm3, wheel, real.ramp);
  assert.ok(Math.abs(wheel - 61) < 0.5, 'wheel ' + wheel);
  assert.ok(Math.abs(track - 131) < 1.5, 'track ' + track);
  assert.ok(Math.abs(top - 870) < 15, 'top speed ' + top);
});

test('with a speed-up ramp the robot starts slower but still stops at the distance', () => {
  const run = (ramp) => { const sim = new Sim({ ramp, collide: false }, { x: 1000, y: 300, h: 0 }, []); const t = runToEnd(sim, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]])); return { t, y: sim.pose.y }; };
  const instant = run(0), ramped = run(0.5);
  assert.ok(Math.abs(ramped.y - 600) < 4, 'distance still 30 cm: ' + ramped.y);
  // 0.5 s to full speed is 0.25 s to the default 50 %, costing about 0.125 s.
  assert.ok(ramped.t > instant.t + 0.08, 'took longer: ' + instant.t + ' vs ' + ramped.t);
});

test('mission models react: pushing M03 drops the flag, touching M10 loses points', () => {
  // M03 Flip the Rock is at (80, 658); drive the robot west into it.
  const sim = new Sim({}, { x: 300, y: 658, h: -90 }, []);
  assert.equal(sim.mission.m10a, true, 'M10 starts complete');
  runToEnd(sim, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  assert.equal(sim.mission.m03a, true);
  assert.ok(sim.objects.find(o => o.key === 'm03').done);
  assert.ok(sim.logLines.some(l => l.includes('M03')));
  // M10 snail habitat is at (1040, 720); bump it from the east.
  const bump = new Sim({}, { x: 1220, y: 720, h: -90 }, []);
  runToEnd(bump, prog([['move', { dir: 'forward', val: '15', unit: 'cm' }]]));
  assert.equal(bump.mission.m10b, false);
});

test('pushing M02 pops seeds; seeds pushed into the M14 dock count', () => {
  const sim = new Sim({}, { x: 630, y: 360, h: 0 }, []);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '15', unit: 'cm' }]]));
  const seeds = sim.objects.filter(o => o.seed);
  assert.ok(seeds.length >= 2, 'seeds popped: ' + seeds.length);
  assert.equal(sim.mission.m02, seeds.length);
  // Put a seed inside the dock holding M14 (city dock by default) and check the count.
  const dock = sim.objects.find(o => o.dock && o.holds === 'M14');
  Object.assign(seeds[0], { x: dock.x, y: dock.y });
  sim.runMechanisms(0.01);
  assert.equal(sim.mission.m14a, 1);
});

test('M12: slide a low arm under the cane and lift fast to flip it up; slow lifts and presses fail', () => {
  // The cane lies at x 1940 from y 795 to 955. Come from the west, arm flat, and slide under it.
  const arm = { id: 'a', port: 'E', motion: 'lift', x: 0, y: 100, dir: 'front', len: 90, rest: 'down', cw: 'raises', ratio: 1 };
  const run = (speed, cfgArm = arm) => {
    const s = new Sim({ arms: [cfgArm] }, { x: 1700, y: 880, h: 90 }, []);
    runToEnd(s, prog([['move', { dir: 'forward', val: '8', unit: 'cm' }], ['motorSpeed', { port: 'E', pct: String(speed) }], ['motor', { port: 'E', dir: 'clockwise', val: '60', unit: 'degrees' }]]));
    return s;
  };
  const fast = run(100);
  assert.ok(!fast.logLines.some(l => l.startsWith('Bumped')), 'the low arm slides under the cane');
  assert.equal(fast.mission.m12a, true);
  assert.ok(fast.objects.find(o => o.key === 'm12cane').lifted);
  const slow = run(30);
  assert.notEqual(slow.mission.m12a, true);
  assert.ok(slow.logLines.some(l => l === 'M12: it lifted a little and fell back down.'));
  // Gearing the arm down makes the same motor speed too slow.
  assert.notEqual(run(100, { ...arm, ratio: 1 / 3 }).mission.m12a, true);
  // Pressing down on the tree does nothing.
  const press = new Sim({ arms: [{ ...arm, rest: 'up', cw: 'lowers' }] }, { x: 1940, y: 560, h: 0 }, []);
  runToEnd(press, prog([['motor', { port: 'E', dir: 'clockwise', val: '90', unit: 'degrees' }]]));
  assert.notEqual(press.mission.m12a, true);
});

test('reads deflate-compressed files like the SPIKE app writes', async () => {
  const { project } = buildProject(prog([['move', { dir: 'back', val: '2', unit: 'rotations' }]]));
  const deflateZip = (entries) => {
    // Minimal zip writer using method 8 (deflate).
    const chunks = [], central = []; let off = 0;
    for (const [name, data] of entries) {
      const n = Buffer.from(name), c = zlib.deflateRawSync(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      chunks.push(lh, n, c);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
      central.push(ch, n); off += 30 + n.length + c.length;
    }
    const cd = Buffer.concat(central); const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...chunks, cd, end]);
  };
  const sb3 = deflateZip([['project.json', Buffer.from(JSON.stringify(project))]]);
  const llsp3 = deflateZip([['manifest.json', Buffer.from('{}')], ['scratch.sb3', sb3]]);
  const res = await importProject(ab(llsp3));
  assert.equal(res.program.stacks[0].length, 1);
  assert.equal(res.program.stacks[0][0].dir, 'back');
});

test('rejects SPIKE Python projects with a clear message', async () => {
  const zip = makeZip([{ name: 'manifest.json', data: '{}' }, { name: 'projectbody.json', data: '{}' }]);
  await assert.rejects(importProject(ab(zip)), /Python/);
});

test('scoring follows the rulebook rules', () => {
  assert.equal(totalScore({}, 6, false), 50);
  assert.equal(totalScore({ m01b: true }, 0, false), 0, 'bonus needs the main condition');
  assert.equal(totalScore({ m04a: true, m04b: true, m04x: true }, 0, false), 0, 'katydid outside zeroes M04');
  assert.equal(totalScore({ m14a: 2, m14b: 5 }, 0, true), 20 + 10 + 10, 'M14 bonus capped by seeds in station');
  assert.equal(MISSIONS.length, 15);
});

// Optional: point SPIKE_FIXTURES at a folder of your own .llsp3 files (kept out of git).
const fixtures = process.env.SPIKE_FIXTURES;
test('imports and round-trips local SPIKE files', { skip: !fixtures && 'set SPIKE_FIXTURES to a folder of .llsp3 files' }, async () => {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.llsp3')) files.push(p); } };
  walk(fixtures);
  assert.ok(files.length > 0, 'no .llsp3 files found');
  const manifestGaps = new Set();
  for (const f of files) {
    const res = await importProject(ab(fs.readFileSync(f)));
    const out = exportLlsp3(res.program, 'rt').zip;
    const back = await importProject(ab(out));
    // The export has the files and manifest type of the real one (monitors.json is optional); other manifest differences are listed.
    const real = openLlsp3(fs.readFileSync(f)), ours = openLlsp3(out);
    for (const k of Object.keys(ours.outer)) assert.ok(real.outer[k], path.basename(f) + ' has no ' + k);
    assert.equal(ours.manifest.type, real.manifest.type);
    assert.equal(ours.project.meta.semver, real.project.meta.semver);
    for (const k of Object.keys(real.manifest)) if (!(k in ours.manifest)) manifestGaps.add(k);
    // Gray reporters export as plain values, so only compare programs without them.
    // Exports don't carry SPIKE's sound recordings, so their lengths aren't compared.
    if (!JSON.stringify(res.program).includes('"noteR"')) assert.deepEqual(strip({ ...back.program, sounds: {} }), strip({ ...res.program, sounds: {} }), path.basename(f));
    const sim = new Sim(res.cfg, { x: 240, y: 240, h: 0 });
    runToEnd(sim, res.program, 150);
  }
  console.log(`  checked ${files.length} file(s)`);
  if (manifestGaps.size) console.log('  manifest keys in SPIKE files but not in exports: ' + [...manifestGaps].join(', '));
});

test('the block editor ignores loose blocks and reads an empty "if" as false', () => {
  const json = { blocks: { languageVersion: 0, blocks: [
    { type: 'sim_start', id: 'h', x: 0, y: 0, next: { block: { type: 'sim_if', id: 'i', inputs: { DO: { block: { type: 'sim_stopMove', id: 's' } } }, next: { block: { type: 'sim_wait', id: 'w', inputs: { val: { shadow: { type: 'sim_num', fields: { V: 2 } } } } } } } } },
    { type: 'sim_move', id: 'loose', x: 300, y: 300, fields: { dir: 'back', unit: 'cm' } }
  ] } };
  const { program, warn } = jsonToProgram(json);
  assert.deepEqual(program.stacks[0].map(b => b.t), ['if', 'wait']);
  assert.equal(program.stacks[0][0].cond, null);
  assert.deepEqual(program.stacks[0][1].val, { t: 'num', v: '2' });
  assert.deepEqual(program.stacks[0].map(b => b.id), ['i', 'w']);
  assert.ok(warn.some(w => w.includes('empty condition')));
  const sim = runProgram(program);
  assert.ok(!sim.logLines.some(l => l.includes('Bumped')), 'the stop block inside the empty if did not run');
});

test('a model set to one approach side only reacts to pushes from that side', () => {
  // M03 is at (80, 658). Driving west into it is a push from the east.
  const fromEast = () => { const s = new Sim({}, { x: 300, y: 658, h: -90 }, []); return s; };
  const wrong = fromEast(); wrong.approach = { m03: 'south' };
  runToEnd(wrong, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  assert.equal(wrong.mission.m03a, undefined, 'a push from the east does not count when south is required');
  assert.ok(wrong.logLines.some(l => l === 'M03: touched, but nothing happened.'));
  const right = fromEast(); right.approach = { m03: 'east' };
  runToEnd(right, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  assert.equal(right.mission.m03a, true);
  // From the south: drive north into its bottom face.
  const south = new Sim({}, { x: 80, y: 420, h: 0 }, []); south.approach = { m03: 'south' };
  runToEnd(south, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  assert.equal(south.mission.m03a, true);
});

test('M06: a slow push keeps all the leaf fragments, a fast one scatters some', () => {
  const push = (pct) => {
    const s = new Sim({ arms: [] }, { x: 1502, y: 780, h: 0 }, []);
    runToEnd(s, prog([['speed', { pct: String(pct) }], ['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
    return s;
  };
  const slow = push(25), fast = push(100);
  assert.equal(slow.mission.m06, 3);
  assert.equal(fast.mission.m06, 1);
  assert.ok(slow.logLines.some(l => l.includes('3 of 3 leaf fragments')));
  assert.notEqual(slow.mission.m07a, true, 'pushing is not the M07 action');
});

test('M07: arm up, drive in, lower the arm onto it, drive back: the mycelium extends', () => {
  const arm = { id: 'a1', port: 'E', motion: 'lift', x: 0, y: 100, dir: 'front', len: 90, rest: 'up', cw: 'lowers', ratio: 1 };
  const steps = (back) => [['move', { dir: 'forward', val: '20', unit: 'cm' }], ['motor', { port: 'E', dir: 'clockwise', val: '90', unit: 'degrees' }], ['move', { dir: 'back', val: String(back), unit: 'cm' }]];
  const s = new Sim({ arms: [arm] }, { x: 1582, y: 760, h: 0 }, []);
  runToEnd(s, prog(steps(10)));
  assert.equal(s.mission.m07a, true);
  assert.ok(s.objects.find(o => o.key === 'm07').done);
  // Not pulled far enough.
  const short = new Sim({ arms: [arm] }, { x: 1582, y: 760, h: 0 }, []);
  runToEnd(short, prog(steps(2)));
  assert.notEqual(short.mission.m07a, true);
  // Driving back without lowering the arm onto it does nothing.
  const t = new Sim({ arms: [arm] }, { x: 1582, y: 760, h: 0 }, []);
  runToEnd(t, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }], ['move', { dir: 'back', val: '10', unit: 'cm' }]]));
  assert.notEqual(t.mission.m07a, true);
});
