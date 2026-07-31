// modules/MMM-ImmichTileSlideShow/MMM-ImmichTileSlideShow.js
/*
 * MagicMirror² Module: MMM-ImmichTileSlideShow
 * A tile-based slideshow that can pull images from Immich (via node_helper)
 * and displays them in a configurable grid with simple transitions.
 *
 * Defaults render with placeholder tiles so it works with zero config.
 */

/* global Module, Log, MMMITSSConfig */

/**
 * @typedef {Object} TileImage
 * @property {string} src - Media URL (image or video via module/Immich proxy)
 * @property {string} [title] - Optional title/caption
 * @property {"image"|"video"} [kind] - Media kind
 * @property {string} [posterSrc] - Poster image for videos
 * @property {string} [takenAt]
 * @property {string} [albumName]
 */

Module.register("MMM-ImmichTileSlideShow", {
  // Minimum MagicMirror version
  requiresVersion: "2.1.0",

  /**
   * Default module configuration (v2).
   *
   * The full option reference lives in configSchema.js — these defaults exist
   * so MagicMirror's config checker sees known keys. Everything is resolved
   * into a canonical shape by MMMITSSConfig.normalize() during start().
   */
  defaults: {
    // Layout: "mosaic" (auto bento-box) | "grid" (uniform cols x rows) | "frame" (single tile)
    mode: "mosaic",
    cols: 3, // grid mode only
    rows: 2, // grid mode only
    tileSize: null, // mosaic only: px, or "small" | "medium" | "large"

    // Slideshow
    interval: 10000,
    transition: "fade", // fade | slide
    transitionMs: 600,
    randomize: true,
    staggerMs: 250,
    fit: "cover", // cover | contain
    dim: 0.25, // 0-1 (or 0-100 as a percentage)

    // Groups: accept true | false | { ...options }
    captions: false,
    featured: true, // mosaic only; forced off for grid/frame
    videos: true,
    scroll: false,

    // Rendering
    fullscreen: true,
    heightPx: 360, // inline mode only

    // Media filters
    imageExtensions: "jpg,jpeg,png,gif,webp,heic",
    videoExtensions: "mp4,mov,m4v,webm,avi,mkv,3gp",

    // Performance
    performance: {
      lightweight: false,
      maxTiles: 160,
      sizeCacheMax: 400,
      sizeCacheTtlMinutes: 30
    },

    // Immich: one object, or an array of servers
    immich: null,
    activeImmich: 0,

    debug: false
  },

  /**
   * Return the list of styles to load
   * @returns {string[]}
   */
  getStyles() {
    return [this.file("css/MMM-ImmichTileSlideShow.css")];
  },

  /**
   * Shared config normalizer, loaded before the module body runs.
   * @returns {string[]}
   */
  getScripts() {
    return [this.file("configSchema.js")];
  },

  /**
   * Return the list of translation files
   * @returns {Object<string,string>}
   */
  getTranslations() {
    return {
      en: "translations/en.json"
    };
  },

  /**
   * Module start lifecycle hook
   */
  start() {
    // Resolve the v2 config into its canonical shape. A v1 config throws here
    // with per-key migration guidance rather than silently rendering wrong.
    try {
      this.cfg = MMMITSSConfig.normalize(this.config);
    } catch (e) {
      this._configError = e.message;
      Log.error("MMM-ImmichTileSlideShow :: " + e.message);
      return;
    }

    this.images = /** @type {TileImage[]} */ ([]);
    this.tileEls = [];
    this._rotationTimer = null;
    this._featuredTimer = null;
    this._nextImageIndex = 0;
    this._nextVideoIndex = 0;
    this._started = false;
    this._activeVideoCount = 0;
    this._imagePool = [];
    this._videoPool = [];
    this._cadenceIndex = 0;
    this._cadenceSeq = null;
    this._sizeCache = new Map();
    this._sizeCacheTimer = null;
    this._initialFilled = false;
    this._fitPlan = null;

    // Lightweight mode: no client-side behavioral changes beyond Immich asset preference.

    this.log("started with config", this.cfg);

    // Ask the helper for data; it should respond with IMMICH_TILES_DATA.
    // The helper receives the already-normalized config so both sides agree.
    this.sendSocketNotification("IMMICH_TILES_REGISTER", {
      identifier: this.identifier,
      config: this.cfg
    });

    // Create rendering root depending on mode
    if (this.cfg.fullscreen !== false) {
      this._ensureRootFullscreen();
    }

    // Show placeholders immediately to avoid a blank screen
    if (!this.images || this.images.length === 0) {
      // If fullscreen, tiles are already created; if inline, wait for getDom()
      if (this._container) {
        this._fillTilesInitial();
        this._initialFilled = true;
      }
      this._startRotation();
      this._setDebugText('waiting for data');
    }

    // Periodic size cache clearing to bound memory
    const ttlMin = Number(this.cfg.performance.sizeCacheTtlMinutes) || 0;
    if (ttlMin > 0) {
      const periodMs = Math.max(1, ttlMin) * 60 * 1000;
      this._sizeCacheTimer = setInterval(() => {
        try { this._sizeCache && this._sizeCache.clear(); } catch (_) {}
        this.log('cleared size cache');
      }, periodMs);
    }
  },

  /**
   * Render the DOM container; tiles are filled after data arrives.
   * @returns {HTMLElement}
   */
  getDom() {
    // Surface a config error on-screen — a silent mirror is the worst outcome
    // of a hard break, so make the required migration impossible to miss.
    if (this._configError) {
      const err = document.createElement("div");
      err.className = "immich-tiles-config-error";
      err.innerText = this._configError;
      return err;
    }
    // If using fullscreen background, return an invisible stub
    if (this.cfg.fullscreen !== false) {
      const stub = document.createElement("div");
      stub.style.display = "none";
      return stub;
    }
    // Inline mode: build root inside our module wrapper
    const root = this._ensureRootInline();
    // If initial placeholders not yet filled, do it now
    if (!this._initialFilled) {
      this._fillTilesInitial();
      this._initialFilled = true;
      if (!this._rotationTimer) this._startRotation();
    }
    return root;
  },

  /**
   * Handle notifications from node_helper.
   * @param {string} notification
   * @param {any} payload
   */
  socketNotificationReceived(notification, payload) {
    if (notification === "IMMICH_TILES_DATA" && payload && Array.isArray(payload.images)) {
      this.log("received images:", payload.images.length);
      this.images = payload.images;
      this._splitMedia();
      this._cadenceIndex = 0;
      this._cadenceSeq = null;
      this._fillTilesInitial();
      this._startRotation();
      this._started = true;
      this._setDebugText(`media: ${this._imagePool.length} img, ${this._videoPool.length} vid`);
      this._recalculateTiles();
      this._maybeStartScroll();
    } else if (notification === "IMMICH_TILES_APPEND" && payload && Array.isArray(payload.images) && payload.images.length) {
      // Progressive album loading: append subsequent pages to the existing pool
      // without disturbing rotation or already-rendered tiles.
      this.log("appending images:", payload.images.length);
      if (!Array.isArray(this.images)) this.images = [];
      this.images.push(...payload.images);
      for (const m of payload.images) {
        const k = (m && m.kind) || 'image';
        if (k === 'video') this._videoPool.push(m);
        else this._imagePool.push(m);
      }
      this._setDebugText(`media: ${this._imagePool.length} img, ${this._videoPool.length} vid`);
    }
  },

  // (No active refresh request; media refresh is driven by config changes or module restarts)

  /**
   * Create a tile element with inner structure.
   * @returns {HTMLDivElement}
   */
  _createTile() {
    const tile = document.createElement("div");
    tile.className = "immich-tile";

    const media = document.createElement("div");
    media.className = "immich-tile-media";
    // background-image for images via child .immich-tile-img
    const img = document.createElement("div");
    img.className = "immich-tile-img";
    media.appendChild(img);
    tile.appendChild(media);

    const caption = document.createElement("div");
    caption.className = "immich-tile-caption";
    tile.appendChild(caption);

    return tile;
  },

  /**
   * Ensure fullscreen root is created and contains the grid wrapper and tiles.
   */
  _ensureRootFullscreen() {
    if (this._root) return;
    const container = document.querySelector('.region.fullscreen.below .container') || document.body;
    this.log('mount target found?', !!container);
    if (container && container.classList) {
      container.classList.remove('hidden');
      container.style.display = '';
    }
    // Keep the container visible even if MagicMirror toggles it later
    const keepVisible = () => {
      if (container && container.classList && container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        container.style.display = '';
        this.log('re-unhid fullscreen_below container');
      }
    };
    try {
      this._mmObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            keepVisible();
          }
        }
      });
      this._mmObserver.observe(container, { attributes: true, attributeFilter: ['class'] });
      keepVisible();
    } catch (e) {
      // ignore observer issues
    }
    const root = this._buildRootElement();
    container.appendChild(root);
    this._root = root;
    // After attaching to DOM, recalc tile capacity and bind resize
    this._recalculateTiles();
    this._bindResize();
    this._maybeStartScroll();
    this.log('created root and tiles:', this.tileEls.length);
  },

  _ensureRootInline() {
    // Build the root within module wrapper and return it
    // If already created, return existing
    if (this._root) return this._root;
    const root = this._buildRootElement();
    root.classList.add('inline');
    // Inline mode: allow pointer events to interact with module region if needed
    root.style.pointerEvents = 'auto';
    // Set container height if provided
    const h = Number(this.cfg.heightPx);
    if (Number.isFinite(h) && h > 0 && this._container) {
      this._container.style.height = `${h}px`;
    }
    this._root = root;
    // Recalculate capacity after insertion (next tick) and bind resize
    setTimeout(() => { this._recalculateTiles(); this._bindResize(); this._maybeStartScroll(); }, 0);
    return root;
  },

  _buildRootElement() {
    const root = document.createElement('div');
    root.className = 'immich-tiles-root';
    root.style.pointerEvents = 'none';

    // Grid wrapper inside root
    const wrapper = document.createElement('div');
    wrapper.className = 'immich-tiles-wrapper';
    // Initial gap defaults; will be refined in _updateLayoutVars
    if (this.cfg.layout.auto === false) {
      wrapper.style.setProperty("--mmmitss-gap", `8px`);
    } else {
      wrapper.style.setProperty("--mmmitss-gap", `clamp(8px, 0.9vw, 18px)`);
    }
    // Tile backdrop is styled purely via CSS in v2 (no backgroundColor option).
    wrapper.style.setProperty("--mmmitss-fit", this.cfg.fit);
    wrapper.style.setProperty("--mmmitss-transition", `${this.cfg.transitionMs}ms`);
    wrapper.classList.toggle("transition-fade", (this.cfg.transition || "fade") === "fade");
    wrapper.classList.toggle("transition-slide", (this.cfg.transition || "fade") === "slide");
    if (this.cfg.debug) wrapper.classList.add('debug');

    this.tileEls = [];
    // Start with a modest number of tiles; auto capacity adjustments will follow
    const cap = Number(this.cfg.performance.maxTiles) || 160;
    const baseTiles = Math.min(20, Math.max(10, Math.floor(cap * 0.2)));
    for (let i = 0; i < baseTiles; i++) {
      const tile = this._createTile();
      wrapper.appendChild(tile);
      this.tileEls.push(tile);
    }

    root.appendChild(wrapper);
    // Darkening overlay
    root.style.setProperty('--mmmitss-overlay', String(this.cfg.dim));
    const overlay = document.createElement('div');
    overlay.className = 'immich-tiles-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    root.appendChild(overlay);
    // Optional debug label
    const dbg = document.createElement('div');
    dbg.className = 'immich-tiles-debug';
    dbg.style.cssText = 'position:absolute;left:8px;bottom:8px;color:#8bc34a;font:12px/1.2 monospace;background:rgba(0,0,0,.35);padding:4px 6px;border-radius:4px;display:none;';
    root.appendChild(dbg);

    this._container = wrapper;
    return root;
  },

  /**
   * Populate the grid once with a staggered effect.
   */
  _fillTilesInitial() {
    this.log('filling initial tiles, current images:', this.images && this.images.length);
    const usePlaceholders = !this.images || this.images.length === 0;
    const total = this.tileEls.length;
    for (let i = 0; i < total; i++) {
      const tile = this.tileEls[i];
      const delay = i * (this.cfg.staggerMs || 0);
      setTimeout(() => {
        const img = usePlaceholders ? this._placeholderImage(i) : this._nextImageForTile(tile);
        this.log('apply initial tile', i, 'placeholder?', usePlaceholders);
        this._applyTile(tile, img);
      }, delay);
    }
    // After initial fill, choose a few featured tiles near center and enlarge them
    const after = (total - 1) * (this.cfg.staggerMs || 0) + 150;
    setTimeout(() => this._applyFeaturedTiles(), after);
  },

  /**
   * Begin rotating a single random tile at each interval.
   */
  _startRotation() {
    if (this._rotationTimer) clearInterval(this._rotationTimer);
    this._rotationTimer = setInterval(() => {
      if (!this.tileEls.length) return;
      const pickIndex = () => (this.cfg.randomize
        ? Math.floor(Math.random() * this.tileEls.length)
        : Math.floor(Date.now() / this.cfg.interval) % this.tileEls.length);
      let tile = null;
      let media;
      if (this._fitPlan) {
        // Fitted mosaic: choose the tile first so the photo can be matched to
        // that slot's aspect ratio.
        tile = this.tileEls[pickIndex()];
        media = this.images && this.images.length ? this._nextImageForTile(tile) : this._placeholderImage(0);
        if (media && media.kind === 'video' && this.cfg.videos.enabled) {
          tile = this._pickTileForVideo() || tile;
        }
      } else {
        media = this.images && this.images.length ? this._nextImage() : this._placeholderImage(0);
        if (media && media.kind === 'video' && this.cfg.videos.enabled) {
          tile = this._pickTileForVideo();
        }
        if (!tile) tile = this.tileEls[pickIndex()];
      }
      this._applyTile(tile, media, true);
    }, Math.max(1000, this.cfg.interval));
  },

  /**
   * Get the next image from the list in a circular manner.
   * @returns {TileImage}
   */
  _nextImage() {
    // media-aware selection using image:video ratio
    const hasImages = this._imagePool && this._imagePool.length > 0;
    const hasVideos = this._videoPool && this._videoPool.length > 0 && this.cfg.videos.enabled;
    if (!hasImages && !hasVideos) return this._placeholderImage(0);
    const kind = this._selectMediaKind();
    if (kind === 'video' && hasVideos) {
      const v = this._videoPool[this._nextVideoIndex % this._videoPool.length];
      this._nextVideoIndex = (this._nextVideoIndex + 1) % this._videoPool.length;
      return v;
    }
    if (hasImages) {
      const im = this._imagePool[this._nextImageIndex % this._imagePool.length];
      this._nextImageIndex = (this._nextImageIndex + 1) % this._imagePool.length;
      return im;
    }
    // fallback to videos if no images
    const v = this._videoPool[this._nextVideoIndex % this._videoPool.length];
    this._nextVideoIndex = (this._nextVideoIndex + 1) % this._videoPool.length;
    return v;
  },

  /**
   * Like _nextImage(), but in a fitted mosaic prefer a photo whose aspect ratio
   * is close to the tile's slot. `cover` crops whatever doesn't match, so
   * matching shape to slot is what keeps faces and subjects inside the frame.
   * @param {HTMLDivElement} tile
   * @returns {TileImage}
   */
  _nextImageForTile(tile) {
    const media = this._nextImage();
    if (!this._fitPlan || !tile || !media || media.kind === 'video') return media;
    const target = parseFloat((tile.dataset && tile.dataset.slotAspect) || '');
    if (!Number.isFinite(target) || target <= 0) return media;
    const pool = this._imagePool;
    if (!pool || pool.length < 4) return media;

    // _nextImage() already advanced past `media`; scan a short window ahead for
    // a better-shaped photo and consume that one instead. Bounded so rotation
    // still walks the whole album rather than replaying the same few photos.
    const WINDOW = Math.min(12, pool.length);
    let bestIdx = -1;
    let bestCost = this._ratioCost(media, target);
    if (bestCost === null) bestCost = Infinity;
    for (let k = 0; k < WINDOW; k++) {
      const idx = (this._nextImageIndex + k) % pool.length;
      const cost = this._ratioCost(pool[idx], target);
      if (cost !== null && cost < bestCost) {
        bestCost = cost;
        bestIdx = idx;
      }
    }
    if (bestIdx < 0) return media;
    this._nextImageIndex = (bestIdx + 1) % pool.length;
    return pool[bestIdx];
  },

  /**
   * Log-space distance between a photo's aspect ratio and a target, or null
   * when the ratio isn't known yet.
   * @returns {number|null}
   */
  _ratioCost(media, target) {
    const ratio = this._mediaRatio(media);
    if (!ratio) return null;
    return Math.abs(Math.log(ratio / target));
  },

  /**
   * Aspect ratio of a media item from its metadata, falling back to the size
   * cache populated when tiles measure loaded images.
   * @returns {number} ratio, or 0 when unknown
   */
  _mediaRatio(media) {
    if (!media) return 0;
    const w = Number(media.w);
    const h = Number(media.h);
    if (w > 0 && h > 0) return w / h;
    const src = (media.kind === 'video' && media.posterSrc) ? media.posterSrc : media.src;
    if (src && this._sizeCache && this._sizeCache.has(src)) return this._sizeCache.get(src) || 0;
    return 0;
  },

  _splitMedia() {
    this._imagePool = [];
    this._videoPool = [];
    for (const m of this.images || []) {
      const k = (m && m.kind) || 'image';
      if (k === 'video') this._videoPool.push(m);
      else this._imagePool.push(m);
    }
  },

  // No client-side media pool cap; all received media may be used

  _parseImageVideoRatio() {
    const r = this.cfg.videos.ratio;
    let img = 4, vid = 1;
    if (typeof r === 'string' && r.includes(':')) {
      const parts = r.split(':');
      const a = Math.max(0, parseInt(String(parts[0]).trim(), 10) || 0);
      const b = Math.max(0, parseInt(String(parts[1]).trim(), 10) || 0);
      if (a > 0) img = a;
      if (b > 0) vid = b;
    } else if (typeof r === 'number' && isFinite(r) && r >= 0) {
      img = Math.floor(r) || 0;
      vid = 1;
    }
    if (img === 0 && vid === 0) { img = 1; vid = 0; }
    return { image: img, video: vid };
  },

  _selectMediaKind() {
    if (!this.cfg.videos.enabled || !this._videoPool || this._videoPool.length === 0) return 'image';
    if (!this._imagePool || this._imagePool.length === 0) return 'video';
    const w = this._parseImageVideoRatio();
    const total = (w.image || 0) + (w.video || 0);
    if (total <= 0) return 'image';
    // Build/update deterministic sequence based on ratio (e.g., ['image','image','image','image','video'])
    const needsSeq = !this._cadenceSeq || this._cadenceSeq.length !== total || this._cadenceSeqImage !== w.image || this._cadenceSeqVideo !== w.video;
    if (needsSeq) {
      const seq = [];
      for (let i = 0; i < w.image; i++) seq.push('image');
      for (let i = 0; i < w.video; i++) seq.push('video');
      this._cadenceSeq = seq;
      this._cadenceSeqImage = w.image;
      this._cadenceSeqVideo = w.video;
      this._cadenceIndex = 0;
    }
    const choice = this._cadenceSeq[this._cadenceIndex % this._cadenceSeq.length];
    this._cadenceIndex = (this._cadenceIndex + 1) % this._cadenceSeq.length;
    return choice;
  },

  /**
   * Apply image and caption to a tile, with optional transition class.
   * @param {HTMLDivElement} tile
   * @param {TileImage} image
   * @param {boolean} [animate]
   */
  _applyTile(tile, image, animate = false) {
    const imgEl = tile.querySelector(".immich-tile-img");
    let vidEl = tile.querySelector("video.immich-tile-video");
    const capEl = tile.querySelector(".immich-tile-caption");
    if (!imgEl || !capEl) return;

    // Tear down any prior video element if switching kinds
    if (vidEl && image.kind !== 'video') {
      try {
        vidEl.pause();
        vidEl.removeAttribute('src');
        vidEl.load();
      } catch (e) {}
      vidEl.remove();
      vidEl = null;
      this._activeVideoCount = Math.max(0, this._activeVideoCount - 1);
    }

    if (image.kind === 'video' && this.cfg.videos.enabled) {
      if (!vidEl) {
        vidEl = document.createElement('video');
        vidEl.className = 'immich-tile-video';
        vidEl.muted = !!this.cfg.videos.muted;
        vidEl.loop = !!this.cfg.videos.loop;
        vidEl.playsInline = true;
        vidEl.autoplay = !!this.cfg.videos.autoplay;
        vidEl.preload = String(this.cfg.videos.preload || 'metadata');
        // place into media container
        const media = tile.querySelector('.immich-tile-media') || tile;
        media.appendChild(vidEl);
      }
      // set sources/poster
      if (image.posterSrc) vidEl.poster = image.posterSrc;
      if (vidEl.src !== image.src) vidEl.src = image.src;
      // hide the background image layer
      imgEl.style.backgroundImage = image.posterSrc ? `url('${image.posterSrc}')` : '';
      // Play with concurrency guard
      const canPlay = this._activeVideoCount < Number(this.cfg.videos.maxConcurrent || 1);
      if (canPlay && this.cfg.videos.autoplay) {
        // Attempt playback
        vidEl.play().then(() => {
          this._activeVideoCount++;
          vidEl.onended = () => { this._activeVideoCount = Math.max(0, this._activeVideoCount - 1); };
          vidEl.onpause = () => { this._activeVideoCount = Math.max(0, this._activeVideoCount - 1); };
        }).catch(() => {
          // Autoplay may be blocked; show poster background
        });
      }
    } else {
      // Image mode: set background-image and remove any video
      imgEl.style.backgroundImage = `url('${image.src}')`;
    }

    // Caption
    if (this.cfg.captions.enabled) {
      const text = this._buildCaption(image);
      if (text) {
        capEl.textContent = text;
        capEl.style.display = "block";
      } else {
        capEl.textContent = "";
        capEl.style.display = "none";
      }
    } else {
      capEl.textContent = "";
      capEl.style.display = "none";
    }

    if (animate) {
      tile.classList.remove("swap");
      // force reflow to restart animation
      // eslint-disable-next-line no-unused-expressions
      void tile.offsetWidth;
      tile.classList.add("swap");
      setTimeout(() => tile.classList.remove("swap"), Math.max(200, this.cfg.transitionMs));
    }

    // Adjust mosaic spans by orientation
    this._applyMosaicSpans(tile, image);
  },

  /**
   * Build a placeholder image reference.
   * @param {number} i
   * @returns {TileImage}
   */
  _placeholderImage(i) {
    return {
      src: `/${this.name}/placeholder.svg`,
      title: this.translate("TITLE") + ` #${(i % 9) + 1}`
    };
  },

  /**
   * Utility log wrapper honoring config.debug
   */
  log(...args) {
    if (this.cfg.debug && typeof Log !== "undefined" && Log.log) {
      Log.log("[MMM-ImmichTileSlideShow]", ...args);
    }
  },

  /**
   * Stop lifecycle hook to clear timers
   */
  stop() {
    if (this._rotationTimer) clearInterval(this._rotationTimer);
    if (this._featuredTimer) clearInterval(this._featuredTimer);
    if (this._mmObserver) {
      try { this._mmObserver.disconnect(); } catch (e) {}
      this._mmObserver = null;
    }
    this._activeVideoCount = 0;
    this._unbindResize();
    if (this._sizeCacheTimer) { try { clearInterval(this._sizeCacheTimer); } catch (_) {} this._sizeCacheTimer = null; }
    // Remove injected root to avoid leakage on restarts
    try {
      if (this._root && this._root.parentNode) {
        this._root.parentNode.removeChild(this._root);
      }
    } catch (_) {}
    this._root = null;
    this._container = null;
  },

  _setDebugText(text) {
    const el = this._root && this._root.querySelector('.immich-tiles-debug');
    if (!el) return;
    if (this.cfg.debug) {
      el.textContent = `MMM-ImmichTileSlideShow · ${text}`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }
  ,

  /**
   * Choose a tile positioned near the center for video playback.
   * Prefers currently featured tiles if configured and available.
   * @returns {HTMLDivElement|null}
   */
  _pickTileForVideo() {
    if (!this._container || !this.tileEls || !this.tileEls.length) return null;

    // Prefer featured tiles if available and allowed
    if (this.cfg.videos.placement === 'featured' || this.cfg.videos.preferFeatured) {
      const featured = Array.from(this._container.querySelectorAll('.immich-tile.featured'));
      if (featured.length) {
        const idx = Math.floor(Math.random() * featured.length);
        return featured[idx];
      }
      if (this.cfg.videos.placement === 'featured') return null; // no featured available
    }

    if (this.cfg.videos.placement === 'any') return null;

    // Center band selection
    const band = this._resolveCenterBand();
    const total = this._container.children.length;
    const bandCount = Math.max(1, Math.floor(total * band));
    const bandStart = Math.max(0, Math.floor((total - bandCount) / 2));
    const bandEnd = Math.min(total, bandStart + bandCount);
    if (bandEnd <= bandStart) return null;
    const pickIndex = Math.floor(Math.random() * (bandEnd - bandStart)) + bandStart;
    const el = this._container.children[pickIndex];
    return el && el.classList && el.classList.contains('immich-tile') ? el : null;
  },

  _resolveCenterBand() {
    // Use explicit videoCenterBand if provided; otherwise fall back to automatic band
    let band = this.cfg.videos.centerBand;
    if (band === null || band === undefined || band === '') {
      band = this._autoCenterBand();
    }
    band = Number(band);
    if (!Number.isFinite(band) || band <= 0) band = this._autoCenterBand();
    if (band > 1) band = band / 100; // allow percent
    return Math.min(1, Math.max(0.1, band));
  },

  /**
   * Build caption text from config.tileInfo
   * @param {TileImage} image
   * @returns {string}
   */
  _buildCaption(image) {
    const items = Array.isArray(this.cfg.captions.fields) ? this.cfg.captions.fields : [String(this.cfg.captions.fields || "")];
    const parts = [];
    for (const key of items) {
      const k = String(key).toLowerCase().trim();
      if (k === "title" && image.title) parts.push(image.title);
      else if (k === "date" && image.takenAt) parts.push(this._formatDate(image.takenAt));
      else if (k === "album" && image.albumName) parts.push(image.albumName);
    }
    return parts.join(" • ");
  },

  /**
   * Lightweight date formatter without external deps
   * @param {string} iso
   */
  _formatDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    } catch (_) {
      return "";
    }
  },

  /**
   * Determine image orientation and set grid row/column spans accordingly.
   * @param {HTMLDivElement} tile
   * @param {string} src
   */
  _applyMosaicSpans(tile, src) {
    // Do not override featured tile sizing
    if (tile && tile.dataset && tile.dataset.featured === '1') return;
    // Accept either a full image object (with potential w/h) or a src string
    if (typeof src !== 'string') {
      const image = src;
      const realSrc = (image && image.kind === 'video' && image.posterSrc) ? image.posterSrc : (image && image.src);
      const w = image && Number(image.w);
      const h = image && Number(image.h);
      if (w && h && w > 0 && h > 0) {
        const ratio = w / h;
        if (this._sizeCache) {
          try { this._sizeCache.set(realSrc, ratio); } catch (_) {}
        }
        this._applySpansForRatio(tile, ratio);
        return;
      }
      src = realSrc;
    }
    // Use cached ratio when available to avoid image reloading
    if (this._sizeCache && this._sizeCache.has(src)) {
      const ratio = this._sizeCache.get(src);
      this._applySpansForRatio(tile, ratio);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return;
      const ratio = w / h;
      if (this._sizeCache) {
        try { this._sizeCache.set(src, ratio); } catch (_) {}
      }
      this._applySpansForRatio(tile, ratio);
    };
    img.src = src;
  },

  _applySpansForRatio(tile, ratio) {
    // Viewport-fitted mosaic owns tile geometry: the slot plan covers the grid
    // exactly, so a ratio-driven span here would break that coverage and push
    // tiles out of view. Keep the ratio for image/slot matching only.
    if (this._fitPlan) {
      tile.dataset.ratio = String(ratio);
      return;
    }
    // Respect tileSpans config: when disabled (explicitly false, or null in
    // manual layout), keep every tile at 1×1 so a fixed cols×rows grid can't
    // develop blank cells from rows spilling into cells the auto-placer can't
    // backfill. imageFit: "cover" crops portraits/landscapes to fill the cell.
    const spansEnabled = this.cfg.layout.spans === true;
    if (!spansEnabled) {
      tile.style.gridColumn = '';
      tile.style.gridRow = '';
      tile.dataset.ratio = String(ratio);
      return;
    }
    let colSpan = 1;
    let rowSpan = 1;
    if (ratio >= 2.0) { // panorama
      colSpan = 3; rowSpan = 1;
    } else if (ratio >= 1.3) { // landscape
      colSpan = 2; rowSpan = 1;
    } else if (ratio <= 0.5) { // very tall
      colSpan = 1; rowSpan = 3;
    } else if (ratio <= 0.8) { // portrait
      colSpan = 1; rowSpan = 2;
    } else { // near square
      colSpan = 1; rowSpan = 1;
    }
    tile.style.gridColumn = `span ${colSpan}`;
    tile.style.gridRow = `span ${rowSpan}`;
    tile.dataset.ratio = String(ratio);
  },

  // --- Auto layout helpers ---
  _bindResize() {
    if (this._resizeBound) return;
    this._onResize = () => {
      clearTimeout(this._resizeDebounce);
      this._resizeDebounce = setTimeout(() => this._recalculateTiles(), 150);
    };
    window.addEventListener('resize', this._onResize);
    // Also react to layout changes that never fire a window resize: sibling
    // modules reflowing, the region resizing, or browser chrome appearing.
    // Observe only the root: its size is driven by the region, whereas the
    // container's CSS vars are what we write, so observing it could feed back.
    if (typeof ResizeObserver !== 'undefined' && this._root) {
      try {
        this._resizeObserver = new ResizeObserver(this._onResize);
        this._resizeObserver.observe(this._root);
      } catch (_) { this._resizeObserver = null; }
    }
    this._resizeBound = true;
  },

  _unbindResize() {
    if (!this._resizeBound) return;
    try { window.removeEventListener('resize', this._onResize); } catch (_) {}
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (_) {}
      this._resizeObserver = null;
    }
    this._resizeBound = false;
    this._onResize = null;
  },

  _recalculateTiles() {
    if (!this._container) return;
    // Update CSS variables for layout based on container size
    this._updateLayoutVars();
    // Manual layout: honor tileCols/tileRows exactly (plus a small buffer for
    // smooth swaps); trim any surplus DOM tiles left over from initial fill.
    if (this.cfg.layout.auto === false) {
      const cols = Math.max(1, Number(this.cfg.layout.cols) || 3);
      const rows = Math.max(1, Number(this.cfg.layout.rows) || 2);
      const needed = cols * rows;
      this._trimTileCapacity(needed);
      const added = this._ensureTileCapacity(needed);
      if (added > 0 && this.images) {
        for (let i = this.tileEls.length - added; i < this.tileEls.length; i++) {
          const tile = this.tileEls[i];
          const media = (this.images && this.images.length) ? this._nextImage() : this._placeholderImage(i);
          this._applyTile(tile, media);
        }
      }
      return;
    }
    // Viewport-fitted mosaic: exactly one tile per planned slot. No buffer —
    // a surplus tile would land in an implicit track and bleed off-screen.
    if (this._fitPlan) {
      const needed = this._fitPlan.slots.length;
      this._trimTileCapacity(needed);
      const added = this._ensureTileCapacity(needed);
      this._applyFitPlanGeometry();
      if (added > 0) {
        for (let i = this.tileEls.length - added; i < this.tileEls.length; i++) {
          const tile = this.tileEls[i];
          const media = (this.images && this.images.length) ? this._nextImageForTile(tile) : this._placeholderImage(i);
          this._applyTile(tile, media);
        }
      }
      return;
    }
    const m = this._computeLayoutMetrics();
    if (!m) return;
    let needed;
    if (this.cfg.scroll.enabled) {
      // Credits-like: keep only visible rows + a few extra rows buffered
      const extraRows = 4;
      needed = Math.min(Number(this.cfg.performance.maxTiles) || 160, (m.cols * (m.rows + extraRows)));
    } else {
      const bufferScreens = 1; // minimal buffer
      const buffer = Math.max(2, Math.floor(m.count * 0.15));
      needed = Math.min(Number(this.cfg.performance.maxTiles) || 160, (m.count * bufferScreens) + buffer);
    }
    const added = this._ensureTileCapacity(needed);
    if (added > 0 && this.images) {
      // Fill newly added tiles quickly
      for (let i = this.tileEls.length - added; i < this.tileEls.length; i++) {
        const tile = this.tileEls[i];
        const media = (this.images && this.images.length) ? this._nextImage() : this._placeholderImage(i);
        this._applyTile(tile, media);
      }
      // Re-apply featured tiles on capacity change
      this._clearFeaturedTiles();
      this._applyFeaturedTiles();
    }
    // Trim excess tiles to reduce DOM load
    this._trimTileCapacity(needed);
    // nothing else here; infinite scroll recycles tiles on the fly
  },

  _ensureTileCapacity(target) {
    let added = 0;
    while (this.tileEls.length < target) {
      const tile = this._createTile();
      this._container.appendChild(tile);
      this.tileEls.push(tile);
      added++;
    }
    return added;
  },

  _trimTileCapacity(target) {
    while (this.tileEls.length > target) {
      const tile = this.tileEls.pop();
      try { tile.remove(); } catch (_) { if (tile && tile.parentNode) tile.parentNode.removeChild(tile); }
    }
  },

  _computeLayoutMetrics() {
    try {
      const el = this._container;
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.gap) || 8;
      // Probe a tile width from an existing tile; fallback to 180px
      let tileW = 180;
      if (this.tileEls && this.tileEls.length) {
        const r = this.tileEls[0].getBoundingClientRect();
        if (r && r.width) tileW = r.width;
      }
      // Row size is a fixed value in CSS var --row-size; compute from grid-auto-rows
      let rowH = 140;
      const gar = cs.gridAutoRows || cs.getPropertyValue('grid-auto-rows');
      const m = /([0-9.]+)px/.exec(gar);
      if (m) rowH = parseFloat(m[1]);
      const w = el.clientWidth || el.offsetWidth || 0;
      const h = el.clientHeight || el.offsetHeight || 0;
      if (!w || !h) return null;
      const cols = Math.max(1, Math.floor((w + gap) / (tileW + gap)));
      const rows = Math.max(1, Math.floor((h + gap) / (rowH + gap)));
      const count = Math.max(4, cols * rows);
      return { gap, tileW, rowH, cols, rows, count };
    } catch (_) {
      return null;
    }
  },

  _updateLayoutVars() {
    const el = this._container;
    if (!el) return;
    const root = this._root || el.parentElement;
    let w = (root && (root.clientWidth || root.offsetWidth)) || (el.clientWidth || el.offsetWidth) || 0;
    let h = (root && (root.clientHeight || root.offsetHeight)) || (el.clientHeight || el.offsetHeight) || 0;

    // In fullscreen the root is `position: absolute; inset: 0`, so its height
    // resolves against MagicMirror's region — which can be taller than the
    // window once the document grows (other modules, body padding). Sizing rows
    // against that overflows the visible area and clips the bottom row, so
    // clamp to the part of the root actually on screen.
    if (this.cfg.fullscreen) {
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      if (vw && vh && root && typeof root.getBoundingClientRect === 'function') {
        const r = root.getBoundingClientRect();
        const visibleW = vw - Math.max(0, r.left);
        const visibleH = vh - Math.max(0, r.top);
        if (visibleW > 0) w = Math.min(w, visibleW);
        if (visibleH > 0) h = Math.min(h, visibleH);
      }
    }

    if (!w || !h) return;

    // Nothing moved — skip the write. Keeps ResizeObserver from ping-ponging
    // and makes repeated _recalculateTiles() calls cheap. The fit plan still
    // has to exist before we can skip: the first pass has nothing cached yet.
    const needsFitPlan = this._fitEnabled() && !this._fitPlan;
    if (this._lastLayoutW === w && this._lastLayoutH === h && !needsFitPlan) return;
    this._lastLayoutW = w;
    this._lastLayoutH = h;

    const aspect = w / h;

    // Fullscreen mosaic: solve an exact cols x rows grid for the visible
    // viewport instead of letting auto-fill pick columns against a fixed row
    // height. Fractional tracks that don't divide the viewport are what push
    // the last row past the bottom edge, so the fit path uses explicit
    // `repeat(n, 1fr)` tracks and zero-height implicit tracks — nothing can
    // spill out of view regardless of how spans pack.
    if (this._fitEnabled()) {
      this._buildFitPlan(el, w, h);
      return;
    }
    // Leaving fit mode (e.g. window left fullscreen): drop the plan and its
    // inline geometry so the auto-fill template below applies again.
    if (this._fitPlan) this._clearFitPlan(el);
    // Fixed layout ("grid" and "frame"): honor cols/rows exactly. The base CSS
    // uses grid-template-columns: repeat(auto-fill, minmax(--tile-min, 1fr)),
    // which ignores the requested column count and would auto-fill more tiles
    // when the viewport is wider than --tile-min. Override the template inline
    // so mode:"frame" renders one full-viewport tile.
    if (this.cfg.layout.auto === false) {
      const cols = Math.max(1, Number(this.cfg.layout.cols) || 3);
      const rows = Math.max(1, Number(this.cfg.layout.rows) || 2);
      const minGap = 8;
      let gapPx = Math.max(minGap, Math.min(64, Math.round(w * 0.008)));
      const tileW = Math.max(1, Math.floor((w - (cols - 1) * gapPx) / cols));
      const rowSize = Math.max(1, Math.floor((h - (rows - 1) * gapPx) / rows));
      el.style.setProperty('--mmmitss-gap', `${gapPx}px`);
      el.style.setProperty('--tile-min', `${tileW}px`);
      el.style.setProperty('--row-size', `${rowSize}px`);
      // Force exact grid geometry (overrides the auto-fill template)
      el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      el.style.gridAutoRows = `${rowSize}px`;
      // grid + scroll is a valid combination; keep the transform hint
      if (this.cfg.scroll.enabled) el.style.willChange = 'transform';
      return;
    }
    // Clear any inline manual-layout overrides when returning to auto layout
    if (el.style.gridTemplateColumns) el.style.gridTemplateColumns = '';
    if (el.style.gridAutoRows) el.style.gridAutoRows = '';
    // Auto layout (mosaic). An explicit tileSize overrides the width heuristic:
    // CSS auto-fill derives the column count from --tile-min, and rows stay
    // unbounded, so aspect spans still pack without leaving holes.
    const forcedTile = this.cfg.layout.tileSize;
    let targetCols;
    if (this.cfg.scroll.enabled) {
      // Credits-like: 1–2 columns with bigger gaps
      targetCols = (w >= 1200 ? 2 : 1);
      const gapPx = Math.round(Math.min(40, Math.max(18, w * 0.018)));
      el.style.setProperty('--mmmitss-gap', `${gapPx}px`);
      const tileMin = forcedTile
        ? Math.min(forcedTile, w)
        : Math.round(Math.max(220, Math.min(420, (w - (targetCols - 1) * gapPx) / targetCols)));
      const rowSize = Math.round(tileMin * 0.85);
      el.style.setProperty('--tile-min', `${tileMin}px`);
      el.style.setProperty('--row-size', `${rowSize}px`);
    } else {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.gap) || 10;
      let tileMin;
      if (forcedTile) {
        // Never exceed the viewport, or auto-fill collapses to a single column
        tileMin = Math.min(forcedTile, w);
      } else {
        if (w < 700) targetCols = 3;
        else if (w < 1100) targetCols = 5;
        else if (w < 1600) targetCols = 7;
        else targetCols = 9;
        if (aspect < 0.9) targetCols = Math.max(3, Math.floor(targetCols * 0.7));
        tileMin = Math.max(140, Math.min(300, Math.floor((w - (targetCols - 1) * gap) / targetCols)));
      }
      const rowSize = Math.floor(tileMin * (aspect > 1.6 ? 0.72 : aspect < 0.9 ? 0.82 : 0.76));
      el.style.setProperty('--tile-min', `${tileMin}px`);
      el.style.setProperty('--row-size', `${rowSize}px`);
    }
    // Ensure transform optimizations for scrolling
    el.style.willChange = 'transform';
  },

  /**
   * True when the viewport-fitted mosaic should drive layout: mode "mosaic",
   * rendering fullscreen, and the browser really is filling the screen
   * (F11/`--kiosk`/`--start-fullscreen`). Scrolling mosaics are excluded — a
   * credits scroll is deliberately taller than the viewport.
   * @returns {boolean}
   */
  _fitEnabled() {
    if (!this.cfg) return false;
    if (this.cfg.mode !== 'mosaic') return false;
    if (this.cfg.fullscreen === false) return false;
    if (this.cfg.scroll.enabled) return false;
    return this._isScreenFilling();
  },

  /**
   * Fullscreen API covers F11 and requestFullscreen(). Kiosk mode reports no
   * fullscreen element, so fall back to comparing the viewport against the
   * screen — a kiosk window matches it apart from device-pixel rounding.
   * @returns {boolean}
   */
  _isScreenFilling() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) return true;
      const scr = window.screen || {};
      const sw = Number(scr.width) || 0;
      const sh = Number(scr.height) || 0;
      if (!sw || !sh) return false;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      // 2% tolerance absorbs rounding and hairline browser chrome.
      return Math.abs(vw - sw) <= sw * 0.02 && Math.abs(vh - sh) <= sh * 0.02;
    } catch (_) {
      return false;
    }
  },

  /**
   * Pick the cols x rows split whose cells best match a square-ish target at a
   * sensible tile size, then lay explicit tracks and a slot plan on the grid.
   * @param {HTMLElement} el grid container
   * @param {number} w visible width in px
   * @param {number} h visible height in px
   */
  _buildFitPlan(el, w, h) {
    const gap = Math.max(6, Math.min(24, Math.round(Math.min(w, h) * 0.008)));
    const forced = this.cfg.layout.tileSize;
    // Aim for cells a touch wider than tall: most photos are landscape, and a
    // 4:3-ish cell crops them less than a square one.
    const targetAspect = 4 / 3;
    const targetW = forced || Math.max(180, Math.min(340, Math.round(w / 7)));
    const maxTiles = Number(this.cfg.performance.maxTiles) || 160;

    let best = null;
    for (let cols = 1; cols <= 16; cols++) {
      const cellW = (w - (cols - 1) * gap) / cols;
      if (cellW < 90) break;
      for (let rows = 1; rows <= 16; rows++) {
        const cellH = (h - (rows - 1) * gap) / rows;
        if (cellH < 90) break;
        if (cols * rows > maxTiles) continue;
        // Log-space distances so "twice as wide" and "half as wide" cost the same.
        const aspectCost = Math.abs(Math.log((cellW / cellH) / targetAspect));
        const sizeCost = Math.abs(Math.log(cellW / targetW));
        const score = aspectCost + sizeCost * 1.2;
        if (!best || score < best.score) best = { cols, rows, cellW, cellH, score };
      }
    }
    if (!best) best = { cols: 1, rows: 1, cellW: w, cellH: h };

    const slots = this._planFitSlots(best.cols, best.rows);
    this._fitPlan = {
      cols: best.cols,
      rows: best.rows,
      gap,
      cellW: best.cellW,
      cellH: best.cellH,
      slots
    };

    el.style.setProperty('--mmmitss-gap', `${gap}px`);
    el.style.setProperty('--tile-min', `${Math.floor(best.cellW)}px`);
    el.style.setProperty('--row-size', `${Math.floor(best.cellH)}px`);
    el.style.gridTemplateColumns = `repeat(${best.cols}, 1fr)`;
    el.style.gridTemplateRows = `repeat(${best.rows}, 1fr)`;
    // Belt and braces: if anything ever lands outside the planned tracks it
    // gets a zero-sized implicit track rather than pushing the grid off-screen.
    el.style.gridAutoRows = '0px';
    el.style.gridAutoColumns = '0px';
    this.log('fit plan', best.cols + 'x' + best.rows, 'slots', slots.length);
    this._setDebugText(`fit ${best.cols}×${best.rows} · ${slots.length} tiles · cell ${Math.round(best.cellW)}×${Math.round(best.cellH)}`);
  },

  _clearFitPlan(el) {
    this._fitPlan = null;
    if (!el) return;
    el.style.gridTemplateColumns = '';
    el.style.gridTemplateRows = '';
    el.style.gridAutoRows = '';
    el.style.gridAutoColumns = '';
    for (const tile of this.tileEls || []) {
      tile.style.gridArea = '';
      if (tile.dataset) delete tile.dataset.slotAspect;
    }
  },

  /**
   * Tile a cols x rows board with blocks that cover every cell exactly once:
   * a few 2x2 features near the centre, some 2x1 / 1x2 pairs for mosaic
   * texture, and 1x1 for the rest. Exact coverage is what keeps the grid from
   * overflowing while leaving no blank cells.
   * @returns {{c: number, r: number, cs: number, rs: number}[]}
   */
  _planFitSlots(cols, rows) {
    const taken = new Array(cols * rows).fill(false);
    const at = (c, r) => taken[r * cols + c];
    const free = (c, r, cs, rs) => {
      if (c + cs > cols || r + rs > rows) return false;
      for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) if (at(x, y)) return false;
      return true;
    };
    const claim = (c, r, cs, rs) => {
      for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) taken[y * cols + x] = true;
    };

    const slots = [];

    // Featured 2x2 blocks, biased toward the centre band.
    let featuredWanted = 0;
    if (this.cfg.featured.enabled && cols >= 3 && rows >= 3) {
      const min = this.cfg.featured.min;
      const max = this.cfg.featured.max;
      featuredWanted = min + Math.floor(Math.random() * (max - min + 1));
    }
    const band = Math.min(1, Math.max(0.1, Number(this.cfg.featured.band) || this._autoCenterBand()));
    const bandC0 = Math.floor((cols * (1 - band)) / 2);
    const bandC1 = Math.max(bandC0 + 1, Math.ceil(cols - (cols * (1 - band)) / 2));
    const bandR0 = Math.floor((rows * (1 - band)) / 2);
    const bandR1 = Math.max(bandR0 + 1, Math.ceil(rows - (rows * (1 - band)) / 2));
    for (let i = 0, guard = 0; i < featuredWanted && guard < 200; guard++) {
      const c = bandC0 + Math.floor(Math.random() * Math.max(1, bandC1 - bandC0));
      const r = bandR0 + Math.floor(Math.random() * Math.max(1, bandR1 - bandR0));
      if (!free(c, r, 2, 2)) continue;
      claim(c, r, 2, 2);
      slots.push({ c, r, cs: 2, rs: 2, featured: true });
      i++;
    }

    // Fill the remainder scan-order. Occasionally widen or heighten a block so
    // the mosaic keeps varied slot shapes for portrait/landscape photos.
    const pairChance = 0.28;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (at(c, r)) continue;
        let cs = 1;
        let rs = 1;
        if (Math.random() < pairChance) {
          if (Math.random() < 0.5 && free(c, r, 2, 1)) cs = 2;
          else if (free(c, r, 1, 2)) rs = 2;
        }
        claim(c, r, cs, rs);
        slots.push({ c, r, cs, rs, featured: false });
      }
    }
    return slots;
  },

  /**
   * Stamp the planned geometry onto the tile elements, one tile per slot.
   */
  _applyFitPlanGeometry() {
    const plan = this._fitPlan;
    if (!plan || !this._container) return;
    const { gap, cellW, cellH } = plan;
    for (let i = 0; i < plan.slots.length && i < this.tileEls.length; i++) {
      const s = plan.slots[i];
      const tile = this.tileEls[i];
      // Explicit placement (not `span` alone) so dense auto-flow can't shuffle
      // a tile into an implicit track.
      tile.style.gridArea = `${s.r + 1} / ${s.c + 1} / span ${s.rs} / span ${s.cs}`;
      tile.classList.toggle('featured', !!s.featured);
      tile.dataset.featured = s.featured ? '1' : '0';
      const slotW = s.cs * cellW + (s.cs - 1) * gap;
      const slotH = s.rs * cellH + (s.rs - 1) * gap;
      tile.dataset.slotAspect = String(slotW / slotH);
    }
  },

  _autoCenterBand() {
    // Compute a reasonable center band width based on container aspect ratio
    const el = this._container;
    if (!el) return 0.5;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const aspect = w / h;
    if (aspect >= 1.8) return 0.4; // very wide
    if (aspect <= 0.9) return 0.6; // tall
    return 0.5; // balanced
  },

  /**
   * Randomly pick 2..3 tiles and make them 2x2 (4x area), placing them near the center.
   */
  _applyFeaturedTiles() {
    // In credits-like scrolling mode, skip featured tiles for cleaner layout
    if (this.cfg.scroll.enabled) return;
    // Fitted mosaic: features are part of the slot plan, so a reshuffle means
    // re-planning the board rather than restyling individual tiles.
    if (this._fitPlan) {
      this._fitPlan.slots = this._planFitSlots(this._fitPlan.cols, this._fitPlan.rows);
      this._recalculateTiles();
      this._scheduleFeaturedShuffle();
      return;
    }
    if (!this.cfg.featured.enabled) return;
    if (!this.tileEls || this.tileEls.length < 6) return;

    // v2: featured count is always min..max. Defaults (2..3) match the old
    // "auto" heuristic closely, so the inverted featuredAuto flag is gone.
    const min = this.cfg.featured.min;
    const max = this.cfg.featured.max;
    const count = min + Math.floor(Math.random() * (max - min + 1));
    if (count <= 0) return;

    // Compute a central band (portion of the children list) to place featured tiles
    const total = this._container ? this._container.children.length : this.tileEls.length;
    let band = Number(this.cfg.featured.band);
    if (!Number.isFinite(band) || band <= 0) band = this._autoCenterBand();
    band = Math.min(1, Math.max(0.1, band));
    const bandCount = Math.max(1, Math.floor(total * band));
    const bandStart = Math.max(0, Math.floor((total - bandCount) / 2));
    const bandEnd = Math.min(total, bandStart + bandCount);

    // Pick unique indices away from edges to bias central placement
    const pool = [...this.tileEls];
    // Avoid already featured
    const candidates = pool.filter((el) => el.dataset.featured !== '1');
    if (candidates.length === 0) return;

    const chosen = [];
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const idx = Math.floor(Math.random() * candidates.length);
      const el = candidates.splice(idx, 1)[0];
      chosen.push(el);
    }

    // Apply featured class and move them near the center of the grid
    chosen.forEach((tile, i) => {
      tile.classList.add('featured');
      tile.dataset.featured = '1';
      tile.style.gridColumn = 'span 2';
      tile.style.gridRow = 'span 2';
      try {
        // Distribute evenly across the center band
        const slot = Math.floor(((i + 1) * (bandEnd - bandStart)) / (chosen.length + 1));
        const targetIndex = Math.min(this._container.children.length, bandStart + slot);
        const refChild = this._container.children[targetIndex];
        if (refChild) this._container.insertBefore(tile, refChild);
        else this._container.appendChild(tile);
      } catch (_) {}
    });
    this.log('featured tiles applied:', chosen.length);

    // Schedule periodic reshuffle if configured
    this._scheduleFeaturedShuffle();
  },

  /**
   * Remove current featured tiles and restore spans based on stored ratio (if available).
   */
  _clearFeaturedTiles() {
    if (!this._container) return;
    if (this._fitPlan) return; // slot plan reassigns featured tiles wholesale
    const featured = this._container.querySelectorAll('.immich-tile.featured');
    featured.forEach((tile) => {
      tile.classList.remove('featured');
      if (tile.dataset) {
        tile.dataset.featured = '0';
        const r = parseFloat(tile.dataset.ratio || '1');
        let col = 1, row = 1;
        if (!isNaN(r)) {
          if (r >= 2.0) { col = 3; row = 1; }
          else if (r >= 1.3) { col = 2; row = 1; }
          else if (r <= 0.5) { col = 1; row = 3; }
          else if (r <= 0.8) { col = 1; row = 2; }
        }
        tile.style.gridColumn = `span ${col}`;
        tile.style.gridRow = `span ${row}`;
      }
    });
  },

  /**
   * Set up (or refresh) periodic featured tiles reshuffle.
   */
  _scheduleFeaturedShuffle() {
    const minutes = Number(this.cfg.featured.shuffleMinutes || 0);
    if (!minutes || minutes <= 0) {
      if (this._featuredTimer) { clearInterval(this._featuredTimer); this._featuredTimer = null; }
      return;
    }
    if (this._featuredTimer) return; // already scheduled
    const period = Math.max(1, minutes) * 60 * 1000;
    this._featuredTimer = setInterval(() => {
      this.log('reshuffle featured tiles');
      this._clearFeaturedTiles();
      this._applyFeaturedTiles();
    }, period);
  },

  // --- Scrolling feature ---
  _maybeStartScroll() {
    if (this.cfg.scroll.enabled) this._startScroll();
    else this._stopScroll();
  },

  _startScroll() {
    if (!this._container || this._scrolling) return;
    this._scrolling = true;
    this._scrollOffset = 0;
    this._lastScrollTs = 0;
    const step = (ts) => {
      if (!this._scrolling) return;
      if (!this._lastScrollTs) this._lastScrollTs = ts;
      const dt = Math.max(0, ts - this._lastScrollTs);
      this._lastScrollTs = ts;
      const speed = Math.max(1, Number(this.cfg.scroll.speed) || 18);
      this._scrollOffset += (speed * dt) / 1000;
      // Recycle tiles when we've scrolled past approximately one row
      this._checkInfiniteScrollRecycle();
      this._container.style.transform = `translateY(${-this._scrollOffset}px)`;
      this._scrollRaf = window.requestAnimationFrame(step);
    };
    this._scrollRaf = window.requestAnimationFrame(step);
  },

  _stopScroll() {
    this._scrolling = false;
    if (this._scrollRaf) {
      try { window.cancelAnimationFrame(this._scrollRaf); } catch (_) {}
      this._scrollRaf = 0;
    }
    if (this._container) this._container.style.transform = '';
  },

  _checkInfiniteScrollRecycle() {
    const m = this._computeLayoutMetrics();
    if (!m) return;
    const rowStep = m.rowH + m.gap;
    // If we've scrolled more than a row, move top N tiles to bottom
    while (this._scrollOffset > rowStep) {
      const n = Math.max(1, m.cols);
      for (let i = 0; i < n && this._container.firstChild; i++) {
        const tile = this._container.firstChild;
        // Refill with next media to avoid repeats
        const media = (this.images && this.images.length) ? this._nextImage() : this._placeholderImage(i);
        this._applyTile(tile, media);
        // Move to end
        this._container.appendChild(tile);
      }
      this._scrollOffset -= rowStep;
    }
  }
});
