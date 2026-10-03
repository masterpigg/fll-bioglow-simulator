// BioGlow (FLL Challenge 2026-27) field data. Units: millimetres, origin at the
// bottom-left corner of the mat, y pointing away from the home wall.
// Positions are traced from the official wireframe PDF (20 cm grid) and are approximate.

export const FW = 2000;
export const FH = 1143;
export const HOME_R = 484;

// r = rotation in degrees, clockwise. key identifies a model for its mission mechanism.
// M01 is a launcher along the bottom wall: a red base, a track to the pilot's turntable, the drone
// riding on it, and a separate LiDAR map beside the survey area (see the Field Setup Reference Guide).
export const MODELS = [
  { key: 'm01base', n: '01', name: 'M01 drone launcher base', x: 650, y: 45, w: 40, h: 50, r: 0 },
  { key: 'm01track', n: '', name: 'M01 drone track', x: 900, y: 45, w: 460, h: 30, r: 0 },
  { key: 'm01drone', n: '', name: 'M01 drone', x: 886, y: 60, w: 50, h: 50, r: 0, round: true },
  { key: 'm01pilot', n: '01', name: 'M01 pilot', x: 1149, y: 56, w: 72, h: 72, r: 0, round: true },
  { key: 'm01map', n: '01', name: 'M01 LiDAR map', x: 1055, y: 220, w: 85, h: 80, r: 30 },
  { key: 'm02', n: '02', name: 'M02 Exploding Seeds', x: 630, y: 540, w: 70, h: 60, r: 20 },
  { key: 'm03', n: '03', name: 'M03 Flip the Rock', x: 80, y: 658, w: 125, h: 50, r: 0 },
  { key: 'm04', n: '04', name: 'M04 Lucky Leaves', x: 116, y: 1020, w: 145, h: 130, r: 0 },
  { key: 'm05', n: '05', name: 'M05 Reaching Roots', x: 402, y: 1090, w: 40, h: 60, r: 0 },
  { key: 'm0809', n: '08 09', name: 'M08 Tangled / M09 Research Platform', x: 578, y: 1068, w: 159, h: 103, r: 0 },
  { key: 'm10spider', n: '10', name: 'M10 spider habitat', x: 749, y: 1048, w: 45, h: 45, r: 0 },
  { key: 'm10snail', n: '10', name: 'M10 snail habitat', x: 1040, y: 720, w: 45, h: 35, r: 0 },
  // M06 and M07 stand side by side on the back wall: the nest (ant on a rack in front) to the west,
  // the mycelium (red handle in front) to the east (Field Setup Reference Guide, page 8).
  { key: 'm06', n: '06', name: 'M06 Leafcutter Frenzy', x: 1502, y: 1072, w: 80, h: 120, r: 0 },
  { key: 'm07', n: '07', name: 'M07 Humongous Fungus', x: 1582, y: 1072, w: 79, h: 120, r: 0 },
  { key: 'm11', n: '11', name: 'M11 Window to the Past', x: 1406, y: 594, w: 80, h: 80, r: 45 },
  { key: 'm12', n: '12', name: 'M12 Forest Elder', x: 1940, y: 758, w: 73, h: 73, r: 0, round: true },
  // The post is a few inches south of the tree (coach's note); the support tie (ring) starts hanging on the tree's
  // south side, to be hooked and pulled south over the post.
  { key: 'm12post', n: '12', name: 'M12 Forest Elder post', x: 1940, y: 655, w: 25, h: 45, r: 0 },
  { key: 'm12tie', n: '', name: 'M12 support tie (ring on the tree)', x: 1940, y: 712, w: 50, h: 14, r: 0 },
  // The cane lies flat on the mat, hinged at the bottom of the tree and pointing away from home.
  // under: a low lift arm can slide beneath it.
  { key: 'm12cane', n: '', name: 'M12 cane (hinged at the tree, lying on the mat)', x: 1940, y: 875, w: 18, h: 160, r: 0, under: true }
];

