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
const fs = require("fs");

const LOG_PREFIX = "MMM-ImmichTileSlideShow :: helper :: ";

function dlog(ctx, ...args) {
  if (ctx && ctx.config && ctx.config.debug) {
    Log.info(LOG_PREFIX + "[debug]", ...args);
  } else {
    Log.debug(LOG_PREFIX, ...args);
  }
}

/**
 * @typedef {Object} TileImage
 * @property {string} src
 * @property {string} [title]
 * @property {"image"|"video"} [kind]
 * @property {string} [posterSrc]
 * @property {string} [takenAt]
 * @property {string} [albumName]
 */

module.exports = NodeHelper.create({
  requiresVersion: "2.1.0",

  start() {
    this.config = null;
    Log.info(LOG_PREFIX + "started");
    try {
      // Ensure a PNG screenshot exists for README reference (generated locally)
      const out = path.join(__dirname, 'public', 'screenshot.png');
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2YbXkAAAAASUVORK5CYII='; // 1x1 black PNG
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    } catch (e) {
      Log.warn(LOG_PREFIX + 'Could not (re)generate screenshot.png: ' + e.message);
    }
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
      const cfg = this.config || {};
      const immichCfg = (cfg.immichConfigs && cfg.immichConfigs[cfg.activeImmichConfigIndex || 0]) || {};
      dlog(this, "incoming config", {
        mode: immichCfg.mode,
        url: immichCfg.url,
        hasApiKey: !!immichCfg.apiKey,
        timeout: immichCfg.timeout,
        albumName: immichCfg.albumName,
        albumId: immichCfg.albumId,
        querySize: immichCfg.querySize
      });
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
      images.push({ src: base, title: `Tile ${i + 1}`, kind: 'image' });
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
function toTileImage(img, immichApi, isVideo) {
  const title = (img.originalFileName || '').replace(/\.[^.]+$/, '');
  const takenAt = (img.exifInfo && img.exifInfo.dateTimeOriginal) || img.fileCreatedAt || img.fileModifiedAt || null;
  const albumName = img.albumName || null;
  if (isVideo) {
    return {
      kind: 'video',
      src: immichApi.getVideoLink(img.id),
      posterSrc: immichApi.getImageLink(img.id),
      title,
      takenAt,
      albumName
    };
  }
  return { kind: 'image', src: immichApi.getImageLink(img.id), title, takenAt, albumName };
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
  dlog(context, 'normalized active config', {
    mode: cfg.mode,
    url: cfg.url,
    timeout: cfg.timeout,
    albumName: cfg.albumName,
    albumId: cfg.albumId,
    querySize: cfg.querySize
  });

  // Build valid extensions sets
  const validImageSet = new Set(
    (context.config.validImageFileExtensions || 'jpg,jpeg,png,gif,webp')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const validVideoSet = new Set(
    (context.config.validVideoFileExtensions || 'mp4,mov,m4v,webm,avi,mkv,3gp')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  // toggle immichApi debug passthrough
  immichApi.debugOn = !!(context.config && context.config.debug);
  await immichApi.init(cfg, context.expressApp, true);
  dlog(context, 'api level resolved', immichApi.apiLevel);

  let images = [];
  if (cfg.mode === 'album') {
    let albumIds = cfg.albumId;
    if (cfg.albumName && !cfg.albumId) {
      const names = Array.isArray(cfg.albumName) ? cfg.albumName : [cfg.albumName];
      albumIds = await immichApi.findAlbumIds(names);
      dlog(context, 'findAlbumIds', names, '=>', albumIds);
    }
    if (albumIds) {
      albumIds = Array.isArray(albumIds) ? albumIds : [albumIds];
      images = await immichApi.getAlbumAssetsForAlbumIds(albumIds);
      dlog(context, 'album assets count', images && images.length);
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
    dlog(context, 'search assets count', images && images.length);
  } else if (cfg.mode === 'random') {
    images = await immichApi.randomSearchAssets(cfg.querySize, cfg.query);
    dlog(context, 'random assets count', images && images.length);
  } else if (cfg.mode === 'anniversary') {
    images = await immichApi.anniversarySearchAssets(
      cfg.anniversaryDatesBack,
      cfg.anniversaryDatesForward,
      cfg.anniversaryStartYear,
      cfg.anniversaryEndYear,
      cfg.querySize,
      cfg.query
    );
    dlog(context, 'anniversary assets count', images && images.length);
  } else {
    // memory lane (default)
    images = await immichApi.getMemoryLaneAssets(cfg.numDaysToInclude);
    dlog(context, 'memory lane assets count', images && images.length);
  }

  // Filter by extension and kind
  if (images && images.length) {
    const before = images.length;
    images = images.filter((img) => {
      const name = img.originalPath || img.originalFileName || '';
      const type = (img.type || '').toString().toLowerCase();
      const isVideoByType = type.includes('video');
      const isImageByType = type.includes('image');
      const okImage = hasValidExt(name, validImageSet) || isImageByType;
      const okVideo = (context.config.enableVideos === true) && (hasValidExt(name, validVideoSet) || isVideoByType);
      return okImage || okVideo;
    });
    const after = images.length;
    dlog(context, `filter by ext (${before} -> ${after})`);
  }

  // Map to tile images
  let tiles = (images || []).map((img) => {
    const name = img.originalPath || img.originalFileName || '';
    const type = (img.type || '').toString().toLowerCase();
    const isVideo = type.includes('video') || (!type && hasValidExt(name, validVideoSet));
    return toTileImage(img, immichApi, isVideo);
  });
  dlog(context, 'mapped tiles', tiles && tiles.length);

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
  dlog(context, 'sorted tiles', cfg.sortImagesBy, 'descending?', cfg.sortImagesDescending, 'count', tiles && tiles.length);

  // Send to client
  Log.info(LOG_PREFIX + `Loaded ${tiles.length} image(s) for mode=${cfg.mode}`);
  context.sendSocketNotification('IMMICH_TILES_DATA', { images: tiles });
}

// Bind to the module object
module.exports._loadFromImmich = _loadFromImmichImpl;
