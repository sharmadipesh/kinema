/**
 * The production blueprint schema.
 *
 * One call, not ten. Camera, lenses, equipment, lighting, colour, story prose
 * and editor judgement all derive from the same reading of the same video —
 * splitting them across ten requests would pay ten times over for ten
 * independent guesses at the same thing, and they would contradict each other.
 *
 * Everything measurable is supplied *to* this call rather than requested from
 * it: shot statistics, motion profile, the colour palette counted from actual
 * pixels, the story stages segmented from the energy curve. The model's job is
 * the judgement layer on top — which is the part it is genuinely good at and
 * the part nothing else can produce.
 */

const nullableString = (description: string) => ({ type: ['string', 'null'], description });
const stringList = (description: string, maxItems: number) => ({
  type: 'array',
  maxItems,
  description,
  items: { type: 'string' },
});

const GEAR_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'category', 'priority', 'why', 'alternatives'],
  properties: {
    name: { type: 'string', description: 'The equipment class, not a product. "Variable ND filter", not a model number.' },
    category: {
      type: 'string',
      enum: ['camera', 'lens', 'stabilization', 'lighting', 'grip', 'audio', 'monitoring', 'power', 'storage', 'specialty'],
    },
    priority: { type: 'string', enum: ['required', 'recommended', 'optional'] },
    why: {
      type: 'string',
      description:
        'What it does AND which observed characteristic of this reference demands it. "Tracking movement appears in most shots" — not "useful for stability".',
    },
    alternatives: stringList('Cheaper ways to achieve the same result. Empty when there is no reasonable substitute.', 3),
  },
} as const;

export const BLUEPRINT_SCHEMA_NAME = 'production_blueprint';

