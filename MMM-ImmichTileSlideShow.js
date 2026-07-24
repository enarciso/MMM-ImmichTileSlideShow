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
        const img = usePlaceholders ? this._placeholderImage(i) : this._nextImage();
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
      const media = this.images && this.images.length ? this._nextImage() : this._placeholderImage(0);
      let tile = null;
      if (media && media.kind === 'video' && this.cfg.videos.enabled) {
        tile = this._pickTileForVideo();
      }
      if (!tile) {
        const index = this.cfg.randomize
          ? Math.floor(Math.random() * this.tileEls.length)
          : (Date.now() / this.cfg.interval) % this.tileEls.length;
        tile = this.tileEls[index];
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
    // and makes repeated _recalculateTiles() calls cheap.
    if (this._lastLayoutW === w && this._lastLayoutH === h) return;
    this._lastLayoutW = w;
    this._lastLayoutH = h;

    const aspect = w / h;
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
