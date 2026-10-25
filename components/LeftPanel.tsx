'use client';
import { useEffect, useState } from 'react';
import LayoutsPanel from './LayoutsPanel';
import MediaPanel from './MediaPanel';
import StylesPanel from './StylesPanel';
import FramePanel from './FramePanel';
import BackgroundPanel from './BackgroundPanel';
import OverlaysPanel from './OverlaysPanel';
import { Seg, type Option } from './controls';

/* The left panel, as in Shots: Mockup (the screenshots, the media gallery and how they're framed) and
   Canvas (what's behind and above them). The open tab is remembered in this browser. */
type Tab = 'mockup' | 'canvas';
const TAB_KEY = 'layoutStage.leftTab';
const TABS: Option<Tab>[] = [
  { value: 'mockup', label: 'Mockup' },
  { value: 'canvas', label: 'Canvas' },
];

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>('mockup');
  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === 'canvas') setTab('canvas');
    } catch {
      /* storage unavailable: start on Mockup */
    }
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not remembered */
    }
  };

  return (
    <aside className="panel" id="leftPanel" aria-label={tab === 'mockup' ? 'Mockup' : 'Canvas'}>
      <div className="tabs">
        <Seg label="Panel" options={TABS} value={tab} onPick={pick} />
      </div>
      {tab === 'mockup' ? (
        <>
          <LayoutsPanel />
          <MediaPanel />
          <StylesPanel />
          <FramePanel />
        </>
      ) : (
        <>
          <BackgroundPanel />
          <OverlaysPanel />
        </>
      )}
    </aside>
  );
}
