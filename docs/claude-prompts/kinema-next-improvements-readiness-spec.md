# KINEMA — Required Next Improvements and Recreation Readiness Specification

## Product focus

KINEMA's core promise should be:

> Turn a reference video into an editable, evidence-backed plan that a real team can shoot, edit, and deliver.

The current product already has a strong analysis foundation: video detection, motion events, story stages, Story flow/contact sheet, camera and equipment guidance, an Editor Toolkit, measured/inferred separation, history, copy actions, and partial-result handling.

The next release should not add more analysis prose. It should close the gap between **having an analysis** and **being able to recreate the video**.

## Current readiness problem

The existing `Ready to recreate this?` feature is an availability counter, not a recreation decision.

Current behavior in `src/analysis/readiness.ts` and `src/sidepanel/blueprint/Readiness.tsx`:

- checks nine output categories
- gives each category a Boolean `ready`
- counts present categories as `ready / total`
- treats one or more objects/items as sufficient
- sends a row to a broad result tab when clicked

Observed weaknesses:

1. The preview reports `9/9` while Analysis Coverage reports a gap and Audio design is not produced.
2. Story-frame coverage is not checked. The preview has no captured frame for two stages but still reports full readiness.
3. Story/Edit consistency is not checked. The preview Story board has three stages while the Edit map contains an additional Peak stage.
4. Timeline coverage is not checked. A missing story interval can still be called ready.
5. Source availability is not checked. A history result can be complete as an analysis but not ready for live seeking.
6. Evidence quality, confidence, and partial coverage do not affect the verdict.
7. Camera readiness only requires a `camera` object; it does not check whether the explanation, capabilities, frame-rate plan, tier, or production relevance is useful.
8. Edit readiness passes when either a cut map or workflow exists, even when footage requirements, transition instructions, or source frames are missing.
9. It does not know what the user wants to do: study the reference, shoot it, edit existing footage, or deliver a cut.
10. It does not collect constraints such as aspect ratio, duration, platform, budget, crew, equipment, or available footage.
11. It does not distinguish a blocker, a required user decision, a warning, an optional enhancement, or an unavailable modality.
12. It gives no single recommended next action.
13. Checklist rows are not user-confirmable and cannot represent real-world preparation.
14. The panel is collapsed and placed among technical Overview accordions, so the most product-oriented decision is visually secondary.
15. Clicking a row only changes tabs; it does not focus the exact missing section or perform a recovery action.

# P0 — Features required for the next useful release

## 1. Replace the Boolean counter with a Recreation Readiness engine

### Goal

Answer four different questions truthfully:

1. Is the analysis trustworthy enough to use?
2. Is the creative/production plan ready to shoot?
3. Is the editorial plan ready to edit?
4. Is the result ready to hand off or export?

### Required verdicts

Use a small set of understandable verdicts:

- **Blocked** — a critical prerequisite is missing or inconsistent
- **Needs decisions** — analysis is usable but the user must choose constraints
- **Plan ready** — reference plan is coherent and can be used for pre-production
- **Ready to shoot** — production requirements and user constraints are resolved
- **Ready to edit** — footage/editorial prerequisites are present or confirmed
- **Ready to deliver** — handoff/export requirements are satisfied

Do not compress all of these into a percentage. `8/9` can hide the one item that makes recreation impossible.

### Required item states

Every readiness item should use:

- `ready`
- `needs_input`
- `warning`
- `blocked`
- `optional`
- `unavailable`

### Required item importance

- `critical`
- `required`
- `recommended`
- `optional`

### Suggested data model

```ts
type ReadinessState =
  | 'ready'
  | 'needs_input'
  | 'warning'
  | 'blocked'
  | 'optional'
  | 'unavailable';

type ReadinessPhase =
  | 'analysis'
  | 'story'
  | 'production'
  | 'footage'
  | 'edit'
  | 'delivery';

interface ReadinessAction {
  label: string;
  kind:
    | 'jump'
    | 'choose'
    | 'retry'
    | 'detect-video'
    | 'select-frame'
    | 'confirm'
    | 'export';
  target?: string;
}

interface RecreationReadinessItem {
  id: string;
  phase: ReadinessPhase;
  title: string;
  state: ReadinessState;
  importance: 'critical' | 'required' | 'recommended' | 'optional';
  summary: string;
  reason?: string;
  evidence?: string[];
  dependencies?: string[];
  action?: ReadinessAction;
  automaticallyEvaluated: boolean;
}

interface RecreationReadinessSummary {
  verdict:
    | 'blocked'
    | 'needs_decisions'
    | 'plan_ready'
    | 'ready_to_shoot'
    | 'ready_to_edit'
    | 'ready_to_deliver';
  blockers: string[];
  decisions: string[];
  warnings: string[];
  assumptions: string[];
  nextAction?: ReadinessAction;
}
```

