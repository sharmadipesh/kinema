/**
 * The manifest is generated rather than checked in, so the version cannot drift
 * from package.json.
 *
 * Every permission below carries its justification inline. If a justification
 * cannot be written, the permission does not belong in the manifest.
 */
export function createManifest({ version }) {
  return {
    manifest_version: 3,
    // Keep in step with `APP_NAME` in src/config.ts, which drives every
    // in-panel surface. The manifest cannot import it, so this is the one
    // deliberate duplicate.
    name: 'KINEMA — understand how any video moves',
    version,
    description:
      'Inspect the motion, cuts, transitions and effects in any browser-accessible video, on a timeline you can jump through.',
    // 116: `sidePanel.setPanelBehavior`. 109: `chrome.offscreen`.
    minimum_chrome_version: '116',

    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },

    // No `default_popup`: it and the side panel's `openPanelOnActionClick`
    // behaviour are mutually exclusive — with a popup declared, the click never
    // reaches the panel and the panel would simply never open.
    action: {
      default_title: 'KINEMA',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png' },
    },

    side_panel: { default_path: 'sidepanel.html' },

    background: { service_worker: 'background.js', type: 'module' },

    // NOTE: no static `content_scripts` block. Nothing is injected into any page
    // until the user asks for it — see `background/tab-videos.ts`, which injects
    // on demand under `activeTab` or a granted origin. A statically declared
    // `<all_urls>` content script would run everywhere, forever, to serve a
    // feature the user invokes occasionally.

    permissions: [
      // `storage`   — settings (sync), analysis history and the user's own
      //               OpenAI key (local, never synced).
      'storage',
      // `sidePanel` — the product's only surface.
      'sidePanel',
      // `scripting` — injects the video-detection script into the tab the user
      //               is looking at, at the moment they ask for it.
      'scripting',
      // `activeTab` — grants access to the current tab from the toolbar click,
      //               so the common case needs no broad host permission at all.
      //               NOTE: this only works because the service worker handles
      //               `action.onClicked` itself and calls `sidePanel.open()`.
      //               Letting Chrome open the panel via
      //               `openPanelOnActionClick` consumes the click, and the
      //               grant never arrives.
      'activeTab',
      // `offscreen` — an MV3 service worker cannot decode video (no
      //               HTMLVideoElement). Uploaded files are decoded in an
      //               offscreen document, which also outlives the side panel.
      'offscreen',
    ],

    // Nothing at install time. `https://api.openai.com/*` is requested at
    // runtime when the user connects a key; a site origin is requested only if
    // the user wants Motion Inspector to keep working on that site after the
    // activeTab grant lapses.
    optional_host_permissions: ['*://*/*'],

    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' https: data: blob:; media-src 'self' blob:",
    },
  };
}
