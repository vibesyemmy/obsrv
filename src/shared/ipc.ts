export const IPC = {
  navigate: 'obsrv:navigate',
  reload: 'obsrv:reload',
  relaunch: 'obsrv:relaunch',
  log: 'obsrv:log',
  targetPaused: 'obsrv:target-paused',
  /** Main -> chrome: the target page's cursor, as CSS, for the canvas. */
  targetCursor: 'obsrv:target-cursor',
  /** Target preload -> main: a <select> wants its popup drawn (see shared/selectPopup.ts). */
  selectOpen: 'obsrv:select-open',
  /** Main -> chrome: draw that popup over the canvas. */
  selectPopup: 'obsrv:select-popup',
  /** Chrome -> main: the row chosen, or a dismissal. */
  selectResult: 'obsrv:select-result',
  /** Main -> target preload: write the pick into the element. */
  selectPick: 'obsrv:select-pick',
  /** Target preload -> main: a date/time/colour input wants its picker (see shared/pickerPopup.ts). */
  pickerOpen: 'obsrv:picker-open',
  /** Main -> chrome: host a picker over the canvas for that input. */
  pickerPopup: 'obsrv:picker-popup',
  /** Chrome -> main: host this input in the overlay at this anchor; resolves when it is put away. */
  pickerHost: 'obsrv:picker-host',
  /** Main -> overlay: host this input, or null to take it down. */
  pickerShow: 'obsrv:picker-show',
  /** Overlay -> main: the hosted input is in place and may be clicked. */
  pickerReady: 'obsrv:picker-ready',
  /** Overlay -> main: the hosted input took a value (`done` on commit). */
  pickerEvent: 'obsrv:picker-event',
  /** Overlay -> main: the host was dismissed without a value. */
  pickerClose: 'obsrv:picker-close',
  /** Main -> target preload: write the value into the element, or forget the request. */
  pickerPick: 'obsrv:picker-pick',
  inspect: 'obsrv:inspect',
  back: 'obsrv:back',
  forward: 'obsrv:forward',
  setViewport: 'obsrv:set-viewport',
  setTextScale: 'obsrv:set-text-scale',
  setThrottle: 'obsrv:set-throttle',
  setNativeBounds: 'obsrv:set-native-bounds',
  setNativeVisible: 'obsrv:set-native-visible',
  setNativeObscured: 'obsrv:set-native-obscured',
  /** Chrome -> main: open a menu in the overlay view. */
  menuOpen: 'obsrv:menu-open',
  /** Main -> overlay: draw this menu. */
  menuShow: 'obsrv:menu-show',
  /** Overlay -> main: a row was chosen, or the menu was dismissed. */
  menuPick: 'obsrv:menu-pick',
  /** Main -> chrome: the outcome, for the control that asked. */
  menuResult: 'obsrv:menu-result',
  setMode: 'obsrv:set-mode',
  sendInput: 'obsrv:send-input',
  getHostInfo: 'obsrv:get-host-info',
  getSettings: 'obsrv:get-settings',
  setSettings: 'obsrv:set-settings',
  frame: 'obsrv:frame',
  frameSubscribe: 'obsrv:frame-subscribe',
  /** Chrome -> main: keep (true) or drop (false) the onion skin's reference render; answers whether one fits. */
  setOnionSkin: 'obsrv:set-onion-skin',
  /** Main -> chrome: a frame of the reference render, on its own channel (see shared/onionSkin.ts). */
  referenceFrame: 'obsrv:reference-frame',
  referenceSubscribe: 'obsrv:reference-subscribe',
  urlChanged: 'obsrv:url-changed',
  titleChanged: 'obsrv:title-changed',
  loadError: 'obsrv:load-error',
  hostChanged: 'obsrv:host-changed',
  targetLoading: 'obsrv:target-loading',
  targetNavigating: 'obsrv:target-navigating',
  nativeFocused: 'obsrv:native-focused',
  syncScroll: 'obsrv:sync-scroll',
  applyScroll: 'obsrv:apply-scroll',
  scrollResult: 'obsrv:scroll-result',
  openImage: 'obsrv:open-image',
  focusUrl: 'obsrv:focus-url',
  openImagePath: 'obsrv:open-image-path',
  readImageFile: 'obsrv:read-image-file',
  uiState: 'obsrv:ui-state',
  agentApply: 'obsrv:agent-apply',
  agentActivity: 'obsrv:agent-activity',
  getUpdate: 'obsrv:get-update',
  checkUpdate: 'obsrv:check-update',
  openRelease: 'obsrv:open-release',
  updateStatus: 'obsrv:update-status',
  getHistory: 'obsrv:get-history',
  clearHistory: 'obsrv:clear-history',
  historyChanged: 'obsrv:history-changed',
  getTabs: 'obsrv:get-tabs',
  addTab: 'obsrv:add-tab',
  closeTab: 'obsrv:close-tab',
  activateTab: 'obsrv:activate-tab',
  tabsChanged: 'obsrv:tabs-changed',
} as const
