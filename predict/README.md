# Prediction side analysis

`sim.ts` runs the game engine as a Monte Carlo simulator for real 2026–27 NBA games. The daily NBA prediction agent uses it as one extra signal (`sim`) next to its own research. It is never the deciding factor on its own.

```
bun predict/sim.ts input.json > output.json
```

See the comment at the top of `sim.ts` for the input format. For each game it returns the simulated margin distribution, cover and over percentages against the given lines, the main players' simulated stat lines, and the probabilities for any player props.

## Reading the output

- **Ratings** are each player's latest real season (2025–26), and rosters are the 2026–27 opening rosters. Trades since opening night go in `add`, and absences in `out`.
- **Absolute numbers are biased.** A test against the real 2025–26 season showed that league totals and season win percentages match well (win% correlation 0.80). Single games, though, spread too wide (margin SD ~15–17 against ~12–13 in reality), talent gaps come out exaggerated, and stars' scoring is compressed (Gilgeous-Alexander 26 ppg in the sim against 31 in reality). So `homeCoverPct` and `overPct` are overconfident.
- **The most useful parts are the differences.** When `out` is given, the same game is also simulated with everyone available. `injuryAdjPts`, the per-player `dMin`/`dPts`/`dPra`, and the props' `injuryDeltaPct` show what the absences change, such as who picks up the minutes and shots. Those differences cancel most of the engine's own biases.
- The agent records the raw values for every game, so the weekly review can fit a calibration (real margin against simulated margin) once there are enough results.
