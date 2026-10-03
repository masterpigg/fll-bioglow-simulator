# BioGlow Robot Game Simulator

An unofficial practice simulator for the **FIRST® LEGO® League Challenge 2026–27 BioGlow** robot game. It runs in any modern browser, including Chromebooks and tablets, with nothing to install.

Kids can build a program from SPIKE™ Prime–style word blocks, or import one saved from the LEGO Education SPIKE App. They can then watch a virtual robot run it on the mat, practice 2:30 matches and score the result.

## What it does

- **Field:** the 2.0 m × 1.14 m BioGlow mat on the 20 cm wireframe grid, with both home areas, the black lines and every mission model.
- **Loose pieces:** purple pieces slide and turn when the robot pushes them, and stop against walls and models. Drag them anywhere, add more, or reset them. A keystone species piece starts in left home. Mission models stay fixed, like the real Dual Lock; a "just for fun" setting lets the robot shove them too.
- **Left / Right:** one tap moves the start position to the matching spot in the other home.
- **Robot:** a two-wheel drive base you can configure, with a color sensor, a distance sensor, a gyro (yaw angle) and attachment motors.
- **Robot editor:** drag the wheels, color sensor, distance sensor and arms on a top view of the robot laid out in LEGO studs (8 mm). Dragging a wheel sideways sets the wheel spacing; dragging it forward or back moves the axle. Pick a standard wheel size (56 mm SPIKE Prime, 88 mm, 62.4 mm, 43.2 mm) or enter your own. Each arm is a **lift/press** arm (tilts up and down) or a **sweep** arm (swings flat), points front, back, left or right, and has a length and gear ratio. Lowered and sweeping arms push loose pieces; arms stop when they press on a model or the mat, like SPIKE stall detection.
- **Blocks:** a drag-and-drop editor that looks and works like the SPIKE App, with the same ten categories:
  - **Motors:** run for, go to position, start, stop, set speed, set relative position, position and relative position.
  - **Movement:** move, steer, tank (left/right %), start/stop moving, movement speed, movement motors, and "1 motor rotation = … cm".
  - **Light:** turn on an image (with a 5×5 pixel picker like SPIKE's), turn on for a time, write, turn off pixels, set brightness, set a pixel, and the center button light. The page shows the hub's light matrix live.
  - **Sound:** play sound (until done), start sound, beep, start beep, stop all sounds, set/change volume, and the volume reporter. Beeps play as real tones; library sounds play a short stand-in chirp for their real length. A Sound button turns audio off.
  - **Events:** when program starts, when color, when pressed, when distance, when the hub's left/right button is pressed or released, when timer, when a condition turns true, when I receive, broadcast, and broadcast and wait. Several start stacks run at the same time, like on the hub. The hub's left and right buttons on the page work while a program runs.
  - **Control:** wait, repeat, forever, if, if-else, wait until, repeat until and stop.
  - **Sensors:** is color, reflection, distance and pressed checks; color, reflected light, distance, yaw/pitch/roll, and timer reporters; reset yaw and reset timer.
  - **Operators:** + − × ÷, pick random, < > =, and/or/not, join, letter of, length, contains, mod, round, and math functions.
  - **Variables:** "Make a Variable" and "Make a List", plus set, change, add, delete, insert, replace, item, item #, length, contains, and the variable and list reporters. The page shows their current values.
  - **My Blocks:** "Make a Block", with number and true/false inputs.

  The running blocks are outlined in yellow.
- **Calibration:** three short test programs to run on the real robot (drive 5 rotations, spin 2 rotations, drive 2 seconds). Enter what you measured and the simulator uses your robot's real wheel size, wheel spacing and top speed. An optional speed-up time makes the robot accelerate instead of jumping to full speed.
- **What to do on each model:** a tag above each model says how the simulator scores it (PUSH, PRESS, LIFT, HOOK & PULL, HOLD, … AGAIN, DON'T TOUCH, DON'T BUMP, BRING K, BRING SEEDS). Tags turn green when done and red when a model is disturbed. Tap a model to see its mission, the scoring items and the points. The tags can be turned off.
- **Mat look:** the official mat photo (default) or a plain green drawing. On the photo, the color sensor reads the colors printed under it; on the plain mat it sees only the black lines, the white home areas and their red and blue edges.
- **Approach sides (coach setting):** in a model's card, a coach can require pushes to come from one side of the mat (north, south, east or west, within 55°). A push from another side does nothing, and the log only says "touched, but nothing happened". Kids see arrows only if "Show approach directions" is turned on. Settings are saved on the device and travel in share links. No sides are set by default; confirmed sides go in `DEFAULT_APPROACH` in `src/field.js`.
- **Missions 13–15 docks:** choose which model sits on the mine, farm and city docks on the Field tab (or on the Score tab).
- **Mission models that react (simplified):** pushing or pressing the right model completes it. Examples: the M01 pilot launches the drone, M02 drops seeds you can collect, M03's flag goes down (push it again to flip the rock back for the bonus), pressing M04 once takes a leaf and pressing again takes the second (driving or sweeping into it knocks the katydid out and the mission scores 0), raising M09's platform drops the camera trap and a seed you can collect, sliding a low lift arm under M12's cane and lifting it fast flips the cane up against the tree (too slow and it falls back), hooking M12's support tie on the tree and pulling it south puts it around the post, pushing the M06 ant into the nest keeps more leaf fragments the slower it goes, hooking a lift arm onto M07 and driving backwards extends the mycelium, touching an M10 habitat loses those points, and on M15 a lift arm raises the nesting canopy, hooking and pulling brings the garden skylight in, and a push opens the compost hatch. The keystone species counts for M13 when it's pushed into the M13 dock, and seeds count for M14 in the M14 dock. Choose which dock (mine, farm, city) holds M13, M14 and M15; M15's environmental bonus follows that choice. The score sheet can fill these in automatically.
- **SPIKE files:**
  - **Import:** reads `.llsp3` Word Blocks projects. Drive motors and sensor ports are read from the program. Blocks the simulator can't run yet show up in gray.
  - **Export:** writes `.llsp3` files that follow the SPIKE App's file layout.
  - **Share:** *Share link* sends the program, robot setup and start position by email, chat or any app on the device's share sheet. The program is packed into the link itself (`#p=…`), so nothing is uploaded and opening the link loads it into the simulator. *Share file* attaches the `.llsp3` where the browser allows it; Chrome on Android doesn't allow SPIKE files, so there it saves to Downloads instead.
  - **Share this robot** (Robot tab): a link carrying only the robot setup (sizes, wheels, sensors, arms, ports). Opening it replaces the robot on that device and keeps the program.
  - **Open from GitHub:** lists the `.llsp3` files in a GitHub repository, grouped by folder, and opens one with a tap. A private repo needs a fine-grained personal access token with access to only that repository, Contents: Read-only, and an expiry date. The repo name and token are remembered in that browser only and sent only to `api.github.com`; **Forget token** removes them.
- **Match mode:** a 2:30 clock. Stopping the robot outside home costs a precision token.
- **Score sheet:** all 15 missions, equipment inspection and precision tokens, using the rulebook's point values.
- **Saved progress:** your program, robot settings and score are saved in the browser.

### Not yet

- Mission mechanisms are simplified: any push or press on the right model completes it. Real models need the right direction, force or attachment, and some items are still scored by hand: M07's connection with the other team's root and M14's seeds-touching-the-mat bonus. Arms can push pieces but not pick them up.
- Arms are limited to straight front/back/left/right directions, with no odd angles, linkages or multi-joint arms.
- Not simulated yet: SPIKE Python projects; tilt, shake and orientation start blocks (the simulated robot never tilts); the real sound recordings (a stand-in plays instead).
- Sensor values are simplified. The color sensor reports SPIKE color numbers. On the mat photo it names the photo's colors by hue (sand and other orange shades read yellow, grey reads no color) and takes reflected light from brightness, so black lines read about 8 and white about 98; on the plain mat reflected light is a rough guess per color. The distance reporter gives 200 when nothing is in range; check that against your real sensor. Pitch and roll are always 0. The force sensor counts as pressed when the front of the robot is pushing on something.
- Exported files re-import here, but opening them in the SPIKE App hasn't been confirmed yet.
- There is no live connection to the SPIKE App. Moving programs with files works everywhere. A desktop "virtual hub" helper might be possible later.

## Run it

GitHub Pages serves this repo as-is. To run it locally, use any static file server; browsers block ES modules on `file://`, so opening `index.html` directly won't work:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Tests

The tests need Node 18 or newer and have no dependencies:

```bash
npm test
```

To also check your own SPIKE projects, point the tests at a folder of `.llsp3` files. Keep those files out of this repo; `.gitignore` already excludes `*.llsp3` and `fixtures/`.

```bash
SPIKE_FIXTURES=path/to/your/projects npm test
```

## Releasing

After changing any file, bump `VERSION` (and the stylesheet's `?v=`) in `index.html`. Every module loads with that version in its URL, so browsers never mix old and new files after an update.

## Libraries

The block editor is [Blockly](https://github.com/google/blockly) 11.2.2 (Apache 2.0), loaded from jsDelivr with its Scratch-style "zelos" look. Everything else is plain JavaScript with no dependencies.

## Code layout

| File | What it holds |
| --- | --- |
| `src/field.js` | Mat size, mission model positions, scoring rules |
| `src/blocks.js` | The block table: every block's wording, inputs and SPIKE file name |
| `src/workspace.js` | The Blockly block shapes, menu and editor setup |
| `src/blocks-json.js` | Converting between editor blocks and the simulator's program |
| `src/robot-view.js` | Drawing the robot on the field and in the robot editor |
| `src/sim.js` | Drive physics, sensors, collisions and the program runner |
| `src/spike-io.js` | `.llsp3` / `.sb3` zip reading and writing, block conversion |
| `src/share.js` | Packing a program into a share link and back |
| `src/github.js` | Listing and downloading SPIKE projects from a GitHub repository |
| `src/app.js` | The page UI |

## Sources and accuracy

- Mission names and point values come from the official 2026–27 BioGlow Robot Game Rulebook. Check the FIRST Challenge Updates for changes during the season.
- Model positions were traced from the public field wireframe and may be off by a few centimetres. Fix them in `src/field.js`.
- The mat photo (`assets/mat.jpg`) is cropped from the field photo in the official Robot Game Rulebook. It is © FIRST and the LEGO Group and is used here only as a practice backdrop. Choose **Plain** on the Field tab for the drawn version.
- Sensor readings are simplified. The mat is treated as green, home as white, the home borders as red and blue, and the printed lines as black.

FIRST®, FIRST® LEGO® League and BIOGLOW™ are trademarks of FIRST and the LEGO Group. LEGO®, SPIKE™ and LEGO Education are trademarks of the LEGO Group. This project is not affiliated with or endorsed by either.
