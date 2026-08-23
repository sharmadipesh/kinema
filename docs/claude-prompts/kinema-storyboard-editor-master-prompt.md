# KINEMA — Storyboard, Moodboard, and Professional Editor Workspace

Copy everything below this line into Claude Code while its working directory is the KINEMA repository.

---

## ROLE

Act as a principal product engineer with 20+ years of combined experience in:

- Chrome Manifest V3 extension architecture
- TypeScript, Preact/React, IndexedDB, service workers, and content scripts
- video analysis and computer vision pipelines
- professional offline editing, finishing, color, and sound workflows
- cinematography, production design, and creative direction
- product design, accessibility, UX research, reliability, and QA

You are working inside the existing **KINEMA** Chrome extension repository. The package and some UI strings may still say **Motion Inspector**. Treat that naming mismatch as something to audit, not permission to perform a broad rebrand.

Your job is to turn an analyzed video into a practical **Story Board + Story Moodboard + Editor Workspace** that helps an editor understand, rebuild, and use the reference video.

This is not a greenfield project. Do not rebuild it from scratch.

## PRIMARY OUTCOME

Given a detected or uploaded video, KINEMA should produce a time-based visual board that answers:

1. What happens visually from beginning to end?
2. Why does each stage exist?
3. Which reference frame best represents each stage or beat?
4. How do energy, pacing, composition, motion, lighting, color, and typography evolve?
5. What footage must be captured or selected to reproduce the edit?
6. Where should the editor cut, transition, speed-ramp, add text, grade, and design sound?
7. Which claims are measured, visually observed, inferred, or merely suggested?
8. What parts of the result are complete, partial, unavailable, stale, or failed?

The result must feel like a working editorial tool, not a long AI essay.

## NON-NEGOTIABLE RULES

1. Preserve all working functionality and all existing user changes.
2. The working tree contains significant uncommitted work. Never reset, discard, overwrite, or mass-reformat unrelated files.
3. Do not rebuild the extension, replace its state model, or redesign unrelated screens.
4. Inspect the real code before making claims. Cite actual paths, functions, types, and tests.
5. Never fabricate timestamps, cuts, focal lengths, camera bodies, sounds, colors, or technical certainty.
6. Derived timestamps must come from the local measurement pipeline.
7. Model interpretation must be grounded in supplied frames and measurements.
8. Keep locally derived results usable when AI interpretation fails.
9. A missing section must show an explicit reason. Never silently render an empty area.
10. Never silently change the video bound to an active analysis session.
11. Optimize the side panel for narrow widths, keyboard use, readable hierarchy, and progressive disclosure.
12. Use existing tokens, components, schemas, storage, and analysis primitives before adding new abstractions.
13. Add dependencies only if the benefit is essential and cannot reasonably be achieved with the current stack.
14. Do not change files during the initial audit.

## CURRENT IMPLEMENTATION — VERIFY, DO NOT BLINDLY ASSUME

The repository appears to already contain substantial implementation for:

- event-driven video discovery and a content-side video registry
- active-video scoring and a multiple-video selector
- analysis sessions locked to a selected video
- development-only detection inspection
- motion, scene, continuity, rhythm, energy, palette, coverage, and readiness analysis
- structured camera, lens, stabilization, equipment, lighting, and production-blueprint schemas
- an editor toolkit with an edit map, cut map, pacing, transition recipes, footage checklist, workflow, typography, colorist, sound, priorities, and mistakes
- Overview, Story, Create, and Edit result tabs
- Story stages derived from a measured energy curve
- OpenAI structured-output generation plus defensive validation
- local-only fallback behavior when interpretation is unavailable
- history and evidence-frame storage

Important files likely include:

