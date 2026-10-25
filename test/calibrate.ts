import { boot, runSeason, report } from './harness';
boot();
const seasons = (process.argv[2] ?? '1980,1995,2010,2024').split(',').map(Number);
const t0 = Date.now();
for (const s of seasons) {
  const r = runSeason(s, 7, 2);
  console.log(report(s, r, process.argv[3] === 'v').text);
}
console.log('time', (Date.now() - t0) / 1000, 's');