// Interchangeable docks for missions 13-15. Which dock is which comes from the mat art and the
// setup guide photos (the mine dock is in the top-right corner); teams choose which model goes where.
export const DOCKS = [
  { key: 'mine', name: 'mine dock', x: 1880, y: 1030, w: 120, h: 80, r: -40 },
  { key: 'farm', name: 'farm dock', x: 998, y: 627, w: 91, h: 139, r: 0 },
  { key: 'city', name: 'city dock', x: 1282, y: 91, w: 85, h: 131, r: 0 }
];
export const DEFAULT_DOCKS = { mine: 'M13', farm: 'M15', city: 'M14' };

// Black lines printed on the mat (polylines), about 20 mm wide.
export const LINES = [
  [[470, 812], [513, 892], [756, 892]],
  [[1331, 973], [1431, 876], [1683, 876]],
  [[940, 422], [1008, 306]]
];

// Scoring, from the 2026-27 BioGlow Robot Game Rulebook.
export const MISSIONS = [
  { id: 'M01', name: 'Drone Survey', items: [{ k: 'm01a', label: 'Drone no longer touching the mat', pts: 20 }, { k: 'm01b', label: 'Bonus: LiDAR map flipped, scan marker in survey area', pts: 10, req: 'm01a' }] },
  { id: 'M02', name: 'Exploding Seeds', items: [{ k: 'm02', label: 'Seeds no longer touching the stalk (each)', pts: 10, count: true }] },
  { id: 'M03', name: 'Flip the Rock', items: [{ k: 'm03a', label: 'Research flag is down', pts: 20 }, { k: 'm03b', label: 'Bonus: rock back in its starting position', pts: 10, req: 'm03a' }] },
  { id: 'M04', name: 'Lucky Leaves', items: [{ k: 'm04a', label: 'One leaf removed, not touching the nest', pts: 10 }, { k: 'm04b', label: 'Bonus: second leaf removed, katydid in its starting position', pts: 20, req: 'm04a' }, { k: 'm04x', label: 'Katydid completely outside the leaf habitat (mission scores 0)', pts: 0, zero: true }] },
  { id: 'M05', name: 'Reaching Roots', items: [{ k: 'm05a', label: 'Plant root partially extended', pts: 10, group: 'm05' }, { k: 'm05b', label: 'Plant root completely extended', pts: 20, group: 'm05' }] },
  { id: 'M06', name: 'Leafcutter Frenzy', items: [{ k: 'm06', label: 'Ant touching the nest, leaf fragments inside (each)', pts: 10, count: true }] },
  { id: 'M07', name: 'Humongous Fungus', items: [{ k: 'm07a', label: 'Mycelium completely extended', pts: 20 }, { k: 'm07b', label: 'Bonus: connection with the opposing team’s extended root', pts: 10, req: 'm07a' }] },
  { id: 'M08', name: 'Tangled', items: [{ k: 'm08', label: 'The vine is touching the mat', pts: 30 }] },
  { id: 'M09', name: 'Research Platform', noEquip: true, items: [{ k: 'm09a', label: 'Research platform raised', pts: 10 }, { k: 'm09b', label: 'Camera trap deployed', pts: 10 }, { k: 'm09c', label: 'Seed no longer touching the tree', pts: 10 }] },
  { id: 'M10', name: 'Fragile Microhabitats', noEquip: true, items: [{ k: 'm10a', label: 'Spider habitat in its starting position', pts: 10 }, { k: 'm10b', label: 'Snail habitat in its starting position', pts: 10 }] },
  { id: 'M11', name: 'Window to the Past', items: [{ k: 'm11', label: 'Root cover down, touching the mat', pts: 20 }] },
  { id: 'M12', name: 'Forest Elder', noEquip: true, items: [{ k: 'm12a', label: 'Cane completely raised, touching the tree', pts: 20 }, { k: 'm12b', label: 'Support tie around the post', pts: 10 }] },
  { id: 'M13', name: 'Keystone Species', items: [{ k: 'm13', label: 'Your keystone species on the restoration platform, young trees raised', pts: 30 }] },
  { id: 'M14', name: 'Seeds of Renewal', items: [{ k: 'm14a', label: 'Seeds in the replantation station (each)', pts: 5, count: true }, { k: 'm14b', label: 'Bonus: of those, seeds touching the mat (each)', pts: 5, count: true, capBy: 'm14a' }] },
  { id: 'M15', name: 'Biocentric Architecture', items: [{ k: 'm15a', label: 'Nesting canopy raised', pts: 10 }, { k: 'm15b', label: 'Garden skylight completely in', pts: 10 }, { k: 'm15c', label: 'Compost hatch opened, touching the mat', pts: 10 }, { k: 'm15d', label: 'Environmental bonus: the dock’s greatest need is done (mine: canopy, city: skylight, farm: hatch)', pts: 10 }] }
];

