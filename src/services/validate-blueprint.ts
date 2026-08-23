import type {
  CameraPlan,
  ColorPlan,
  EditorToolkit,
  GearItem,
  GearPriority,
  LensPlan,
  LightingPlan,
  PaletteSwatch,
  ProductionBlueprint,
  ProductionComplexity,
  StabilizationPlan,
  StoryStage,
} from '../types/motion.ts';

/**
 * Validation for the production blueprint.
 *
 * The pattern from the rest of the product: strict mode guarantees the shape,
 * this layer refuses to trust it. Two rules do most of the work here.
 *
 * An equipment item with no stated reason is dropped, not rendered. "Tripod —
 * recommended" with an empty `why` is precisely the useless advice the whole
 * feature exists to avoid, and letting it through would make the feature look
 * broken in exactly the way the brief describes.
 *
 * Story stage prose is matched to stages the pipeline actually segmented. A
 * stage the model invented has no measured timespan, no reference frame and no
 * place on the timeline, so it is discarded rather than shown.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issue: string };

const isString = (value: unknown): value is string => typeof value === 'string';

function text(value: unknown, max = 400): string | undefined {
  if (!isString(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^(n\/?a|none|unknown|null|not applicable|not visible)\.?$/i.test(trimmed)) return undefined;
  return trimmed.slice(0, max);
}

function list(value: unknown, max: number, itemMax = 300): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => text(entry, itemMax))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return isString(value) && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const maybe = <K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

export interface BlueprintContext {
  stages: StoryStage[];
  palette: PaletteSwatch[];
  /** The measured half of the toolkit: cut map, edit map, pacing, checklist. */
  derivedToolkit: Pick<
    EditorToolkit,
    'editMap' | 'cutMap' | 'pacing' | 'footageChecklist' | 'soundOpportunities'
  >;
}

export function validateBlueprint(
  input: unknown,
  context: {
    stages: StoryStage[];
    palette: PaletteSwatch[];
    /** The measured half of the toolkit: cut map, edit map, pacing, checklist. */
    derivedToolkit: Pick<
      EditorToolkit,
      'editMap' | 'cutMap' | 'pacing' | 'footageChecklist' | 'soundOpportunities'
    >;
  },
): ValidationResult<ProductionBlueprint> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;

  const blueprint: ProductionBlueprint = {
    ...maybe('creativeIntent', readIntent(root.creativeIntent)),
    creativeDirection: list(root.creativeDirection, 8),
    movementLanguage: list(root.movementLanguage, 5),
    composition: list(root.composition, 6),
    ...maybe('camera', readCamera(root.camera)),
    ...maybe('lenses', readLenses(root.lenses)),
    ...maybe('stabilization', readStabilization(root.stabilization)),
    equipment: readEquipment(root.equipment),
    ...maybe('lighting', readLighting(root.lighting)),
    ...maybe('color', readColor(root.color, context.palette)),
    shootingDirection: list(root.shootingDirection, 8),
    shotList: readShotList(root.shotList),
    editorToolkit: mergeToolkit(context.derivedToolkit, readEditor(root.editor)),
    storyStages: mergeStages(context.stages, root.storyStages),
    moodboardKeywords: list(root.moodboardKeywords, 10, 80),
    referencesToCollect: list(root.referencesToCollect, 7),
    topThree: list(root.topThree, 3),
    avoid: list(root.avoid, 6),
    ...maybe('difficulty', readDifficulty(root.difficulty)),
    ...maybe('complexity', readComplexity(root.complexity)),
    unavailable: readUnavailable(root.unavailable),
  };

  // A blueprint with nothing usable in it is a failure, not an empty result.
  const populated =
    blueprint.creativeDirection.length + blueprint.equipment.length + blueprint.shotList.length + blueprint.topThree.length;
  if (populated === 0) return { ok: false, issue: 'blueprint was empty' };

  return { ok: true, value: { ...blueprint, unavailable: withDroppedSections(blueprint, root) } };
}

