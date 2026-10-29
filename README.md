# Marble Blast 🐸 — a Zuma-style web game

A simple, self-contained browser game inspired by **Zuma**: a chain of colored
marbles snakes along a winding track toward the skull pit. You control a frog
shooter at the bottom of the screen — aim with the mouse, click to fire marbles,
and match **3 or more** same-colored marbles to blast them before the chain
reaches the end!

## How to run

No build step, no dependencies. Just open `index.html` in any modern browser:

```bash
# Option 1: open directly
open index.html          # macOS
xdg-open index.html      # Linux

# Option 2: serve it (recommended)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the frog turret |
| Left click | Fire a marble |
| Right click / Space | Swap loaded ↔ next marble |
| A/D or ←/→ | Rotate turret (keyboard) |
| P | Pause / Resume |
| R | Restart game |

## Rules & features

- **Match 3+** same-colored marbles in the chain to destroy them.
- **Chain reactions**: when a blast closes the gap and creates a new run of 3+,
  it auto-matches for bonus points and pushes the chain backward.
- **Combos**: consecutive matches multiply your score.
- **8 levels**: each level gets faster, longer, and adds more marble colors.
- **3 lives**: lose one whenever the head marble reaches the skull pit.
- Danger meter (top-right) shows how close the chain head is to the pit.
- Juice: particle bursts, screen shake, glossy marbles, procedural per-level tracks.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure + HUD |
| `style.css` | Styling (dark theme, overlay panels) |
| `game.js` | All game logic & canvas rendering (~650 lines) |
| `test-logic.js` | Headless smoke test of core mechanics (`node test-logic.js`) |
| `render-test.js` | Headless render-pipeline test (`node render-test.js`) |

## Tech notes

- Pure vanilla JS + HTML5 Canvas 2D — zero libraries.
- The track is a procedurally generated serpentine spline per level, sampled
  into a dense polyline with an arc-length table; marbles are positioned by
  binary-search lookup along it, so the chain follows curves perfectly.
- Game loop uses `requestAnimationFrame` with delta-time clamping.