export const TOKEN_PTS = [0, 10, 15, 25, 35, 50, 50];
export const MATCH_SECONDS = 150;

export function missionPoints(m, score) {
  let t = 0, zero = false;
  for (const it of m.items) {
    const v = score[it.k];
    if (it.zero) { if (v) zero = true; continue; }
    if (it.count) { let n = v || 0; if (it.capBy) n = Math.min(n, score[it.capBy] || 0); t += n * it.pts; }
    else if (v && (!it.req || score[it.req])) t += it.pts;
  }
  return zero ? 0 : t;
}

export function totalScore(score, tokens, inspection) {
  let t = 0;
  for (const m of MISSIONS) t += missionPoints(m, score);
  return t + TOKEN_PTS[tokens] + (inspection ? 20 : 0);
}

// Simplified mission mechanisms. The real models have levers, hinges and gears; here a model reacts
// to how the robot touches it:
//   push  = the robot (or a sweep arm) drives into it
//   press = a lift arm comes down on it
//   lift  = a low lift arm right against it is raised (lifting a lever from underneath)
//   pull  = a lift arm lowered onto it (hooked behind a handle) is dragged away as the robot drives off
//   touch = any contact (for models that must not be disturbed)
// "sets" are score sheet items the action completes. "hold" needs that many seconds of pushing.
// "fragments" scores that many pieces for a slow push and fewer for a fast one (M06's leaves scatter).
// "pull" needs the robot to drag the hooked arm that many mm.
// "fast" needs the arm to rise at least that fast (% of top speed, after gearing), or the part falls back.
// "again" needs that mechanism done first, then a new touch of the same kind (back off and do it again).
// "bad" marks a touch that costs points (the model shows red and the tag says not to do it).
// "drops" lets that many seeds fall off as loose pieces without counting them for M02.
// A push can also be required to come from one side of the mat (see APPROACH); the default is any side.
export const MECHANISMS = [
  { id: 'm01-pilot', model: 'm01pilot', how: 'push', sets: ['m01a'], says: 'M01: the pilot launched the drone.', lifts: 'm01drone' },
  { id: 'm01-map', model: 'm01map', how: 'press', sets: ['m01b'], says: 'M01: the LiDAR map flipped over.' },
  { id: 'm02-stalk', model: 'm02', how: 'push', seeds: 3, says: 'M02: the seeds popped off the stalk.' },
  { id: 'm03-rock', model: 'm03', how: 'push', sets: ['m03a'], says: 'M03: the research flag is down.' },
  { id: 'm03-back', model: 'm03', how: 'push', again: 'm03-rock', sets: ['m03b'], says: 'M03: the rock flipped back to its starting position.' },
  { id: 'm04-leaf', model: 'm04', how: 'press', sets: ['m04a'], says: 'M04: a leaf came off the nest.' },
  { id: 'm04-leaf2', model: 'm04', how: 'press', again: 'm04-leaf', sets: ['m04b'], says: 'M04: a second leaf came off, and the katydid stayed put.' },
  { id: 'm04-katydid', model: 'm04', how: 'push', bad: true, sets: ['m04x'], says: 'M04: the katydid got knocked out of the leaf habitat.' },
  { id: 'm05-part', model: 'm05', how: 'push', sets: ['m05a'], says: 'M05: the plant root is partly extended.' },
  { id: 'm05-full', model: 'm05', how: 'push', hold: 1, sets: ['m05b'], clears: ['m05a'], says: 'M05: the plant root is completely extended.' },
  { id: 'm06-ant', model: 'm06', how: 'push', fragments: 3, says: 'M06: the ant reached the nest.' },
  { id: 'm07-mycelium', model: 'm07', how: 'pull', pull: 40, sets: ['m07a'], says: 'M07: the mycelium is extended.' },
  { id: 'm08-vine', model: 'm0809', how: 'press', sets: ['m08'], says: 'M08: the vine is down on the mat.' },
  { id: 'm09-platform', model: 'm0809', how: 'push', sets: ['m09a', 'm09b', 'm09c'], drops: 1, says: 'M09: the research platform is raised; the camera trap and the seed dropped.' },
  { id: 'm10-spider', model: 'm10spider', how: 'touch', clears: ['m10a'], says: 'M10: the spider habitat was disturbed.' },
  { id: 'm10-snail', model: 'm10snail', how: 'touch', clears: ['m10b'], says: 'M10: the snail habitat was disturbed.' },
  { id: 'm11-cover', model: 'm11', how: 'push', sets: ['m11'], says: 'M11: the root cover is down.' },
  { id: 'm12-tie', model: 'm12tie', how: 'pull', pull: 40, sets: ['m12b'], says: 'M12: the support tie is around the post.' },
  { id: 'm12-cane', model: 'm12cane', how: 'lift', fast: 70, lifts: 'm12cane', sets: ['m12a'], says: 'M12: the cane flipped up against the tree.' },
  { id: 'm15-canopy', dock: 'M15', how: 'lift', sets: ['m15a'], says: 'M15: the nesting canopy is raised.' },
  { id: 'm15-skylight', dock: 'M15', how: 'pull', pull: 40, sets: ['m15b'], says: 'M15: the garden skylight is pulled completely in.' },
  { id: 'm15-hatch', dock: 'M15', how: 'push', sets: ['m15c'], says: 'M15: the compost hatch is open.' }
];
// Score items the simulation can fill in. M10 starts complete and is lost when touched; M06 counts leaf fragments;
// M02, M13 and M14 are counted from where seeds and the keystone species end up; M15's bonus from which dock it sits on.
export const AUTO_KEYS = ['m01a', 'm01b', 'm02', 'm03a', 'm03b', 'm04a', 'm04b', 'm04x', 'm05a', 'm05b', 'm06', 'm07a', 'm08', 'm09a', 'm09b', 'm09c', 'm10a', 'm10b', 'm11', 'm12a', 'm12b', 'm13', 'm14a', 'm15a', 'm15b', 'm15c', 'm15d'];
// M15's environmental bonus: the item each dock needs most.
export const DOCK_NEED = { mine: 'm15a', city: 'm15b', farm: 'm15c' };

// Approach sides for pushes: the direction the robot comes from, as compass points on the mat
// (north = the back wall, south = the home wall, west = the red home side, east = the blue home side).
// The value is the push direction (from the robot into the model).
export const APPROACH = { south: [0, 1], north: [0, -1], west: [1, 0], east: [-1, 0] };
export const APPROACH_TOLERANCE = 55; // degrees either side of the required direction
// Sides confirmed on the real models, by model key (docks: 'dock:M15'). Unlisted models take pushes from any side.
export const DEFAULT_APPROACH = {};
