'use client';
import { useRef, useState, type DragEvent } from 'react';
import { useEditor } from '@/lib/store';
import { useThumbUrl } from '@/lib/images';
import { MAX_MEDIA, MEDIA_DRAG, slotFor } from '@/lib/media';
import type { MediaItem } from '@/lib/model';
import './panels.css';

/* The media gallery, after Shots' media picker: every image added to the project (upload, drop, paste,
   capture), up to MAX_MEDIA. Click one to put it in the selected layout (none selected: the one-file
   rule), or drag it onto a layout on the canvas. The selected layout's image is ringed and each image a
   layout shows carries that layout's number; only images no layout shows can be removed. */

const NONE: MediaItem[] = [];
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

function MediaTile({ item, layouts, current, action }: { item: MediaItem; layouts: number[]; current: boolean; action: string }) {
  const url = useThumbUrl(item.imageId);
  const { placeMedia, removeMediaItem } = useEditor.getState();
  return (
    <li className="media-item">
      <button
        className="media-tile" type="button" draggable
        aria-label={`${item.name}: ${action}`} aria-current={current || undefined}
        title={`${item.name} · ${item.nw}×${item.nh}`}
        onClick={() => placeMedia(item.imageId, useEditor.getState().ui.selected)}
        onDragStart={(e) => {
          e.dataTransfer.setData(MEDIA_DRAG, item.imageId);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <span className="media-face">{url ? <img alt="" src={url} draggable={false} /> : null}</span>
        {layouts.length > 0 && (
          <span className="media-use" aria-hidden="true">
            {layouts.map((n) => <span key={n}>{n}</span>)}
          </span>
        )}
      </button>
      {layouts.length === 0 && (
        <button className="media-remove" type="button" aria-label={`Remove ${item.name} from media`} title="Remove from media" onClick={() => removeMediaItem(item.imageId)}>
          ×
        </button>
      )}
    </li>
  );
}

export default function MediaPanel() {
  const media = useEditor((s) => s.doc.media) ?? NONE;
  // The visible layouts' images, one per line (a string, so drags don't re-render).
  const shown = useEditor((s) => s.doc.slots.slice(0, s.doc.count).map((x) => x.imageId).join('\n'));
  const selectedId = useEditor((s) => (s.ui.selected != null && s.ui.selected < s.doc.count ? s.doc.slots[s.ui.selected].imageId : null));
  // Where a click puts an image now.
  const target = useEditor((s) => { const t = slotFor(s.doc, s.ui.selected); return `${t.added ? 'add as' : 'put in'} layout ${t.i + 1}`; });
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const layoutsOf = (id: string) => shown.split('\n').flatMap((x, k) => (x === id ? [k + 1] : []));

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    void useEditor.getState().addMediaFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <section className={'group media' + (over ? ' dragover' : '')} aria-labelledby="mediaHead" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="group-head">
        <h2 id="mediaHead">Media</h2>
        <span className="note" id="mediaCount">{media.length} of {MAX_MEDIA}</span>
      </div>
      <ul className="media-grid" aria-label="Media">
        {media.map((m) => (
          <MediaTile key={m.imageId} item={m} layouts={layoutsOf(m.imageId)} current={m.imageId === selectedId} action={target} />
        ))}
        <li className="media-item">
          <button className="media-tile media-add" id="mediaAddBtn" type="button" aria-label="Add media" title="Add images to Media" onClick={() => fileRef.current?.click()}>
            <span className="media-face">
              <PlusIcon />
              <span className="media-add-cap">Add</span>
            </span>
          </button>
        </li>
      </ul>
      <p className="fine">
        {media.length ? 'Click one to use it in the selected layout, or drag it onto a layout.' : `Every image you add is kept here, up to ${MAX_MEDIA}, to use in any layout.`}
      </p>
      <input
        ref={fileRef}
        type="file"
        id="mediaFiles"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) void useEditor.getState().addMediaFiles(files);
        }}
      />
    </section>
  );
}