/**
 * Sections the validator itself removed, added to the model's own list.
 *
 * Every reader above returns `undefined` or `[]` when the content is malformed,
 * truncated, or reason-free — which is the right call, since a spec sheet with
 * no justification is the advice this feature exists to avoid. What was missing
 * is the second half: the section then simply vanished from the panel, and an
 * absent section is indistinguishable from a section the video did not warrant.
 *
 * A drop is only reported when the model actually attempted the section. Not
 * offering lighting at all is a legitimate answer to a video with nothing to
 * say about lighting; offering it and failing validation is not.
 */
function withDroppedSections(
  blueprint: ProductionBlueprint,
  root: Record<string, unknown>,
): ProductionBlueprint['unavailable'] {
  const attempted = (value: unknown): boolean =>
    Array.isArray(value) ? value.length > 0 : Boolean(value) && typeof value === 'object';

  const dropped: Array<{ section: string; reason: string }> = [];
  const check = (section: string, kept: boolean, raw: unknown, reason: string): void => {
    if (!kept && attempted(raw)) dropped.push({ section, reason });
  };

  check('Camera', Boolean(blueprint.camera), root.camera, 'The camera plan came back without a stated reason, so it was not shown.');
  check('Lenses', Boolean(blueprint.lenses), root.lenses, 'The lens recommendation was incomplete, so it was not shown.');
  check('Stabilisation', Boolean(blueprint.stabilization), root.stabilization, 'The stabilisation plan was incomplete, so it was not shown.');
  check('Lighting', Boolean(blueprint.lighting), root.lighting, 'The lighting plan was incomplete, so it was not shown.');
  check('Colour', Boolean(blueprint.color), root.color, 'The colour direction was incomplete, so it was not shown.');
  check(
    'Equipment',
    blueprint.equipment.length > 0,
    root.equipment,
    'Every equipment item came back without a reason to need it, so none were shown.',
  );
  check('Shot list', blueprint.shotList.length > 0, root.shotList, 'The shot list was malformed, so it was not shown.');

  // The model's own declarations win: it may already have explained the gap
  // better than this generic sentence can.
  const declared = new Set(blueprint.unavailable.map((entry) => entry.section.toLowerCase()));
  return [...blueprint.unavailable, ...dropped.filter((entry) => !declared.has(entry.section.toLowerCase()))];
}

function readIntent(value: unknown): ProductionBlueprint['creativeIntent'] {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const labels = list(entry.labels, 4, 40);
  const why = text(entry.why, 400);
  return labels.length > 0 && why ? { labels, why } : undefined;
}

function readCamera(value: unknown): CameraPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const capabilities = list(entry.capabilities, 7);
  const why = text(entry.why, 500);
  // Capabilities without a reason are a spec sheet, not a recommendation.
  if (capabilities.length === 0 || !why) return undefined;

  const tiers = Array.isArray(entry.tiers)
    ? entry.tiers.flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const tierEntry = raw as Record<string, unknown>;
        const tier = oneOf(tierEntry.tier, ['lean', 'creator', 'professional'] as const);
        const setup = list(tierEntry.setup, 6, 120);
        const bestFor = text(tierEntry.bestFor, 160);
        return tier && setup.length > 0 && bestFor ? [{ tier, setup, bestFor }] : [];
      })
    : [];

  return {
    priority: oneOf(entry.priority, ['high', 'moderate', 'low'] as const) ?? 'moderate',
    capabilities,
    why,
    suitableTypes: list(entry.suitableTypes, 4, 120),
    tiers,
    frameRates: readPairs(entry.frameRates, 'rate', 'use', 4),
    settingsNotes: list(entry.settingsNotes, 5),
  };
}

function readLenses(value: unknown): LensPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const character = text(entry.character, 300);
  const ranges = readPairs(entry.ranges, 'range', 'use', 4);
  if (!character || ranges.length === 0) return undefined;
  return {
    character,
    ranges,
    // Never let this silently vanish: focal length cannot be read from pixels.
    caveat: text(entry.caveat, 300) ?? 'Focal lengths are inferred from apparent perspective and cannot be read from the video.',
  };
}

