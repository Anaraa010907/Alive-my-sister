# Хоёр ертөнц — team architecture & contracts

Limbo-like wordless 2D co-op puzzle-platformer. Screen split horizontally:
- **World 0 (top) = living world.** Brother (ах). Sepia dusk, black silhouettes, accent blue khadag.
- **World 1 (bottom) = world of the dead.** Younger sister (дүү, a girl). Photographic negative: dark sky, pale ground, the sister is white with a **red ribbon**; enemies there are ink-black.
- Both worlds share the **same x coordinates**. Player controls one character at a time (switch button) — later online co-op will let two people play at once.
- Nobody fights. You hide, escape, lure and trick. A danger in one world is usually solved by the character in the other world.

Plain HTML5 canvas + vanilla JS, no build step, no libraries. Runs as a hosted page (sandboxed iframe: no alert/confirm, no network, localStorage may throw → always try/catch).

## Files and owners (write ONLY your own files)

| File | Owner |
|---|---|
| `index.html`, `js/tw.js`, `js/game.js`, `js/levels/ch1.js` | Lead (engine) |
| `js/levels/ch2.js`, `docs/ch2-design.md` | Level & quest designer |
| `js/art-enemies.js`, `art-preview.html`, `docs/art-notes.md` | Character & enemy artist |
| `js/enemies.js`, `docs/enemy-ai.md` | Enemy AI programmer |
| `js/audio-ext.js`, `audio-preview.html`, `docs/audio-notes.md` | Sound & music designer |
| `js/ui.js`, `css/ui.css`, `ui-preview.html`, `docs/ui-notes.md` | UI/UX designer |
| `docs/story.md` | Story & world writer |
| `tests/*` | QA |

Load order in `index.html`: `tw.js` → `audio-ext.js` → `art-enemies.js` → `enemies.js` → `levels/ch1.js` → `levels/ch2.js` → `ui.js` → `game.js` (boots last). Every module only **registers** things on the global `TW`; never run game logic at load time. Wrap each file in `(function(){ 'use strict'; ... })();`. A missing module must never crash the game (engine has fallbacks).

## Global namespace (`js/tw.js`)

```js
window.TW = {
  H: 240,            // logical panel height; world y grows downward
  G: 190,            // ground top y in both worlds
  DEATH_Y: 330,
  PHYS: {
    brother: { w:14, h:30, speed:120, jumpV:430, gravity:1500 },  // jump height ≈ 61, jump length ≈ 69 at full speed
    sister:  { w:12, h:24, speed:118, jumpV:375, gravity:1150 },  // jump height ≈ 61, jump length ≈ 77
    crate:   { w:40, h:40, push:62 }
  },
  chapters: {},      // id -> chapter data (see below)
  chapterOrder: [],  // e.g. ['ch1','ch2']; each level file pushes its id
  enemyTypes: {},    // type -> { init(e, api), update(e, dt, api) }        (enemies.js)
  enemyArt: {},      // type -> function(ctx, e, t, P)                        (art-enemies.js)
  envArt: {},        // name -> function(...) see Art contract                (art-enemies.js)
  sfxExt: {},        // name -> function(A, vol)                              (audio-ext.js)
  music: {},         // name -> { start(A), stop(A) }                         (audio-ext.js)
  ui: null,          // { init(game) }                                        (ui.js)
  on(name, fn), off(name, fn), emit(name, data)   // tiny event bus
};
```

### Physics facts for level design
- Units are logical pixels. Ground top is `G = 190`. Visible panel shows ~380–850 units of width depending on screen (phones portrait ≈ 380).
- Reachable step: ≤ 50 high. Unreachable: ≥ 75 high. Gap the brother can jump: ≤ 45 safe (69 max). Sister: ≤ 55 safe.
- Fall into a gap → dies when y > 330. Brother in water dies. No fall damage otherwise.
- Crate: brother pushes it by walking (62 u/s); it casts a **solid shadow** at the same x,y in the dead world. Crate that falls off the world respawns at `home`.
- When one character is controlled, the other stands still but **time keeps running** in both worlds. Design rule: an idle character must be safe (hidden, out of reach, or silent) whenever the player is expected to switch.

