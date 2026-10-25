'use client';
import { useEffect } from 'react';
import { useEditor } from '@/lib/store';
import TopBar from './TopBar';
import LayoutsPanel from './LayoutsPanel';
import SelectedPanel from './SelectedPanel';
import FramePanel from './FramePanel';
import Stage from './Stage';
import BackgroundPanel from './BackgroundPanel';
import StylesPanel from './StylesPanel';
import OverlaysPanel from './OverlaysPanel';
import ExportSheet from './ExportSheet';
import CaptureDialog from './CaptureDialog';
import { useShortcuts } from './useShortcuts';

/* Three-column editor: layouts + frame left, the live canvas center, background + styles right. */
export default function Editor() {
  const init = useEditor((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  useShortcuts();

  return (
    <>
      <div className="app">
        <TopBar />
        <main className="work">
          <aside className="panel" id="leftPanel" aria-label="Layouts and frame">
            <LayoutsPanel />
            <SelectedPanel />
            <FramePanel />
          </aside>
          <Stage />
          <aside className="panel" id="rightPanel" aria-label="Background and styles">
            <BackgroundPanel />
            <OverlaysPanel />
            <StylesPanel />
          </aside>
        </main>
      </div>
      <ExportSheet />
      <CaptureDialog />
    </>
  );
}
