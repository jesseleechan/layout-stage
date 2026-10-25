import { describe, expect, it } from 'vitest';
import { gradientLine, meshPoints, xorshift } from '@/lib/render/background';

/** The prototype's meshPoints, copied verbatim from reference/layout-stage.html, as the oracle. */
function prototypeMeshPoints(seed: number): number[][] {
  let a = ((seed + 1) * 2654435761) >>> 0 || 1;
  const rnd = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
  const q = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  return q.slice(0, 3).map(([qx, qy]) => [qx + 0.06 + rnd() * 0.38, qy + 0.06 + rnd() * 0.38]);
}

describe('xorshift', () => {
  it('is deterministic per seed', () => {
    const a = xorshift(42), b = xorshift(42);
    const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b);
    expect(sa).toEqual(sb);
  });
  it('differs between seeds', () => {
    const a = xorshift(1), b = xorshift(2);
    expect(Array.from({ length: 5 }, a)).not.toEqual(Array.from({ length: 5 }, b));
  });
  it('returns values in [0, 1) and never gets stuck at 0', () => {
    for (const seed of [-1, 0, 1, 3, 7, 160, 99999]) {
      const r = xorshift(seed);
      const vals = Array.from({ length: 200 }, r);
      expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
      expect(new Set(vals).size).toBeGreaterThan(190);
    }
  });
});

describe('meshPoints', () => {
  it('is deterministic per seed', () => {
    expect(meshPoints(3)).toEqual(meshPoints(3));
    expect(meshPoints(7)).toEqual(meshPoints(7));
    expect(meshPoints(3)).not.toEqual(meshPoints(7));
  });

  it("matches the prototype's meshPoints", () => {
    for (let seed = 0; seed < 2000; seed++) expect(meshPoints(seed)).toEqual(prototypeMeshPoints(seed));
    for (const seed of [12345, 54321, 99999]) expect(meshPoints(seed)).toEqual(prototypeMeshPoints(seed));
  });

  it('returns 3 points in 3 distinct quadrants, each inset 6–44% inside its quadrant', () => {
    const left = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const pts = meshPoints(seed);
      expect(pts).toHaveLength(3);
      const quads = pts.map(([x, y]) => {
        const qx = x < 0.5 ? 0 : 0.5, qy = y < 0.5 ? 0 : 0.5;
        expect(x - qx).toBeGreaterThanOrEqual(0.06);
        expect(x - qx).toBeLessThanOrEqual(0.44);
        expect(y - qy).toBeGreaterThanOrEqual(0.06);
        expect(y - qy).toBeLessThanOrEqual(0.44);
        return `${qx},${qy}`;
      });
      expect(new Set(quads).size).toBe(3);
      left.add(['0,0', '0.5,0', '0,0.5', '0.5,0.5'].find((q) => !quads.includes(q))!);
    }
    // the shuffle leaves out each quadrant for some seed
    expect(left.size).toBe(4);
  });
});

describe('gradientLine (CSS angle convention)', () => {
  const corners = (W: number, H: number) => [[0, 0], [W, 0], [0, H], [W, H]];

  function check(angle: number, W: number, H: number) {
    const [x0, y0, x1, y1] = gradientLine(angle, W, H);
    const a = (angle * Math.PI) / 180;
    const len = Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a));
    // centered on the canvas, of length |W·sin a| + |H·cos a|, pointing along (sin a, −cos a)
    expect((x0 + x1) / 2).toBeCloseTo(W / 2, 6);
    expect((y0 + y1) / 2).toBeCloseTo(H / 2, 6);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(len, 6);
    if (len > 0) {
      expect((x1 - x0) / len).toBeCloseTo(Math.sin(a), 6);
      expect((y1 - y0) / len).toBeCloseTo(-Math.cos(a), 6);
    }
    // like CSS, the 0% and 100% lines pass through the canvas corners
    const proj = corners(W, H).map(([cx, cy]) => (cx - W / 2) * Math.sin(a) + (cy - H / 2) * -Math.cos(a));
    expect(Math.min(...proj)).toBeCloseTo(-len / 2, 6);
    expect(Math.max(...proj)).toBeCloseTo(len / 2, 6);
    return [x0, y0, x1, y1];
  }

  it('0° runs bottom → top', () => {
    const [x0, y0, x1, y1] = check(0, 1000, 1500);
    expect([x0, y0, x1, y1].map((v) => Math.round(v) + 0)).toEqual([500, 1500, 500, 0]);
  });
  it('90° runs left → right', () => {
    const [x0, y0, x1, y1] = check(90, 1000, 1500);
    expect([x0, y0, x1, y1].map((v) => Math.round(v) + 0)).toEqual([0, 750, 1000, 750]);
  });
  it('180° runs top → bottom', () => {
    const [x0, y0, x1, y1] = check(180, 3000, 2250);
    expect([x0, y0, x1, y1].map((v) => Math.round(v) + 0)).toEqual([1500, 0, 1500, 2250]);
  });
  it('45° on a non-square canvas runs from the bottom-left corner line to the top-right', () => {
    const [x0, y0, x1, y1] = check(45, 1000, 1500);
    const half = (2500 * Math.SQRT1_2) / 2; // len = (1000 + 1500)·sin 45°
    expect(x0).toBeCloseTo(500 - half * Math.SQRT1_2, 6);
    expect(y0).toBeCloseTo(750 + half * Math.SQRT1_2, 6);
    expect(x1).toBeCloseTo(500 + half * Math.SQRT1_2, 6);
    expect(y1).toBeCloseTo(750 - half * Math.SQRT1_2, 6);
  });
  it('holds for the preset angles on every preset canvas', () => {
    for (const [W, H] of [[1000, 1500], [3000, 2250], [2000, 2000], [1080, 1350], [96, 72]]) {
      for (const angle of [125, 135, 145, 150, 155, 160, 165, 180, 270, 315, -30]) check(angle, W, H);
    }
  });
});
