# Enemy AI (js/enemies.js) — states, transitions, numbers
Shared: gravity 1500, never steps past a floor edge (gap/water, via `groundAhead`), hops small steps, `anim += |dx|*0.25`, `face` = move dir. Optional def `y` = feet level (default ground G). `vx` = real speed.
**wolf** 34×20, world 0. `patrol` 45 u/s in `patrol:[x0,x1]` (centre; default x±80), 1 s pause at ends/edges/walls then turns.
- Sees brother: not hidden, alive, dx ≤160 in front / ≤50 behind, |feet Δ| <40, line of sight not blocked by solids. → `alert` 0.5 s (growl) → `chase` 135 u/s.
- `chase` lost when brother hides or gets >320 away (raven alarm: no range limit for 4 s) → `sniff`: walks 60 u/s to last seen x, sniffs 2.5 s → `lost`.
- Hops obstacles ≤22; brother standing >22.5 above it within 60 horizontally, or no progress for 0.9 s (wall, gap edge) → `howl` 1.5 s → `lost`.
- `lost`: trots 70 u/s back into the patrol range (≥1.5 s, blind) → `patrol`. Touch with an unhidden live brother in ANY state = kill.
- Sounds: wolfGrowl (alert), wolfHowl, wolfStep every 0.24 s while chasing, wolfBark every 2–4.5 s while chasing. Music `chase` on while any wolf is in `chase`.
**raven** 14×10, sits with feet on its perch point (def x,y). `perch` ~3–3.5 s → `look` 0.3 s (turns) → `perch`…
- Sees unhidden brother 0<dx·face≤190, any height, line of sight → `alarm` 1.2 s (ravenCaw+ravenFlap): every wolf of its world within 600 → `chase` (forced 4 s) → `cooldown` 6 s → `perch`.
**shulam** 30×16, world 1, blind. `idle`: wanders random points of `range:[x0,x1]` (centre; default x±60) at 20 u/s with pauses, shulamBreath every 3–6 s.
- Hears any noise of its world with distance(centre, noise) ≤ noise.r → `listen` 0.6 s → `hunt` 90 u/s to noise x (shulamShriek, ≤1 per 1.5 s); newer noise retargets.
- At target / edge / wall → `search` 2 s (sweeps ±14 at 30 u/s) → `return` 35 u/s to range → `idle`. Climbs ≤24, treats ghost bridges as gaps.
- Sister alive, centres ≤26 apart, |feet Δ|<14 → `attack` (0.45 s lunge 150 u/s) → `search`. Touch = kill. Still/silent sister is never heard (only bones, landings, calls, echoes are noises).
Tests: `python3 tests/ai/test_ai.py [--shots]` (sandbox chapter `tests/ai/sandbox.js`).