Do not persist values that can be derived cheaply unless persistence is needed for user confirmations. Persist manual confirmations and user choices separately from measured analysis.

## 2. Add Recreation Mode and a short Project Brief

Readiness cannot be truthful without knowing the user's goal.

### Recreation mode

Ask the user to choose one:

- **Study reference** — analysis completeness matters; production assets do not
- **Plan a shoot** — story, shot, camera, lighting, equipment, and footage plans matter
- **Edit footage** — cut, pacing, transition, audio, typography, and footage availability matter
- **Create a cutdown** — target duration, platform, aspect ratio, and mandatory beats matter

Recommended default: **Plan a shoot**, but do not silently assume it after the user begins editing the brief.

### Minimum optional brief

- target platform
- target aspect ratio
- target duration
- fidelity: close recreation / inspired adaptation
- production tier: lean / creator / professional
- available crew size
- available camera/support/lighting
- editor/NLE
- footage status: not shot / being shot / footage available
- audio status: reference audio available / music selected / no audio yet

Every unanswered field should be a decision, not an error. Only fields required for the selected mode should block later readiness levels.

## 3. Add a Story/Edit consistency validator

Before showing a positive readiness verdict, validate:

- stage IDs are unique and ordered
- stages have valid time ranges
- stage ranges do not overlap unexpectedly
- the complete video range is covered, or uncovered ranges are explicitly explained
- representative-frame references belong to the current analysis
- every required stage has a usable frame or declared fallback
- Story stages and Edit map refer to the same canonical stage set
- pacing rows correspond to canonical stages
- shot counts are plausible relative to scene segmentation
- cut-map events stay within video duration
- palette/frame artifacts belong to the same analysis version
- history results do not claim live source controls

If a mismatch is found:

- mark the affected item `blocked` or `warning` based on impact
- say what is inconsistent
- preserve usable sections
- offer a targeted retry or local repair when safe
- never silently hide the mismatch

## 4. Make the Storyboard editable

The current Story view is useful but read-only. A professional editor must be able to correct the machine.

### Required editing actions

- choose a different representative frame from captured frames
- rename a stage
- edit stage purpose and editor note
- split a stage at a measured time
- merge adjacent stages
- mark a stage approved
- mark a stage as optional for an adaptation/cutdown
- add a manual reference keyword
- reset a manual change to the generated value

### Integrity rules

- never overwrite measured start/end values with AI prose
- label manual edits as user-authored
- retain original generated values for reset/history
- recalculate dependent edit-map/pacing information after split/merge
- warn before a change invalidates copied/exported output
- persist edits per analysis

### Readiness integration

- missing stage frame: `needs_input` when the user can choose one
- invalid/missing frame: `blocked` if the selected workflow requires a visual board
- unapproved stage: `recommended`, not automatically a blocker
- uncovered timeline interval: `blocked` until repaired or explicitly excluded

## 5. Add actionable footage readiness

The existing footage checklist is generated text. Turn it into a working checklist.

### Required behavior

- group items as Must have / Recommended / Optional
- connect each item to one or more story stages
- let the user mark Available / Needs capture / Not applicable
- identify transition-handle requirements
- show which missing footage blocks which stage
- persist confirmation state
- provide “show affected stages” navigation
- export the checklist with status

Do not claim to inspect a footage library until actual footage-upload/bin analysis exists.

## 6. Add an editor handoff pack

Clipboard-only output is not enough for a repeatable workflow.

### Required V1 exports

- Story board as Markdown
- contact sheet as printable HTML or image
- cut/marker list as CSV
- footage checklist with user status
- complete recreation brief as Markdown
- JSON export for KINEMA backup/interchange

### Export rules

- include title, duration, aspect, analysis version, and generation time
- include evidence labels and unavailable sections
- include measured timestamps without changing precision
- include user edits and mark them as manual
- never embed API keys or internal debug logs
- give visible success/failure feedback
- define behavior when frames are missing

Postpone EDL/FCPXML/Premiere project generation until frame rate, timebase, drop-frame behavior, clip identity, and format validation are designed and tested.

