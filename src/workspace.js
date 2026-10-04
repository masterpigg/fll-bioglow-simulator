// SPIKE-style drag-and-drop block editor, built on Blockly (loaded as the global `Blockly`)
// with the Scratch-like "zelos" renderer. Block shapes come from SPEC in blocks.js.

import { SPEC, PORTS, IMAGES, SOUNDS, COLORS, walkProgram } from './blocks.js';

const BLOCKLY_VERSION = '11.2.2';

// SPIKE App category colors.
export const COLOR = {
  motor: '#0090F5', move: '#FF4CCD', light: '#9966FF', sound: '#CF63CF', events: '#FFBF00', control: '#FFAB19',
  sensor: '#4CBFE6', op: '#59C059', var: '#FF8C1A', my: '#FF6680', note: '#9AA5A0'
};
const CATEGORIES = [
  ['Motors', 'motor'], ['Movement', 'move'], ['Light', 'light'], ['Sound', 'sound'], ['Events', 'events'],
  ['Control', 'control'], ['Sensors', 'sensor'], ['Operators', 'op']
];
const SHAPE = { HEXAGON: 1, ROUND: 2 };

// Values the dropdowns must offer before a program loads: motor ports such as "AE" (two motors
// at once), broadcast messages and sound names.
const extraPorts = new Set();
const messages = new Set(['message1']);
const sounds = new Set(SOUNDS);
export function registerNames(prog) {
  walkProgram(prog, (n) => {
    if (n.port && !PORTS.includes(n.port)) extraPorts.add(n.port);
    if (n.msg) messages.add(n.msg);
    if (n.sound) sounds.add(n.sound);
  });
  for (const name of Object.keys(prog.sounds || {})) sounds.add(name);
}

// Color menus show a dot in the color next to its name, like the SPIKE App. Each option is a small
// picture (dot + name on a white pill) so it reads the same in the menu and on the block.
const DOT = { black: '#111111', violet: '#7A4FD6', blue: '#1E6FD9', azure: '#3FA9F5', green: '#2F8F4E', yellow: '#E8C21E', red: '#D9342B', white: '#FFFFFF', none: 'none' };
function colorOption(name) {
  const w = 30 + name.length * 8, h = 22;
  const dot = name === 'none'
    ? '<circle cx="12" cy="11" r="6.5" fill="#fff" stroke="#8A9590" stroke-width="1.5" stroke-dasharray="2.5 2"/>'
    : `<circle cx="12" cy="11" r="6.5" fill="${DOT[name]}" stroke="#4A5550" stroke-width="1.2"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="11" fill="#fff" stroke="#D5DAD7"/>${dot}<text x="23" y="15.5" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#2B3530">${name}</text></svg>`;
  return [{ src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), width: w, height: h, alt: name }, name];
}

function argFor(key, d) {
  if (!d) return { type: 'field_label_serializable', name: key, text: '' };
  if (d.kind === 'var') return { type: 'field_variable', name: key, variable: 'my variable', variableTypes: [''], defaultType: '' };
  if (d.kind === 'list') return { type: 'field_variable', name: key, variable: 'my list', variableTypes: ['list'], defaultType: 'list' };
  if (d.kind === 'msg') return { type: 'field_message', name: key };
  if (d.kind === 'sound') return { type: 'field_sound', name: key };
  if (d.kind === 'matrix') return { type: 'field_matrix', name: key, value: IMAGES.heart };
  if (d.kind === 'menu' || d.kind === 'field') {
    if (d.ports) return { type: 'field_dropdown', name: key, options: () => PORTS.concat([...extraPorts]).map(p => [p, p]) };
    if (d.opts === COLORS) return { type: 'field_dropdown', name: key, options: COLORS.map(colorOption) };
    return { type: 'field_dropdown', name: key, options: d.opts.map(o => [o, o]) };
  }
  if (d.kind === 'bool') return { type: 'input_value', name: key, check: 'Boolean' };
  return { type: 'input_value', name: key };
}