- `src/content/video-registry.ts`
- `src/content/scoring.ts`
- `src/content/index.ts`
- `src/background/tab-videos.ts`
- `src/background/session-registry.ts`
- `src/background/orchestrator.ts`
- `src/background/artifacts.ts`
- `src/analysis/story.ts`
- `src/analysis/energy.ts`
- `src/analysis/editor-toolkit.ts`
- `src/analysis/coverage.ts`
- `src/analysis/readiness.ts`
- `src/services/blueprint-schema.ts`
- `src/services/blueprint-prompts.ts`
- `src/services/validate-blueprint.ts`
- `src/sidepanel/blueprint/StoryView.tsx`
- `src/sidepanel/blueprint/EditView.tsx`
- `src/sidepanel/blueprint/CreateView.tsx`
- `src/sidepanel/blueprint/Readiness.tsx`
- `src/sidepanel/motion/VideoSelect.tsx`
- `src/sidepanel/motion/DetectionInspector.tsx`
- `src/storage/frame-store.ts`
- `src/storage/history.ts`

Treat this list as a starting map. Search the repository and correct it where necessary.

## KNOWN PARTIAL OR SUSPICIOUS AREAS TO VERIFY

These are audit hypotheses, not permission to patch immediately:

1. `buildBlueprint()` captures a representative frame for every story stage, but those frames may be sent only to the model and never persisted. `StoryView` may therefore display the nearest general evidence frame instead of the actual stage reference frame.
2. Retry/resume may reconstruct the blueprint with an empty palette, losing measured color information even though the original analysis captured it.
3. SPA navigation detection may compare only `location.pathname`, missing query-string and hash route changes such as a new YouTube `watch?v=...` video.
4. The background tab registry may sort aggregated videos by document index after the content registry sorted them by active score, contradicting the selector’s “likely current” ordering.
5. Tab reload/navigation cleanup may run only for a narrow loading-state condition, allowing stale registry entries or session bindings.
6. Blueprint validation may drop malformed or empty camera/equipment/editor sections without appending an explicit `unavailable` explanation, producing silent UI gaps.
7. The “complete” Story UI may be only partially connected to persisted data, history restoration, retry, or failure paths.
8. Camera and equipment schemas may exist, but their reliability under truncation, missing model fields, invalid items, local-only mode, retry, and history may be untested.
9. Editor Toolkit and Story views may lack direct component tests and full workflow tests.
10. Real-world video detection behavior may lack integration coverage for node replacement, source swaps, multiple frames, query-only navigation, removal during analysis, and duplicates.
11. Product naming may be inconsistent between KINEMA, Motion Inspector, package metadata, UI, docs, and generated assets.
12. Existing comments may claim data is stored when the code does not actually write it.

Verify every item. Add any additional incomplete, partial, disconnected, misleading, or dead feature you find.

# PHASE 0 — READ-ONLY PRODUCT AND CODE AUDIT

Before editing any file, inspect the repository and return one audit report.

## A. Build a feature-completeness matrix

For every relevant feature, assign exactly one status:

- **Complete** — implemented end to end, accessible in UI, persisted where required, and tested
- **Partial** — meaningful implementation exists but important behavior, states, or tests are missing
- **UI-only** — visible surface exists but data or actions are fake, static, or disconnected
- **Backend-only** — logic/data exists but users cannot reliably access it
- **Broken** — intended behavior exists but fails or violates an invariant
- **Missing** — no meaningful implementation exists
- **Unverified** — cannot be established from available evidence

At minimum, assess:

- initial video discovery
- inserted/removed video nodes
- source changes
- SPA navigation
- multiple-video ordering and manual selection
- stale-video cleanup
- analysis-to-video locking
- removal during analysis
- retry/resume
- local-only analysis
- palette capture, retry, rendering, and history
- evidence-frame persistence
- story-stage reference-frame persistence
- Story arc derivation
- Story Moodboard stage cards
- storyboard/contact-sheet presentation
- camera, lens, stabilization, and equipment recommendations
- Editor Toolkit sections and actions
- empty/partial/unavailable states
- history restoration
- accessibility
- narrow-panel responsiveness
- tests and debug tooling

For every Partial, UI-only, Backend-only, Broken, or Missing item, provide:

