import { CONTINUITY_KINDS, MOTION_EVENT_TYPES, RECREATE_PLATFORMS } from '../types/motion.ts';

/**
 * The JSON Schemas handed to the Responses API under `text.format`.
 *
 * Written by hand rather than generated: OpenAI strict mode has specific
 * requirements — every property listed in `required`, `additionalProperties:
 * false` on every object, nullability expressed as a union type rather than by
 * omission — and writing it explicitly keeps full control.
 *
 * Note what is *not* in any of these schemas: timestamps. The model is never
 * asked when something happened, because it does not know and would answer
 * anyway. It is asked which measured event an observation belongs to, and the
 * normalizer supplies the time from the measurement.
 */

const nullableString = (description: string) => ({ type: ['string', 'null'], description });

// -- Pass 1: global context ---------------------------------------------------

export const GLOBAL_SCHEMA_NAME = 'video_editing_context';

export const GLOBAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'format', 'motionCharacter', 'typographyUse', 'transitionStyle', 'colorTreatment'],
  properties: {
    summary: {
      type: 'string',
      description:
        'Two to four sentences on how this video is EDITED and how it MOVES — cutting rhythm, transition style, camera behaviour, type treatment, and how those change across the running time. Never a description of subject matter or story. You are given real shot statistics: use them rather than estimating.',
    },
    format: {
      type: 'string',
      enum: ['social', 'music-video', 'commercial', 'cinematic', 'documentary', 'tutorial', 'motion-graphics', 'other'],
      description: 'The editing idiom this most resembles, judged from construction rather than subject.',
    },
    motionCharacter: {
      type: 'string',
      description: 'One sentence on the dominant movement language: whose movement, what kind, how forceful.',
    },
    typographyUse: nullableString(
      'One sentence on how type is used and animated, if any is visible. Null when the video carries no meaningful typography.',
    ),
    transitionStyle: {
      type: 'string',
      description: 'One sentence on how shots are joined — the prevailing method, and any recurring exception.',
    },
    colorTreatment: nullableString(
      'One sentence on the grade or palette, only where it is a deliberate and visible choice. Null otherwise.',
    ),
  },
} as const;

// -- Pass 2: candidate interpretation -----------------------------------------

export const EVENTS_SCHEMA_NAME = 'motion_events';

/**
 * The deep event. Almost every field is nullable on purpose: an absent field
 * means the frames did not support a claim, and that is information the UI
 * renders as silence rather than as a guess.
 */
