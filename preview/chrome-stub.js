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
    // `...extra` is applied first so its own `evidence` key cannot clobber the
    // merged one — spreading it last silently replaced the whole object.
    const event = (id, startTime, type, category, title, description, confidence, certainty, extra = {}) => ({
      id, startTime, type, category, title, description, confidence, certainty,
      ...extra,
      evidence: {
        visualChangeScore: 0.42,
        histogramDistance: 0.38,
        sampleIntervalSec: 0.33,
        beforeFrameId: `analysis-1:${id}-before`,
        duringFrameId: `analysis-1:${id}-during`,
        afterFrameId: `analysis-1:${id}-after`,
        ...(extra.evidence || {}),
      },
    });

    const events = [
      event('e1', 1.24, 'zoom_in', 'camera', 'Zoom In', 'The frame pushes in on the subject over roughly half a second, with no cut.', 0.81, 'detected',
        { endTime: 1.78, direction: 'outward', effects: ['Scale increase'], evidence: { motionMagnitude: 0.041, dominantDirection: 'outward' } }),
      event('e2', 2.4, 'hard_cut', 'cut', 'Hard Cut', 'A straight cut into a wider shot of the same location.', 0.93, 'detected'),
      event('e3', 4.32, 'whip_pan', 'transition', 'Whip Pan Transition', 'Rapid horizontal movement with directional blur, cutting near peak movement into a shot that continues the same direction.', 0.86, 'detected',
        { endTime: 4.68, direction: 'right', effects: ['Motion blur', 'Scale increase'], evidence: { motionMagnitude: 0.072, dominantDirection: 'right' } }),
      event('e4', 6.05, 'text_appears', 'text', 'Text Appears', 'A short type card lands hard on the cut, with no easing on entry.', 0.74, 'detected', { effects: ['Hard cut-in'] }),
      event('e5', 7.8, 'hard_cut', 'cut', 'Hard Cut', 'Cut to a detail shot.', 0.9, 'detected'),
      event('e6', 9.15, 'flash', 'effect', 'Likely flash frame', 'A single bright frame between two shots, used as a transition beat.', 0.58, 'likely',
        { effects: ['Exposure spike'], evidence: { luminanceChange: 0.31 } }),
      event('e7', 11.4, 'camera_pan', 'camera', 'Camera Pan', 'A steady lateral move across the scene, held for about a second.', 0.79, 'detected',
        { endTime: 12.5, direction: 'left', evidence: { motionMagnitude: 0.033, dominantDirection: 'left' } }),
      event('e8', 13.2, 'zoom_out', 'camera', 'Likely zoom out', 'The frame appears to pull back, though the movement is slight.', 0.52, 'likely',
        { direction: 'inward', evidence: { motionMagnitude: 0.019, dominantDirection: 'inward' } }),
      event('e9', 15.6, 'crossfade', 'transition', 'Crossfade', 'A brief dissolve between two static shots.', 0.71, 'detected', { endTime: 16.1 }),
      event('e10', 18.9, 'hard_cut', 'cut', 'Hard Cut', 'Cut back to the opening framing.', 0.91, 'detected'),
      event('e11', 21.3, 'text_animation', 'text', 'Text Animation', 'Type scales up and settles, timed to the cut before it.', 0.68, 'detected', { effects: ['Scale', 'Ease out'] }),
      event('e12', 24.7, 'speed_ramp', 'speed', 'Likely speed ramp', 'Motion appears to accelerate into the final shot.', 0.49, 'likely'),
    ];

    const meter = (value, label) => ({ value, label });
    return {
      video: { duration: 28.4, width: 1080, height: 1920, fps: 29.97 },
      overview: {
        summary: 'Fast-paced fashion edit built on hard cuts every one to two seconds, with whip-pan transitions carrying motion across cuts and kinetic type landing on the beat.',
        pacing: 'fast', sceneChanges: 4, transitions: 2, textAnimations: 2, cameraMovements: 3, effects: 1,
      },
      editingDNA: {
        pacing: meter(0.68, 'Fast'), cuts: meter(0.52, 'Frequent'), motion: meter(0.74, 'High'),
        text: meter(0.35, 'Moderate'), transitions: meter(0.48, 'Moderate'), effects: meter(0.28, 'Low'),
      },
      events,
      stats: { coarseFrames: 85, fineFrames: 96, candidates: 12, framesSentToModel: 30 },
    };
  }

  function history() {
    return [
      { id: 'analysis-1', sourceType: 'page', title: 'Instagram Reel', url: 'https://instagram.com/reel/x', analyzedAt: Date.now() - 3600000, duration: 28.4, eventCount: 12, analysis: analysis() },
      { id: 'analysis-2', sourceType: 'upload', title: 'campaign-cut-v3.mp4', analyzedAt: Date.now() - 86400000 * 2, duration: 61.2, eventCount: 21, analysis: analysis() },
    ];
  }

  const STATE = {
    session: { id: 's1', videoId: 'f1-v1', sourceKind: 'page', label: 'Instagram Reel', startedAt: Date.now(), status: 'completed', completedStages: [] },
    analysis: analysis(),
    source: null,
    error: null,
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
              case 'panel:get-state':
                reply({ for: 'panel:get-state', state: scenario === 'result' ? STATE : { session: null, analysis: null, source: null, error: null } });
                break;
              case 'panel:detect-videos':
                if (scenario === 'permission') {
                  fail({ code: 'PAGE_PERMISSION', message: 'Motion Inspector needs permission for this tab.', retryable: true });
                  break;
                }
                reply({ for: 'panel:detect-videos', report: scenario === 'empty' ? { ...REPORT, videos: [] } : REPORT });
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
                reply({ for: 'panel:recreate', guide: { platform: request.platform, steps: [
                  'Place the outgoing and incoming clips on adjacent layers.',
                  'Over the final third of the outgoing shot, animate Position rapidly from left to right.',
                  'Enable motion blur on both layers so the movement smears rather than strobes.',
                  'Add a slight scale increase across the same range.',
                  'Cut at the frame of maximum movement, not before it.',
                  'Start the incoming clip already moving in the same direction, then ease it down.',
                ], caveat: 'The exact easing could not be measured from the sampled frames — match it by eye.' } });
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
          const frames = [];
          for (let index = 1; index <= 12; index += 1) {
            frames.push(
              { id: `analysis-1:e${index}-before`, candidateId: `e${index}`, role: 'before', time: 4.0, dataUrl: swatch(200) },
              { id: `analysis-1:e${index}-during`, candidateId: `e${index}`, role: 'during', time: 4.32, dataUrl: swatch(40) },
              { id: `analysis-1:e${index}-after`, candidateId: `e${index}`, role: 'after', time: 4.68, dataUrl: swatch(120) },
            );
          }
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
