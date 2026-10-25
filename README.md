# NBA History Simulator

Rewrite NBA history from any season since 1979–80: real rosters and draft classes, a possession-by-possession game engine, AI general managers (trades, free agency, contracts, tanking and all-in modes), injuries, fatigue, awards, records and franchise histories.

**Play:** open the GitHub Pages site of this repository on your phone and add it to the home screen (iPhone: Share → *Add to Home Screen*; Android: menu → *Install app*). It runs offline and keeps several saved leagues in the browser.

## Project layout

- `src/engine/game.ts` – possession-by-possession engine and coach (rotations, fatigue, fouls, matchups, crunch time). `src/engine/eracal.json` – per-season calibration.
- `src/league/*` – season, playoffs by era, lottery, draft, expansion, free agency, contracts, injuries, records.
- `src/ai/*` – player value, trade valuation and AI trade logic.
- `src/ui/*` – React interface (pixel-art live games, team and player pages).
- `prep/prepare.py <data dir> data/history.json` – historical data → era-relative ratings, aging curves, draft classes.
- `test/*` – calibration and league checks (`bun test/calibrate.ts`, `bun test/cap.ts 2000 3`, …).

## Build

```
bun install react react-dom
bun build.ts          # dist/nba-istorija.html (single page) and dist/pwa/ (installable app)
cp dist/pwa/* docs/   # publish: GitHub Pages serves the docs/ folder
```

Data: Basketball-Reference (via sumitrodatta/bball-reference-datasets).