## Chapter data format (`js/levels/chN.js`)

```js
TW.chapters.ch2 = {
  id: 'ch2', num: 2, title: 'Чонын хөндий',
  endText: 'One or two Mongolian lines shown on the chapter end screen.',
  width: 3600,                       // right edge of the level; place a cliff block at the end
  start: [100, 100],                 // brother x, sister x (both stand on ground at G)
  checkpoints: [[100, 900], [100, 1200]],   // ascending x per character; must be on ground
  worlds: [
    { // 0 — living
      ground: [[-300, 560], [610, 3700]],          // solid floor segments, top at G; gaps between = pits
      blocks: [ {x:380, y:G-22, w:36, h:22, k:'rock'} ],  // k: 'rock' | 'cliff' | 'log' | 'stone' | 'ledge'
      water:  [ {x0:800, x1:960} ],                // deadly water inside a gap (surface at G+16)
      grass:  [ {x0:1200, x1:1290} ],              // tall grass: standing still inside = hidden
      decor:  [ {k:'horse', x:175} ]               // optional props the engine knows ('horse','yurt','skull')
    },
    { // 1 — dead
      ground: [...], blocks: [...],
      bones:  [ {x0:1500, x1:1580} ],              // noisy floor: sister's steps are loud here
      decor:  []
    }
  ],
  objects: [                                       // every object has id, type, world
    { id:'L1', type:'lever',       world:1, x:1072, y:G,   target:'B1' },   // character in that world pulls with action
    { id:'B1', type:'drawbridge',  world:0, x0:800, x1:960 },              // pivot at x1, lowers over [x0,x1]
    { id:'G1', type:'gate',        world:0, x:1800 },                       // 14 wide, blocks until its lever is pulled
    { id:'P1', type:'plate',       world:0, x0:2030, x1:2080, target:'GB1' },// held while the world's character stands on it
    { id:'GB1',type:'ghostbridge', world:1, x0:2150, x1:2350 },             // solid only while its plate is held
    { id:'R1', type:'ropebridge',  world:0, x0:2150, x1:2350 },             // appears when its lever is pulled
    { id:'C1', type:'crate',       world:0, x:1300 }                        // shadow appears in world 1
  ],
  enemies: [                                       // spawned from these defs; re-spawned when that world's character dies
    { id:'W1', type:'wolf',   world:0, x:1400, patrol:[1350, 1600] },
    { id:'R1', type:'raven',  world:0, x:2000, y:G-95 },                    // perch top (engine draws a perch tree under it)
    { id:'S1', type:'shulam', world:1, x:2500, range:[2420, 2650] }
  ],
  exit: { x: 3400, kind: 'pass' },                 // both characters within ±45 of x → chapter done. kind 'meet' = big reunion beam (ch1), 'pass' = fade out
  stages: [                                        // drives hints: first stage whose done() is false is current
    { done: S => S.obj.B1.on, hint: S => ({ world:1, x:1072, y:G-12 }) },
    ...
  ]
};
TW.chapterOrder.push('ch2');
```

Runtime state the chapter functions may read: `S.obj[id]` (`.on` true once triggered, `.p` 0..1 animation, `.held` for ghostbridge, plus `.x/.y` for crate), `S.chars[0|1]` (`x, y, w, h, vx, onGround, hidden, dying`), `S.enemies` (array of live enemy entities), `S.t` (seconds).

## Enemy entities

The engine creates each enemy from its def: all def fields copied, plus
```
{ x, y, w, h, vx:0, vy:0, face:1, onGround:true, state:'idle', t:0, anim:0, alive:true, def }
```
`x,y` = top-left of hitbox, feet at `y+h`. `w,h` = hitbox size (set in `init`). `face` = 1 right / -1 left. `state` string, `t` seconds in current state, `anim` = running animation phase (radians, AI increases it with movement speed).

