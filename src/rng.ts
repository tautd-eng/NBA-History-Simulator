// Small, fast, serialisable PRNG (sfc32). The whole league state stores the
// four state words, so a saved league continues with the same random stream.
export class Rng {
  s: [number, number, number, number];
  constructor(seed: number | [number, number, number, number]) {
    if (Array.isArray(seed)) this.s = [...seed] as [number, number, number, number];
    else {
      this.s = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
      for (let i = 0; i < 15; i++) this.next();
    }
  }
  next(): number {
    let [a, b, c, d] = this.s;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    this.s = [a, b, c, d];
    return t / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  chance(p: number): boolean { return this.next() < p; }
  normal(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick<T>(arr: T[]): T { return arr[this.int(arr.length)]; }
  /** index chosen with probability proportional to w[i] (w[i] >= 0) */
  weighted(w: number[]): number {
    let s = 0;
    for (const x of w) s += x;
    if (s <= 0) return this.int(w.length);
    let r = this.next() * s;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return w.length - 1;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Stable hash of a string to [0,1) — used for per-player constants such as endurance. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
