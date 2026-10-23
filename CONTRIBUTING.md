# Contributing

No build step and no dependencies — the whole simulator is `index.html` plus nine ES
modules in `src/`. Open it and it runs.

## Before you push

```sh
node test/rates.test.mjs     # rate curve + mapping of all 4 layouts
node test/physics.test.mjs   # hover, freefall, roll ramp, flip, angle mode, 60 s of random input
node test/ghost.test.mjs
node test/input.test.mjs
node test/tracks.test.mjs
python3 -m http.server 8000  # then open http://localhost:8000/test/collide.html
```

The node tests print `all … checks passed` or throw. The collision sweep needs a
browser, because `world.js` imports three, which node does not resolve.

## Style

- Match the file you are in. Comments explain *why*, not what the next line does.
- Physics coefficients go in `CFG` at the top of `src/physics.js`, never inline at the
  call site.
- Any new stick behaviour belongs in the layout data (`LAYOUTS` in `src/settings.js`),
  not as a branch in the input code.
- No new dependency. There is nothing to install and nothing to bundle.

## Commits

One thing per commit, imperative subject line (`Add tilt compensation to the mixer`).
If you touch `physics.js`, the physics test has to stay green — it pins the numbers
that make the quad feel like a real one.