function readPairs<A extends string, B extends string>(
  value: unknown,
  keyA: A,
  keyB: B,
  max: number,
): Array<Record<A | B, string>> {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const entry = raw as Record<string, unknown>;
      const a = text(entry[keyA], 80);
      const b = text(entry[keyB], 240);
      return a && b ? [{ [keyA]: a, [keyB]: b } as Record<A | B, string>] : [];
    })
    .slice(0, max);
}

function readStabilization(value: unknown): StabilizationPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  if (!Array.isArray(entry.items)) return undefined;
  const items = entry.items
    .flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Record<string, unknown>;
      const tool = text(item.tool, 80);
      const priority = oneOf(item.priority, ['required', 'recommended', 'optional'] as const);
      const why = text(item.why, 300);
      return tool && priority && why ? [{ tool, priority, why }] : [];
    })
    .slice(0, 5);
  return items.length > 0 ? { items } : undefined;
}

/**
 * Equipment without a reason is dropped.
 *
 * The entire complaint this feature answers is "it returns Camera / Lights /
 * Tripod, which is not useful". An item whose `why` is missing is that item.
 */
function readEquipment(value: unknown): GearItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const entry = raw as Record<string, unknown>;
      const name = text(entry.name, 80);
      const why = text(entry.why, 400);
      const category = oneOf(entry.category, [
        'camera', 'lens', 'stabilization', 'lighting', 'grip',
        'audio', 'monitoring', 'power', 'storage', 'specialty',
      ] as const);
      const priority: GearPriority = oneOf(entry.priority, ['required', 'recommended', 'optional'] as const) ?? 'optional';
      if (!name || !why || !category) return [];
      const alternatives = list(entry.alternatives, 3, 120);
      return [{ name, category, priority, why, ...(alternatives.length ? { alternatives } : {}) }];
    })
    .slice(0, 14);
}

function readLighting(value: unknown): LightingPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const character = list(entry.character, 6);
  if (character.length === 0) return undefined;
  return {
    character,
    setup: list(entry.setup, 6),
    caveat: text(entry.caveat, 300) ?? 'A suggested recreation inferred from the image, not the original lighting setup.',
  };
}

function readColor(value: unknown, palette: PaletteSwatch[]): ColorPlan | undefined {
  if (!value || typeof value !== 'object') return palette.length > 0 ? { direction: [], guidance: [], palette } : undefined;
  const entry = value as Record<string, unknown>;
  const direction = list(entry.direction, 6);
  const guidance = list(entry.guidance, 5);
  if (direction.length === 0 && guidance.length === 0 && palette.length === 0) return undefined;
  // The palette is measured, so it comes from the pipeline rather than the model.
  return { direction, guidance, palette };
}

function readShotList(value: unknown): ProductionBlueprint['shotList'] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const entry = raw as Record<string, unknown>;
      const shot = text(entry.shot, 160);
      const durationTarget = text(entry.durationTarget, 60);
      const use = text(entry.use, 200);
      if (!shot || !durationTarget || !use) return [];
      const direction = text(entry.direction, 80);
      return [{ index: index + 1, shot, durationTarget, use, ...(direction ? { direction } : {}) }];
    })
    .slice(0, 10);
}

/**
 * The measured half and the written half, combined.
 *
 * Cut map, edit map, pacing and checklist are arithmetic over the timeline and
 * always present; workflow, priorities and mistakes are judgement and may be
 * absent. Merging here means the UI never has to reason about which half it is
 * looking at.
 */