function defFor(t, s) {
  const args = [];
  // %name -> %1, %2 ...; any other % is a literal percent sign (written %% for Blockly).
  const message0 = s.text.replace(/%(\w+)/g, (_, k) => { args.push(argFor(k, s.p && s.p[k])); return '\u0001' + args.length; })
    .replace(/%/g, '%%').replace(/\u0001/g, '%');
  const def = { type: 'sim_' + t, message0, args0: args, colour: COLOR[s.cat], inputsInline: true };
  if (s.shape === 'hat') { def.nextStatement = null; def.extensions = ['sim_hat']; }
  else if (s.shape === 'n') { def.output = null; def.outputShape = SHAPE.ROUND; }
  else if (s.shape === 'b') { def.output = 'Boolean'; def.outputShape = SHAPE.HEXAGON; }
  else { def.previousStatement = null; if (!s.end) def.nextStatement = null; }
  if (s.body) { def.message1 = '%1'; def.args1 = [{ type: 'input_statement', name: 'DO' }]; }
  if (s.else) { def.message2 = 'else'; def.message3 = '%1'; def.args3 = [{ type: 'input_statement', name: 'ELSE' }]; }
  return def;
}

// Dropdown of broadcast messages, with "New message…" to add one (like SPIKE).
function messageField(B) {
  return class FieldMessage extends B.FieldDropdown {
    constructor(value) { super(() => [...messages].map(m => [m, m]).concat([['New message…', '__new__']])); if (value) this.setValue(value); }
    static fromJson(o) { return new FieldMessage(o.value); }
    doClassValidation_(v) {
      if (v === '__new__') {
        const name = (window.prompt('New message name:') || '').trim();
        if (!name) return null;
        messages.add(name); return name;
      }
      return super.doClassValidation_(v);
    }
  };
}

// The 5×5 light matrix picker: a small picture on the block; tap it to switch pixels on and off.
function matrixField(B) {
  const CELL = 6;
  return class FieldMatrix extends B.Field {
    constructor(value) { super(value || IMAGES.heart); this.SERIALIZABLE = true; this.CURSOR = 'pointer'; }
    static fromJson(o) { return new FieldMatrix(o.value); }
    doClassValidation_(v) { return typeof v === 'string' && /^[0-9]{25}$/.test(v) ? v : null; }
    initView() {
      this.cells = [];
      // Nested group: the zelos theme paints rects directly inside a text field white.
      const g = B.utils.dom.createSvgElement('g', {}, this.fieldGroup_);
      B.utils.dom.createSvgElement('rect', { width: CELL * 5 + 4, height: CELL * 5 + 4, rx: 4, fill: '#1F2A44' }, g);
      for (let i = 0; i < 25; i++) this.cells.push(B.utils.dom.createSvgElement('rect', { x: 2 + (i % 5) * CELL + 0.5, y: 2 + Math.floor(i / 5) * CELL + 0.5, width: CELL - 1, height: CELL - 1, rx: 1 }, g));
    }
    render_() {
      const v = this.getValue() || '';
      this.cells.forEach((c, i) => c.setAttribute('fill', v[i] === '0' ? '#3A4663' : `rgba(255, 255, 255, ${0.4 + 0.066 * Number(v[i])})`));
      this.size_ = new B.utils.Size(CELL * 5 + 4, CELL * 5 + 4);
    }
    showEditor_() {
      const box = document.createElement('div'); box.className = 'matrix-editor';
      const grid = document.createElement('div'); grid.className = 'matrix-grid';
      const draw = () => { const v = this.getValue(); [...grid.children].forEach((b, i) => { b.classList.toggle('on', v[i] !== '0'); b.setAttribute('aria-pressed', String(v[i] !== '0')); }); };
      for (let i = 0; i < 25; i++) {
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', `Pixel ${i % 5 + 1}, ${Math.floor(i / 5) + 1}`);
        b.onclick = () => { const v = this.getValue().split(''); v[i] = v[i] === '0' ? '9' : '0'; this.setValue(v.join('')); draw(); };
        grid.appendChild(b);
      }
      const presets = document.createElement('div'); presets.className = 'matrix-presets';
      for (const [name, img] of Object.entries(IMAGES)) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
        b.onclick = () => { this.setValue(img); draw(); };
        presets.appendChild(b);
      }
      box.append(grid, presets); draw();
      B.DropDownDiv.getContentDiv().appendChild(box);
      B.DropDownDiv.setColour('#FFFFFF', '#C6CBD1');
      B.DropDownDiv.showPositionedByField(this);
    }
  };
}

