/**
 * Preview harness only — never bundled, never shipped.
 *
 * Stubs the Chrome extension APIs so the *real production side-panel bundle*
 * can be rendered and inspected in an ordinary page. It answers the panel's
 * port RPC with a realistic completed analysis, which is the only way to look
 * at the timeline, the label collision behaviour and the event cards at a
 * genuine 320-420px without loading the extension.
 */
(function () {
  const KEY = 'sk-' + 'p'.repeat(44) + 'demo';

  const local = { 'mi:credentials': { key: KEY, savedAt: Date.now(), verifiedAt: Date.now() }, 'mi:history': history() };
  const sync = { 'mi:settings': { saveHistory: true, warnBeforeScrub: true, samplingRate: 'balanced', theme: 'dark' } };
  const session = {};

  const area = (store) => ({
    get: (keys) => {
      if (keys == null) return Promise.resolve({ ...store });
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of list) if (key in store) out[key] = store[key];
      return Promise.resolve(out);
    },
    set: (items) => {
      Object.assign(store, items);
      return Promise.resolve();
    },
    remove: (key) => {
      delete store[key];
      return Promise.resolve();
    },
  });

  function analysis() {
    const ev = (id, startTime, peakTime, endTime, type, category, title, description, confidence, certainty, extra = {}) => ({
      id, startTime, peakTime, endTime, type, category, title, description, confidence, certainty,
      role: 'primary',
      ...extra,
      evidence: {
        visualChangeScore: 0.52, histogramDistance: 0.47, colorChange: 0.12,
        motionMagnitude: 0.072, peakVelocity: 0.61, motionContinues: true,
        detailLoss: 0.28, sampleIntervalSec: 0.042,
        frameIds: [0, 1, 2, 3, 4].map((n) => `analysis-1:${id}-${n}`),
        ...(extra.evidence || {}),
      },
    });

    const events = [
      ev('e1', 1.18, 1.24, 1.78, 'push_in', 'camera', 'Push In', 'The frame pushes in on the subject across roughly half a second, with no cut.', 0.81, 'detected', {
        direction: 'outward', effects: ['Scale increase'],
        motion: { direction: 'outward', magnitude: 'moderate', speed: 'slow', acceleration: 'building', scaleChange: 'closer' },
        camera: { movement: 'Slow push toward the subject', intensity: 'subtle', ambiguity: 'An optical zoom, a digital scale and a physical push look identical in frames — this cannot be told apart from pixels alone.' },
        observation: { before: 'A medium shot, framing stable.', build: 'The subject grows steadily in frame while the background compresses only slightly.', peak: 'Largest framing, movement still carrying.', after: 'Movement eases without settling fully before the cut.' },
        whyDetected: 'Quadrant motion vectors point outward from the frame centre across seven consecutive samples, with almost no shared translation.',
        whyItWorks: 'A slow push adds pressure without announcing itself — the viewer reads rising intensity without noticing the camera.',
        recreationHint: 'Scale up by a few percent over the whole shot, easing in rather than starting at speed.',
      }),
      ev('e2', 2.4, 2.4, undefined, 'hard_cut', 'cut', 'Hard Cut', 'A straight cut into a wider shot of the same location.', 0.93, 'detected', {
        evidence: { motionMagnitude: 0.004, detailLoss: undefined, motionContinues: false },
        observation: { before: 'Tight framing, static.', peak: 'Complete frame replacement in a single sample interval.', after: 'Wider framing, also static.' },
        whyDetected: 'Pixel difference 0.62 and tonal shift 0.58 in one interval, with no motion in either neighbouring frame.',
      }),
      ev('e3', 4.12, 4.34, 4.61, 'whip_pan', 'transition', 'Whip Pan Transition', 'Rapid rightward movement smears the outgoing shot and hides a cut near maximum motion.', 0.86, 'detected', {
        direction: 'right', effects: ['Motion blur', 'Scale increase'],
        containsIds: ['e3::pan', 'e3::blur'],
        motion: { direction: 'right', magnitude: 'extreme', speed: 'very rapid', acceleration: 'building' },
        camera: { movement: 'Hard lateral whip', intensity: 'strong' },
        transition: {
          technique: 'Direction-matched whip',
          outgoingBehavior: 'The outgoing close-up accelerates rightward through the last third of the shot until fine detail is gone.',
          transitionMoment: 'At the join the frame carries almost no stable detail — only directional streaks.',
          incomingBehavior: 'The incoming wide begins already moving rightward at a similar rate, then decelerates over about a quarter of a second.',
        },
        observation: {
          before: 'The subject sits stable in frame; lateral movement has only just begun.',
          build: 'Horizontal displacement climbs sharply and fine detail starts disappearing into smear.',
          peak: 'Maximum displacement around the join, with the frame reduced to directional streaks.',
          after: 'The incoming shot continues rightward, so the eye reads one continuous movement rather than two shots.',
        },
        timing: { start: 4.12, build: 4.22, peak: 4.30, boundary: 4.34, settle: 4.50, end: 4.61 },
        continuity: {
          measured: 'direction-matched',
          interpreted: 'subject-matched',
          note: 'The incoming shot picks up the same rightward movement, and the same figure carries across the join.',
        },
        explanations: {
          short: 'Rapid rightward movement smears the outgoing shot and hides a cut near maximum motion.',
          detailed: 'Rightward displacement increases sharply from about 4.12s onward. Fine detail becomes progressively smeared as velocity climbs, and the shot changes close to maximum movement. The incoming wide begins already moving rightward at a similar rate, then decelerates over roughly a quarter of a second.',
          technical: 'Build horizontal velocity into the cut, maximise blur near the boundary, then begin the incoming shot with matching directional movement before easing it down.',
        },
        observations: {
          horizontalMotion: 'strong', direction: 'left-to-right', blurProgression: 'increasing',
          sceneIdentityChanges: true, incomingMotion: 'continues',
        },
        claimChecks: [
          { field: 'direction', claimed: 'left-to-right', measured: 'right', verdict: 'agrees' },
          { field: 'horizontalMotion', claimed: 'strong', measured: '7.2% of frame width (saturated)', verdict: 'agrees' },
          { field: 'blurProgression', claimed: 'increasing', measured: 'detail down 28%', verdict: 'agrees' },
          { field: 'incomingMotion', claimed: 'continues', measured: 'movement continues after the change', verdict: 'agrees' },
        ],
        whyDetected: 'Displacement runs beyond what the estimator can measure across five consecutive samples, edge density falls 28% over the same window, and movement after the join continues at a similar rate.',
        whyItWorks: 'The cut lands where the image holds the least stable detail, so there are few reference points for noticing it. Carrying the same direction into the next shot lets the eye stitch the two together.',
        recreationHint: 'Accelerate hard in one direction, cut at peak movement, and start the next shot already moving the same way.',
      }),
      ev('e4', 6.05, 6.05, 6.31, 'text_appears', 'text', 'Text Appears', 'A short type card lands hard on the cut with no easing on entry.', 0.74, 'detected', {
        effects: ['Hard cut-in'],
        typography: { textDetected: true, content: 'SUMMER 2026', animationType: 'Scale and opacity', entrance: 'Scales from about 85% to 100% while fading up over roughly 250ms', exit: 'Fast opacity fade' },
        observation: { before: 'Clean frame, no overlay.', peak: 'Type at full size and opacity.', after: 'Type holds for about a second.' },
        whyDetected: 'A localised structural change with no accompanying camera motion and no tonal shift in the surrounding frame.',
      }),
      ev('e5', 9.15, 9.15, undefined, 'flash', 'effect', 'Likely flash frame', 'A single bright frame between two shots, used as a transition beat.', 0.58, 'likely', {
        evidence: { luminanceChange: 0.41, motionMagnitude: 0.008 },
        observation: { peak: 'One frame at markedly higher exposure than either neighbour.' },
        whyDetected: 'Brightness rises 41% for a single sample while the tonal distribution stays comparatively intact.',
      }),
      ev('e6', 11.4, 11.6, 12.5, 'camera_pan', 'camera', 'Camera Pan', 'A steady lateral move across the scene, held for about a second.', 0.79, 'detected', {
        direction: 'left', motion: { direction: 'left', magnitude: 'moderate', speed: 'steady', acceleration: 'steady' },
      }),
      ev('e7', 13.2, 13.3, undefined, 'pull_out', 'camera', 'Possible pull out', 'The frame appears to pull back, though the movement is slight.', 0.42, 'possible', {
        direction: 'inward', evidence: { motionMagnitude: 0.014, detailLoss: undefined },
      }),
      ev('e8', 15.6, 15.8, 16.1, 'crossfade', 'transition', 'Crossfade', 'A brief dissolve between two static shots.', 0.71, 'detected', {}),
      ev('e9', 18.9, 18.9, undefined, 'hard_cut', 'cut', 'Hard Cut', 'Cut back to the opening framing.', 0.91, 'detected', {}),
      ev('e10', 21.3, 21.45, 21.9, 'text_animation', 'text', 'Text Animation', 'Type scales up and settles, timed to the cut before it.', 0.68, 'detected', {
        effects: ['Scale', 'Ease out'],
        typography: { textDetected: true, content: 'OUT NOW', animationType: 'Scale with overshoot', entrance: 'Overshoots slightly then settles over roughly 300ms' },
      }),
      ev('e11', 24.7, 24.8, 25.2, 'speed_ramp', 'speed', 'Possible speed ramp', 'Motion appears to accelerate into the final shot before settling.', 0.44, 'possible', {
        timing: { start: 24.7, peak: 24.86, boundary: 24.8, end: 25.2 },
        recreationHint: 'Ramp from 100% to roughly 40% across the last third of the outgoing shot, easing out rather than cutting the speed.',
        evidence: {
          motionCurve: [
            { time: 24.70, velocity: 0.12 }, { time: 24.74, velocity: 0.28 }, { time: 24.78, velocity: 0.55 },
            { time: 24.82, velocity: 0.81 }, { time: 24.86, velocity: 0.94 }, { time: 24.90, velocity: 0.72 },
            { time: 24.96, velocity: 0.41 }, { time: 25.04, velocity: 0.22 }, { time: 25.14, velocity: 0.09 },
          ],
        },
      }),
      // Secondary parts of the whip pan, reached from its detail view only.
      { id: 'e3::pan', startTime: 4.16, type: 'camera_pan', category: 'camera', title: 'Camera Pan', description: 'Sustained movement across the frame. Measured direction: right.', confidence: 0.48, certainty: 'detected', role: 'secondary', direction: 'right', evidence: { visualChangeScore: 0.3, sampleIntervalSec: 0.042 } },
      { id: 'e3::blur', startTime: 4.38, type: 'motion_blur', category: 'effect', title: 'Motion Blur', description: 'Fine detail collapses across the frame.', confidence: 0.44, certainty: 'detected', role: 'secondary', evidence: { detailLoss: 0.28, sampleIntervalSec: 0.042 } },
    ];

    const meter = (value, label, why) => ({ value, label, why });
    const scenes = [
      [0, 2.4], [2.4, 4.12], [4.12, 6.05], [6.05, 7.8], [7.8, 9.15], [9.15, 11.4],
      [11.4, 15.6], [15.6, 18.9], [18.9, 21.3], [21.3, 24.7], [24.7, 28.4],
    ].map(([startTime, endTime], index) => ({
      id: `s${index + 1}`, index: index + 1, startTime, endTime,
      duration: Number((endTime - startTime).toFixed(3)),
      motionLevel: index % 3 === 0 ? 0.045 : 0.008,
      meanLuma: 0.52, sampleCount: 8,
      ...(index % 3 === 0 ? { dominantDirection: 'right' } : {}),
    }));

    return {
      id: 'analysis-1',
      video: { duration: 28.4, width: 1080, height: 1920, fps: 29.97 },
      overview: {
        summary: 'An eighteen-shot vertical edit averaging 1.6s per shot. The first third runs on straight cuts; from six to twelve seconds the cutting tightens and joins start carrying movement across the boundary. Rightward camera movement recurs and is repeatedly preserved through cuts, giving directional continuity even as locations change. Typography is sparse but fast, entering in roughly 250 to 300 milliseconds.',
        pacing: 'fast', sceneChanges: 4, transitions: 3, textAnimations: 2, cameraMovements: 3, effects: 1,
      },
      editingDNA: {
        pacing: meter(0.68, 'Fast', '11 shots across 28.4s — about 21 cuts per minute.'),
        cuts: meter(0.52, 'Frequent', '4 hard cuts detected in 28.4s.'),
        motion: meter(0.74, 'High', 'Movement measured in 4 of 11 shots.'),
        text: meter(0.35, 'Moderate', '2 typography events.'),
        transitions: meter(0.48, 'Moderate', '3 joins used something other than a straight cut.'),
        effects: meter(0.28, 'Low', '1 effect event.'),
      },
      events,
      scenes,
      rhythm: {
        shotCount: 11, averageShot: 2.58, medianShot: 1.93, shortestShot: 1.35, longestShot: 4.2,
        cutsPerMinute: 21.1, density: 'moderate', fastestSectionStart: 6.05, fastestSectionEnd: 11.4,
      },
      motionProfile: {
        dominantDirection: 'right', dominantDirectionCount: 4, cameraMotionShare: 0.36,
        translationEvents: 5, zoomEvents: 2, blurEvents: 3, rapidMotionEvents: 1,
      },
      rhythmNote: '11 shots, averaging 2.58s (shortest 1.35s, longest 4.20s). The cutting is densest between 00:06 and 00:11. Movement runs left → right across 4 measured moments.',
      version: '2.0',
      energy: [0.35,0.42,0.58,0.71,0.86,0.94,0.88,0.72,0.55,0.41,0.33,0.28].map((value, index) => ({
        startTime: index * 2.37, endTime: (index + 1) * 2.37, value, cuts: value > 0.7 ? 2 : 1,
      })),
      blueprint: {
        creativeIntent: { labels: ['Premium', 'Energetic', 'Editorial'], why: 'Fast camera movement carries the energy while controlled lighting, restrained typography and clean compositions keep it from reading as frantic. The restraint is what makes it premium rather than merely busy.' },
        creativeDirection: [
          'Keep compositions simple and subject-led — the movement is doing the work.',
          'Use movement as the primary transition device rather than graphic effects.',
          'Maintain directional continuity between shots that cut together.',
          'Let the middle third carry the highest energy and give the ending room.',
          'Keep typography minimal and short-lived.',
        ],
        movementLanguage: [
          'Subjects and camera move predominantly left to right.',
          'Camera movement follows the subject rather than leading it.',
          'Scene changes land near the strongest point of movement.',
        ],
        composition: ['Tight close-ups with the subject slightly off-centre.', 'Generous headroom on the wider setups.'],
        camera: {
          priority: 'high',
          capabilities: ['4K capture', 'Reliable continuous autofocus on moving subjects', '50/60fps for selective slow motion', 'Good gimbal compatibility'],
          why: 'Movement appears in 36% of shots and most joins carry motion across them, so subject tracking and stabilisation matter far more than resolution or dynamic range here.',
          suitableTypes: ['Mirrorless hybrid', 'Cinema-oriented mirrorless', 'Modern flagship smartphone'],
          tiers: [
            { tier: 'lean', setup: ['Modern smartphone', 'Compact gimbal', 'Small LED panel'], bestFor: 'social content with a one-person crew' },
            { tier: 'creator', setup: ['Mirrorless body', '24–70mm zoom', 'Gimbal', 'Two compact LEDs'], bestFor: 'campaign work for a brand' },
            { tier: 'professional', setup: ['Cinema body', 'Fast zoom plus a 35mm prime', 'Professional stabiliser', 'Controlled lighting package'], bestFor: 'commercial production with a crew' },
          ],
          frameRates: [
            { rate: '24/25 fps', use: 'Main real-time footage' },
            { rate: '50/60 fps', use: 'Selective slow motion and movement-heavy transitions' },
          ],
          settingsNotes: ['Preserve natural motion blur — a very fast shutter makes whip movements strobe.', 'Protect highlights if practical lights sit in frame.'],
        },
        lenses: {
          character: 'Moderate-wide to normal perspective, with mild compression on the detail shots.',
          ranges: [
            { range: '24–35mm', use: 'Tracking and environmental movement' },
            { range: '50mm', use: 'Controlled close-ups and detail' },
          ],
          caveat: 'Focal lengths are inferred from apparent perspective and cannot be read from the video.',
        },
        stabilization: { items: [
          { tool: 'Gimbal', priority: 'recommended', why: 'Smooth lateral tracking appears in most moving shots.' },
          { tool: 'Handheld', priority: 'optional', why: 'The higher-energy middle section would tolerate more organic movement.' },
          { tool: 'Tripod', priority: 'optional', why: 'Only for the static anchor shots that punctuate the movement.' },
        ] },
        equipment: [
          { name: 'Variable ND filter', category: 'lens', priority: 'recommended', why: 'Lets you hold a wide aperture outdoors while keeping the shutter slow enough to preserve the motion blur the transitions depend on.', alternatives: ['Fixed ND set'] },
          { name: 'Single-axis gimbal or stabiliser', category: 'stabilization', priority: 'recommended', why: 'Tracking movement carries 36% of the shots and reads as controlled rather than handheld.' },
          { name: 'Compact bi-colour LED panel', category: 'lighting', priority: 'recommended', why: 'The reference separates the subject from a dark background with a soft directional key.', alternatives: ['Bounced daylight through diffusion'] },
          { name: 'Fast standard zoom', category: 'lens', priority: 'required', why: 'Shot sizes change constantly between close-ups and wides without an apparent lens change.' },
        ],
        lighting: {
          character: ['Soft directional key', 'Moderate contrast', 'Dark background separation', 'Warm practical accents'],
          setup: ['Large soft source about 45° camera-left', 'Negative fill camera-right to hold the contrast', 'Small edge light behind the subject', 'Warm practicals in the background'],
          caveat: 'A suggested recreation inferred from the image, not the original lighting setup.',
        },
        color: {
          direction: ['Moderate-high contrast', 'Slightly muted saturation', 'Warm highlights', 'Cooler shadows'],
          guidance: ['Avoid crushing shadow detail.', 'Keep warmth in skin and practicals rather than the whole frame.'],
          palette: [
            { hex: '#1c1c1e', weight: 0.34, role: 'primary' },
            { hex: '#6b5a48', weight: 0.21, role: 'secondary' },
            { hex: '#d4a373', weight: 0.14, role: 'accent' },
            { hex: '#8a8a86', weight: 0.11, role: 'neutral' },
          ],
        },
        shootingDirection: [
          'Capture short one-to-two second usable movements rather than long takes.',
          'Ask the subject to enter and exit frame with clear directional movement.',
          'Record several rightward tracking passes of each setup.',
          'Leave extra movement before and after any shot feeding a transition.',
        ],
        shotList: [
          { index: 1, shot: 'Medium tracking shot, subject walking', direction: 'Left → Right', durationTarget: '3–4s usable', use: 'Opening setup' },
          { index: 2, shot: 'Close-up push-in on the subject', direction: null, durationTarget: '2s', use: 'Cut into the higher-energy sequence' },
          { index: 3, shot: 'Fast lateral camera move past foreground', direction: 'Left → Right', durationTarget: '2s with handles', use: 'Whip transition source' },
        ],
        editorToolkit: {
          editMap: [
            { startTime: 0, endTime: 6.05, label: 'Hook', note: '3 shots, averaging 2.02s · 2 cuts.' },
            { startTime: 6.05, endTime: 15.6, label: 'Build', note: '5 shots, averaging 1.91s · 4 cuts.' },
            { startTime: 15.6, endTime: 21.3, label: 'Peak', note: '2 shots, averaging 2.85s · 2 cuts.' },
            { startTime: 21.3, endTime: 28.4, label: 'Resolve', note: '2 shots, averaging 3.55s · 1 cut.' },
          ],
          cutMap: [
            { time: 2.4, type: 'hard_cut', label: 'Hard Cut' },
            { time: 4.12, type: 'whip_pan', label: 'Whip Pan · Left → Right' },
            { time: 7.8, type: 'hard_cut', label: 'Hard Cut' },
            { time: 15.6, type: 'crossfade', label: 'Crossfade' },
            { time: 18.9, type: 'hard_cut', label: 'Hard Cut' },
          ],
          pacing: [
            { section: 'Hook · 00:00–00:06', description: 'Very fast. Shots run about 2.02s against a 2.58s average.' },
            { section: 'Build · 00:06–00:15', description: 'Fast. Shots run about 1.91s against a 2.58s average.' },
            { section: 'Resolve · 00:21–00:28', description: 'Slower. Shots run about 3.55s against a 2.58s average.' },
          ],
          transitionRecipes: [{
            name: 'Direction-matched whip',
            sourceFootage: ['Outgoing shot accelerating rightward past the cut point', 'Incoming shot already moving rightward'],
            cutPoint: 'At maximum displacement, where the frame holds least stable detail.',
            editRequirement: 'Match the velocity and direction across the join so the eye reads one movement.',
            post: 'Directional blur only if the in-camera smear is insufficient.',
          }],
          footageChecklist: [
            'Enough distinct setups to cover every shot in the edit.',
            'Lateral camera passes with movement running past the intended cut, not stopping on it.',
            'Extra movement handles at both ends of any shot feeding a transition.',
            'A static alternative of each key setup, for edit flexibility.',
          ],
          workflow: ['Select the best movement takes.', 'Build shot order before touching timing.', 'Lock the cut rhythm.', 'Align movement direction across transitions.', 'Add blur only once timing feels right.', 'Add typography.', 'Sound design.', 'Grade last.'],
          typographyNotes: ['Keep entrances under about 300ms.', 'Land type on a cut rather than mid-shot.'],
          coloristNotes: ['Moderate-high contrast.', 'Warm highlights, cooler shadows.', 'Keep skin natural.'],
          soundOpportunities: [
            { time: 4.12, event: 'Whip Pan · Transitions', suggestion: 'Directional whoosh following the movement' },
            { time: 7.8, event: 'Hard Cut · Cuts', suggestion: 'Transient hit on the frame of the cut' },
            { time: 21.3, event: 'Text Animation · Text', suggestion: 'Light tick or swell as the type lands' },
          ],
          priorities: ['Maintain movement direction across major cuts.', 'Keep the opening tight.', 'Let the middle carry the highest cut density.'],
          mistakes: ['Equal shot lengths throughout.', 'Changing motion direction without purpose.', 'Adding blur before the timing works.'],
        },
        storyStages: [
          { id: 'stage-1', index: 1, name: 'Hook', startTime: 0, endTime: 6.05, energy: 0.45, shotCount: 3, averageShot: 2.02, dominantEventTypes: ['hard_cut','whip_pan'], referenceTime: 4.12, referenceFrameId: 'analysis-1:stage-0',
            purpose: 'Capture attention before the viewer decides to scroll.', mood: 'Bold and urgent.', composition: 'Tight close-up with the subject slightly off-centre.', camera: 'Rapid push-in and a hard lateral whip.', lighting: 'High contrast with a dark background.', color: 'Near-black with warm skin and amber practicals.', movement: 'Toward camera, then hard right.', typography: null,
            keywords: ['cinematic fashion close-up','dynamic push-in','high contrast editorial portrait'], shotSuggestion: 'Low-angle close-up of the subject moving through a dark urban environment, warm practical lights behind, shallow depth, controlled tracking.' },
          { id: 'stage-2', index: 2, name: 'Build', startTime: 6.05, endTime: 15.6, energy: 0.78, shotCount: 5, averageShot: 1.91, dominantEventTypes: ['hard_cut','camera_pan'], referenceTime: 11.4, referenceFrameId: 'analysis-1:stage-1',
            purpose: 'Establish the environment while raising the pace.', mood: 'Momentum, controlled.', composition: 'Wider framings with foreground occlusion.', camera: 'Handheld tracking with lateral passes.', lighting: 'More practical sources entering frame.', color: 'Warmer skin, stronger ambers.', movement: 'Sustained left-to-right.', typography: 'Short type card lands on the cut.',
            keywords: ['tracking shot foreground occlusion','urban night practical lighting'], shotSuggestion: 'Tracking pass alongside the subject with foreground elements crossing the lens.' },
          { id: 'stage-3', index: 3, name: 'Peak', startTime: 15.6, endTime: 21.3, energy: 0.91, shotCount: 2, averageShot: 2.85, dominantEventTypes: ['crossfade','hard_cut'], referenceTime: 18.2, referenceFrameId: 'analysis-1:stage-2',
            purpose: 'Land the strongest image while attention is highest.', mood: 'Peak intensity.', composition: 'Full-frame subject, minimal negative space.', camera: 'Locked with a fast push.', lighting: 'Hardest key of the piece.', color: 'Deepest saturation.', movement: 'Brief, decisive.', typography: null,
            keywords: ['high contrast hero frame'], shotSuggestion: 'Hero framing held just long enough to register before the release.' },
          { id: 'stage-4', index: 4, name: 'Resolve', startTime: 21.3, endTime: 28.4, energy: 0.31, shotCount: 2, averageShot: 3.55, dominantEventTypes: ['hard_cut'], referenceTime: 24.7,
            purpose: 'Give the eye somewhere to land before the end.', mood: 'Settled.', composition: 'Simpler, more centred framing.', camera: 'Near-static with a slow push.', lighting: 'Softer and cleaner.', color: 'More neutral.', movement: 'Minimal.', typography: null,
            keywords: ['minimal editorial closing frame'], shotSuggestion: 'Static wide holding the subject centred as movement settles.' },
        ],
        moodboardKeywords: ['editorial streetwear campaign','dynamic fashion tracking shot','cinematic urban night lighting','whip pan fashion commercial','warm practical lighting portrait','minimal kinetic typography'],
        referencesToCollect: [
          'Low-angle urban fashion photography with strong architectural lines.',
          'Tight beauty close-ups with directional soft lighting.',
          'Tracking shots with foreground occlusion.',
          'High-contrast night street imagery with warm practical lighting.',
        ],
        topThree: [
          'Carry left-to-right movement through your transition cuts.',
          'Build the fastest pacing in the middle third of the edit.',
          'Use soft directional lighting with dark background separation.',
        ],
        avoid: ['Random transitions between every shot.','Changing motion direction without purpose.','Keeping every shot the same duration.'],
        difficulty: { level: 'moderate', why: 'Requires matched camera movement between two shots but no complex compositing.' },
        complexity: { crew: 'low', lighting: 'moderate', cameraMovement: 'high', post: 'moderate', note: 'The real constraint is matched camera movement — the lighting and post are ordinary.' },
        unavailable: [{ section: 'Audio design', reason: 'KINEMA analyses picture only, so sound is suggested rather than observed.' }],
      },
      coverage: {
        scenes: 'complete', transitions: 'high', cameraMotion: 'complete',
        typography: 'partial', frameAccess: 'complete',
        notes: ['No typography was detected in most shots. Short or infrequent text can fall between sampled frames.'],
      },
      stats: { coarseFrames: 85, mediumFrames: 148, fineFrames: 264, candidates: 13, clusters: 11, framesSentToModel: 63, modelCalls: 5 },
    };
  }

  function history() {
    return [
      { id: 'analysis-1', sourceType: 'page', title: 'Instagram Reel', url: 'https://instagram.com/reel/x', analyzedAt: Date.now() - 3600000, duration: 28.4, eventCount: 12, analysis: analysis() },
      { id: 'analysis-2', sourceType: 'upload', title: 'campaign-cut-v3.mp4', analyzedAt: Date.now() - 86400000 * 2, duration: 61.2, eventCount: 21, analysis: analysis() },
    ];
  }

  function runningSession(sinceProgressMs) {
    const now = Date.now();
    return {
      id: 's-run', videoId: 'f1-v1', sourceKind: 'page', label: 'Instagram Reel',
      startedAt: now - 96_000,
      status: 'ai_analysis',
      detail: 'batch 2 / 4',
      completedStages: ['reading_video', 'coarse_sampling', 'medium_sampling', 'detecting_scenes', 'fine_sampling', 'building_scenes', 'capturing_evidence', 'global_pass'],
      lastProgressAt: now - sinceProgressMs,
      stageStartedAt: now - sinceProgressMs,
      retries: 0,
      resumable: true,
      version: '2.0',
    };
  }

  const STATE = {
    session: { id: 's1', videoId: 'f1-v1', sourceKind: 'page', label: 'Instagram Reel', startedAt: Date.now(), status: 'completed', completedStages: [] },
    analysis: analysis(),
    source: null,
    error: null,
  };

  const MULTI_REPORT = {
    tabId: 1, pageUrl: 'https://www.instagram.com/', siteLabel: 'Instagram', unreachable: false,
    videos: [
      { id: 'f1-v3', index: 2, duration: 28.4, currentTime: 6.2, width: 1080, height: 1920, paused: false, muted: false,
        visible: true, frameAccess: 'available', streaming: true, drmProtected: false, title: 'Instagram Reel',
        siteId: 'instagram', siteLabel: 'Instagram', activeScore: 9.8, likelyActive: true },
      { id: 'f1-v1', index: 0, duration: 134, currentTime: 0, width: 1920, height: 1080, paused: true, muted: true,
        visible: true, frameAccess: 'unknown', streaming: true, drmProtected: false, title: 'Instagram video',
        siteId: 'instagram', siteLabel: 'Instagram', activeScore: 3.1, likelyActive: false },
      { id: 'f1-v2', index: 1, duration: 12, currentTime: 0, width: 640, height: 640, paused: true, muted: true,
        visible: false, frameAccess: 'unknown', streaming: false, drmProtected: true, title: 'Instagram video',
        siteId: 'instagram', siteLabel: 'Instagram', activeScore: 0.9, likelyActive: false },
    ],
  };

  const REPORT = {
    tabId: 1, pageUrl: 'https://www.instagram.com/reel/demo/', siteLabel: 'Instagram', unreachable: false,
    videos: [{
      id: 'f1-v1', index: 0, currentSrc: 'blob:https://www.instagram.com/x', duration: 28.4, currentTime: 6.2,
      width: 1080, height: 1920, paused: false, muted: true, visible: true, frameAccess: 'available',
      streaming: true, drmProtected: false, title: 'Instagram Reel', siteId: 'instagram', siteLabel: 'Instagram',
    }],
  };

  const params = new URLSearchParams(location.search || location.hash.replace(/^#/, ''));
  const scenario = params.get('scenario') || 'result';

  globalThis.chrome = {
    runtime: {
      id: 'preview',
      getURL: (path) => path,
      connect: () => {
        const listeners = [];
        const port = {
          name: 'mi:panel',
          onMessage: { addListener: (fn) => listeners.push(fn) },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: (message) => {
            if (!message || message.kind !== 'req') return;
            const reply = (payload) => setTimeout(() => listeners.forEach((fn) => fn({ __mi: true, id: message.id, kind: 'res', payload })), 40);
            const fail = (error) => setTimeout(() => listeners.forEach((fn) => fn({ __mi: true, id: message.id, kind: 'err', error })), 40);
            const push = (payload) => setTimeout(() => listeners.forEach((fn) => fn({ __mi: true, id: 0, kind: 'evt', payload })), 60);
            const request = message.payload;

            switch (request.type) {
              case 'panel:get-state': {
                const progressScenarios = { working: 2_000, slow: 40_000, stalled: 200_000 };
                if (scenario === 'multi') {
                  reply({ for: 'panel:get-state', state: { session: null, analysis: null, source: null, error: null } });
                  break;
                }
                if (scenario in progressScenarios) {
                  reply({
                    for: 'panel:get-state',
                    state: { session: runningSession(progressScenarios[scenario]), analysis: null, source: null, error: null },
                  });
                  break;
                }
                reply({ for: 'panel:get-state', state: scenario === 'result' ? STATE : { session: null, analysis: null, source: null, error: null } });
                break;
              }
              case 'panel:detect-videos':
                if (scenario === 'permission') {
                  fail({ code: 'PAGE_PERMISSION', message: 'Motion Inspector needs permission for this tab.', retryable: true });
                  break;
                }
                reply({
                  for: 'panel:detect-videos',
                  report: scenario === 'empty' ? { ...REPORT, videos: [] } : scenario === 'multi' ? MULTI_REPORT : REPORT,
                });
                break;
              case 'panel:seek':
                reply({ for: 'panel:seek', outcome: { ok: true, actualTime: request.timestamp } });
                break;
              case 'panel:set-sync':
                reply({ for: 'panel:set-sync' });
                if (scenario === 'result') {
                  let time = 4.1;
                  setInterval(() => {
                    time = (time + 0.25) % 28.4;
                    push({ type: 'event:time', videoId: 'f1-v1', currentTime: time, paused: false });
                  }, 250);
                }
                break;
              case 'panel:recreate':
                reply({ for: 'panel:recreate', guide: {
                  platform: request.platform,
                  technique: 'Direction-matched whip transition',
                  timing: [
                    { label: 'Total observed transition', value: '~490ms' },
                    { label: 'Outgoing movement', value: '~220ms' },
                    { label: 'Cut', value: 'Near peak movement' },
                    { label: 'Incoming settle', value: '~270ms' },
                  ],
                  whyThisMatches: 'The original hides its scene boundary at maximum horizontal motion, where the frame carries almost no stable detail, and continues the same rightward movement in the incoming shot. These steps reproduce both properties rather than the whip alone.',
                  steps: [
                  'Place the outgoing and incoming clips on adjacent layers.',
                  'Over the final third of the outgoing shot, animate Position rapidly from left to right.',
                  'Enable motion blur on both layers so the movement smears rather than strobes.',
                  'Add a slight scale increase across the same range.',
                  'Cut at the frame of maximum movement, not before it.',
                  'Start the incoming clip already moving in the same direction, then ease it down.',
                  ],
                  caveat: 'The exact easing could not be measured from the sampled frames — match it by eye.',
                } });
                break;
              case 'panel:clear-analysis':
                reply({ for: 'panel:clear-analysis' });
                push({ type: 'event:state', state: { session: null, analysis: null, source: null, error: null } });
                break;
              case 'panel:load-history':
                reply({ for: 'panel:load-history', analysis: analysis() });
                push({ type: 'event:state', state: STATE });
                break;
              default:
                reply({ for: request.type });
            }
          },
        };
        return port;
      },
      sendMessage: (message) => {
        if (message?.type === 'mi:read-frames') {
          const swatch = (hue) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="hsl(${hue} 30% 30%)"/></svg>`)}`;
          const roles = ['before', 'build', 'peak', 'settle', 'after'];
          const frames = [];
          for (let index = 1; index <= 12; index += 1) {
            roles.forEach((role, order) => {
              frames.push({
                id: `analysis-1:e${index}-${order}`,
                candidateId: `e${index}`,
                role,
                order,
                time: Number((4.04 + order * 0.15).toFixed(2)),
                dataUrl: swatch(200 - order * 30),
              });
            });
          }
          /*
            Stage reference frames, as the real pipeline now writes them.
            Stage 4 is deliberately absent so the harness also shows the honest
            "no frame" placeholder rather than only the happy path.
          */
          [4.12, 11.4, 18.2].forEach((time, index) => {
            frames.push({
              id: `analysis-1:stage-${index}`,
              candidateId: `stage-${index + 1}`,
              role: 'stage',
              order: index,
              time,
              dataUrl: swatch(20 + index * 60),
            });
          });
          return Promise.resolve({ ok: true, data: frames });
        }
        return Promise.resolve(undefined);
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: area(local),
      sync: area(sync),
      session: area(session),
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
  };
})();