### Behaviour contract (`js/enemies.js`) — Enemy AI programmer
```js
TW.enemyTypes.wolf = {
  init(e, api)        { /* set w,h,state; MUST fully reset (also used on respawn) */ },
  update(e, dt, api)  { /* move, change state, kill */ }
};
```
`api` (provided by the engine each frame):
```
api.S, api.G, api.H, api.dt
api.chars                     // [brother, sister]
api.solidsFor(world)          // array of {x,y,w,h} solids for that world (ground, blocks, closed gates, bridges, crate/shadow)
api.moveBody(e, dx, dy, world)// collide-and-slide using solids; sets e.onGround; returns {hitX:bool}
api.groundAhead(e, world, dx) // true if there is floor under the point (e.x+e.w/2 + dx, G+2)
api.overlap(a, b)
api.isHidden(c)               // c.hidden: in grass, on ground, still ≥0.25 s
api.noises                    // this frame's sound events [{world, x, y, r, src}] src: 'step'|'bones'|'land'|'call'|'echo'
api.kill(c, why)              // kill a character ('wolf','shulam',...)
api.sfx(name, world, x)       // play a sound, volume falls off with distance from the active camera
api.music(name, on)           // start/stop a music layer, e.g. api.music('chase', true)
api.enemies                   // all live enemy entities (ravens alert wolves through this)
api.rand()                    // Math.random
```
Noise events the engine emits: sister steps on `bones` (r 170, src 'bones'), sister lands hard (r 110 'land', r 200 if on bones), a character's call ◎ in its own world (r 220 'call') and its **echo in the other world** at the same x (r 260 'echo'). The echo is the key lure: the brother calls → the shulam in the dead world hears it.

