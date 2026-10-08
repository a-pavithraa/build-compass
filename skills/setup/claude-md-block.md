The `# Project map` section sets how often Claude updates the map. Each update is one run of the map agent, about 40,000 tokens on a small project and more on a large one. Offer these three and add the one the user picks.

**After milestones** (recommended):

```markdown
# Project map
- Before a long stretch of work on your own, after each milestone, and when I ask "where are we?", use the `mapping-progress` skill.
```

**After every finished task** (the most current map, and the most tokens):

```markdown
# Project map
- Before a long stretch of work on your own, after each milestone or finished task, and when I ask "where are we?", use the `mapping-progress` skill.
```

**Only when asked** (the fewest tokens):

```markdown
# Project map
- When I ask "where are we?" or ask for the map, use the `mapping-progress` skill. Update the map only when I ask.
```
