import { MOTION_EVENT_TYPES, RECREATE_PLATFORMS } from '../types/motion.ts';

/**
 * The JSON Schemas handed to the Responses API under `text.format`.
 *
 * Written by hand rather than generated: OpenAI strict mode has specific
 * requirements — every property listed in `required`, `additionalProperties:
 * false` on every object, nullability expressed as a union type rather than by
 * omission — and writing it explicitly keeps full control.
 *
 * Note what is *not* in this schema: timestamps. The model is never asked when
 * something happened, because it does not know and would answer anyway. It is
 * asked which measured candidate an observation belongs to, and the normalizer
 * supplies the time from the measurement.
 */

export const MOTION_SCHEMA_NAME = 'motion_analysis';

export const MOTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'events'],
  properties: {
    summary: {
      type: 'string',
      description:
        'Two or three sentences describing how this video is EDITED and how it MOVES — pacing, cutting rhythm, transition style, camera behaviour, text treatment. Never a description of the subject matter or story. Example: "Fast-paced fashion edit built on hard cuts every one to two seconds, with whip-pan transitions carrying motion across cuts and kinetic type landing on the beat."',
    },
    events: {
      type: 'array',
      description:
        'One entry per candidate you can confidently characterise. Skip candidates whose frames do not support any specific reading — an omitted event is far better than an invented one. At most two entries may share a candidateId, and only when two genuinely distinct things happen at that moment (for example a cut that also introduces text).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateId', 'type', 'title', 'description', 'confidence', 'effects'],
        properties: {
          candidateId: {
            type: 'string',
            description: 'Exactly one of the candidate ids given in the prompt. Never invent an id.',
          },
          type: {
            type: 'string',
            enum: [...MOTION_EVENT_TYPES],
            description:
              'The most specific type the evidence actually supports. If the frames show a shot change but not which technique produced it, use scene_change rather than guessing whip_pan.',
          },
          title: {
            type: 'string',
            description:
              'Two to five words in title case naming the technique. Example: "Whip Pan Transition". Do not include a timestamp, and do not write the word "Likely" — the product adds that itself when the measurements are weak.',
          },
          description: {
            type: 'string',
            description:
              'One or two sentences saying what happens and how it was done, in editing language. Reference what is visible between the before, during and after frames. Do not restate the numbers you were given.',
          },
          confidence: {
            type: 'number',
            description:
              'Between 0 and 1: how strongly the frames support this specific classification. Use the low end freely — 0.4 on an ambiguous transition is a useful answer, 0.9 on one is not.',
          },
          effects: {
            type: 'array',
            maxItems: 6,
            description:
              'Short labels for visual treatments actually visible in the frames, such as "Motion blur", "Scale increase", "Light leak", "Colour shift". Empty array when none are evident.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export const RECREATE_SCHEMA_NAME = 'recreate_guide';

export const RECREATE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['platform', 'steps', 'caveat'],
  properties: {
    platform: { type: 'string', enum: [...RECREATE_PLATFORMS] },
    steps: {
      type: 'array',
      maxItems: 10,
      description:
        'Ordered, imperative steps specific to THIS observed event and this tool. Use the measured duration and direction supplied in the prompt. Never invent a numeric parameter that was not measured — write "a short overlap, roughly half the transition" rather than a precise frame count you cannot know.',
      items: { type: 'string' },
    },
    caveat: {
      type: ['string', 'null'],
      description:
        'One sentence naming what could not be determined from the evidence and therefore has to be judged by eye. Null when the observation was complete enough that nothing meaningful is missing.',
    },
  },
} as const;
