import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReadinessPanel } from './ReadinessPanel.tsx';
import { deriveRecreationReadiness } from '../../analysis/recreation-readiness.ts';
import { analysis, blueprint, bothFrames, project, stage, stageFrame } from '../../test/fixtures.ts';
import type { RecreationMode } from '../../types/project.ts';

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

const show = (
  mode: RecreationMode | undefined,
  overrides: Parameters<typeof deriveRecreationReadiness>[0] | null = null,
  onAction = vi.fn(),
) => {
  const readiness = deriveRecreationReadiness(
    overrides ?? {
      analysis: analysis(),
      frames: bothFrames(),
      project: project(mode ? { mode } : {}),
      canSeek: true,
    },
  );
  act(() => root.render(<ReadinessPanel readiness={readiness} onAction={onAction} />));
  return { readiness, onAction };
};

const buttons = () => [...container.querySelectorAll('button')];
const click = (node: HTMLButtonElement | undefined) =>
  act(() => node?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('ReadinessPanel', () => {
  it('shows the verdict and next action without being expanded', () => {
    // The old counter was two clicks deep in a collapsed accordion.
    show('shoot');

    expect(container.textContent).toContain('Recreation readiness');
    expect(container.textContent).toContain('Needs decisions');
    expect(container.textContent).toMatch(/Next: /);
  });

  it('never shows a bare score', () => {
    show('shoot');
    expect(container.textContent).not.toMatch(/\d+\/\d+/);
  });

  it('leads with the blocker when the board is broken', () => {
    const broken = analysis({
      blueprint: blueprint({
        storyStages: [stage({ id: 'stage-1', startTime: 0, endTime: 8 }), stage({ id: 'stage-2', index: 2, startTime: 14, endTime: 20 })],
      }),
    });
    show('shoot', { analysis: broken, frames: bothFrames(), project: project({ mode: 'shoot' }), canSeek: true });

    expect(container.textContent).toContain('Blocked');
    expect(container.textContent).toMatch(/1 blocker/);
  });

  it('groups rows by phase once expanded', () => {
    show('shoot');
    click(buttons().find((node) => node.textContent?.startsWith('Review')));

    const headings = [...container.querySelectorAll('h3')].map((node) => node.textContent);
    expect(headings).toContain('Analysis integrity');
    expect(headings).toContain('Story board');
  });

  it('states every status in words, not only colour', () => {
    show('shoot');
    click(buttons().find((node) => node.textContent?.startsWith('Review')));

    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Needs input');
  });

  it('marks a user-answered row as answered by the user', () => {
    show('shoot');
    click(buttons().find((node) => node.textContent?.startsWith('Review')));

    // Manual confirmations must never wear the same tick as a measurement.
    expect(container.textContent).toContain('· you');
  });

  it('routes the next action to an exact section, not just a tab', () => {
    const { onAction } = show('shoot');
    click(buttons().find((node) => node.textContent?.startsWith('Next:')));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0].target).toContain('#');
  });

  it('asks for a mode before grading anything', () => {
    show(undefined);

    expect(container.textContent).toContain('Choose what you are doing');
  });

  it('reaches a positive verdict with no next action beyond export', () => {
    show('study', {
      analysis: analysis(),
      frames: bothFrames(),
      project: project({ mode: 'study' }),
      canSeek: true,
    });

    expect(container.textContent).toContain('Plan ready');
  });

  it('explains a missing frame rather than counting it as ready', () => {
    show('shoot', {
      analysis: analysis(),
      frames: [stageFrame(0, 4)],
      project: project({ mode: 'shoot' }),
      canSeek: true,
    });
    click(buttons().find((node) => node.textContent?.startsWith('Review')));

    expect(container.textContent).toContain('no usable frame');
  });
});