### Ch2 enemy specs (designer plans with these numbers; AI implements them; artist draws these states)
- **wolf** (world 0) — hitbox 34×20. States: `patrol` (walks patrol range at 45 u/s, pauses 1 s at ends), `sniff` (head down, 2.5 s at last known spot), `alert` (0.5 s freeze, ears up), `chase` (135 u/s toward brother — faster than him), `howl` (sitting, head up, 1.5 s, when brother escapes onto a high block), `lost` (trots back to patrol). Sees the brother if not hidden and within 160 in front / 50 behind and roughly same height band. Can hop obstacles ≤ 22 high, cannot climb blocks ≥ 30, will not jump gaps or enter water. Touching an unhidden brother → kill. A hidden brother is safe even if a wolf walks past.
- **raven** (world 0) — hitbox 14×10, sits on a perch at (x, y). States: `perch` (looks left/right, turning every ~3 s; `look` 0.3 s turn), `alarm` (caws, wings flap 1.2 s), `cooldown` (6 s, can't alarm again). If it sees the unhidden brother within 190 in the direction it faces → `alarm` and every wolf within 600 switches to `chase` toward the brother. Does not kill.
- **shulam** (world 1) — blind crawling ghoul, hitbox 30×16. States: `idle` (slow wander in `range` at 20 u/s), `listen` (0.6 s, head raised, after hearing), `hunt` (90 u/s to the noise x), `search` (2 s sweeping at noise spot), `return` (35 u/s back to range), `attack` (lunge when sister within 26). Hears any noise whose `r` reaches it. Cannot climb blocks > 24, does not cross gaps. Touching the sister → kill. A sister standing still on normal ground is silent and safe.

## Art contract (`js/art-enemies.js`) — Character & enemy artist
```js
TW.enemyArt.wolf = function(ctx, e, t, P) { ... };   // also raven, shulam
TW.envArt.grass  = function(ctx, zone, t, front, P) { ... };  // zone {x0,x1}; called twice: front=false behind characters, front=true in front (partly covers a hidden brother)
TW.envArt.bones  = function(ctx, zone, t, P) { ... };          // dead-world noisy floor on the ground line G
TW.envArt.perch  = function(ctx, x, y, P) { ... };             // dead tree / pole from ground G up to (x,y) for a raven
```
- `ctx` is already in **world coordinates of that panel** (1 unit = 1 logical px, y down, ground top = 190). Draw the enemy with feet at `e.y + e.h`, centered on `e.x + e.w/2`, mirrored by `e.face`. Use `ctx.save()/restore()`; never leave transforms, alpha or shadow set.
- `t` global seconds (for idle breathing, flapping). `e.anim` = gait phase. Draw distinct poses per `e.state` (see specs above).
- `P` palette: `{world, sil, rim, eye, pale, red, blue}`. World 0: sil `#0b0a09` (pure silhouette like Limbo, only eyes lit `#f3efe4`). World 1: sil `#05060a` ink-black with a faint pale rim `rgba(210,218,232,0.35)` so it reads against the dark sky; ground there is pale `#c2c7cf`.
- Scale: brother is 30 tall, sister 24. Wolf ≈ 22 tall at shoulder, raven ≈ 10, shulam ≈ 16 crawling (long thin limbs, sunken head, no eyes — maybe a mouth slit).
- Performance: plain paths, no `shadowBlur`, no image loading.

## Audio contract (`js/audio-ext.js`) — Sound & music designer
```js
TW.sfxExt.wolfHowl = function(A, vol) { ... };
TW.music.chase = { start(A) {...}, stop(A) {...} };
```
`A = { AC, master, echoIn, noiseBuf, tone(f0,f1,dur,type,peak,echo), noise(dur,filterType,freq,peak) }` — `AC` AudioContext, `master` GainNode, `echoIn` GainNode feeding a 0.3 s echo, `noiseBuf` 1 s white noise buffer. Multiply every peak gain by `vol` (0..1). Everything procedural (oscillators, noise, filters), no files. Keep peaks ≤ 0.25. Music layers fade in/out over ~1 s and must be safe to start/stop repeatedly.
Needed for ch2: `wolfGrowl, wolfHowl, wolfStep, wolfBark, ravenCaw, ravenFlap, shulamBreath, shulamShriek, shulamCrawl, bones, grassRustle, heartbeat`, music `chase`, and an ambience layer `music.valley` (night wind with distant howls, very quiet).

## UI contract (`js/ui.js`, `css/ui.css`) — UI/UX designer
`TW.ui = { init(game) }` — called once by the engine after layout. `game` is `TW.game`:
```
game.startChapter(id)   // MUST be called from a click/tap handler (starts audio)
game.restart()          // restart current chapter
game.pause(bool), game.isPaused()
game.setMuted(bool), game.isMuted()
game.chapters()         // [{id, num, title, unlocked, best:{time,deaths}|null}]
game.current()          // {id, num, title} or null
game.touchUI()          // true if touch controls are shown
```
Events (`TW.on`): `chapterStart {id,num,title}`, `chapterEnd {id,num,title,endText,next,time,deaths}` (next = id or null), `death {who}`, `pause {paused}`.
UI owns: title screen (title «ХОЁР ЕРТӨНЦ», subtitle «Дүүгээ ол.», Эхлэх = continue last unlocked chapter, Бүлгүүд = chapter select), chapter select (locked chapters greyed), a small pause button (top-right) + pause menu (Үргэлжлүүлэх / Бүлгийг дахин эхлэх / Бүлгүүд / Дуу асаах-унтраах), chapter title card on `chapterStart` (e.g. «2-р бүлэг» + «Чонын хөндий», fades over the game ~2.5 s, must not block input), chapter end screen on `chapterEnd` (endText, time, deaths, Дараагийн бүлэг / Дахин тоглох / Бүлгүүд). Keyboard: Esc or P toggles pause. All text Mongolian. Touch controls (`#controls`, `#pad`, `#bJump`, `#bAction`, `#bSwitch`) belong to the engine — restyle only via css, never rename. Visual language: the existing one (black, Georgia serif title with wide letter-spacing, warm off-white text, red `#d0343a` and blue `#7fa7e6` accents, end screen on off-white `#f4f2ee`). 44 px touch targets, z-index above canvas (≥10).

## Visual & tone rules (everyone)
Wordless storytelling. Silhouettes, fog, grain. No gore: deaths are a dissolve into particles. Mongolian steppe + folklore (чоно, хэрээ, шулам, албин, мангас, овоо, хадаг). All player-facing text in Mongolian Cyrillic.

## Testing
Headless Chrome is at `/usr/bin/google-chrome`; Python Playwright is installed (`from playwright.sync_api import sync_playwright`, `p.chromium.launch(executable_path="/usr/bin/google-chrome")`). Screenshots can be viewed with the Read tool. The engine exposes `window.__game` for scripted tests (pause the loop, step frames, set inputs).
