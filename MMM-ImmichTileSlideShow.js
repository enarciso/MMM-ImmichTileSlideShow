// modules/MMM-ImmichTileSlideShow/MMM-ImmichTileSlideShow.js
/*
 * MagicMirror² Module: MMM-ImmichTileSlideShow
 * A tile-based slideshow that can pull images from Immich (via node_helper)
 * and displays them in a configurable grid with simple transitions.
 *
 * Defaults render with placeholder tiles so it works with zero config.
 */

/* global Module, Log */

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
   * Default module configuration
   */
  defaults: {
    // Grid layout
    tileRows: 2,
    tileCols: 3,
    tileGapPx: 8,
    imageFit: "cover", // cover | contain
    // Non-fullscreen container height in px (set 0 to let CSS control)
    containerHeightPx: 360,

    // Slideshow behavior
    updateInterval: 10000, // ms - how often to rotate a tile
    initialStaggerMs: 250, // ms between initial tile fills
    randomizeTiles: true,

    // Transitions
    transition: "fade", // fade | slide
    transitionDurationMs: 600,

    // Captions
    showCaptions: false,
    tileInfo: ["date"], // which metadata to show in caption: title | date | album

    // Darken overlay over tiles (0–1 or 0–100 for percentage)
    overlayOpacity: 0.25,

    // Immich (optional)
    immichConfigs: [], // array of Immich config objects (similar to MMM-ImmichSlideShow)
    activeImmichConfigIndex: 0,
    validImageFileExtensions: "jpg,jpeg,png,gif,webp,heic",
    validVideoFileExtensions: "mp4,mov,m4v,webm,avi,mkv,3gp",
    enableVideos: false,
    imageVideoRatio: "4:1", // images:videos selection ratio
    videoAutoplay: true,
    videoMuted: true,
    videoLoop: true,
    videoPreload: "metadata", // none | metadata | auto
    videoMaxConcurrent: 1,

    // Styling
    backgroundColor: "#000",

    // Development
    debug: false
    ,
    // Featured larger tiles: picks between min..max and places near center
    featuredTilesMin: 2,
    featuredTilesMax: 3,
    // Reshuffle featured tiles every N minutes (0 disables)
    featuredShuffleMinutes: 10,
    // Center band width (0–1 or 0–100%) where featured tiles are placed
    featuredCenterBand: 0.5
  },

  /**
   * Return the list of styles to load
   * @returns {string[]}
   */
  getStyles() {
    return [this.file("css/MMM-ImmichTileSlideShow.css")];
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

    this.log("started with config", this.config);

    // Ask the helper for data; it should respond with IMMICH_TILES_DATA
    this.sendSocketNotification("IMMICH_TILES_REGISTER", {
      identifier: this.identifier,
      config: this.config
    });

    // Mount to fullscreen background region regardless of module position
    this._ensureRoot();

    // Show placeholders immediately to avoid a blank screen
    if (!this.images || this.images.length === 0) {
      this._fillTilesInitial();
      this._startRotation();
      this._setDebugText('waiting for data');
    }
  },

  /**
   * Render the DOM container; tiles are filled after data arrives.
   * @returns {HTMLElement}
   */
  getDom() {
    // We mount our UI into the fullscreen_below region directly. Return an invisible stub.
    const stub = document.createElement("div");
    stub.style.display = "none";
    return stub;
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
    }
  },

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
  _ensureRoot() {
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
    const root = document.createElement('div');
    root.className = 'immich-tiles-root';
    root.style.pointerEvents = 'none';

    // Grid wrapper inside root
    const wrapper = document.createElement('div');
    wrapper.className = 'immich-tiles-wrapper';
    wrapper.style.setProperty("--mmmitss-gap", `${this.config.tileGapPx}px`);
    wrapper.style.setProperty("--mmmitss-bg", this.config.backgroundColor);
    wrapper.style.setProperty("--mmmitss-fit", this.config.imageFit);
    wrapper.style.setProperty("--mmmitss-transition", `${this.config.transitionDurationMs}ms`);
    wrapper.classList.toggle("transition-fade", (this.config.transition || "fade") === "fade");
    wrapper.classList.toggle("transition-slide", (this.config.transition || "fade") === "slide");
    if (this.config.debug) wrapper.classList.add('debug');

    this.tileEls = [];
    // Start with a modest number of tiles; we will keep rotating content
    const initialTiles = Math.max(12, this.config.tileRows * this.config.tileCols) || 12;
    for (let i = 0; i < initialTiles; i++) {
      const tile = this._createTile();
      wrapper.appendChild(tile);
      this.tileEls.push(tile);
    }

    root.appendChild(wrapper);
    // Darkening overlay
    let ov = Number(this.config.overlayOpacity);
    if (Number.isFinite(ov)) {
      if (ov > 1) ov = ov / 100; // allow percentage input
      ov = Math.max(0, Math.min(1, ov));
    } else {
      ov = 0.25;
    }
    root.style.setProperty('--mmmitss-overlay', String(ov));
    const overlay = document.createElement('div');
    overlay.className = 'immich-tiles-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    root.appendChild(overlay);
    // Optional debug label
    const dbg = document.createElement('div');
    dbg.className = 'immich-tiles-debug';
    dbg.style.cssText = 'position:absolute;left:8px;bottom:8px;color:#8bc34a;font:12px/1.2 monospace;background:rgba(0,0,0,.35);padding:4px 6px;border-radius:4px;display:none;';
    root.appendChild(dbg);
    container.appendChild(root);
    this._root = root;
    this._container = wrapper;
    this.log('created root and tiles:', this.tileEls.length);
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
      const delay = i * (this.config.initialStaggerMs || 0);
      setTimeout(() => {
        const img = usePlaceholders ? this._placeholderImage(i) : this._nextImage();
        this.log('apply initial tile', i, 'placeholder?', usePlaceholders);
        this._applyTile(tile, img);
      }, delay);
    }
    // After initial fill, choose a few featured tiles near center and enlarge them
    const after = (total - 1) * (this.config.initialStaggerMs || 0) + 150;
    setTimeout(() => this._applyFeaturedTiles(), after);
  },

  /**
   * Begin rotating a single random tile at each interval.
   */
  _startRotation() {
    if (this._rotationTimer) clearInterval(this._rotationTimer);
    this._rotationTimer = setInterval(() => {
      if (!this.tileEls.length) return;
      const index = this.config.randomizeTiles
        ? Math.floor(Math.random() * this.tileEls.length)
        : (Date.now() / this.config.updateInterval) % this.tileEls.length;
      this.log('rotating tile index', index);
      const tile = this.tileEls[index];
      const img = this.images && this.images.length ? this._nextImage() : this._placeholderImage(index);
      this._applyTile(tile, img, true);
    }, Math.max(1000, this.config.updateInterval));
  },

  /**
   * Get the next image from the list in a circular manner.
   * @returns {TileImage}
   */
  _nextImage() {
    // media-aware selection using image:video ratio
    const hasImages = this._imagePool && this._imagePool.length > 0;
    const hasVideos = this._videoPool && this._videoPool.length > 0 && this.config.enableVideos;
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

  _parseImageVideoRatio() {
    const r = this.config.imageVideoRatio;
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
    if (!this.config.enableVideos || !this._videoPool || this._videoPool.length === 0) return 'image';
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

    if (image.kind === 'video' && this.config.enableVideos) {
      if (!vidEl) {
        vidEl = document.createElement('video');
        vidEl.className = 'immich-tile-video';
        vidEl.muted = !!this.config.videoMuted;
        vidEl.loop = !!this.config.videoLoop;
        vidEl.playsInline = true;
        vidEl.autoplay = !!this.config.videoAutoplay;
        vidEl.preload = String(this.config.videoPreload || 'metadata');
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
      const canPlay = this._activeVideoCount < Number(this.config.videoMaxConcurrent || 1);
      if (canPlay && this.config.videoAutoplay) {
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
    if (this.config.showCaptions) {
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
      setTimeout(() => tile.classList.remove("swap"), Math.max(200, this.config.transitionDurationMs));
    }

    // Adjust mosaic spans by orientation
    this._applyMosaicSpans(tile, (image.kind === 'video' && image.posterSrc) ? image.posterSrc : image.src);
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
    if (this.config.debug && typeof Log !== "undefined" && Log.log) {
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
  },

  _setDebugText(text) {
    const el = this._root && this._root.querySelector('.immich-tiles-debug');
    if (!el) return;
    if (this.config.debug) {
      el.textContent = `MMM-ImmichTileSlideShow · ${text}`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }
  ,

  /**
   * Build caption text from config.tileInfo
   * @param {TileImage} image
   * @returns {string}
   */
  _buildCaption(image) {
    const items = Array.isArray(this.config.tileInfo) ? this.config.tileInfo : [String(this.config.tileInfo || "")];
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
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return;
      const ratio = w / h;
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
    };
    img.src = src;
  },

  /**
   * Randomly pick 2..3 tiles and make them 2x2 (4x area), placing them near the center.
   */
  _applyFeaturedTiles() {
    if (!this.tileEls || this.tileEls.length < 6) return;
    const min = Math.max(0, Number(this.config.featuredTilesMin) || 2);
    const max = Math.max(min, Number(this.config.featuredTilesMax) || (min + 1));
    const count = Math.min(max, Math.max(min, Math.floor(Math.random() * (max - min + 1)) + min));

    // Compute a central band (portion of the children list) to place featured tiles
    const total = this._container ? this._container.children.length : this.tileEls.length;
    let band = Number(this.config.featuredCenterBand);
    if (!Number.isFinite(band) || band <= 0) band = 0.5;
    if (band > 1) band = band / 100; // allow percentage
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
    const minutes = Number(this.config.featuredShuffleMinutes || 0);
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
  }
});
