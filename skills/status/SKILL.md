---
name: status
description: Show where the project stands, from its map, in a few lines.
disable-model-invocation: true
---

# Project status

1. From the project root, run `node <plugin>/map/status.mjs`, where `<plugin>` is two folders up from this skill's base directory.
2. Show its output to the user as it is: it is already the answer. Add nothing from `map-data.js`.
3. If it says there is no map, offer to draw one. If it says the map is out of date with the code, offer to update it with the `mapping-progress` skill. Do either only on a yes.