function defineBlocks(B) {
  B.Extensions.register('sim_hat', function () { this.hat = 'cap'; });
  B.fieldRegistry.register('field_message', messageField(B));
  B.fieldRegistry.register('field_matrix', matrixField(B));
  B.fieldRegistry.register('field_sound', class FieldSound extends B.FieldDropdown {
    constructor(value) { super(() => [...sounds].map(n => [n, n])); if (value) this.setValue(value); }
    static fromJson(o) { return new FieldSound(o.value); }
  });
  B.defineBlocksWithJsonArray(Object.entries(SPEC).map(([t, s]) => defFor(t, s)).concat([
    { type: 'sim_num', message0: '%1', args0: [{ type: 'field_number', name: 'V', value: 0 }], output: null, outputShape: SHAPE.ROUND, colour: '#FFFFFF' },
    { type: 'sim_text', message0: '%1', args0: [{ type: 'field_input', name: 'V', text: '' }], output: null, outputShape: SHAPE.ROUND, colour: '#FFFFFF' },
    { type: 'sim_var', message0: '%1', args0: [{ type: 'field_variable', name: 'name', variable: 'my variable', variableTypes: [''], defaultType: '' }], output: null, outputShape: SHAPE.ROUND, colour: COLOR.var },
    { type: 'sim_arg', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'name', text: 'input' }], output: null, outputShape: SHAPE.ROUND, colour: COLOR.my },
    { type: 'sim_arg_b', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'name', text: 'input' }], output: 'Boolean', outputShape: SHAPE.HEXAGON, colour: COLOR.my }
  ]));

  const label = (name, params) => name + params.map(p => p.kind === 'b' ? ` <${p.name}>` : ` (${p.name})`).join('');
  // "define" hat for a My Block. Its name and inputs are fixed when it is made.
  B.Blocks.sim_define = {
    init() {
      this.procName = ''; this.params = [];
      this.appendDummyInput().appendField('define').appendField(new B.FieldLabelSerializable(''), 'LABEL');
      this.setNextStatement(true); this.setColour(COLOR.my); this.hat = 'cap';
    },
    saveExtraState() { return { name: this.procName, params: this.params }; },
    loadExtraState(st) { this.procName = st.name || ''; this.params = st.params || []; this.setFieldValue(label(this.procName, this.params), 'LABEL'); }
  };
  // A call to a My Block, with one slot per input.
  B.Blocks.sim_call = {
    init() {
      this.procName = ''; this.params = [];
      this.appendDummyInput('HEAD').appendField(new B.FieldLabelSerializable(''), 'LABEL');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(COLOR.my); this.setInputsInline(true);
    },
    saveExtraState() { return { name: this.procName, params: this.params }; },
    loadExtraState(st) {
      this.procName = st.name || ''; this.params = st.params || [];
      this.setFieldValue(this.procName, 'LABEL');
      for (let i = 0; this.getInput('ARG' + i); i++) this.removeInput('ARG' + i);
      this.params.forEach((p, i) => { const inp = this.appendValueInput('ARG' + i); if (p.kind === 'b') inp.setCheck('Boolean'); });
    }
  };
}