## 7. Add selective repair/regeneration

Current retry support should be expanded beyond a broad interpretation retry.

### Required targets

- retry Story interpretation
- retry camera/equipment plan
- retry Editor Toolkit prose
- regenerate one selected stage
- recapture missing stage frames without re-running unrelated AI work
- rebuild local story/edit artifacts from persisted measurements

### Rules

- show what will be recomputed and what will be preserved
- preserve local measurements, palette, canonical stages, user edits, and valid frames
- require confirmation if a retry would replace manual edits
- report validation rejection separately from network/model failure
- never charge for a model retry when a local repair is sufficient

## 8. Add truthful audio status now; audio analysis as the next capability

### Immediate requirement

Readiness must say:

- audio not analyzed
- suggested sound design is visual inference only
- whether this matters for the chosen recreation mode

Audio absence should:

- be `optional` for Study reference when the user wants picture analysis
- be a `warning` for Plan a shoot
- be `needs_input` or `blocked` for music-driven Edit footage/Cutdown workflows

### Next capability

Add audio analysis in a separate approved phase:

- waveform overview
- silence/dialogue/music regions
- beat and downbeat candidates
- section changes
- visual cut-to-beat relationship
- detected audio events only when actually measured
- suggested sound-design layer kept separate

Do not infer BPM or dialogue from frames.

## 9. Add privacy, retention, and deletion controls

Required before encouraging repeated professional use:

- explain which frames are sent to the model
- show whether the analysis is local-only or AI-assisted
- delete an analysis and all associated frames/manual edits
- history retention setting
- storage-usage summary
- remove orphaned frame data
- export before deletion

# P1 — High-value features after P0 is reliable

## 10. Reference vs Rough Cut comparison

This is the strongest potential professional differentiator.

Compare an uploaded rough cut with the reference on:

- story-stage timing
- cut density and shot-duration distribution
- energy progression
- motion direction and continuity
- transition placement/type
- typography timing
- palette evolution
- missing/extra beats

Output differences, not a single fake similarity score. Let the editor choose whether fidelity or adaptation is the goal.

## 11. Footage Bin Assistant

After explicit footage upload:

- match clips to stage requirements
- suggest strongest representative takes
- identify direction-compatible transition pairs
- flag insufficient handles
- identify missing shot roles
- group alternates/duplicates

Keep user confirmation central; do not auto-edit or discard footage.

## 12. Cutdown planner

Create plans for:

- 16:9 → 9:16 adaptation
- long reference → 30s / 15s / 6s
- alternate hooks
- mandatory and removable stages
- reframing risk and text-safe areas
- revised pacing without destroying story logic

## 13. Analysis versions and approval history

- generated version history
- user-edit history
- approved/needs-work status per stage
- compare two analyses or board revisions
- restore previous version
- export version metadata

# P2 — Defer until product fit is proven

- cloud collaboration and shared comments
- automatic NLE project generation
- stock marketplace integrations
- AI-generated replacement storyboard artwork
- automatic final-video editing
- social publishing
- large camera-product recommendation databases

# Detailed `Ready to recreate this?` UX

## Placement

Move Recreation Readiness out of the lower technical accordion stack.

Recommended placement:

- compact persistent summary below the Overview/Story/Create/Edit tabs
- full Readiness view or drawer when opened
- visible on all result tabs
- state preserved while navigating

## Collapsed summary

Show:

```text
RECREATION READINESS
Needs 2 decisions
Plan is usable; choose a production tier and replace two missing stage frames.

[Review blockers]  [Next: choose production tier]
```

Do not show only `7/9`.

## Expanded layout

Group by workflow:

1. Analysis integrity
2. Story board
3. Production plan
4. Footage
5. Edit plan
6. Audio
7. Delivery

Each row should show:

- status icon plus text label
- title
- concise reason
- evidence or dependency when useful
- one direct action
- whether the result was automatic or user-confirmed

## Example rows

```text
BLOCKED — Story coverage
The Story board does not cover 00:15–00:21, but the Edit map identifies that range as Peak.
[Repair story stages]

NEEDS INPUT — Representative frames
Two of three stages are using no frame.
[Choose frames]

READY — Cut map
Five measured cuts are available and inside the source duration.
[View cut map]

WARNING — Audio
No audio was analyzed. Sound-design notes are suggestions based on visual events.
[Set audio status]

NEEDS INPUT — Production tier
Camera and equipment recommendations include three tiers, but no target tier is selected.
[Choose tier]
```

