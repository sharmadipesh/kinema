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
 * Effort per pass, matched to what each pass actually has to do.
 *
 * Reading a filmstrip for directional smear and where movement peaks is the one
 * genuinely hard visual reasoning task here, so the candidate pass gets the
 * most. The global pass characterises an idiom from thumbnails and supplied
 * statistics; reconciliation and recreate are text over facts already
 * established, and both hold up with none.
 */
export const GLOBAL_EFFORT: ReasoningEffort = 'low';
export const EVENTS_EFFORT: ReasoningEffort = 'medium';
export const RECONCILE_EFFORT: ReasoningEffort = 'low';
export const RECREATE_EFFORT: ReasoningEffort = 'none';
/**
 * The blueprint is a large synthesis over measurements already established,
 * plus a read of a handful of frames. Low effort, large output budget.
 */
export const BLUEPRINT_EFFORT: ReasoningEffort = 'low';

/**
 * `low` detail costs a flat ~85 tokens per image and downsamples hard. That is
 * the right trade for scene boundaries and gross movement, which are exactly
 * the low-frequency signals this product reads.
 */
export const IMAGE_DETAIL = 'low';

export const GLOBAL_MAX_OUTPUT_TOKENS = 1200;
export const EVENTS_MAX_OUTPUT_TOKENS = 8000;
export const RECONCILE_MAX_OUTPUT_TOKENS = 2500;
export const RECREATE_MAX_OUTPUT_TOKENS = 1800;
export const BLUEPRINT_MAX_OUTPUT_TOKENS = 9000;

export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const OPENAI_ORIGIN_PATTERN = 'https://api.openai.com/*';
