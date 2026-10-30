import { lazy, Suspense } from 'react';
import UI from './UI';

const Scene = lazy(() => import('./Scene')); // 3D code is split into its own chunk

export default function App() {
  return (
    <>
      <div className="stage"><Suspense fallback={<div className="loading">Loading 3D showroom…</div>}><Scene /></Suspense></div>
      <UI />
    </>
  );
}
