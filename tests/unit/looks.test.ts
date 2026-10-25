/* Window bar and texture in the model, styles, autosave and store (the drawing is in render-bar and
   render-background tests). */
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { applyStyleTo, clone, defaultBackground, defaultUi, STYLES, type Composition, type Style } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();

describe('built-in styles', () => {
  it('every built-in names a bar and a texture, so applying one clears them', () => {
    for (const st of STYLES) {
      expect(['none', 'light', 'dark']).toContain(st.frame.bar);
      expect(st.background.texture).toBeGreaterThanOrEqual(0);
    }
    expect(STYLES.slice(0, 6).every((st) => st.frame.bar === 'none' && st.background.texture === 0)).toBe(true);
  });

  it('ends with Slate, Concrete and Editorial', () => {
    expect(STYLES.map((s) => s.name).slice(-3)).toEqual(['Slate', 'Concrete', 'Editorial']);
    const by = (n: string) => STYLES.find((s) => s.name === n)!;
    expect(by('Slate').background).toEqual({ type: 'solid', solid: '#B7BCBF', grain: 6, texture: 0 });
    expect(by('Concrete').background).toEqual({ type: 'solid', solid: '#8E8E8C', grain: 34, texture: 70 });
    expect(by('Editorial').frame).toMatchObject({ radius: 10, bar: 'light', shadow: { preset: 'lifted', opacity: 0.45 } });
    expect(by('Editorial').background).toMatchObject({ type: 'mesh', meshSeed: 5, grain: 14, texture: 20 });
  });

  it('the default composition has no bar and no texture', () => {
    const d = defaultComposition();
    expect(d.frame.bar).toBe('none');
    expect(d.background.texture).toBe(0);
    expect(defaultBackground().texture).toBe(0);
  });
});

describe('applyStyleTo', () => {
  it('a style saved before window bars applies with no bar, and keeps the current texture', () => {
    const d = defaultComposition();
    applyStyleTo(d, STYLES.find((s) => s.name === 'Editorial')!);
    expect(d.frame.bar).toBe('light');
    expect(d.background.texture).toBe(20);
    const old = { name: 'My style 1', frame: { radius: 4, borderW: 0, borderC: '#FFFFFF', shadow: clone(d.frame.shadow) }, background: { type: 'solid', solid: '#EEEEEE' } } as unknown as Style;
    applyStyleTo(d, old);
    expect(d.frame).toEqual({ radius: 4, borderW: 0, borderC: '#FFFFFF', bar: 'none', shadow: d.frame.shadow });
    expect(d.background).toMatchObject({ type: 'solid', solid: '#EEEEEE', texture: 20 });
  });

  it('a bar value it doesn’t know applies as none; a style with a bar keeps it', () => {
    const d = defaultComposition();
    applyStyleTo(d, { name: 'x', frame: { ...clone(d.frame), bar: 'sepia' as never }, background: {} });
    expect(d.frame.bar).toBe('none');
    applyStyleTo(d, { name: 'y', frame: { ...clone(d.frame), bar: 'dark' }, background: {} });
    expect(d.frame.bar).toBe('dark');
  });
});

describe('autosave', () => {
  const old = () => {
    const d = clone(defaultComposition()) as unknown as { frame: Record<string, unknown>; background: Record<string, unknown> };
    delete d.frame.bar;
    delete d.background.texture;
    return d;
  };

  it('fills in no bar and no texture for a save from before them', () => {
    const out = sanitizeComposition(old())!;
    expect(out.frame.bar).toBe('none');
    expect(out.background.texture).toBe(0);
    expect(out).toEqual(defaultComposition());
  });

  it('keeps a valid bar and coerces anything else to none', () => {
    for (const [v, want] of [['light', 'light'], ['dark', 'dark'], ['none', 'none'], ['DARK', 'none'], [3, 'none'], [null, 'none']] as const) {
      const d = old();
      d.frame.bar = v;
      expect(sanitizeComposition(d)!.frame.bar).toBe(want);
    }
  });

  it('clamps the texture to 0–100 and drops anything unusable', () => {
    for (const [v, want] of [[35, 35], [0, 0], [100, 100], [140, 100], [-5, 0], ['abc', 0], [NaN, 0], [Infinity, 0], [null, 0]] as const) {
      const d = old();
      d.background.texture = v;
      expect(sanitizeComposition(d)!.background.texture).toBe(want);
    }
  });
});

describe('store', () => {
  beforeEach(() => {
    S().loadComposition(defaultComposition());
    useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
  });

  it('setFrameBar is one undo step', () => {
    S().setFrameBar('dark');
    expect(S().doc.frame.bar).toBe('dark');
    expect(S().canUndo).toBe(true);
    S().setFrameBar('light');
    S().undo();
    expect(S().doc.frame.bar).toBe('dark');
    S().undo();
    expect(S().doc.frame.bar).toBe('none');
    expect(S().canUndo).toBe(false);
  });

  it('texture is a live background edit: no undo step until commit', () => {
    S().editBackground({ texture: 40 });
    S().editBackground({ texture: 55 });
    expect(S().doc.background.texture).toBe(55);
    expect(S().canUndo).toBe(false);
    S().commit();
    S().undo();
    expect(S().doc.background.texture).toBe(0);
  });

  it('applying a saved style without a bar removes the bar', () => {
    S().setFrameBar('light');
    const saved = { name: 'My style 1', frame: { ...clone(S().doc.frame), bar: undefined }, background: {} } as unknown as Style;
    S().applyStyle(saved);
    expect(S().doc.frame.bar).toBe('none');
  });

  it('saveStyle keeps the bar and the texture', async () => {
    S().setFrameBar('dark');
    S().editBackground({ texture: 33 });
    S().commit();
    await S().saveStyle();
    const st = S().savedStyles.at(-1)!;
    expect(st.frame.bar).toBe('dark');
    expect(st.background.texture).toBe(33);
    const d: Composition = defaultComposition();
    applyStyleTo(d, st);
    expect([d.frame.bar, d.background.texture]).toEqual(['dark', 33]);
  });
});
