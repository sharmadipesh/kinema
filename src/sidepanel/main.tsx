import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/sidepanel.css';
import { SidePanel } from './SidePanel.tsx';

/**
 * The side panel runs on a normal extension page, so it uses React proper —
 * bundle size is irrelevant here and the tree is far more stateful than
 * anything the content script does (which is nothing: it renders no UI at all).
 */

const container = document.getElementById('root');
if (!container) throw new Error('side panel root element is missing');

createRoot(container).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
