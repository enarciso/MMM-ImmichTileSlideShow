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
 * @property {string} src - Image URL (served via module or Immich proxy)
 * @property {string} [title] - Optional title/caption
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

    // Immich (optional)
    immichConfigs: [], // array of Immich config objects (similar to MMM-ImmichSlideShow)
    activeImmichConfigIndex: 0,
    validImageFileExtensions: "jpg,jpeg,png,gif,webp",

    // Styling
    backgroundColor: "#000",

    // Development
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
    this._nextImageIndex = 0;
    this._started = false;

    this.log("started with config", this.config);

    // Ask the helper for data; it should respond with IMMICH_TILES_DATA
    this.sendSocketNotification("IMMICH_TILES_REGISTER", {
      identifier: this.identifier,
      config: this.config
    });
  },

  /**
   * Render the DOM container; tiles are filled after data arrives.
   * @returns {HTMLElement}
   */
  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "immich-tiles-wrapper";

    // Apply CSS grid variables
    wrapper.style.setProperty("--mmmitss-rows", String(this.config.tileRows));
    wrapper.style.setProperty("--mmmitss-cols", String(this.config.tileCols));
    wrapper.style.setProperty("--mmmitss-gap", `${this.config.tileGapPx}px`);
    wrapper.style.setProperty("--mmmitss-bg", this.config.backgroundColor);
    wrapper.style.setProperty("--mmmitss-fit", this.config.imageFit);
    wrapper.style.setProperty("--mmmitss-transition", `${this.config.transitionDurationMs}ms`);
    wrapper.classList.toggle("transition-fade", (this.config.transition || "fade") === "fade");
    wrapper.classList.toggle("transition-slide", (this.config.transition || "fade") === "slide");

    // Create tiles (empty until data arrives)
    const total = this.config.tileRows * this.config.tileCols;
    this.tileEls = [];
    for (let i = 0; i < total; i++) {
      const tile = this._createTile();
      wrapper.appendChild(tile);
      this.tileEls.push(tile);
    }
    this._container = wrapper;
    return wrapper;
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
      this._fillTilesInitial();
      this._startRotation();
      this._started = true;
    }
  },

  /**
   * Create a tile element with inner structure.
   * @returns {HTMLDivElement}
   */
  _createTile() {
    const tile = document.createElement("div");
    tile.className = "immich-tile";

    const img = document.createElement("div");
    img.className = "immich-tile-img";
    tile.appendChild(img);

    const caption = document.createElement("div");
    caption.className = "immich-tile-caption";
    tile.appendChild(caption);

    return tile;
  },

  /**
   * Populate the grid once with a staggered effect.
   */
  _fillTilesInitial() {
    const usePlaceholders = !this.images || this.images.length === 0;
    const total = this.tileEls.length;
    for (let i = 0; i < total; i++) {
      const tile = this.tileEls[i];
      const delay = i * (this.config.initialStaggerMs || 0);
      setTimeout(() => {
        const img = usePlaceholders ? this._placeholderImage(i) : this._nextImage();
        this._applyTile(tile, img);
      }, delay);
    }
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
    if (!this.images || this.images.length === 0) return this._placeholderImage(0);
    const img = this.images[this._nextImageIndex % this.images.length];
    this._nextImageIndex = (this._nextImageIndex + 1) % this.images.length;
    return img;
  },

  /**
   * Apply image and caption to a tile, with optional transition class.
   * @param {HTMLDivElement} tile
   * @param {TileImage} image
   * @param {boolean} [animate]
   */
  _applyTile(tile, image, animate = false) {
    const imgEl = tile.querySelector(".immich-tile-img");
    const capEl = tile.querySelector(".immich-tile-caption");
    if (!imgEl || !capEl) return;

    // Set background image
    imgEl.style.backgroundImage = `url('${image.src}')`;

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
  }
});
