import type { MotionAnalysis, ReadinessItem } from '../types/motion.ts';

/**
 * Whether there is enough here to actually go and make something.
 *
 * Every row is checked against real data rather than assumed from the analysis
 * having completed. A tick next to "Camera plan" when no camera plan was
 * produced is precisely the kind of reassurance that wastes somebody's
 * afternoon — so a row is only complete when the thing it names exists and is
 * non-empty, and an incomplete row says which section to go and look at.
 */
export function deriveReadiness(analysis: MotionAnalysis): ReadinessItem[] {
  const blueprint = analysis.blueprint;
  const toolkit = blueprint?.editorToolkit;
  const primaryEvents = analysis.events.filter((event) => event.role === 'primary');

  const items: ReadinessItem[] = [
    {
      label: 'Motion analysis',
      ready: primaryEvents.length > 0,
      detail: primaryEvents.length > 0 ? `${primaryEvents.length} events on the timeline` : 'No events were detected',
      tab: 'overview',
    },
    {
      label: 'Shot structure',
      ready: analysis.scenes.length > 1,
      detail: analysis.scenes.length > 1 ? `${analysis.scenes.length} shots segmented` : 'No shot boundaries found',
      tab: 'overview',
    },
    {
      label: 'Story structure',
      ready: (blueprint?.storyStages.length ?? 0) > 1,
      detail:
        (blueprint?.storyStages.length ?? 0) > 1
          ? `${blueprint?.storyStages.length} stages`
          : 'Not enough energy variation to segment an arc',
      tab: 'story',
    },
    {
      label: 'Creative direction',
      ready: (blueprint?.creativeDirection.length ?? 0) > 0,
      detail:
        (blueprint?.creativeDirection.length ?? 0) > 0
          ? `${blueprint?.creativeDirection.length} directions`
          : 'Not produced',
      tab: 'create',
    },
    {
      label: 'Shot list',
      ready: (blueprint?.shotList.length ?? 0) > 0,
      detail: (blueprint?.shotList.length ?? 0) > 0 ? `${blueprint?.shotList.length} shots planned` : 'Not produced',
      tab: 'create',
    },
    {
      label: 'Camera plan',
      ready: Boolean(blueprint?.camera),
      detail: blueprint?.camera ? `${blueprint.camera.capabilities.length} capabilities identified` : 'Not produced',
      tab: 'create',
    },
    {
      label: 'Lighting plan',
      ready: Boolean(blueprint?.lighting),
      detail: blueprint?.lighting ? `${blueprint.lighting.setup.length} setup notes` : 'Not produced',
      tab: 'create',
    },
    {
      label: 'Equipment',
      ready: (blueprint?.equipment.length ?? 0) > 0,
      detail: (blueprint?.equipment.length ?? 0) > 0 ? `${blueprint?.equipment.length} items` : 'Not produced',
      tab: 'create',
    },
    {
      label: 'Edit plan',
      ready: (toolkit?.cutMap.length ?? 0) > 0 || (toolkit?.workflow.length ?? 0) > 0,
      detail:
        (toolkit?.cutMap.length ?? 0) > 0 ? `${toolkit?.cutMap.length} cuts mapped` : 'Not produced',
      tab: 'edit',
    },
  ];

  return items;
}

export function readinessSummary(items: ReadinessItem[]): { ready: number; total: number } {
  return { ready: items.filter((item) => item.ready).length, total: items.length };
}
