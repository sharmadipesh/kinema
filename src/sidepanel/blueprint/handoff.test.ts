import { describe, expect, it } from 'vitest';
import { boardMarkdownWithEdits, briefMarkdown, contactSheetHtml, cutListCsv, escapeHtml, footageCsv, handoffJson } from './handoff.ts';
import { csvField, safeName } from '../../utils/download.ts';
import { analysis, blueprint, bothFrames, project, stageFrame } from '../../test/fixtures.ts';

const context = (overrides: Partial<Parameters<typeof briefMarkdown>[0]> = {}) => ({
  analysis: analysis(),
  project: project(),
  frames: bothFrames(),
  title: 'Instagram Reel',
  generatedAt: Date.parse('2026-08-24T10:00:00Z'),
  ...overrides,
});

describe('cutListCsv', () => {
  it('keeps measured seconds at full precision rather than converting to timecode', () => {
    // SMPTE needs a frame rate, which this product often cannot measure and
    // refuses to guess. A confidently wrong timecode is worse than seconds.
    const csv = cutListCsv(context());

    expect(csv).toContain('"2.400"');
    expect(csv).toContain('"00:02"');
  });

  it('attributes each cut to the stage containing it', () => {
    expect(cutListCsv(context())).toContain('"Hook"');
  });

  it('quotes a label containing a comma so the row cannot split', () => {
    const withComma = analysis({
      blueprint: blueprint({
        editorToolkit: { ...blueprint().editorToolkit, cutMap: [{ time: 1, type: 'hard_cut', label: 'Cut, then pan' }] },
      }),
    });
    const csv = cutListCsv(context({ analysis: withComma }));

    expect(csv).toContain('"Cut, then pan"');
    expect(csv.split('\n')[1]?.split('","').length).toBe(5);
  });
});

describe('csvField', () => {
  it('escapes embedded quotes', () => {
    expect(csvField('a "quoted" word')).toBe('"a ""quoted"" word"');
  });
});

describe('footageCsv', () => {
  it('exports the user status alongside the requirement', () => {
    const csv = footageCsv(
      context({ project: project({ footage: { 'A tracking pass alongside the subject': 'needs-capture' } }) }),
    );

    expect(csv).toContain('"Needs capture"');
  });

  it('says a requirement has no status rather than implying it is done', () => {
    expect(footageCsv(context())).toContain('"Not set"');
  });
});

describe('briefMarkdown', () => {
  it('records the analysis version and generation time', () => {
    const out = briefMarkdown(context());

    expect(out).toContain('**Analysis version**: 2.1');
    expect(out).toContain('2026-08-24');
  });

  it('labels the user brief as supplied rather than measured', () => {
    const out = briefMarkdown(context({ project: project({ brief: { tier: 'creator' } }) }));

    expect(out).toContain('Supplied by you, not measured.');
  });

  it('carries unavailable sections into the document', () => {
    const withGap = analysis({
      blueprint: blueprint({ unavailable: [{ section: 'Lighting', reason: 'Not produced.' }] }),
    });

    expect(briefMarkdown(context({ analysis: withGap }))).toContain('**Lighting** — Not produced.');
  });
});

describe('boardMarkdownWithEdits', () => {
  it('applies a renamed stage and names it as a manual edit', () => {
    const out = boardMarkdownWithEdits(
      context({ project: project({ stageEdits: { 'stage-1': { name: 'Cold open' } } }) }),
    );

    expect(out).toContain('Cold open');
    expect(out).toContain('edited by hand: name');
  });

  it('says nothing about manual edits when there are none', () => {
    expect(boardMarkdownWithEdits(context())).not.toContain('Manual edits');
  });
});

describe('handoffJson', () => {
  it('keeps the analysis and the user layer separate', () => {
    const parsed = JSON.parse(handoffJson(context({ project: project({ mode: 'shoot' }) })));

    expect(parsed.analysis.id).toBe('analysis-1');
    expect(parsed.project.mode).toBe('shoot');
    // Merging them would lose which half was measured.
    expect(parsed.analysis.mode).toBeUndefined();
  });

  it('references frames by id rather than inlining megabytes of base64', () => {
    const parsed = JSON.parse(handoffJson(context()));

    expect(parsed.frameIds).toEqual(['analysis-1:stage-0', 'analysis-1:stage-1']);
    expect(handoffJson(context())).not.toContain('data:image');
  });

  it('carries no credential material', () => {
    const out = handoffJson(context());
    expect(out).not.toContain('Bearer');
    expect(out).not.toContain('sk-');
  });
});

describe('contactSheetHtml', () => {
  it('inlines frames so the sheet survives leaving the extension', () => {
    expect(contactSheetHtml(context())).toContain('data:image/gif;base64');
  });

  it('prints the reason for a missing frame instead of an empty box', () => {
    const html = contactSheetHtml(context({ frames: [stageFrame(0, 4)] }));

    expect(html).toMatch(/Frame no longer stored|No frame captured/);
  });

  it('escapes a hostile video title', () => {
    // The title comes from the page DOM and this file opens in a browser.
    const html = contactSheetHtml(context({ title: '<img src=x onerror=alert(1)>' }));

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could break out of markup', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('safeName', () => {
  it('strips path separators so an export cannot escape its directory', () => {
    expect(safeName('../../etc/passwd')).not.toContain('/');
  });

  it('falls back to a usable name when nothing survives cleaning', () => {
    expect(safeName('///')).toBeTruthy();
  });

  it('removes control characters', () => {
    expect(safeName(`clip${String.fromCharCode(1)}name`)).toBe('clipname');
  });
});
