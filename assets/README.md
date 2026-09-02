# Field Model — "layout (dragon place)"

This game now ships with the actual Sketchfab model you uploaded, at:

```
assets/field/scene.gltf
assets/field/scene.bin
assets/field/textures/*.png
```

**License:** CC-BY-4.0 by 3DWorkbench. Commercial use is allowed; attribution
is required and is already included as a credit line on the game's start
menu (see `index.html`), linking back to the author and the original
Sketchfab page. Keep that credit if you redistribute the game.

## How it's wired in

`world.js` loads `assets/field/scene.gltf` on startup. Because raw Sketchfab
exports rarely match an arbitrary game world's scale/origin, the loader:

1. Measures the model's bounding box.
2. Scales it so its widest horizontal dimension is ~360 units (fits
   comfortably inside the game's ~400-unit world and player boundary).
3. Recenters it at the origin and drops it so its lowest point sits at
   y = 0.
4. Marks the model's `Ground`, `Road`, and `Dragon_platform` meshes as
   walkable terrain — the player's ground collision raycasts against
   these specifically (not the whole scene, which also contains
   non-walkable decoration: characters, a dragon statue, plants, birds,
   swords/shields, water planes, etc.).

If the model fails to load for any reason, the game silently falls back
to the original procedural grass field, so it's never unplayable.

## If you want to retune it

In `world.js`:
- `FIELD_TARGET_SPAN` — change the 360 to make the field bigger/smaller
  relative to the player.
- `FIELD_TERRAIN_NODE_NAMES` — add/remove node names here if you want the
  player to be able to walk on (or fall through) different parts of the
  scene, e.g. add `'KolP1'` or `'addObj_uvSet02'` if you want those props
  to be walkable too.

## Note on the scene's contents

This is a full diorama layout (ground, dragon statue, platform, water
planes, a road, characters, animals, plants, weapons props) rather than a
plain empty field — it'll visually dominate the game as scenic set-dressing.
The game's own gatherable resources (trees, rocks, berry bushes) and water
ponds are scattered procedurally on top of it and re-snapped to its actual
surface height once it finishes loading, so they sit correctly rather than
floating or clipping.
