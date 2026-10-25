'use client';
import { useEffect } from 'react';
import { useEditor } from '@/lib/store';
import TopBar from './TopBar';
import LeftPanel from './LeftPanel';
import Stage from './Stage';
import RightPanel from './RightPanel';
import ExportSheet from './ExportSheet';
import CaptureDialog from './CaptureDialog';
import ProjectsSheet from './ProjectsSheet';
import { useShortcuts } from './useShortcuts';

/* The editor, laid out like Shots: floating clusters along the top, the Mockup / Canvas panel on the
   left, the live canvas in the middle, the layout count and layout presets on the right. */
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
        <LeftPanel />
        <Stage />
        <RightPanel />
      </div>
      <ExportSheet />
      <CaptureDialog />
      <ProjectsSheet />
    </>
  );
}
