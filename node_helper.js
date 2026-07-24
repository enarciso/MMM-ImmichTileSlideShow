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
 * @property {number} [w]
 * @property {number} [h]
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
      // The frontend sends an already-normalized v2 config (configSchema.js),
      // so no defaulting or legacy handling is needed here.
      this.config = payload && payload.config ? payload.config : {};
      Log.info(LOG_PREFIX + "register received");
      const immichCfg = activeImmich(this.config) || {};
      dlog(this, "incoming config", {
        source: immichCfg.source,
        url: immichCfg.url,
        hasApiKey: !!immichCfg.apiKey,
        timeout: immichCfg.timeout,
        albumNames: immichCfg.albumNames,
        albumIds: immichCfg.albumIds,
        size: immichCfg.size
      });
      if (activeImmich(this.config)) {
        _loadFromImmichImpl(this).catch((e) => {
          Log.error(LOG_PREFIX + "Immich load failed: " + e.message);
          this._sendInitialImages();
        });
      } else {
        this._sendInitialImages();
      }
      return;
    }
    // No periodic refresh path; refresh occurs on module restart or config changes
  },

  /**
   * Send a starting set of images. If Immich config is present, this is
   * where Immich fetch would be initiated. For now, send placeholders.
   */
  _sendInitialImages() {
    /** @type {TileImage[]} */
    let images = [];

    if (activeImmich(this.config)) Log.info(LOG_PREFIX + "Immich config detected — falling back to placeholders.");

    const layout = (this.config && this.config.layout) || {};
    const count = Math.max(12, (layout.rows || 2) * (layout.cols || 3) * 3);
    const base = `/${this.name}/placeholder.svg`;
    for (let i = 0; i < count; i++) {
      images.push({ src: base, title: `Tile ${i + 1}`, kind: 'image' });
    }

    this.sendSocketNotification("IMMICH_TILES_DATA", { images });
  }
});

// ------- Immich integration helpers -------

/**
 * Return the active Immich server entry from a normalized v2 config,
 * or null when no usable server is configured.
 * @param {object} moduleConfig normalized config
 * @returns {object|null}
 */
function activeImmich(moduleConfig) {
  const list = moduleConfig && Array.isArray(moduleConfig.immich) ? moduleConfig.immich : [];
  if (!list.length) return null;
  const idx = Number(moduleConfig.activeImmich) || 0;
  const entry = list[idx] || list[0];
  return entry && entry.url && entry.apiKey ? entry : null;
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
  // Try to extract dimensions when available to avoid extra probing in the browser
  const exif = img && img.exifInfo ? img.exifInfo : {};
  const w = Number(
    exif.imageWidth || exif.ImageWidth || exif.exifImageWidth || exif.PixelXDimension || exif.pixelXDimension ||
    img.width || img.w || null
  ) || null;
  const h = Number(
    exif.imageHeight || exif.ImageHeight || exif.exifImageHeight || exif.PixelYDimension || exif.pixelYDimension ||
    img.height || img.h || null
  ) || null;
  if (isVideo) {
    return {
      kind: 'video',
      src: immichApi.getVideoLink(img.id),
      posterSrc: immichApi.getImageLink(img.id),
      title,
      takenAt,
      albumName,
      w,
      h
    };
  }
  return { kind: 'image', src: immichApi.getImageLink(img.id), title, takenAt, albumName, w, h };
}

/**
 * Filter a raw Immich asset list by valid extension/type and map to tile records.
 * Extracted so progressive per-page emission and the final aggregated path share logic.
 */
