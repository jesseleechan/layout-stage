'use client';
import dynamic from 'next/dynamic';

// The editor draws with canvas and reads IndexedDB, so it renders in the browser only.
const Editor = dynamic(() => import('@/components/Editor'), { ssr: false });

export default function Page() {
  return <Editor />;
}
