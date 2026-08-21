# Motion Inspector

**Understand how any video moves.**

A Chrome side-panel extension that inspects a video you are watching — or one you upload — and
explains how it was edited: where the cuts are, what the transitions do, how the camera moves, and
how to recreate any of it in your own tool.

It is DevTools for video motion, not a chatbot. The whole product is one workflow:

```
video → motion analysis → timeline → event → timestamp → explanation → recreate
```

---

## Contents

- [How it works](#how-it-works)
- [The analysis pipeline](#the-analysis-pipeline)
- [Execution contexts, and why each exists](#execution-contexts-and-why-each-exists)
- [What it can and cannot read](#what-it-can-and-cannot-read)
- [Security model](#security-model)
- [Privacy](#privacy)
- [Quick start](#quick-start)
- [Project layout](#project-layout)
- [Design decisions](#design-decisions)
- [Permissions, and why each one exists](#permissions-and-why-each-one-exists)
- [Testing](#testing)
- [Known limitations](#known-limitations)

---

## How it works

1. Open the side panel on a page with a video. Motion Inspector lists what it can see, and probes
   each one to find out whether its pixels are actually readable.
2. Press **Analyse**. Frames are sampled locally and differenced to find the moments where something
   changed. Only those moments — a couple of dozen frames — are sent to OpenAI for interpretation.
3. You get a timeline. Click an event and the video jumps to that exact timestamp; the before /
   during / after frames show you why it was flagged.
4. Press **Recreate** and pick a tool. The instructions are built from the measured characteristics
   of *that* moment, not from a generic description of the technique.

---

## The analysis pipeline

The central engineering claim: **the model is never used to find anything.** It is used to name what
local measurement already found. A thirty-second video is roughly a thousand frames; this sends
about thirty, and none of them chosen at random.

```
video
  ↓  metadata                    duration, dimensions; fps only when measurable
  ↓  frame-access probe          available | restricted   (restricted → offer upload)
  ↓  coarse sampling             ~3 fps, downscaled to 64×36 grayscale
  ↓  local measurement           pixel difference · 32-bin histogram χ² · luminance ·
  ↓                              4-quadrant block motion (direction + divergence)
  ↓  candidate detection         adaptive threshold, non-maximum suppression
  ↓  fine sampling               ~12 fps around each candidate → sub-frame timestamps
  ↓  evidence selection          before / during / after, tiered against a hard frame budget
  ↓  AI interpretation           ONE call, strict json_schema, one repair turn
  ↓  validation + normalisation  clamped, canonicalised, anchored to measurements
  ↓  motion timeline
```

Two rules run through the whole thing:

**Timestamps come from measurement, never from the model.** The schema in
[`src/services/motion-schema.ts`](src/services/motion-schema.ts) does not contain a time field. The
model is asked which *candidate* an observation belongs to; the normalizer supplies the time.

**Confidence cannot exceed the evidence.** A candidate that barely cleared the detection threshold
caps how sure the product is willing to sound about it, and anything below the bar is labelled
*Likely* rather than stated. See [`src/analysis/normalizer.ts`](src/analysis/normalizer.ts).

Editing DNA is derived from the event list by documented formulas
([`src/analysis/editing-dna.ts`](src/analysis/editing-dna.ts)) — never asked for. A model asked to
rate "pacing" out of ten will answer, and the answer will mean nothing.

---

## Execution contexts, and why each exists

MV3 forces the split. Each context is here because it can do something none of the others can.

| Context | Owns | Why it has to |
| --- | --- | --- |
| **Content script** | detection, stable ids, seeking, time sync, page-video capture | the only context that can touch a page's `<video>` |
| **Offscreen document** | uploaded-file decoding, sampling, thumbnails | a service worker has no video decoder, and this outlives the panel |
| **Web Worker** | block-matching and histogram math | keeps the search off the offscreen document's thread |
| **Service worker** | session lifecycle, cancellation, the OpenAI call, storage | the only context all others can reach, and the only one allowed near the key |
| **Side panel** | UI | it is destroyed when the user closes it, so it may not own work |

An analysis survives the panel being closed. It does not survive the tab being closed, and says so.

---

## What it can and cannot read

Three separate capabilities, deliberately kept separate in the code and in the UI:

```
1. detection   — we found a <video>
2. control     — we may set currentTime and read timeupdate
3. pixel access — we may draw it to a canvas and read the pixels back
```

A site can permit the first two and forbid the third. `frameAccess` therefore starts at `unknown`
and only ever changes because of a real runtime probe
([`src/content/frame-access.ts`](src/content/frame-access.ts)) — never because of a hostname.

| Source | Detect | Seek | Read frames |
| --- | :--: | :--: | :--: |
| Uploaded MP4 / WebM / MOV | — | ✅ | ✅ |
| Generic HTML5 video (same-origin or CORS) | ✅ | ✅ | ✅ |
| YouTube, Instagram, TikTok, Vimeo, X | ✅ | ✅ | probe |
| Blob / MSE video | ✅ | ✅ | probe, and capture scrubs the live element |
| DRM / EME protected | ✅ | ⚠️ | ❌ |

Frames are unreadable for two very different reasons — a canvas tainted by cross-origin media, and
encrypted media — and the product only names DRM when the element actually reports media keys.
**No attempt is made to bypass DRM, EME, protected streams, or any browser security boundary.** When
frames are unavailable, the answer is to offer manual upload.

Uploaded video is the best case by a wide margin: extension-origin object URL, untainted canvas,
accurate seeking, measurable frame rate, and nobody's playback disturbed.

---

## Security model

The user's OpenAI key is never reachable from a page.

1. [`src/storage/credentials.ts`](src/storage/credentials.ts) is never imported by the content
   bundle, directly or transitively.
2. The key lives under its own `chrome.storage.local` key, outside `Settings`, so no settings read
   can surface it — and `normalizeSettings` rebuilds a whitelist on every read and write, so an
   injected field cannot survive a round-trip. A test asserts this.
3. It never crosses a message or a port.
4. **[`scripts/build-manifest.mjs`](scripts/build-manifest.mjs) greps the built `dist/content.js`
   for the credential storage key, the OpenAI endpoint and `Bearer `, and fails the build on a hit.**
   `chrome.storage.local` is readable by this extension's own content scripts, so the storage area is
   not the protection — this check is.

There is no application-owned key, no hardcoded key, and no backend.

---

## Privacy

- A video is analysed **only** after you press Analyse. Opening the panel, detecting videos and
  hovering never send anything.
- Analysis sends **sampled frames** — roughly two dozen small JPEGs — to OpenAI using your own key,
  with `store: false`. The video file itself is never uploaded.
- The panel says exactly that. It does not claim your video "stays local", because the frames do not.
- History is local, capped, and created only by an analysis you ran. No browsing activity is
  recorded and no page is scanned unless you asked for a detection.
- Your API key is stored on this device only, never synced, and never logged — only a `sk-…wxyz`
  mask ever is.
- Evidence frames live in IndexedDB with LRU eviction; deleting a history entry deletes its frames.

---

## Quick start

```bash
npm install
npm run build
```

Then load `dist/` at `chrome://extensions` → Developer mode → **Load unpacked**. Click the toolbar
icon to open the panel, and add your OpenAI key in **Settings**.

```bash
npm run verify      # lint + typecheck + tests
npm run dev         # watch build
```

---

## Project layout

```
motion-inspector/
├── sidepanel.html · offscreen.html
├── scripts/
│   ├── defines.mjs             # compile-time constants (no secrets, by design)
│   ├── manifest.config.mjs     # manifest generated per build, every permission justified
│   ├── build-manifest.mjs      # + the credential leak guard
│   └── generate-icons.mjs      # PNGs rendered from geometry — no binary assets in git
└── src/
    ├── analysis/               # config · metrics · candidates · editing-dna · normalizer
    ├── background/             # service-worker · orchestrator · session-registry ·
    │                           #   samplers · offscreen-host · tab-videos
    ├── content/                # index · video-registry · frame-access · capture
    ├── offscreen/              # main · video-source · diff.worker
    ├── services/               # motion-schema · prompts · validate-motion ·
    │                           #   permissions · transport/
    ├── sidepanel/              # SidePanel · AnalyzeScreen · HistoryScreen · SettingsPanel
    │   └── motion/             # VideoCard · UploadDrop · Overview · EventList ·
    │                           #   EventDetail · RecreatePanel · timeline/
    ├── storage/                # settings (sync) · credentials (local) · history · frame-store
    ├── types/                  # motion · video · analysis · messages · domain
    └── utils/                  # errors · time · schedule · port-rpc · id · logger
```

---

## Design decisions

**Analysis at 64×36.** Not a compromise — the point. Scene boundaries and camera translation are
low-frequency signals; downscaling removes the grain and compression noise that would otherwise
dominate a pixel difference, and makes each frame cost a few thousand operations instead of millions.

**Adaptive thresholds, not constants.** A locked-off interview and a hand-held street edit produce
difference series an order of magnitude apart. A fixed threshold that works for one invents events in
the other, so the threshold is the median of *this* video's series plus k median-absolute-deviations.

**Ports, not one-shot messages.** Traffic on an open port resets MV3's idle timer, which is what stops
the service worker being suspended in the middle of a multi-minute analysis.

**Full-state pushes, not deltas.** The panel receives a session snapshot rather than a set of
narrow events. An earlier delta design had no event for "the analysis was cleared", so the panel kept
rendering a timeline the worker had already forgotten.

**No categorical colour.** Nine event categories rendered as nine hues would be a parrot at 320px and
the timeline would stop reading as an instrument. One accent, reserved for the active event, the
playhead and focus.

**Tailwind v3, not v4.** Carried over from the sibling project, whose config documents why.

---

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `storage` | settings (sync), analysis history, and your own key (local, never synced) |
| `sidePanel` | the product's only surface |
| `scripting` | injects the detection script into the tab you are looking at, when you ask |
| `activeTab` | grants access from the toolbar click, so the common case needs no broad host permission. The worker handles `action.onClicked` itself rather than using `openPanelOnActionClick`, because letting Chrome consume the click means the grant never arrives |
| `offscreen` | a service worker cannot decode video; uploads are decoded in an offscreen document |

There are **no host permissions at install time.** `https://api.openai.com/*` is requested when you
connect a key. A site origin is requested only if you want detection to keep working there after the
`activeTab` grant lapses. There is no static content script: nothing is injected into any page until
you ask for it.

---

## Testing

```bash
npm run verify
```

84 unit tests over the parts where correctness is checkable without a browser: frame measurement,
candidate detection, refinement, normalisation, Editing DNA derivation, model-output validation,
timeline label layout, timecode formatting, and the settings whitelist.

Two of them exist because they caught real bugs during development — a block matcher that answered
with a confident motion vector for a region carrying no motion information, and a timeline label
layout that silently overlapped at narrow widths.

---

## Known limitations

- **Analysing a page video scrubs it.** For Media Source video the bytes exist nowhere reachable
  except the live element, so sampling moves the playhead you are watching. State is restored
  afterwards, including on cancellation, and the panel warns first.
- **Frame access is unpredictable per site**, and deliberately so — it is probed, not assumed. When a
  probe says no, upload is the path.
- **Frame rate is often unknowable.** Container metadata is not exposed to the browser. It is measured
  for uploads via `requestVideoFrameCallback` and left absent otherwise, rather than guessed.
- **An analysis does not survive its tab closing**, only the panel closing.
- **Site access is per tab.** Switching tabs with the panel open lands on a tab with no
  `activeTab` grant; the panel says so and one click on the toolbar icon fixes it. That is the cost
  of shipping with no host permissions at install.
- **The evidence budget is capped** at 36 frames per request. When more candidates survive than fit,
  the drop is logged rather than silently swallowed.
