/**
 * Model configuration, in one place so a change cannot apply to only half the
 * product.
 */

export const DEFAULT_MODEL = 'gpt-5.6';

/**
 * Reasoning efforts gpt-5.6 accepts. `minimal` — which earlier GPT-5 models
 * take — is rejected here with a 400, and is deliberately absent.
 */
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Motion interpretation is a genuine visual reasoning task across two dozen
 * frames, so it gets more than the image-analysis default. Recreate is a
 * rewrite of facts already established, and holds up with none.
 */
export const MOTION_EFFORT: ReasoningEffort = 'medium';
export const RECREATE_EFFORT: ReasoningEffort = 'none';

export const IMAGE_DETAIL = 'low';

export const MOTION_MAX_OUTPUT_TOKENS = 6000;
export const RECREATE_MAX_OUTPUT_TOKENS = 1200;

export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const OPENAI_ORIGIN_PATTERN = 'https://api.openai.com/*';
