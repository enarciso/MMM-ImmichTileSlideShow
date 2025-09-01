// modules/MMM-ImmichTileSlideShow/node_helper.js
/*
 * MagicMirror² Node Helper: MMM-ImmichTileSlideShow
 * Provides image lists to the frontend. Defaults to placeholder images
 * so the module renders without any external configuration.
 *
 * Immich integration implemented with version negotiation and proxying.
 */

/* eslint-disable no-undef */
const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("path");

const LOG_PREFIX = "MMM-ImmichTileSlideShow :: helper :: ";

/**
 * @typedef {Object} TileImage
 * @property {string} src
 * @property {string} [title]
 */

module.exports = NodeHelper.create({
  requiresVersion: "2.1.0",

  start() {
    this.config = null;
    Log.info(LOG_PREFIX + "started");
  },

  /**
   * Handle socket notifications from the front-end
   * @param {string} notification
   * @param {any} payload
   */
  socketNotificationReceived(notification, payload) {
    if (notification === "IMMICH_TILES_REGISTER") {
      this.config = payload && payload.config ? payload.config : {};
      Log.info(LOG_PREFIX + "register received");
      if (Array.isArray(this.config.immichConfigs) && this.config.immichConfigs.length > 0) {
        _loadFromImmichImpl(this).catch((e) => {
          Log.error(LOG_PREFIX + "Immich load failed: " + e.message);
          this._sendInitialImages();
        });
      } else {
        this._sendInitialImages();
      }
      return;
    }
  },

  /**
   * Send a starting set of images. If Immich config is present, this is
   * where Immich fetch would be initiated. For now, send placeholders.
   */
  _sendInitialImages() {
    /** @type {TileImage[]} */
    let images = [];

    // If Immich is configured, we will implement fetching in a follow-up step.
    const hasImmich = Array.isArray(this.config?.immichConfigs) && this.config.immichConfigs.length > 0;
    if (hasImmich) Log.info(LOG_PREFIX + "Immich config detected — falling back to placeholders.");

    const count = Math.max(12, (this.config.tileRows || 2) * (this.config.tileCols || 3) * 3);
    const base = `/${this.name}/placeholder.svg`;
    for (let i = 0; i < count; i++) {
      images.push({ src: base, title: `Tile ${i + 1}` });
    }

    this.sendSocketNotification("IMMICH_TILES_DATA", { images });
  }
});

// ------- Immich integration helpers -------

/**
 * Normalize and fill default values for the active Immich config entry.
 */
function normalizeImmichConfig(moduleConfig) {
  const idx = Number(moduleConfig.activeImmichConfigIndex || 0) || 0;
  const list = Array.isArray(moduleConfig.immichConfigs) ? moduleConfig.immichConfigs : [];
  const active = list[idx] || {};
  const defaults = {
    mode: 'memory',
    timeout: 6000,
    numDaysToInclude: 7,
    albumId: null,
    albumName: null,
    query: null,
    querySize: 100,
    anniversaryDatesBack: 3,
    anniversaryDatesForward: 3,
    anniversaryStartYear: 2020,
    anniversaryEndYear: 2025,
    sortImagesBy: 'none', // name | random | created | modified | taken | none
    sortImagesDescending: false
  };
  return { ...defaults, ...active };
}

/**
 * Return true if filename has a valid extension.
 */
function hasValidExt(filename, validSet) {
  if (!filename || !filename.includes('.')) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return validSet.has(ext);
}

/**
 * Convert Immich asset to a tile image record.
 */
function toTileImage(img, immichApi) {
  const src = immichApi.getImageLink(img.id);
  const title = (img.originalFileName || '').replace(/\.[^.]+$/, '');
  const takenAt = (img.exifInfo && img.exifInfo.dateTimeOriginal) || img.fileCreatedAt || img.fileModifiedAt || null;
  const albumName = img.albumName || null;
  return { src, title, takenAt, albumName };
}

/**
 * Sorting helpers
 */
function sortByKey(list, key) {
  return list.sort((a, b) => {
    const av = (a[key] || '').toString();
    const bv = (b[key] || '').toString();
    if (av > bv) return 1; if (av < bv) return -1; return 0;
  });
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Fetch images from Immich and send to client
 */
async function _loadFromImmichImpl(context) {
  // Lazy-require the API dep only when needed
  const immichApi = require('./immichApi.js');
  const cfg = normalizeImmichConfig(context.config);

  // Build valid extensions set
  const validSet = new Set(
    (context.config.validImageFileExtensions || 'jpg,jpeg,png,gif,webp')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  await immichApi.init(cfg, context.expressApp, true);

  let images = [];
  if (cfg.mode === 'album') {
    let albumIds = cfg.albumId;
    if (cfg.albumName && !cfg.albumId) {
      const names = Array.isArray(cfg.albumName) ? cfg.albumName : [cfg.albumName];
      albumIds = await immichApi.findAlbumIds(names);
    }
    if (albumIds) {
      albumIds = Array.isArray(albumIds) ? albumIds : [albumIds];
      images = await immichApi.getAlbumAssetsForAlbumIds(albumIds);
    } else {
      Log.error(LOG_PREFIX + 'Album mode specified but no album found/selected.');
      // Try to help the user by listing available albums
      try {
        const map = await immichApi.getAlbumNameToIdMap();
        const list = Array.from(map.entries()).map(([name, id]) => `${name} => ${id}`);
        if (list.length > 0) {
          Log.info(LOG_PREFIX + `Available albums (${list.length}): ` + list.join('; '));
          Log.info(LOG_PREFIX + 'Set `albumName: ["<one of the names above>"]` or `albumId: ["<id>"]` in your config.');
        } else {
          Log.warn(LOG_PREFIX + 'No albums returned by Immich API.');
        }
      } catch (e) {
        Log.warn(LOG_PREFIX + 'Failed to list albums: ' + e.message);
      }
    }
  } else if (cfg.mode === 'search') {
    images = await immichApi.searchAssets(cfg.query, cfg.querySize);
  } else if (cfg.mode === 'random') {
    images = await immichApi.randomSearchAssets(cfg.querySize, cfg.query);
  } else if (cfg.mode === 'anniversary') {
    images = await immichApi.anniversarySearchAssets(
      cfg.anniversaryDatesBack,
      cfg.anniversaryDatesForward,
      cfg.anniversaryStartYear,
      cfg.anniversaryEndYear,
      cfg.querySize,
      cfg.query
    );
  } else {
    // memory lane (default)
    images = await immichApi.getMemoryLaneAssets(cfg.numDaysToInclude);
  }

  // Filter by extension
  if (images && images.length) {
    images = images.filter((img) => hasValidExt(img.originalPath || img.originalFileName || '', validSet));
  }

  // Map to tile images
  let tiles = (images || []).map((img) => toTileImage(img, immichApi));

  // Sort
  switch (cfg.sortImagesBy) {
    case 'name':
      tiles = sortByKey(tiles, 'title');
      break;
    case 'created':
    case 'modified':
    case 'taken':
      tiles = sortByKey(tiles, 'takenAt');
      break;
    case 'random':
      tiles = shuffle(tiles);
      break;
    case 'none':
    default:
      // keep API order
      break;
  }
  if (cfg.sortImagesDescending === true) tiles.reverse();

  // Send to client
  Log.info(LOG_PREFIX + `Loaded ${tiles.length} image(s) for mode=${cfg.mode}`);
  context.sendSocketNotification('IMMICH_TILES_DATA', { images: tiles });
}

// Bind to the module object
module.exports._loadFromImmich = _loadFromImmichImpl;