## Next-action logic

Choose the next action in this order:

1. corrupted or inconsistent data
2. missing critical source/frame evidence
3. missing required user decision
4. missing plan section
5. recommended user confirmation
6. export/handoff

Never prioritize an optional gear suggestion ahead of a broken Story board.

## Manual confirmation

Some readiness facts cannot be inferred:

- location secured
- talent available
- equipment available
- footage captured
- music licensed
- brand/client approval
- delivery specification confirmed

Manual confirmations must be explicitly marked. Do not present them as machine-detected facts.

## Empty and failure states

Handle:

- no blueprint
- local-only analysis
- history without a live source
- missing frames
- partial validation
- failed selective retry
- incompatible old analysis version
- unsupported audio access
- no project brief
- user edits that invalidate a generated section

Every state must explain:

1. what happened
2. what remains usable
3. whether recreation is blocked
4. the next safe action

# Acceptance criteria

## Readiness correctness

- full readiness is impossible when a critical stage has no usable frame in a workflow that requires a visual board
- full readiness is impossible when Story and Edit canonical stages disagree
- full readiness is impossible when story coverage contains an unexplained timeline gap
- `unavailable` blueprint sections affect the relevant readiness phase
- a history result can be Plan ready while accurately stating that live seeking is unavailable
- audio absence is evaluated differently by recreation mode
- optional items never block a verdict
- one critical blocker cannot be hidden by many ready items
- manual confirmations are stored separately from analysis-derived facts

## Readiness UX

- the verdict and next action are visible without expanding a technical accordion
- status does not depend on color alone
- every blocker has a useful action or an honest explanation that no automatic action exists
- actions navigate to the exact section/item, not only the broad tab
- keyboard and screen-reader users can inspect and operate all rows
- layout has no horizontal overflow at 320, 360, 380, and 420 px
- changing a brief choice updates readiness immediately
- copy/export reports success or failure

## Storyboard editing

- changing a frame persists through panel close/reopen and history load
- split/merge preserves valid ordered time ranges
- manual edits are visibly labeled and reversible
- dependent Edit-map data is recalculated or marked stale
- no manual action silently changes the locked source video

## Export

- exported time values match measured source values
- missing frames and unavailable sections remain explicit
- manual edits and analysis version are included
- no credential or debug payload is exported
- export behavior is tested with live, history, partial, and missing-frame analyses

# Required tests

## Unit

- readiness state and verdict for every mode
- blocker precedence
- optional/unavailable behavior
- story coverage gaps and overlaps
- Story/Edit stage mismatch
- missing/wrong-analysis frame references
- history/live-source distinction
- user-confirmation persistence and reset
- selective retry preservation rules
- export serialization

## Component

- collapsed summary verdict and next action
- grouped expanded view
- blocker/warning/decision/ready rows
- exact navigation targets
- project brief updates
- manual checklist interaction
- editable stage frame and notes
- split/merge confirmation and failure
- export feedback
- 320–420 px layouts
- keyboard focus and accessible names

## Integration

- completed analysis with missing stage frames
- blueprint partial failure
- Story/Edit inconsistency
- history result without source
- selective retry with preserved user edits
- manual brief/checklist state after reopen
- analysis deletion removes frames and manual state

# Recommended implementation order

1. Add Story/Edit consistency and frame-coverage validation.
2. Replace Boolean readiness types with state, importance, phase, and action.
3. Introduce recreation mode and project brief.
4. Build the persistent Readiness summary and grouped detail UI.
5. Add editable stage frame selection and notes.
6. Convert footage requirements into a persistent checklist.
7. Add selective repair/regeneration.
8. Add export/handoff pack.
9. Add privacy/retention controls.
10. Design audio analysis as a separate phase.
11. Build Reference vs Rough Cut only after the P0 workflow is reliable.

# Instruction for Claude

```text
Use this document as a product and engineering specification.

First perform a read-only audit against the current repository. For every requirement, mark it Complete, Partial, Missing, Broken, or Not applicable and cite exact files/functions/tests.

Pay special attention to `src/analysis/readiness.ts`, `src/sidepanel/blueprint/Readiness.tsx`, Story/Edit canonical stage consistency, representative-frame coverage, history behavior, and existing retry/export infrastructure.

Do not implement during the audit. Return confirmed gaps, proposed data-model changes, migration implications, test plan, and the smallest reviewable P0 phases. Then stop for approval.
```
