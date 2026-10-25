'use client';
import LayoutPresets from './LayoutPresets';
import SelectedPanel from './SelectedPanel';

/* The right panel, as in Shots: how many layouts and the layout presets, then the selected layout. */
export default function RightPanel() {
  return (
    <aside className="panel" id="rightPanel" aria-label="Layouts">
      <LayoutPresets />
      <SelectedPanel />
    </aside>
  );
}
