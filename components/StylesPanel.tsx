'use client';
import { useMemo } from 'react';
import { STYLES, type Background } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { styleThumb } from './thumbs';

/** The current background minus the image (thumbnails never show it), as a string so the panel
 *  only re-renders when it actually changes; the store clones `doc` on every edit. */
const bgKey = (bg: Background) => JSON.stringify({ ...bg, imageId: null, imageName: '' });

export default function StylesPanel() {
  const key = useEditor((s) => bgKey(s.doc.background));
  const saved = useEditor((s) => s.savedStyles);
  const { applyStyle, saveStyle, deleteStyle } = useEditor.getState();

  // styleThumb caches by what it draws, so most tiles are reused even when the background changes.
  const tiles = useMemo(() => {
    const bg = JSON.parse(key) as Background;
    return [
      ...STYLES.map((st) => ({ st, mine: -1, src: styleThumb(st, bg) })),
      ...saved.map((st, i) => ({ st, mine: i, src: styleThumb(st, bg) })),
    ];
  }, [key, saved]);

  return (
    <section className="group">
      <div className="group-head">
        <h2>Styles</h2>
        <span className="note">Frame + background</span>
      </div>
      <div className="styles" id="styleGrid">
        {tiles.map(({ st, mine, src }) => (
          <div className="style-tile" key={mine < 0 ? `b:${st.name}` : `s:${mine}:${st.name}`}>
            <button type="button" className="style-pick" aria-label={`Apply style ${st.name}`} onClick={() => applyStyle(st)}>
              <img alt="" src={src} />
              <span>{st.name}</span>
            </button>
            {mine >= 0 && (
              <button type="button" className="style-del" aria-label={`Delete style ${st.name}`} onClick={() => void deleteStyle(mine)}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="btn wide" id="saveStyleBtn" type="button" onClick={() => void saveStyle()}>
        Save current style
      </button>
      <p className="fine">Saved styles stay in this browser.</p>
    </section>
  );
}