const slotShadow = (d) => ({ shadow: { type: d.kind === 'text' || d.def === '' ? 'sim_text' : 'sim_num', fields: { V: d.def } } });
const flyoutBlock = (t) => {
  const s = SPEC[t], b = { kind: 'block', type: 'sim_' + t };
  for (const [k, d] of Object.entries(s.p || {})) if (d.kind === 'num' || d.kind === 'text') (b.inputs = b.inputs || {})[k] = slotShadow(d);
  return b;
};

function toolbox() {
  const contents = CATEGORIES.map(([name, cat]) => ({
    kind: 'category', name, colour: COLOR[cat],
    contents: Object.keys(SPEC).filter(t => SPEC[t].cat === cat).map(flyoutBlock)
  }));
  contents.push({ kind: 'category', name: 'Variables', colour: COLOR.var, custom: 'SIM_VARIABLES' });
  contents.push({ kind: 'category', name: 'My Blocks', colour: COLOR.my, custom: 'SIM_MYBLOCKS' });
  return { kind: 'categoryToolbox', contents };
}

function variablesFlyout(ws) {
  const items = [{ kind: 'button', text: 'Make a Variable', callbackKey: 'SIM_MAKE_VAR' }];
  const vars = ws.getVariablesOfType('');
  if (vars.length) {
    const first = { name: { id: vars[0].getId() } };
    for (const v of vars) items.push({ kind: 'block', type: 'sim_var', fields: { name: { id: v.getId() } } });
    items.push({ kind: 'block', type: 'sim_setVar', fields: first, inputs: { val: slotShadow(SPEC.setVar.p.val) } });
    items.push({ kind: 'block', type: 'sim_changeVar', fields: first, inputs: { val: slotShadow(SPEC.changeVar.p.val) } });
  }
  items.push({ kind: 'button', text: 'Make a List', callbackKey: 'SIM_MAKE_LIST' });
  const lists = ws.getVariablesOfType('list');
  if (lists.length) {
    const first = { id: lists[0].getId() };
    for (const l of lists) items.push({ kind: 'block', type: 'sim_listContents', fields: { list: { id: l.getId() } } });
    for (const t of ['listAdd', 'listDelete', 'listClear', 'listInsert', 'listReplace', 'listItem', 'listIndexOf', 'listLength', 'listContains']) {
      const b = flyoutBlock(t); b.fields = { list: first }; items.push(b);
    }
  }
  return items;
}

function myBlocksFlyout(ws) {
  const items = [{ kind: 'button', text: 'Make a Block', callbackKey: 'SIM_MAKE_BLOCK' }];
  for (const d of ws.getTopBlocks(false).filter(b => b.type === 'sim_define')) {
    const call = { kind: 'block', type: 'sim_call', extraState: { name: d.procName, params: d.params }, inputs: {} };
    d.params.forEach((p, i) => { if (p.kind !== 'b') call.inputs['ARG' + i] = { shadow: { type: 'sim_text', fields: { V: '' } } }; });
    items.push(call);
    for (const p of d.params) items.push({ kind: 'block', type: p.kind === 'b' ? 'sim_arg_b' : 'sim_arg', fields: { name: p.name } });
  }
  return items;
}

// SPIKE's "Make a Block": a name plus optional inputs. "height, fast?" makes a number input
// called height and a true/false input called fast.
function makeBlock(ws) {
  const name = (window.prompt('Name your block:') || '').trim();
  if (!name) return;
  if (ws.getTopBlocks(false).some(b => b.type === 'sim_define' && b.procName === name)) { window.alert('There is already a block called “' + name + '”.'); return; }
  const raw = window.prompt('Inputs, separated by commas (leave empty for none).\nEnd an input with ? to make it true/false, like: distance, slow?') || '';
  const params = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => s.endsWith('?') ? { name: s.slice(0, -1).trim(), kind: 'b' } : { name: s, kind: 'n' });
  const m = ws.getMetricsManager().getViewMetrics(true);
  window.Blockly.serialization.blocks.append({ type: 'sim_define', extraState: { name, params }, x: m.left + 60, y: m.top + 60 }, ws);
  const tb = ws.getToolbox(); if (tb) tb.refreshSelection();
}

