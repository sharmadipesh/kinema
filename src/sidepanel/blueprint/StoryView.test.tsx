import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StoryView } from './StoryView.tsx';
import type { EvidenceFrame } from '../../types/analysis.ts';
import type { MotionAnalysis, StoryStage } from '../../types/motion.ts';

/**
 * The first component tests in this project.
 *
 * Rendered with `react-dom/client` straight into jsdom rather than a testing
 * library, because the assertions worth making here are about text and
 * structure — is the reason on screen, is the stage a heading, is the control
 * absent when the action is unavailable — and none of them need a query DSL or
 * another dependency to express.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (element: React.ReactElement): void => {
  act(() => root.render(element));
};

const stage = (overrides: Partial<StoryStage> = {}): StoryStage => ({
  id: 'stage-1',
  index: 1,
  name: 'Hook',
  startTime: 20,
  endTime: 28,
  energy: 0.45,
  shotCount: 3,
  averageShot: 2.02,
  dominantEventTypes: ['hard_cut'],
  referenceTime: 21,
  purpose: 'Stop the scroll.',
  ...overrides,
});

const frame = (id: string, time: number): EvidenceFrame => ({
  id,
  candidateId: 'c1',
  role: 'stage',
  order: 0,
  time,
  dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
});

const analysis = (stages: StoryStage[], overrides: Partial<MotionAnalysis> = {}): MotionAnalysis =>
  ({
    id: 'analysis-1',
    video: { duration: 28.4, width: 1080, height: 1920 },
    overview: {} as MotionAnalysis['overview'],
    editingDNA: {} as MotionAnalysis['editingDNA'],
    events: [],
    scenes: [],
    motionProfile: {} as MotionAnalysis['motionProfile'],
    version: '2.1',
    stats: {} as MotionAnalysis['stats'],
    blueprint: { storyStages: stages, moodboardKeywords: [], referencesToCollect: [], unavailable: [] } as unknown as MotionAnalysis['blueprint'],
    ...overrides,
  }) as MotionAnalysis;

const props = {
  title: 'Reel',
  canSeek: true,
  onSeek: () => undefined,
};

describe('StoryView', () => {
  it('says why there is no board rather than rendering an empty one', () => {
    render(<StoryView {...props} analysis={analysis([])} frames={[]} />);

    expect(container.textContent).toContain('Story arc unavailable');
  });

  it('shows the stage frame that was captured for that stage', () => {
    render(
      <StoryView
        {...props}
        analysis={analysis([stage({ referenceFrameId: 'analysis-1:stage-0' })])}
        frames={[frame('analysis-1:stage-0', 21)]}
      />,
    );

    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toContain('Hook');
    expect(container.textContent).not.toContain('Nearest frame');
  });

  it('labels a substituted frame instead of passing it off as the stage', () => {
    render(<StoryView {...props} analysis={analysis([stage()])} frames={[frame('analysis-1:c1-0', 21.7)]} />);

    expect(container.textContent).toContain('Nearest frame');
  });

  it('explains a missing frame rather than showing a blank box', () => {
    // A distant event frame is refused, so this stage has no usable image.
    render(<StoryView {...props} analysis={analysis([stage()])} frames={[frame('analysis-1:c1-0', 3)]} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('No frame captured');
  });

  it('gives every stage a real heading', () => {
    render(<StoryView {...props} analysis={analysis([stage(), stage({ id: 'stage-2', index: 2, name: 'Resolve' })])} frames={[]} />);

    const headings = [...container.querySelectorAll('h3')].map((node) => node.textContent);
    expect(headings).toContain('Hook');
    expect(headings).toContain('Resolve');
  });

  it('does not offer a jump when no live video is bound', () => {
    // A history entry has no source to control. Offering the control and then
    // reporting a failure blames the user for a state they did not create.
    render(<StoryView {...props} canSeek={false} analysis={analysis([stage()])} frames={[]} />);

    const jump = [...container.querySelectorAll('button')].filter((node) =>
      node.getAttribute('aria-label')?.startsWith('Jump to'),
    );
    expect(jump).toHaveLength(0);
  });

  it('offers a jump, with an accessible name, when a video is bound', () => {
    const onSeek = vi.fn();
    render(<StoryView {...props} onSeek={onSeek} analysis={analysis([stage()])} frames={[]} />);

    const jump = [...container.querySelectorAll('button')].find((node) =>
      node.getAttribute('aria-label')?.startsWith('Jump to Hook'),
    );
    expect(jump).toBeDefined();

    act(() => jump?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSeek).toHaveBeenCalledWith(21);
  });

  it('switches to the contact sheet without changing the stage set', () => {
    render(<StoryView {...props} analysis={analysis([stage(), stage({ id: 'stage-2', index: 2, name: 'Resolve' })])} frames={[]} />);

    const sheet = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Contact sheet2');
    act(() => sheet?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('[aria-label="Contact sheet"]')).not.toBeNull();
    expect(container.textContent).toContain('Hook');
    expect(container.textContent).toContain('Resolve');
  });

  it('offers a board copy and a copy per stage', () => {
    render(<StoryView {...props} analysis={analysis([stage()])} frames={[]} />);

    const labels = [...container.querySelectorAll('button')].map((node) => node.textContent);
    expect(labels).toContain('Copy board');
    expect(labels).toContain('Copy stage');
  });
});

describe('StoryView contact sheet', () => {
  const sheet = (canSeek: boolean): void => {
    render(
      <StoryView
        {...props}
        canSeek={canSeek}
        analysis={analysis([stage(), stage({ id: 'stage-2', index: 2, name: 'Resolve' })])}
        frames={[]}
      />,
    );
    const toggle = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Contact sheet2');
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  it('exposes stage names as headings outside the seek control', () => {
    // A heading nested inside a button is not reliably announced as a heading,
    // and heading navigation is how a screen-reader user moves between stages.
    sheet(true);

    const headings = [...container.querySelectorAll('h3')].map((node) => node.textContent);
    expect(headings).toContain('Hook');
    expect(headings).toContain('Resolve');
    expect(container.querySelector('button h3')).toBeNull();
  });

  it('drops the seek control entirely when nothing is bound', () => {
    sheet(false);

    const jumps = [...container.querySelectorAll('button')].filter((node) =>
      node.getAttribute('aria-label')?.startsWith('Jump to'),
    );
    expect(jumps).toHaveLength(0);
  });
});