function _filterAndMap(rawAssets, immichApi, context, validImageSet, validVideoSet) {
  if (!Array.isArray(rawAssets) || rawAssets.length === 0) return [];
  const filtered = rawAssets.filter((img) => {
    const name = img.originalPath || img.originalFileName || '';
    const type = (img.type || '').toString().toLowerCase();
    const isVideoByType = type.includes('video');
    const isImageByType = type.includes('image');
    const okImage = hasValidExt(name, validImageSet) || isImageByType;
    const okVideo = (context.config.videos && context.config.videos.enabled === true) && (hasValidExt(name, validVideoSet) || isVideoByType);
    return okImage || okVideo;
  });
  return filtered.map((img) => {
    const name = img.originalPath || img.originalFileName || '';
    const type = (img.type || '').toString().toLowerCase();
    const isVideo = type.includes('video') || (!type && hasValidExt(name, validVideoSet));
    return toTileImage(img, immichApi, isVideo);
  });
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
  const cfg = activeImmich(context.config);
  if (!cfg) {
    Log.error(LOG_PREFIX + 'No usable Immich server configured (needs `url` and `apiKey`).');
    context._sendInitialImages();
    return;
  }
  dlog(context, 'active immich server', {
    source: cfg.source,
    url: cfg.url,
    timeout: cfg.timeout,
    albumNames: cfg.albumNames,
    albumIds: cfg.albumIds,
    size: cfg.size
  });

  // Extension lists arrive pre-split from configSchema.normalize()
  const validImageSet = new Set(context.config.imageExtensions || []);
  const validVideoSet = new Set(context.config.videoExtensions || []);

  // toggle immichApi debug passthrough
  immichApi.debugOn = !!(context.config && context.config.debug);
  // Prefer thumbnail-sized assets in lightweight mode; fallback to original
  const perf = (context.config && context.config.performance) || {};
  await immichApi.init({ ...cfg, preferThumbnail: !!perf.lightweight }, context.expressApp, true);
  dlog(context, 'api level resolved', immichApi.apiLevel);

  let images = [];
  if (cfg.source === 'album') {
    // `album` accepts IDs and names interchangeably; names resolve via /albums.
    let albumIds = [...cfg.albumIds];
    if (cfg.albumNames.length) {
      const resolved = await immichApi.findAlbumIds(cfg.albumNames);
      dlog(context, 'findAlbumIds', cfg.albumNames, '=>', resolved);
      if (resolved && resolved.length) albumIds = albumIds.concat(resolved);
    }
    if (albumIds.length) {

      // Progressive delivery: stream pages to the frontend as they arrive so the
      // mirror can start rendering after the first page instead of waiting for
      // the entire album to page in.
      const sortMode = cfg.sort;
      const needsFinalSort = sortMode === 'name' || sortMode === 'created' || sortMode === 'modified' || sortMode === 'taken';
      let firstPageSent = false;
      const appendedRaw = [];

      const onPage = (items) => {
        appendedRaw.push(...items);
        // For sort modes that require the full pool (by name/date), defer emission
        // until all pages are collected; emit once at the end after sort/reverse.
        if (needsFinalSort) return;
        const pageTiles = _filterAndMap(items, immichApi, context, validImageSet, validVideoSet);
        if (!pageTiles.length) return;
        if (sortMode === 'random') shuffle(pageTiles);
        if (!firstPageSent) {
          firstPageSent = true;
          Log.info(LOG_PREFIX + `First page ready — sending ${pageTiles.length} tile(s) to frontend`);
          context.sendSocketNotification('IMMICH_TILES_DATA', { images: pageTiles });
        } else {
          dlog(context, `appending ${pageTiles.length} tile(s) to pool`);
          context.sendSocketNotification('IMMICH_TILES_APPEND', { images: pageTiles });
        }
      };

      images = await immichApi.getAlbumAssetsForAlbumIds(albumIds, { onPage });
      dlog(context, 'album assets total', images && images.length);

      if (needsFinalSort) {
        // Single terminal emission for date/name sorts — the frontend receives
        // one fully-sorted set (same UX as before, just after paging completes).
        // Fall through to the shared sort/emit path below.
      } else {
        // Already emitted progressively; suppress the terminal emission by using
        // the raw appended set for the tail-end no-op path.
        return; // done — nothing more to do for progressive modes
      }
      // For final-sort modes, hand off to the shared path with the accumulated set.
      images = appendedRaw;
    } else {
      Log.error(LOG_PREFIX + 'Album mode specified but no album found/selected.');
      // Try to help the user by listing available albums
      try {
        const map = await immichApi.getAlbumNameToIdMap();
        const list = Array.from(map.entries()).map(([name, id]) => `${name} => ${id}`);
        if (list.length > 0) {
          Log.info(LOG_PREFIX + `Available albums (${list.length}): ` + list.join('; '));
          Log.info(LOG_PREFIX + 'Set `immich: { source: "album", album: "<name or id from above>" }` in your config.');
        } else {
          Log.warn(LOG_PREFIX + 'No albums returned by Immich API.');
        }
      } catch (e) {
        Log.warn(LOG_PREFIX + 'Failed to list albums: ' + e.message);
      }
    }
  } else if (cfg.source === 'search') {
    images = await immichApi.searchAssets(cfg.query, cfg.size);
    dlog(context, 'search assets count', images && images.length);
  } else if (cfg.source === 'random') {
    images = await immichApi.randomSearchAssets(cfg.size, cfg.query);
    dlog(context, 'random assets count', images && images.length);
  } else if (cfg.source === 'anniversary') {
    images = await immichApi.anniversarySearchAssets(
      cfg.anniversary.back,
      cfg.anniversary.forward,
      cfg.anniversary.startYear,
      cfg.anniversary.endYear,
      cfg.size,
      cfg.query
    );
    dlog(context, 'anniversary assets count', images && images.length);
  } else {
    // memory lane (default)
    images = await immichApi.getMemoryLaneAssets(cfg.days);
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
      const okVideo = (context.config.videos && context.config.videos.enabled === true) && (hasValidExt(name, validVideoSet) || isVideoByType);
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

  // No server-side pool cap; all filtered media are returned.

  // Sort
  switch (cfg.sort) {
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
  if (cfg.sortDesc === true) tiles.reverse();
  dlog(context, 'sorted tiles', cfg.sort, 'descending?', cfg.sortDesc, 'count', tiles && tiles.length);

  // Send to client
  Log.info(LOG_PREFIX + `Loaded ${tiles.length} image(s) for source=${cfg.source}`);
  context.sendSocketNotification('IMMICH_TILES_DATA', { images: tiles });
}

// Bind to the module object
module.exports._loadFromImmich = _loadFromImmichImpl;