function mergeToolkit(
  derived: Pick<EditorToolkit, 'editMap' | 'cutMap' | 'pacing' | 'footageChecklist' | 'soundOpportunities'>,
  prose: Partial<EditorToolkit> | undefined,
): EditorToolkit {
  return {
    ...derived,
    transitionRecipes: prose?.transitionRecipes ?? [],
    workflow: prose?.workflow ?? [],
    typographyNotes: prose?.typographyNotes ?? [],
    coloristNotes: prose?.coloristNotes ?? [],
    priorities: prose?.priorities ?? [],
    mistakes: prose?.mistakes ?? [],
  };
}

function readEditor(value: unknown): Partial<EditorToolkit> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;

  const transitionRecipes = Array.isArray(entry.transitionRecipes)
    ? entry.transitionRecipes
        .flatMap((raw) => {
          if (!raw || typeof raw !== 'object') return [];
          const recipe = raw as Record<string, unknown>;
          const name = text(recipe.name, 80);
          const cutPoint = text(recipe.cutPoint, 240);
          const editRequirement = text(recipe.editRequirement, 240);
          if (!name || !cutPoint || !editRequirement) return [];
          const post = text(recipe.post, 240);
          return [{
            name,
            sourceFootage: list(recipe.sourceFootage, 4),
            cutPoint,
            editRequirement,
            ...(post ? { post } : {}),
          }];
        })
        .slice(0, 6)
    : [];

  const toolkit = {
    transitionRecipes,
    workflow: list(entry.workflow, 10),
    typographyNotes: list(entry.typographyNotes, 5),
    coloristNotes: list(entry.coloristNotes, 6),
    priorities: list(entry.priorities, 5),
    mistakes: list(entry.mistakes, 6),
  };

  const populated = Object.values(toolkit).some((field) => field.length > 0);
  return populated ? toolkit : undefined;
}

/**
 * Prose is attached to stages the pipeline segmented; invented stages are lost.
 *
 * A stage the model made up has no measured timespan, no reference frame and no
 * place on the timeline — it could only be rendered as a card with nothing
 * behind it.
 */
function mergeStages(stages: StoryStage[], value: unknown): StoryStage[] {
  if (!Array.isArray(value)) return stages;
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const id = text(entry.id, 40);
    if (id) byId.set(id, entry);
  }

  return stages.map((stage) => {
    const prose = byId.get(stage.id);
    if (!prose) return stage;
    return {
      ...stage,
      ...maybe('purpose', text(prose.purpose, 300)),
      ...maybe('mood', text(prose.mood, 160)),
      ...maybe('composition', text(prose.composition, 200)),
      ...maybe('camera', text(prose.camera, 200)),
      ...maybe('lighting', text(prose.lighting, 200)),
      ...maybe('color', text(prose.color, 200)),
      ...maybe('movement', text(prose.movement, 200)),
      ...maybe('typography', text(prose.typography, 200)),
      ...maybe('shotSuggestion', text(prose.shotSuggestion, 400)),
      keywords: list(prose.keywords, 5, 80),
    };
  });
}

function readDifficulty(value: unknown): ProductionBlueprint['difficulty'] {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const level = oneOf(entry.level, ['easy', 'moderate', 'advanced'] as const);
  const why = text(entry.why, 300);
  return level && why ? { level, why } : undefined;
}

function readComplexity(value: unknown): ProductionComplexity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const level = (field: unknown): 'low' | 'moderate' | 'high' | undefined =>
    oneOf(field, ['low', 'moderate', 'high'] as const);

  const crew = level(entry.crew);
  const lighting = level(entry.lighting);
  const cameraMovement = level(entry.cameraMovement);
  const post = level(entry.post);
  // A partial complexity reading is worse than none: three axes rated and one
  // silently absent reads as "that part is free".
  if (!crew || !lighting || !cameraMovement || !post) return undefined;

  return { crew, lighting, cameraMovement, post, ...maybe('note', text(entry.note, 240)) };
}

function readUnavailable(value: unknown): ProductionBlueprint['unavailable'] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const entry = raw as Record<string, unknown>;
      const section = text(entry.section, 80);
      const reason = text(entry.reason, 300);
      return section && reason ? [{ section, reason }] : [];
    })
    .slice(0, 6);
}