export const BLUEPRINT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'creativeIntent', 'creativeDirection', 'movementLanguage', 'composition',
    'camera', 'lenses', 'stabilization', 'equipment', 'lighting', 'color',
    'shootingDirection', 'shotList', 'editor', 'storyStages', 'complexity',
    'moodboardKeywords', 'referencesToCollect', 'topThree', 'avoid', 'difficulty', 'unavailable',
  ],
  properties: {
    creativeIntent: {
      type: 'object',
      additionalProperties: false,
      required: ['labels', 'why'],
      description: 'What the visual language appears designed to communicate. Interpretation, and the UI marks it as such.',
      properties: {
        labels: stringList('Two to four words: Energetic, Premium, Editorial, Raw, Minimal, Playful, Technical.', 4),
        why: { type: 'string', description: 'Two sentences tying the labels to observable construction choices.' },
      },
    },
    creativeDirection: stringList('Five to seven instructions for someone making something in this language.', 8),
    movementLanguage: stringList('The two to four movement rules this edit obeys, stated as rules.', 5),
    composition: stringList('Recurring compositional patterns, and how to reproduce each.', 6),

    camera: {
      type: 'object',
      additionalProperties: false,
      required: ['priority', 'capabilities', 'why', 'suitableTypes', 'tiers', 'frameRates', 'settingsNotes'],
      properties: {
        priority: { type: 'string', enum: ['high', 'moderate', 'low'], description: 'How much the camera choice actually constrains this style.' },
        capabilities: stringList('Capabilities that matter, as capabilities — "reliable continuous autofocus on moving subjects".', 7),
        why: { type: 'string', description: 'Which observed characteristics of this reference produce those requirements.' },
        suitableTypes: stringList('Equipment classes, not products: "mirrorless hybrid", "modern flagship phone".', 4),
        tiers: {
          type: 'array',
          maxItems: 3,
          description: 'Lean, creator and professional routes to the same look, and what changes between them.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tier', 'setup', 'bestFor'],
            properties: {
              tier: { type: 'string', enum: ['lean', 'creator', 'professional'] },
              setup: stringList('The kit for this tier, three to five items.', 6),
              bestFor: { type: 'string', description: 'The production this tier suits.' },
            },
          },
        },
        frameRates: {
          type: 'array',
          maxItems: 4,
          description: 'Recommendations, NOT claims about how the reference was shot. Say what each rate is for.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['rate', 'use'],
            properties: { rate: { type: 'string' }, use: { type: 'string' } },
          },
        },
        settingsNotes: stringList('Shutter, motion blur and exposure guidance. Never invent exact exposure values.', 5),
      },
    },

    lenses: {
      type: 'object',
      additionalProperties: false,
      required: ['character', 'ranges', 'caveat'],
      properties: {
        character: { type: 'string', description: 'The apparent perspective character of the reference.' },
        ranges: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['range', 'use'],
            properties: { range: { type: 'string' }, use: { type: 'string' } },
          },
        },
        caveat: {
          type: 'string',
          description: 'State plainly that focal length is inferred from apparent perspective and cannot be read from pixels.',
        },
      },
    },

    stabilization: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tool', 'priority', 'why'],
            properties: {
              tool: { type: 'string' },
              priority: { type: 'string', enum: ['required', 'recommended', 'optional'] },
              why: { type: 'string', description: 'The role it plays in reproducing THIS movement style.' },
            },
          },
        },
      },
    },

    equipment: {
      type: 'array',
      maxItems: 14,
      description:
        'Only equipment this reference actually demands. A list containing everything is a list nobody reads — omit whole categories that do not apply.',
      items: GEAR_ITEM,
    },

    lighting: {
      type: 'object',
      additionalProperties: false,
      required: ['character', 'setup', 'caveat'],
      properties: {
        character: stringList('Observed lighting character: softness, contrast, key direction, background separation.', 6),
        setup: stringList('A practical setup that would reproduce it.', 6),
        caveat: { type: 'string', description: 'State that this is a suggested recreation inferred from the image, not the original setup.' },
      },
    },

    color: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'guidance'],
      description: 'The measured palette is supplied to you and rendered separately — do not restate hex values.',
      properties: {
        direction: stringList('Contrast, saturation, highlight and shadow treatment, skin handling.', 6),
        guidance: stringList('Practical grading instructions for reproducing it.', 5),
      },
    },

    shootingDirection: stringList('Numbered, practical capture instructions specific to this reference.', 8),
    shotList: {
      type: 'array',
      maxItems: 10,
      description: 'An actionable shot plan that would yield footage cuttable in this style.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['shot', 'direction', 'durationTarget', 'use'],
        properties: {
          shot: { type: 'string', description: 'Shot size and camera behaviour.' },
          direction: nullableString('Screen direction, where it matters for the cutting.'),
          durationTarget: { type: 'string', description: 'How much to capture, e.g. "2-3s usable".' },
          use: { type: 'string', description: 'Where it lands in the edit.' },
        },
      },
    },

    editor: {
      type: 'object',
      additionalProperties: false,
      required: ['transitionRecipes', 'workflow', 'typographyNotes', 'coloristNotes', 'priorities', 'mistakes'],
      description:
        'Think like a senior commercial editor receiving this footage tomorrow. The edit map, cut map and pacing are measured and supplied — do not restate them.',
      properties: {
        transitionRecipes: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'sourceFootage', 'cutPoint', 'editRequirement', 'post'],
            properties: {
              name: { type: 'string' },
              sourceFootage: stringList('What production must capture for this join to be cuttable.', 4),
              cutPoint: { type: 'string', description: 'Where the cut lands relative to the movement.' },
              editRequirement: { type: 'string', description: 'What the editor must match.' },
              post: nullableString('Any post treatment. Null when the cut alone carries it.'),
            },
          },
        },
        workflow: stringList('Ordered assembly steps, adapted to this reference.', 10),
        typographyNotes: stringList('How type should behave. Empty when none was detected.', 5),
        coloristNotes: stringList('Contrast, highlights, shadows, saturation, skin.', 6),
        priorities: stringList('What the editor must get right, most important first.', 5),
        mistakes: stringList('Specific ways an editor would get THIS style wrong.', 6),
      },
    },

    storyStages: {
      type: 'array',
      maxItems: 8,
      description:
        'One entry per supplied story stage, in order, matched by id. The stages are already segmented from the measured energy curve — describe them, do not re-segment or invent a five-act structure.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'purpose', 'mood', 'composition', 'camera', 'lighting', 'color', 'movement', 'typography', 'keywords', 'shotSuggestion'],
        properties: {
          id: { type: 'string', description: 'The stage id given in the prompt.' },
          purpose: { type: 'string', description: 'What this stage does for the viewer.' },
          mood: { type: 'string' },
          composition: { type: 'string' },
          camera: { type: 'string' },
          lighting: { type: 'string' },
          color: { type: 'string' },
          movement: { type: 'string' },
          typography: nullableString('Null when no type appears in this stage.'),
          keywords: stringList('Three to five search terms for gathering references for this stage.', 5),
          shotSuggestion: { type: 'string', description: 'A frame concept usable for storyboarding or reference search.' },
        },
      },
    },

    moodboardKeywords: stringList('Six to ten search terms for the video as a whole.', 10),
    referencesToCollect: stringList('Five to seven descriptions of imagery to gather. Never name real films, brands or photographers.', 7),
    topThree: stringList('The three things that matter most to reproducing this visual language.', 3),
    avoid: stringList('Mistakes specific to this reference, not general advice.', 6),

    difficulty: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'why'],
      properties: {
        level: { type: 'string', enum: ['easy', 'moderate', 'advanced'] },
        why: { type: 'string', description: 'One sentence on what makes it that.' },
      },
    },

    complexity: {
      type: 'object',
      additionalProperties: false,
      required: ['crew', 'lighting', 'cameraMovement', 'post', 'note'],
      description:
        'How demanding each part of recreating this is. Four axes rather than one score, because a piece can be trivial to light and brutal to shoot.',
      properties: {
        crew: { type: 'string', enum: ['low', 'moderate', 'high'] },
        lighting: { type: 'string', enum: ['low', 'moderate', 'high'] },
        cameraMovement: { type: 'string', enum: ['low', 'moderate', 'high'] },
        post: { type: 'string', enum: ['low', 'moderate', 'high'] },
        note: nullableString('One sentence on which part is the real constraint.'),
      },
    },

    unavailable: {
      type: 'array',
      maxItems: 6,
      description:
        'Sections you could not fill because the evidence did not support them, with the reason. Naming a gap is far better than filling it with generic advice — the product shows these to the user rather than hiding an empty panel.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'reason'],
        properties: { section: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
} as const;
