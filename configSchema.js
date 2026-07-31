/* MMM-ImmichTileSlideShow :: configSchema.js
 *
 * Single source of truth for the v2 configuration model.
 *
 * Loaded in BOTH environments:
 *   - browser  : via getScripts() -> window.MMMITSSConfig
 *   - node     : via require('./configSchema.js') in node_helper
 *
 * Responsibilities:
 *   1. Reject v1 configs loudly (v2 is a hard break) with per-key guidance.
 *   2. Normalize the user-facing v2 config into one canonical internal shape
 *      that the renderer and node_helper both consume.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MMMITSSConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  /**
   * Legacy v1 keys -> how to express the same thing in v2.
   * Used to produce an actionable error instead of silently ignoring config.
   */
  const LEGACY_KEYS = {
    autoLayout: 'use `mode: "mosaic"` (auto) or `mode: "grid"` with `cols`/`rows`',
    tileCols: 'use `cols` (with `mode: "grid"`)',
    tileRows: 'use `rows` (with `mode: "grid"`)',
    tileSpans: 'spans are implied by `mode` — "mosaic" spans, "grid"/"frame" do not',
    tileGapPx: 'removed — gap is derived from the layout',
    maxTiles: 'use `maxTiles` under `performance: { maxTiles }`',
    imageFit: 'use `fit`',
    overlayOpacity: 'use `dim`',
    updateInterval: 'use `interval`',
    transitionDurationMs: 'use `transitionMs`',
    randomizeTiles: 'use `randomize`',
    initialStaggerMs: 'use `staggerMs`',
    showCaptions: 'use `captions: true` or `captions: { fields: [...] }`',
    tileInfo: 'use `captions: { fields: [...] }`',
    useFullscreenBelow: 'use `fullscreen`',
    containerHeightPx: 'use `heightPx`',
    backgroundColor: 'use `backgroundColor` under `performance` is gone — style via CSS',
    featuredAuto: 'use `featured: true|false` or `featured: { ... }`',
    featuredTilesMin: 'use `featured: { min }`',
    featuredTilesMax: 'use `featured: { max }`',
    featuredShuffleMinutes: 'use `featured: { shuffleMinutes }`',
    featuredCenterBand: 'use `featured: { band }`',
    enableVideos: 'use `videos: true|false` or `videos: { ... }`',
    imageVideoRatio: 'use `videos: { ratio }`',
    videoPlacement: 'use `videos: { placement }`',
    videoPreferFeatured: 'use `videos: { preferFeatured }`',
    videoCenterBand: 'use `videos: { centerBand }`',
    videoMaxConcurrent: 'use `videos: { maxConcurrent }`',
    videoAutoplay: 'use `videos: { autoplay }`',
    videoMuted: 'use `videos: { muted }`',
    videoLoop: 'use `videos: { loop }`',
    videoPreload: 'use `videos: { preload }`',
    enableScrolling: 'use `scroll: true` or `scroll: { speed }`',
    scrollSpeedPxPerSec: 'use `scroll: { speed }`',
    immichConfigs: 'use `immich: { ... }` (or an array for multiple servers)',
    activeImmichConfigIndex: 'use `activeImmich`',
    lightweightMode: 'use `performance: { lightweight: true }`',
    sizeCacheMax: 'use `performance: { sizeCacheMax }`',
    sizeCacheTtlMinutes: 'use `performance: { sizeCacheTtlMinutes }`',
    validImageFileExtensions: 'use `imageExtensions`',
    validVideoFileExtensions: 'use `videoExtensions`'
  };

  /** Legacy keys that live inside an immichConfigs[] entry. */
  const LEGACY_IMMICH_KEYS = {
    mode: 'use `source` (avoids colliding with the top-level layout `mode`)',
    albumId: 'use `album` — IDs and names are auto-detected',
    albumName: 'use `album` — IDs and names are auto-detected',
    numDaysToInclude: 'use `days`',
    querySize: 'use `size`',
    anniversaryDatesBack: 'use `anniversary: { back }`',
    anniversaryDatesForward: 'use `anniversary: { forward }`',
    anniversaryStartYear: 'use `anniversary: { startYear }`',
    anniversaryEndYear: 'use `anniversary: { endYear }`',
    sortImagesBy: 'use `sort`',
    sortImagesDescending: 'use `sortDesc`'
  };

  const VALID_MODES = ['frame', 'grid', 'mosaic'];
  const VALID_SOURCES = ['memory', 'album', 'search', 'random', 'anniversary'];

  /**
   * Named tile sizes for `mode: "mosaic"`, in px of minimum tile width.
   * Chosen so a 1920px-wide display yields roughly 7 / 5 / 3 columns,
   * against the adaptive heuristic's 9.
   */
  const TILE_SIZES = { small: 240, medium: 340, large: 480 };

  /**
   * Resolve `tileSize` into a px floor, or null to use the adaptive heuristic.
   * Accepts a number, a numeric string ("400" / "400px"), or a TILE_SIZES key.
   * @param {*} value
   * @returns {number|null}
   */
  function toTileSize(value) {
    if (value == null || value === false) return null;
    if (typeof value === 'string') {
      const key = value.trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(TILE_SIZES, key)) return TILE_SIZES[key];
      // Fall through so "400" and "400px" behave like the number 400 rather
      // than silently reverting to the heuristic.
      value = key.replace(/px$/, '');
    }
    const n = Number(value);
    // Below ~80px tiles stop being legible; above 2000px there is nothing to gain.
    return Number.isFinite(n) && n > 0 ? Math.max(80, Math.min(2000, Math.round(n))) : null;
  }

  /**
   * Detect v1 config keys. Returns [] when the config is clean.
   * @param {object} config raw module config
   * @returns {{key:string, hint:string}[]}
   */
  function detectLegacy(config) {
    const found = [];
    if (!config || typeof config !== 'object') return found;
    for (const key of Object.keys(config)) {
      if (Object.prototype.hasOwnProperty.call(LEGACY_KEYS, key)) {
        found.push({ key, hint: LEGACY_KEYS[key] });
      }
    }
    return found;
  }

  /**
   * Build the multi-line error shown when a v1 config is detected.
   */
  function legacyErrorMessage(found) {
    const lines = [
      'MMM-ImmichTileSlideShow v2 uses a new configuration format and cannot read your v1 config.',
      '',
      'Legacy option' + (found.length === 1 ? '' : 's') + ' detected:'
    ];
    for (const f of found) lines.push(`  - ${f.key}  ->  ${f.hint}`);
    lines.push('');
    lines.push('Migration guide: https://github.com/enarciso/MMM-ImmichTileSlideShow#migrating-from-v1');
    return lines.join('\n');
  }

  /** Coerce a 0–1 fraction that may have been given as 0–100 percent. */
  function toFraction(value, fallback) {
    let n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n > 1) n = n / 100;
    return Math.max(0, Math.min(1, n));
  }

  /**
   * Resolve a `true | false | object` group into a normalized object.
   * @param {*} value raw config value
   * @param {object} defaults defaults applied when enabled
   * @param {boolean} defaultEnabled enabled state when the key is absent
   */
  function group(value, defaults, defaultEnabled) {
    if (value === false) return Object.assign({}, defaults, { enabled: false });
    if (value === true) return Object.assign({}, defaults, { enabled: true });
    if (value && typeof value === 'object') {
      const out = Object.assign({}, defaults, value);
      out.enabled = value.enabled !== false;
      return out;
    }
    return Object.assign({}, defaults, { enabled: defaultEnabled });
  }

  /** Split a comma string into a lowercase Set-friendly array. */
  function extList(value, fallback) {
    const src = typeof value === 'string' && value.trim() ? value : fallback;
    return src.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  }

  /**
   * Normalize one Immich server entry.
   */
  function normalizeImmich(raw) {
    const entry = raw && typeof raw === 'object' ? raw : {};

    // Surface legacy per-entry keys as part of the hard break.
    const legacy = [];
    for (const key of Object.keys(entry)) {
      if (Object.prototype.hasOwnProperty.call(LEGACY_IMMICH_KEYS, key)) {
        // `mode` is only legacy when it holds an Immich source value; a user
        // writing `source` correctly may still pass `mode` by muscle memory.
        if (key === 'mode' && !VALID_SOURCES.includes(entry.mode)) continue;
        legacy.push({ key: `immich.${key}`, hint: LEGACY_IMMICH_KEYS[key] });
      }
    }
    if (legacy.length) throw new Error(legacyErrorMessage(legacy));

    const source = VALID_SOURCES.includes(entry.source) ? entry.source : 'memory';

    // `album` accepts a single value or array, mixing IDs and names freely.
    const albumsRaw = entry.album == null ? [] : (Array.isArray(entry.album) ? entry.album : [entry.album]);
    const albumIds = [];
    const albumNames = [];
    for (const a of albumsRaw) {
      const s = String(a).trim();
      if (!s) continue;
      if (UUID_RE.test(s)) albumIds.push(s);
      else albumNames.push(s);
    }

    const thisYear = new Date().getFullYear();
    const anniversary = Object.assign(
      { back: 3, forward: 3, startYear: thisYear - 5, endYear: thisYear },
      (entry.anniversary && typeof entry.anniversary === 'object') ? entry.anniversary : {}
    );

    return {
      url: entry.url || null,
      apiKey: entry.apiKey || null,
      timeout: Number(entry.timeout) > 0 ? Number(entry.timeout) : 10000,
      source,
      albumIds,
      albumNames,
      days: Number(entry.days) > 0 ? Number(entry.days) : 7,
      query: entry.query || null,
      size: Number(entry.size) > 0 ? Number(entry.size) : 100,
      anniversary,
      sort: entry.sort || 'none',
      sortDesc: entry.sortDesc === true
    };
  }

  /**
   * Normalize the full v2 module config into the canonical internal shape.
   * Throws a descriptive Error when a v1 config is supplied.
   *
   * @param {object} config raw module config
   * @returns {object} canonical config
   */
  function normalize(config) {
    const raw = config && typeof config === 'object' ? config : {};

    const legacy = detectLegacy(raw);
    if (legacy.length) throw new Error(legacyErrorMessage(legacy));

    const mode = VALID_MODES.includes(raw.mode) ? raw.mode : 'mosaic';

    // Layout is fully derived from `mode` — this is the core v2 simplification.
    // `tileSize` applies to mosaic only: cols/rows would cap the cell budget and
    // reintroduce blank cells, whereas a minimum tile width lets CSS auto-fill
    // pick the count against unbounded rows, so aspect spans stay safe.
    let layout;
    if (mode === 'frame') {
      layout = { auto: false, cols: 1, rows: 1, spans: false, tileSize: null };
    } else if (mode === 'grid') {
      layout = {
        auto: false,
        cols: Math.max(1, Number(raw.cols) || 3),
        rows: Math.max(1, Number(raw.rows) || 2),
        spans: false,
        tileSize: null
      };
    } else {
      layout = { auto: true, cols: null, rows: null, spans: true, tileSize: toTileSize(raw.tileSize) };
    }

    // Featured tiles only make sense in mosaic; force off elsewhere.
    const featured = group(raw.featured, { min: 2, max: 3, shuffleMinutes: 10, band: 0.5 }, mode === 'mosaic');
    if (mode !== 'mosaic') featured.enabled = false;
    featured.band = toFraction(featured.band, 0.5);
    featured.min = Math.max(0, Number(featured.min) || 0);
    featured.max = Math.max(featured.min, Number(featured.max) || featured.min);

    const videos = group(raw.videos, {
      ratio: '4:1',
      placement: 'center',
      preferFeatured: true,
      centerBand: null,
      maxConcurrent: 1,
      autoplay: true,
      muted: true,
      loop: true,
      preload: 'metadata'
    }, true);
    videos.centerBand = videos.centerBand == null ? null : toFraction(videos.centerBand, null);
    videos.maxConcurrent = Math.max(0, Number(videos.maxConcurrent) || 0);

    const scroll = group(raw.scroll, { speed: 18 }, false);
    scroll.speed = Number(scroll.speed) > 0 ? Number(scroll.speed) : 18;

    const captions = group(raw.captions, { fields: ['date'] }, false);
    if (!Array.isArray(captions.fields) || !captions.fields.length) captions.fields = ['date'];

    const performance = Object.assign(
      { lightweight: false, maxTiles: 160, sizeCacheMax: 400, sizeCacheTtlMinutes: 30 },
      (raw.performance && typeof raw.performance === 'object') ? raw.performance : {}
    );
    performance.maxTiles = Math.max(1, Number(performance.maxTiles) || 160);

    // `immich` accepts one object or an array of servers.
    const immichRaw = raw.immich == null ? [] : (Array.isArray(raw.immich) ? raw.immich : [raw.immich]);
    const immich = immichRaw.map(normalizeImmich);
    const activeImmich = Math.max(0, Math.min(immich.length - 1, Number(raw.activeImmich) || 0));

    return {
      mode,
      layout,
      featured,
      videos,
      scroll,
      captions,
      performance,
      immich,
      activeImmich,

      interval: Math.max(1000, Number(raw.interval) || 10000),
      transition: raw.transition === 'slide' ? 'slide' : 'fade',
      transitionMs: Math.max(0, Number(raw.transitionMs) === 0 ? 0 : (Number(raw.transitionMs) || 600)),
      randomize: raw.randomize !== false,
      staggerMs: Math.max(0, Number(raw.staggerMs) === 0 ? 0 : (Number(raw.staggerMs) || 250)),
      fit: raw.fit === 'contain' ? 'contain' : 'cover',
      dim: toFraction(raw.dim == null ? 0.25 : raw.dim, 0.25),

      fullscreen: raw.fullscreen !== false,
      // "auto" detects a screen-filling browser; true/false force the fitted
      // mosaic on or off for setups the detection reads wrong.
      fitToScreen: raw.fitToScreen === true ? true : (raw.fitToScreen === false ? false : 'auto'),
      heightPx: Number(raw.heightPx) >= 0 ? Number(raw.heightPx) : 360,

      imageExtensions: extList(raw.imageExtensions, 'jpg,jpeg,png,gif,webp,heic'),
      videoExtensions: extList(raw.videoExtensions, 'mp4,mov,m4v,webm,avi,mkv,3gp'),

      debug: raw.debug === true
    };
  }

  return {
    normalize,
    detectLegacy,
    legacyErrorMessage,
    LEGACY_KEYS,
    LEGACY_IMMICH_KEYS,
    VALID_MODES,
    VALID_SOURCES,
    TILE_SIZES
  };
});