- user impact
- technical root cause
- exact supporting evidence
- files/functions involved
- severity: P0, P1, P2, or P3
- smallest correct fix
- required tests

## B. Trace the complete data flow

Trace one successful live-video analysis and one uploaded-video analysis through:

```text
video discovery or upload
→ selected video identity
→ locked analysis session
→ sampling and frame capture
→ local measurements
→ AI requests
→ schema validation/normalization
→ artifact persistence
→ history persistence
→ side-panel rendering
→ seek/copy/export actions
```

Also trace these failure flows:

- model interpretation unavailable
- blueprint generation unavailable
- selected video removed mid-analysis
- page navigates to a different video
- canvas/frame access restricted
- retry after partial failure
- history reopened after page/video is gone

Identify exactly where information can be lost, become stale, or appear more certain than it is.

## C. Perform a UX and interaction audit

Evaluate the UI as a professional editor using a narrow Chrome side panel.

Inspect:

- information architecture
- tab names and mental model
- loading and progress feedback
- disabled-action explanations
- current-video identity
- ambiguity when several videos exist
- scanability of long analyses
- timeline-to-card navigation
- reference-frame usefulness
- empty, partial, retry, restricted, and stale states
- keyboard navigation and focus visibility
- semantic headings and accessible names
- color contrast and non-color status cues
- truncation, overflow, sticky controls, and scroll restoration
- history versus current-analysis clarity
- copy/export feedback
- error recovery and preservation of useful partial results

Test or inspect at least these side-panel widths:

- 320 px
- 360 px
- 380 px
- 420 px

## D. Run baseline verification

Without changing files, run the existing scripts from `package.json`, including:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Report exact results. Do not claim something passes if it was not run successfully.

## E. Audit response format

Return:

1. Executive summary
2. Current architecture
3. Feature-completeness matrix
4. Confirmed bugs with severity and reproduction steps
5. UX defects with severity and reproduction steps
6. Data-loss and stale-state risks
7. Test-coverage gaps
8. Recommended product shape
9. Proposed implementation phases
10. Exact files expected to change
11. Decisions or assumptions requiring product approval

Then **STOP**. Do not edit files until I explicitly approve the audit and tell you which phase to implement.

# AFTER APPROVAL — TARGET PRODUCT DESIGN

Implement approved phases only. Use test-driven changes for every bug and behavior change.

## 1. STORY BOARD + STORY MOODBOARD

Create one timeline-native visual workspace. Do not create two repetitive reports.

The distinction should be clear:

- **Storyboard**: what representative shot/frame belongs at each beat and how the sequence is assembled
- **Story Moodboard**: how purpose, mood, energy, composition, color, light, camera, movement, typography, and sound opportunity evolve across those beats

### 1.1 Stage/beat model

Stages must be derived from measured change, scene, rhythm, and energy information. Do not force every video into Hook/Build/Peak/Resolution or a five-act structure.

Each stage should support:

- stable stage ID and ordinal
- measured start/end time
- representative-frame ID and reference time
- stage name
- narrative/editorial purpose
- emotional or visual mood
- energy and pacing description
- shot count and average shot duration where measured
- composition
- camera behavior
- subject or scene movement
- lighting
- measured palette plus interpreted color direction
- typography behavior when visible
- transition into and out of the stage
- suggested sound-design opportunity, explicitly labeled as a suggestion
- footage required to reproduce the stage
- editor action
- reference-search keywords
- confidence/evidence classification

Do not add empty fields merely to make every card look identical. Show only supported information, plus an explicit partial/unavailable explanation when a major section is missing.

### 1.2 Representative frames

- Persist the exact stage reference frames captured for blueprint/story analysis.
- Store lightweight frame references in analysis/history records and image payloads in the existing frame store/IndexedDB architecture.
- Restore them correctly from history.
- Prevent orphaned frames and accidental memory retention.
- Use deterministic nearest-frame fallback only when the intended frame is genuinely unavailable.
- Show a truthful placeholder and reason when no frame can be used.
- Clicking a live-source frame should seek the locked video. A history item must not pretend a missing live video can be controlled.