const EVENT_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: [
    'eventId', 'observations', 'interpretation', 'alternatives', 'continuity',
    'title', 'shortExplanation', 'detailedExplanation', 'technicalExplanation',
    'effects', 'transition', 'typography', 'camera', 'whyDetected', 'whyItWorks',
  ],
  properties: {
    eventId: {
      type: 'string',
      description: 'Exactly one of the event ids given in the prompt. Never invent an id.',
    },

    /**
     * Observations come first, and the model is told to fill them before
     * choosing a type. What was seen must precede what it means, or the
     * classification writes the evidence to support itself.
     */
    observations: {
      type: 'object',
      additionalProperties: false,
      required: [
        'horizontalMotion', 'verticalMotion', 'direction', 'scaleProgression',
        'blurProgression', 'luminanceProgression', 'sceneIdentityChanges',
        'incomingMotion', 'compositionChange', 'textPresent', 'phases',
      ],
      description:
        'ONLY what is visible across the supplied frames. Fill this before deciding what the event is. Every field here is checked against measurements taken from the pixels, so a claim that is not supported will lower the confidence of the whole event — answer null rather than guessing.',
      properties: {
        horizontalMotion: { type: ['string', 'null'], enum: ['none', 'slight', 'moderate', 'strong', null] },
        verticalMotion: { type: ['string', 'null'], enum: ['none', 'slight', 'moderate', 'strong', null] },
        direction: nullableString('Direction of the movement in plain words, e.g. "left-to-right" or "push in". Null when nothing moves.'),
        scaleProgression: { type: ['string', 'null'], enum: ['none', 'growing', 'shrinking', null] },
        blurProgression: { type: ['string', 'null'], enum: ['none', 'increasing', 'decreasing', 'sustained', null] },
        luminanceProgression: { type: ['string', 'null'], enum: ['none', 'brightening', 'darkening', 'spike', null] },
        sceneIdentityChanges: {
          type: ['boolean', 'null'],
          description: 'True when the frames show a different place, subject or setup — not merely a moved camera.',
        },
        incomingMotion: { type: ['string', 'null'], enum: ['none', 'continues', 'reverses', 'different', null] },
        compositionChange: nullableString('How framing or layout changes across the sequence.'),
        textPresent: { type: ['boolean', 'null'] },
        phases: {
          type: 'object',
          additionalProperties: false,
          required: ['before', 'build', 'peak', 'after'],
          description: 'The progression, phase by phase. Describe what CHANGES between frames, never what each frame contains.',
          properties: {
            before: nullableString('The state going in: framing, what is stable, what has begun to move.'),
            build: nullableString('What develops between the opening frames and the strongest one.'),
            peak: nullableString('The strongest frame, and what makes it the strongest.'),
            after: nullableString('The state coming out, and whether it continues or contradicts what came before.'),
          },
        },
      },
    },

    interpretation: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'confidence', 'reasoning'],
      description: 'What the observations above add up to. Reached from them, not before them.',
      properties: {
        type: {
          type: 'string',
          enum: [...MOTION_EVENT_TYPES],
          description:
            'The most specific type the observations actually support. If they show a shot change but not which technique produced it, answer scene_change rather than guessing whip_pan. A wrong specific answer is worse than a right general one.',
        },
        confidence: {
          type: 'number',
          description:
            'Between 0 and 1: how strongly these observations support this classification specifically. Use the low end freely — 0.4 on an ambiguous transition is a useful answer, 0.9 on one is not.',
        },
        reasoning: {
          type: 'string',
          description: 'One or two sentences connecting the observations to the classification.',
        },
      },
    },

    /**
     * Rival readings, kept internal. A confident answer with a close runner-up
     * is a different thing from a confident answer with none, and the product's
     * confidence should reflect that difference.
     */
    alternatives: {
      type: 'array',
      maxItems: 3,
      description:
        'Other classifications that would also fit these observations, with the confidence you would give each. Empty when the reading is unambiguous. These are not shown to the user; they temper how certain the product sounds.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'confidence', 'reasoning'],
        properties: {
          type: { type: 'string', enum: [...MOTION_EVENT_TYPES] },
          confidence: { type: 'number' },
          reasoning: { type: 'string', description: 'One short sentence: what would make this the better reading.' },
        },
      },
    },

    continuity: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'note'],
      description:
        'How the incoming shot relates to the outgoing one. Many transitions are a straight cut that works because something carries across it — reporting only "hard cut" for those misses the technique entirely.',
      properties: {
        kind: {
          type: ['string', 'null'],
          enum: [...CONTINUITY_KINDS, null],
          description:
            'Only subject-matched, shape-matched and composition-matched require judgement; the movement relationships are also measured independently and your answer will be checked against that measurement.',
        },
        note: nullableString('One sentence on what carries across, when something does.'),
      },
    },

    title: {
      type: 'string',
      description:
        'Two to five words in title case naming the technique. Example: "Whip Pan Transition". No timestamp, and never the words "Likely" or "Possible" — the product adds those itself from the measurements.',
    },
    shortExplanation: {
      type: 'string',
      description: 'ONE line for the timeline card. What happened, in editing language. Under about 90 characters.',
    },
    detailedExplanation: {
      type: 'string',
      description:
        'Three or four sentences for the detail view: the progression, where the change lands within it, and what the incoming shot does. This is the forensic account.',
    },
    technicalExplanation: {
      type: 'string',
      description:
        'Two or three imperative sentences describing how to construct the same effect, tool-agnostic. Feeds the Recreate flow.',
    },

    effects: {
      type: 'array',
      maxItems: 6,
      description: 'Short labels for treatments actually visible: "Motion blur", "Scale increase", "Light leak".',
      items: { type: 'string' },
    },

    transition: {
      type: 'object',
      additionalProperties: false,
      required: ['technique', 'outgoingBehavior', 'transitionMoment', 'incomingBehavior'],
      description: 'Only for events that join two shots. All null otherwise.',
      properties: {
        technique: nullableString('How the join appears to have been constructed.'),
        outgoingBehavior: nullableString('What the outgoing shot does as it approaches the join.'),
        transitionMoment: nullableString('What is on screen at the join itself.'),
        incomingBehavior: nullableString('What the incoming shot does immediately after.'),
      },
    },
    typography: {
      type: 'object',
      additionalProperties: false,
      required: ['textDetected', 'content', 'animationType', 'entrance', 'exit'],
      properties: {
        textDetected: { type: 'boolean' },
        content: nullableString('The visible words, if short and legible. Null otherwise — never guess at text.'),
        animationType: nullableString('How the type behaves: scale, fade, slide, mask reveal, per-word, per-character.'),
        entrance: nullableString('How it arrives.'),
        exit: nullableString('How it leaves, if visible in these frames.'),
      },
    },
    camera: {
      type: 'object',
      additionalProperties: false,
      required: ['movement', 'intensity', 'ambiguity'],
      properties: {
        movement: nullableString('What the camera appears to do, in a few words. Null if the camera is static.'),
        intensity: { type: ['string', 'null'], enum: ['subtle', 'moderate', 'strong', null] },
        ambiguity: nullableString(
          'Name what cannot be told apart from pixels — an optical zoom, a digital scale and a physical push look identical in frames. Null when there is no such ambiguity.',
        ),
      },
    },

    whyDetected: {
      type: 'string',
      description:
        'What in these specific frames supports this reading. Reference visible differences between the frames. Do not restate the measurements you were given as though you observed them.',
    },
    whyItWorks: nullableString(
      'One or two sentences on why the technique works on a viewer — what it hides, what it carries, what it makes the eye do. Derive it from this event, not from a definition of the technique. Null for events too plain to warrant one.',
    ),
  },
} as const;

