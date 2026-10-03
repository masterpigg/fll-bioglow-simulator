import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, reflectOf, photoSampler } from '../src/mat-photo.js';
import { Sim } from '../src/sim.js';
import { flatToAst, node } from '../src/blocks.js';
import { FW, FH } from '../src/field.js';

const prog = (list) => flatToAst(list.map(([t, o]) => Object.assign({ t }, o)));
const runToEnd = (sim, program, limit = 60) => { sim.run(program); let t = 0; while (sim.running && t < limit) { sim.advance(0.02); t += 0.02; } return t; };

// A fake mat photo at 1 px per mm: paint(x, y) gives the RGB at field mm (y up from the home wall).
function photo(paint, w = FW, h = FH) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const [r, g, b] = paint(px * FW / w, FH - py * FH / h), i = (py * w + px) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return photoSampler(data, w, h, FW, FH);
}

test('photo colors get SPIKE color names', () => {
  // Values sampled from the official mat photo.
  assert.equal(classify(0, 0, 3), 'black');           // printed line
  assert.equal(classify(251, 253, 254), 'white');     // home area
  assert.equal(classify(223, 83, 80), 'red');         // red home edge
  assert.equal(classify(78, 139, 188), 'blue');       // blue home edge
  assert.equal(classify(121, 184, 140), 'green');     // trees
  assert.equal(classify(226, 153, 108), 'yellow');    // sand (SPIKE has no orange)
  assert.equal(classify(60, 190, 210), 'azure');
  assert.equal(classify(140, 60, 200), 'violet');
  assert.equal(classify(119, 124, 123), 'none');      // grey road
});

test('reflected light matches the plain mat at black and white', () => {
  assert.equal(reflectOf(0, 0, 0), 8);
  assert.equal(reflectOf(255, 255, 255), 98);
  assert.ok(reflectOf(121, 184, 140) > 40 && reflectOf(121, 184, 140) < 80);
});

test('the photo is read right side up', () => {
  // Black stripe across the far half of the field, white elsewhere.
  const at = photo((x, y) => y > FH / 2 ? [0, 0, 0] : [255, 255, 255], 200, 114);
  assert.equal(at([500, 1000]).color, 'black');
  assert.equal(at([500, 100]).color, 'white');
  assert.equal(at([1500, 100]).reflect, 98);
  assert.equal(at([-5, 100]), null);
});

const stripe = () => photo((x, y) => Math.abs(y - 700) < 10 ? [0, 0, 0] : [120, 185, 140]);

test('on the photo the color sensor stops at a printed line', () => {
  const sim = new Sim({}, { x: 1000, y: 400, h: 0 });
  sim.cfg.collide = false; sim.matPhoto = stripe(); sim.reset();
  assert.equal(sim.sens.color, 'green');
  runToEnd(sim, prog([['startMove', { dir: 'forward' }], ['waitColor', { port: 'C', color: 'black' }], ['stopMove', {}]]));
  assert.equal(sim.sens.color, 'black');
  // The stripe runs from y 690 to 710; the robot stops as soon as the sensor spot is on it.
  assert.ok(sim.sens.spot[1] > 680 && sim.sens.spot[1] < 715, 'sensor stopped at ' + sim.sens.spot[1]);
});

test('reflected light comes from the photo when it is shown', () => {
  const sim = new Sim({ arms: [] }, { x: 1000, y: 400, h: 0 });
  sim.matPhoto = stripe(); sim.reset();
  runToEnd(sim, { stacks: [[{ t: 'setVar', name: 'refl', val: node('reflection', { port: 'C' }) }]], procs: {}, vars: [] });
  assert.equal(sim.vars.refl, reflectOf(120, 185, 140));
  sim.matPhoto = null; sim.reset();
  runToEnd(sim, { stacks: [[{ t: 'setVar', name: 'refl', val: node('reflection', { port: 'C' }) }]], procs: {}, vars: [] });
  assert.equal(sim.vars.refl, 25, 'plain mat green is still 25 %');
});

test('the photo does not change how the robot moves', () => {
  const p = prog([['move', { dir: 'forward', val: '30', unit: 'cm' }], ['move', { dir: 'clockwise', val: '0.5', unit: 'rotations' }], ['move', { dir: 'forward', val: '20', unit: 'cm' }]]);
  const plain = new Sim({}, { x: 600, y: 300, h: 0 }), shown = new Sim({}, { x: 600, y: 300, h: 0 });
  shown.matPhoto = stripe(); shown.reset();
  runToEnd(plain, p); runToEnd(shown, p);
  assert.ok(Math.abs(plain.pose.h) > 30, 'the program turns: ' + plain.pose.h);
  assert.deepEqual(shown.pose, plain.pose);
});