// On a phone held upright the category menu takes a big share of the screen, so it folds away:
// it opens from a button and folds again once a block has been dragged out or the workspace is
// tapped. `onChange(shown)` keeps the button in step.
export function foldingToolbox(ws, onChange) {
  const B = window.Blockly, tb = ws.getToolbox();
  let folding = false, shown = true, foldAfterDrag = false;
  const show = (on) => {
    if (!tb || on === shown) return;
    // Keep the blocks still on screen while the menu strip on the left appears or goes.
    const left = () => ws.getMetricsManager().getAbsoluteMetrics().left;
    const x = ws.scrollX + left(), y = ws.scrollY;
    shown = on;
    tb.setVisible(on);
    B.svgResize(ws);
    ws.scroll(x - left(), y);
    onChange(on);
  };
  const fold = () => { if (folding && shown) { if (ws.isDragging()) foldAfterDrag = true; else show(false); } };
  ws.addChangeListener((e) => {
    if (!folding) return;
    if (e.type === B.Events.TOOLBOX_ITEM_SELECT && !e.newItem && e.oldItem) fold();
    else if (e.type === B.Events.CLICK && e.targetType === 'workspace') fold();
    else if (e.type === B.Events.BLOCK_DRAG && !e.isStart && foldAfterDrag) { foldAfterDrag = false; setTimeout(fold); }
  });
  return {
    toggle() { if (shown) { tb.clearSelection(); show(false); } else show(true); },
    setFolding(on) { folding = on; foldAfterDrag = false; if (!on) show(true); else if (shown) { tb.clearSelection(); show(false); } }
  };
}

let defined = false;
export function createWorkspace(container) {
  const B = window.Blockly;
  if (!B) throw new Error('The block editor could not load. Check the internet connection and reload.');
  if (!defined) { defineBlocks(B); defined = true; }
  const theme = B.Theme.defineTheme('bioglow', {
    base: B.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#F5F6F8', toolboxBackgroundColour: '#FFFFFF', toolboxForegroundColour: '#575E75',
      flyoutBackgroundColour: '#EEF1F4', flyoutForegroundColour: '#575E75', flyoutOpacity: 1,
      scrollbarColour: '#C6CBD1', insertionMarkerColour: '#000000', insertionMarkerOpacity: 0.2
    },
    fontStyle: { family: '"Atkinson Hyperlegible", system-ui, sans-serif', weight: '700', size: 12 }
  });
  const ws = B.inject(container, {
    toolbox: toolbox(), renderer: 'zelos', theme,
    media: `https://cdn.jsdelivr.net/npm/blockly@${BLOCKLY_VERSION}/media/`,
    zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 2, minScale: 0.35 },
    move: { scrollbars: true, drag: true, wheel: false },
    grid: { spacing: 40, length: 3, colour: '#DDE1E6', snap: false },
    trashcan: true, sounds: false
  });
  ws.registerToolboxCategoryCallback('SIM_VARIABLES', variablesFlyout);
  ws.registerToolboxCategoryCallback('SIM_MYBLOCKS', myBlocksFlyout);
  ws.registerButtonCallback('SIM_MAKE_VAR', (btn) => B.Variables.createVariableButtonHandler(btn.getTargetWorkspace(), null, ''));
  ws.registerButtonCallback('SIM_MAKE_LIST', (btn) => B.Variables.createVariableButtonHandler(btn.getTargetWorkspace(), null, 'list'));
  ws.registerButtonCallback('SIM_MAKE_BLOCK', () => makeBlock(ws));
  return ws;
}