export const EVENTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      description:
        'One entry per event id you can characterise. Skip any whose frames do not support a specific reading — an omitted event is far better than an invented one.',
      items: EVENT_ITEM,
    },
  },
} as const;

// -- Pass 3: reconciliation ---------------------------------------------------

export const RECONCILE_SCHEMA_NAME = 'analysis_reconciliation';

export const RECONCILE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'corrections', 'relationships', 'motifs', 'dnaNotes'],
  properties: {
    summary: {
      type: 'string',
      description:
        'The final overview: four to six sentences describing how this edit is constructed, how it changes across its running time, and what recurs. Use the shot statistics and event list you were given. Every claim must trace to something in them.',
    },
    corrections: {
      type: 'array',
      maxItems: 20,
      description:
        'Events whose classification should change now that the whole video is visible. Only include genuine corrections — an empty array is the expected answer for a clean analysis.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['eventId', 'newType', 'reason'],
        properties: {
          eventId: { type: 'string' },
          newType: { type: 'string', enum: [...MOTION_EVENT_TYPES] },
          reason: { type: 'string', description: 'One short sentence. What the wider context revealed.' },
        },
      },
    },
    relationships: {
      type: 'array',
      maxItems: 12,
      description:
        'Events that belong together across the video — a repeated device rather than one moment. Example: five direction-matched joins that form the edit\'s signature. Empty when nothing recurs.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['eventId', 'relatedIds', 'reason'],
        properties: {
          eventId: { type: 'string' },
          relatedIds: { type: 'array', maxItems: 8, items: { type: 'string' } },
          reason: { type: 'string', description: 'One short sentence: what these share.' },
        },
      },
    },
    motifs: {
      type: 'array',
      maxItems: 5,
      description: 'Repeated editing devices, named in a few words each. Empty when the edit has no signature.',
      items: { type: 'string' },
    },
    dnaNotes: {
      type: 'object',
      additionalProperties: false,
      required: ['pacing', 'cuts', 'motion', 'text', 'transitions', 'effects'],
      description:
        'One short sentence per trait explaining what the score reflects, grounded in the statistics supplied. A bar nobody can interrogate is a bar nobody should trust.',
      properties: {
        pacing: { type: 'string' },
        cuts: { type: 'string' },
        motion: { type: 'string' },
        text: { type: 'string' },
        transitions: { type: 'string' },
        effects: { type: 'string' },
      },
    },
  },
} as const;

// -- Recreate -----------------------------------------------------------------

export const RECREATE_SCHEMA_NAME = 'recreate_guide';

export const RECREATE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['platform', 'technique', 'timing', 'steps', 'whyThisMatches', 'caveat'],
  properties: {
    platform: { type: 'string', enum: [...RECREATE_PLATFORMS] },
    technique: { type: 'string', description: 'The technique being reproduced, in a few words.' },
    timing: {
      type: 'array',
      maxItems: 6,
      description:
        'Timing breakdown as label/value pairs, built from the measured durations supplied. Example: {label: "Outgoing movement", value: "~250ms"}. Use the ~ prefix: these are inferred, not frame-counted.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: { label: { type: 'string' }, value: { type: 'string' } },
      },
    },
    steps: {
      type: 'array',
      maxItems: 10,
      description:
        'Ordered, imperative steps specific to THIS observed event and this tool, using its real panel and property names. Never invent a numeric parameter that was not measured — write "a few frames" rather than a precise count you cannot know.',
      items: { type: 'string' },
    },
    whyThisMatches: {
      type: 'string',
      description:
        'Two or three sentences tying the steps back to what was actually observed in this video, referencing the measured direction, duration and structure.',
    },
    caveat: nullableString(
      'One sentence naming what could not be determined and therefore has to be judged by eye. Null when nothing meaningful is missing.',
    ),
  },
} as const;