### 1.3 Board presentation

Provide editor-friendly views using the existing product style:

- **Story flow** — vertical stage cards synchronized with time/energy
- **Contact sheet** — compact frames with stage, time range, purpose, and key edit note
- **Detail** — expanded production/editor instructions for the selected stage

If adding all views at once would create poor complexity, prioritize Story flow and Contact sheet, and explicitly defer Detail.

The board must support:

- seek to stage/reference time for a current live analysis
- copy one stage as structured text
- copy the whole board as Markdown
- clear live/history behavior
- visible partial/unavailable states

Treat PNG/PDF/FCPXML/Premiere XML/EDL export as later phases unless the existing architecture already makes one safe and small. Do not promise editable timeline interchange without validating formats and frame-rate/timebase handling.

## 2. PROFESSIONAL EDITOR WORKSPACE

The Editor tab should answer: **“If I receive footage tomorrow, how do I build this edit?”**

### 2.1 P0 editor features

Make these reliable and directly usable:

1. **Edit map** — stages, time ranges, editorial purpose, rhythm, and primary action
2. **Cut map** — measured cut/event times, type/confidence, and seek action
3. **Pacing map** — relative pacing changes supported by shot-duration measurements
4. **Transition recipes** — outgoing footage, incoming footage, directional/visual match, cut location, handles, and post work
5. **Footage checklist** — concrete footage an editor needs, grouped by must-have, useful, and optional where evidence supports the distinction
6. **Recommended workflow** — an ordered workflow adapted to this reference
7. **Speed-ramp guidance** — relative phases and purpose, never fabricated speed percentages
8. **Typography notes** — only when text is visible or explicitly marked as a creative suggestion
9. **Colorist notes** — measured palette separated from interpretive grade suggestions
10. **Suggested sound map** — opportunities, never claims that unanalysed sounds are present
11. **What must be right** — reference-specific priorities
12. **Mistakes to avoid** — reference-specific failure modes

Every important time-based item must be navigable to the source when the locked source still exists.

### 2.2 High-value P1 features

Design for these after P0 is reliable:

- **Beat Board** — group cuts into editorial beats rather than showing only a flat event list
- **Shot DNA** — reusable description of framing, direction, motion, duration class, and transition role
- **Footage Gap Detector** — compare the reference recipe with a user-confirmed footage inventory; never pretend the extension understands files it has not analyzed
- **Transition Pairing Assistant** — explain what outgoing/incoming shot characteristics must match
- **Replace This Shot mode** — turn a stage into a concise shot brief for production or stock-footage search
- **Alternative Cut recipes** — conservative, faithful, and high-energy variants clearly labeled as suggestions
- **Version QA checklist** — continuity, direction, handles, pacing, text safe area, grade consistency, and deliverable checks
- **Prompt Pack** — copy stage-specific prompts for image/video ideation while preserving the evidence/suggestion distinction

Do not build speculative P1 features until the audit and P0 implementation are approved.

### 2.3 P2 future concepts

Document, but do not implement without explicit approval:

- compare a reference with an uploaded rough cut
- automatic shot matching across a bin of uploaded clips
- transcript or dialogue-aware story beats
- real audio analysis and beat synchronization
- NLE timeline exchange
- collaborative comments/approvals
- cloud board sharing

## 3. CAMERA, LENS, AND PRODUCTION GUIDANCE

Preserve and harden the structured camera/equipment system already present.

Recommendations must prioritize capability over brand and answer:

- what is useful
- why it is useful
- which measured or observed characteristic requires it
- required/recommended/optional priority
- lean/creator/professional alternative where useful

Cover only relevant sections:

- camera capabilities and camera class
- lens/focal-length ranges as recommendations, never claims about the original lens
- stabilization/support
- frame-rate plan
- lighting/grip
- monitoring, power, storage, audio, and specialty tools only when relevant
- shooting and transition-handle guidance

Reject generic lists such as “camera, tripod, lights.” If a recommendation cannot be tied to an observation, omit it and explain the gap.

## 4. EVIDENCE AND CONFIDENCE CONTRACT

Every user-facing insight must fit one of four evidence classes:

- **Measured** — computed locally from timing, pixels, frames, motion, scenes, or cuts
- **Observed** — visible in supplied reference frames and interpreted by the model
- **Inferred** — plausible professional interpretation with uncertainty
- **Suggested** — a creative recommendation not claimed to exist in the source

Use this classification in schemas/data where it materially prevents misleading output. Avoid littering every sentence with badges if grouping or section-level labeling is clearer.

Hard rules:

- exact timing comes only from measured data
- hex colors come only from the measured palette
- camera bodies, lenses, FPS, shutter, and lighting setups are recommendations, not detected facts, unless the product has actual metadata
- sound-design opportunities remain Suggested until audio is analyzed
- model-generated stages not matching locally derived stage IDs are rejected
- invalid model content cannot overwrite locally measured editor-toolkit data
- empty validated sections generate explicit coverage/unavailable information

## 5. REQUIRED RELIABILITY FIXES

Protect these invariants:

1. A DOM video element retains its identity while it remains the same element.
2. A replaced element receives a new identity; stale references are invalidated.
3. The background never reorders videos in a way that destroys active-score ordering.
4. Query, hash, and pathname navigation cause the appropriate re-evaluation.
5. An analysis session never silently moves to a different video.
6. Removing the bound video interrupts safely while preserving useful completed partial work.
7. Retry uses the same persisted local artifacts, including palette, stages, and frame references.
8. History restoration does not depend on a currently open source video.
9. Stage reference frames displayed in Story are the intended persisted frames or a declared fallback.
10. A reload or tab close cannot leave a usable-looking stale registry/session.
11. Partial AI responses cannot create silent missing sections.
12. Local results remain visible if interpretation/blueprint calls fail.

## 6. UX STATE MATRIX

Implement and test deliberate states for:

- no video detected
- permission not granted
- restricted browser page
- one video detected
- several videos with confident likely-current selection
- several ambiguous videos requiring user choice
- metadata still loading
- selected video removed
- SPA changed to a new video
- frame access restricted/CORS-tainted
- upload ready, invalid, too large, unsupported, or interrupted
- analysis queued, sampling, interpreting, blueprint generation, completing
- cancellation
- recoverable AI/network/rate-limit/auth error
- local-only result
- partial blueprint
- retry in progress and retry success/failure
- history item with no live source
- missing or evicted evidence frames
- very short, very long, vertical, square, and landscape videos
- empty Story or Editor sections

For every error/empty state, provide:

- what happened
- whether existing work is safe
- what the user can do next
- an action only when the action is actually available

## 7. DEBUGGING AND OBSERVABILITY

Keep diagnostics development-only unless the information is genuinely user-actionable.

Extend the debug view/logging as needed to expose:

- tab/frame/document identity
- registry video IDs and ownership
- score inputs and final active score
- selected video versus analysis-bound video
- source and currentSrc changes
- attached/removed status
- SPA navigation key before/after
- session ID, phase, source kind, and locked video ID
- frame-access result
- captured, persisted, missing, and restored frame counts
- palette bins/swatches availability across initial analysis and retry
- model-pass status and validation failures by section
- coverage state by output section
- retry artifact availability

Do not log API keys, frame data URLs, full user content, or sensitive model payloads.

For every confirmed bug, create a reproduction description, capture the failing invariant in a test when feasible, then make the smallest correct fix.

## 8. TEST STRATEGY

Use test-driven development. Start with a failing test for each confirmed bug.

Add focused coverage for:

### Unit tests

- stage derivation across different energy shapes without forced five-act output
- representative-frame selection and deterministic fallback
- story-stage/frame serialization
- palette preservation through retry artifacts
- blueprint validation and explicit unavailable reasons
- measured data winning over invalid model data
- cut/edit/pacing/footage derivation
- active score and confidence thresholds
- route-key changes for pathname, search, and hash
- cross-frame video ordering

### Component tests

- Story empty, partial, complete, missing-frame, and history states
- Contact sheet keyboard behavior and copy actions
- Editor Toolkit partial and complete states
- Camera/equipment sections with required/recommended/optional items
- multiple-video selection and “likely current” indication
- interruption and retry states
- 320–420 px overflow-sensitive layouts

### Integration tests

- video inserted, removed, and replaced
- currentSrc/source change
- query-only SPA navigation
- multiple iframes reporting videos
- selected video disappears during analysis
- initial success → blueprint retry with preserved palette and stages
- history save/load with stage frames
- local-only result remains useful

If browser E2E infrastructure does not exist, do not hide that limitation. Add the highest-value unit/integration seams now and propose a separate E2E phase with concrete fixtures.

## 9. PERFORMANCE AND STORAGE BUDGETS

- Avoid full-page polling loops.
- Debounce mutation/navigation announcements.
- Do not repeatedly decode the same reference frames.
- Keep large image data out of service-worker memory and normal JSON records.
- Lazy-load board images.
- Define cleanup/retention behavior for frame blobs and history deletion.
- Avoid one model call per stage; prefer one structured blueprint request unless evidence shows it exceeds safe response limits.
- Keep the side panel interactive while analysis progresses.
- Report any measurable regression in bundle size, analysis duration, storage use, or model payload size.

## 10. IMPLEMENTATION PHASES

After the audit is approved, propose and execute small reviewable phases:

### Phase 1 — Reliability and data integrity

- reproduce and fix confirmed P0/P1 video identity, SPA, ordering, reload, retry, palette, stage-frame, and unavailable-state bugs
- add regression tests

### Phase 2 — Story Board foundation

- persist stage-frame identity/data
- harden story-stage data contracts
- deliver Story flow and contact-sheet UX
- add seek, copy, history, partial, and missing-frame behavior

### Phase 3 — Professional Editor Workspace

- connect and harden P0 toolkit sections
- improve time navigation, footage requirements, transition recipes, speed-ramp guidance, color, typography, sound opportunities, priorities, and mistakes

### Phase 4 — Camera/equipment reliability

- close schema/prompt/validation/rendering gaps
- add explicit unavailable reasons and tests

### Phase 5 — UX hardening and QA

- state matrix
- accessibility
- narrow widths
- visual/regression checks
- production-safe debug behavior

At the end of every approved phase:

1. summarize changes by user outcome
2. list changed files
3. show tests added
4. run lint, typecheck, tests, and production build
5. report exact command results
6. identify remaining partial/missing features
7. stop for review before starting an unapproved phase

## 11. DEFINITION OF DONE

The approved scope is complete only when:

- a detected or uploaded video produces a coherent time-based Story Board/Moodboard when evidence permits
- every stage uses a persisted intended reference frame or an honest fallback
- stages reflect actual measured structure instead of a forced template
- an editor can move from overview to stage to exact source time
- the Editor Toolkit gives reference-specific, actionable instructions
- measured, observed, inferred, and suggested information is not misleadingly mixed
- camera/equipment guidance is specific and justified
- partial and unavailable sections state why they are incomplete
- video replacement/navigation cannot silently corrupt the selected analysis
- retry and history preserve all required local artifacts
- all new behavior has proportional regression coverage
- accessibility and narrow side-panel layouts are verified
- lint, typecheck, tests, and production build pass
- remaining P1/P2 ideas are documented, not presented as already built

## FINAL INSTRUCTION

Begin with **PHASE 0 only**.

Do not modify any files.

Inspect the current repository deeply, verify or reject every known hypothesis, run baseline checks, and return the requested evidence-backed audit. Then stop and wait for approval.
