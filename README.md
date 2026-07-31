# MMM-ImmichTileSlideShow

A tile-based photo & video slideshow for MagicMirror², backed by [Immich](https://immich.app/).

Pick a **mode**, point it at your Immich server, done:

```js
{
  module: "MMM-ImmichTileSlideShow",
  config: {
    mode: "grid", cols: 4, rows: 3,
    immich: {
      url: "http://your-immich-host:2283",
      apiKey: "<YOUR_API_KEY>",
      source: "album",
      album: "MagicMirror"
    }
  }
}
```

- **Three layout modes** — `frame` (one photo), `grid` (uniform tiles), `mosaic` (bento-box)
- Rotates tiles on an interval with fade/slide transitions
- Video tiles with autoplay, muting, and a concurrency cap
- Optional captions and auto-scrolling
- Works with **Immich v1.94 → v3.x** (version auto-detected)
- Renders placeholder tiles with zero config, so you can verify the UI first

> **Upgrading from v1?** The configuration format changed. See [Migrating from v1](#migrating-from-v1).

<img src="public/screenshot.png" alt="Screenshot" width="640" />

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/enarciso/MMM-ImmichTileSlideShow.git MMM-ImmichTileSlideShow
cd MMM-ImmichTileSlideShow
npm install
```

Then add a module block to `config/config.js` — start from [Layout modes](#layout-modes) below or [`examples/config.example.js`](examples/config.example.js).

## Layout modes

`mode` is the one option that shapes everything else. Pick the one matching your intent.

### `mode: "frame"` — digital picture frame

One full-screen photo at a time. No grid math, no featured tiles.

```js
config: {
  mode: "frame",
  interval: 15000,
  immich: { url: "…", apiKey: "…", source: "album", album: "Family" }
}
```

### `mode: "grid"` — uniform tile wall

Exactly `cols` × `rows` equally-sized tiles filling the screen. Images crop to fill (`fit: "cover"`), so there are never blank cells.

```js
config: {
  mode: "grid",
  cols: 4,
  rows: 3,
  immich: { url: "…", apiKey: "…", source: "album", album: "MagicMirror" }
}
```

Sizing guide for a 16:9 monitor:

| Look | Config |
|---|---|
| Two big side-by-side | `cols: 2, rows: 1` |
| Six large tiles | `cols: 3, rows: 2` |
| Twelve medium tiles | `cols: 4, rows: 3` |
| Fifteen smaller tiles | `cols: 5, rows: 3` |

### `mode: "mosaic"` — bento-box (default)

Column count adapts to the viewport, and tiles stretch by image aspect: portraits span 2 rows, landscapes 2 columns, panoramas 3. A few "featured" tiles are enlarged near the center.

```js
config: {
  mode: "mosaic",
  featured: { min: 2, max: 4 },
  immich: { url: "…", apiKey: "…", source: "memory" }
}
```

**Mosaic ignores `cols`/`rows` by design.** A fixed cell budget plus multi-cell spans is what produces blank cells, so mosaic derives its column count from the viewport instead. To make mosaic tiles bigger, set a minimum tile width with `tileSize` — CSS fills as many columns as fit, and rows stay unbounded, so spans still pack cleanly:

```js
config: {
  mode: "mosaic",
  tileSize: "large",   // "small" | "medium" | "large", or a number of px
  immich: { … }
}
```

#### Fullscreen fit (automatic)

When the browser is actually filling the screen — F11, `requestFullscreen()`, or Chromium `--kiosk` — mosaic switches to a **viewport-fitted** layout. Instead of filling columns against a fixed row height and letting the last row spill past the bottom edge, it solves an exact `cols × rows` split for the visible area:

- Tracks are `repeat(n, 1fr)`, so the grid always sums to exactly the viewport — no overflow, no clipped bottom row, no bleed past the edges.
- The tile count is exactly the number of planned slots, with no spare buffer tiles (a spare tile is what used to land off-screen).
- Slots are planned so they cover every cell exactly once: a few 2×2 features near the centre (still honoring `featured.min`/`max`/`band`), some 2×1 and 1×2 blocks for texture, 1×1 for the rest. Exact coverage means no blank cells either.
- Each photo is matched to a slot whose aspect ratio is close to its own, chosen from a short look-ahead window in the album. Since tiles use `fit: "cover"`, matching shape to slot is what keeps subjects from being cropped or pushed off-centre.

Detection is a heuristic: `--kiosk` and F11 report no fullscreen element, so it compares the viewport against `screen` — strictly on width, loosely on height, since browser chrome (a tab strip survives macOS fullscreen) costs height but never width. If your setup reads wrong, force it:

```js
config: {
  mode: "mosaic",
  fitToScreen: true,   // "auto" (default) | true | false
  immich: { … }
}
```

`tileSize` still applies — it becomes the target cell width the solver aims for. Everything re-solves on resize, and the layout reverts to the flowing auto-fill mosaic if the window leaves fullscreen. Windowed (non-fullscreen) mosaic and `scroll` mosaics are unchanged.

Roughly how many columns you get on a 1920px-wide display (windowed; fullscreen fit solves its own split):

| `tileSize` | Min width | Columns |
|---|---|---|
| *(unset)* | adaptive | 9 |
| `"small"` | 240px | 7 |
| `"medium"` | 340px | 5 |
| `"large"` | 480px | 3 |
| `600` | 600px | 3 |

> Mosaic is the densest, most visually varied layout. If you want exact tile counts rather than a minimum size, use `grid`.

## Options

Grouped options accept `true`, `false`, **or** an object of settings — so `videos: true` and `videos: { maxConcurrent: 2 }` are both valid.

### Layout

| Name | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `"mosaic"` | `"frame"`, `"grid"`, or `"mosaic"`. Determines tile count, sizing, and whether aspect-based spans apply. |
| `cols` | number | `3` | Columns — `grid` mode only. |
| `rows` | number | `2` | Rows — `grid` mode only. |
| `tileSize` | number \| string | `null` | Minimum tile width — **`mosaic` mode only**. `"small"` (240px), `"medium"` (340px), `"large"` (480px), or a number of pixels. `null` uses the adaptive width heuristic. Ignored in `grid`/`frame`, where `cols`/`rows` govern. |
| `fit` | string | `"cover"` | How media fills a tile: `"cover"` (crop) or `"contain"` (letterbox). |
| `dim` | number | `0.25` | Darkening overlay so other modules stay readable. `0`–`1` or `0`–`100`. |
| `fullscreen` | boolean | `true` | Render as a fullscreen background (no `position` needed). Set `false` to render inside a region. |
| `fitToScreen` | boolean \| `"auto"` | `"auto"` | **`mosaic` only.** Solve an exact grid for the viewport so tiles can't overflow. `"auto"` enables it when the browser fills the screen; `true`/`false` override the detection. |
| `heightPx` | number | `360` | Grid height when `fullscreen: false`. `0` lets CSS control it. |

### Slideshow

| Name | Type | Default | Description |
|---|---|---|---|
| `interval` | number | `10000` | Milliseconds between tile swaps. |
| `transition` | string | `"fade"` | `"fade"` or `"slide"`. |
| `transitionMs` | number | `600` | Transition duration in ms. |
| `randomize` | boolean | `true` | Swap a random tile each interval instead of cycling in order. |
| `staggerMs` | number | `250` | Stagger between tiles during the initial fill. |

### Captions

| Name | Type | Default | Description |
|---|---|---|---|
| `captions` | boolean \| object | `false` | `true` to enable with defaults, or `{ fields: [...] }`. |
| `captions.fields` | array | `["date"]` | Any of `"title"`, `"date"`, `"album"`. |

### Featured tiles (mosaic only)

| Name | Type | Default | Description |
|---|---|---|---|
| `featured` | boolean \| object | `true` | Enlarged 2×2 tiles near the center. Automatically disabled in `grid`/`frame`. |
| `featured.min` / `featured.max` | number | `2` / `3` | How many tiles are featured at once. |
| `featured.shuffleMinutes` | number | `10` | Reshuffle which tiles are featured. `0` disables. |
| `featured.band` | number | `0.5` | Center band where featured tiles are placed. `0`–`1` or `0`–`100`. |

### Videos

| Name | Type | Default | Description |
|---|---|---|---|
| `videos` | boolean \| object | `true` | `false` disables video tiles entirely. |
| `videos.ratio` | string | `"4:1"` | Images-to-videos cadence, e.g. 4 images then 1 video. |
| `videos.placement` | string | `"center"` | `"center"`, `"featured"`, or `"any"`. |
| `videos.preferFeatured` | boolean | `true` | Prefer featured tiles for playback when available. |
| `videos.centerBand` | number | `null` | Center band for placement; falls back to `featured.band`. |
| `videos.maxConcurrent` | number | `1` | Cap on simultaneously playing videos — **keep low on a Pi**. |
| `videos.autoplay` / `muted` / `loop` | boolean | `true` | Standard HTML5 video behavior. `muted` is required by most autoplay policies. |
| `videos.preload` | string | `"metadata"` | `"none"`, `"metadata"`, or `"auto"`. |

### Scrolling

| Name | Type | Default | Description |
|---|---|---|---|
| `scroll` | boolean \| object | `false` | Credits-style upward auto-scroll. |
| `scroll.speed` | number | `18` | Pixels per second. |

### Media filters & performance

| Name | Type | Default | Description |
|---|---|---|---|
| `imageExtensions` | string | `"jpg,jpeg,png,gif,webp,heic"` | Allowed image extensions (filtered server-side). |
| `videoExtensions` | string | `"mp4,mov,m4v,webm,avi,mkv,3gp"` | Allowed video extensions. |
| `performance.lightweight` | boolean | `false` | Prefer smaller Immich thumbnails. Recommended on Raspberry Pi. |
| `performance.maxTiles` | number | `160` | Upper bound on tiles kept in the DOM (`mosaic` only; `grid`/`frame` use `cols`×`rows`). |
| `performance.sizeCacheMax` | number | `400` | Max entries in the client-side aspect-ratio cache. |
| `performance.sizeCacheTtlMinutes` | number | `30` | Clear that cache periodically. `0` disables. |
| `debug` | boolean | `false` | Verbose logs plus an on-screen status label. |

### Immich

`immich` takes one server object, or an array of them with `activeImmich` selecting the index.

| Name | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | Immich base URL, e.g. `http://host:2283`. **Required.** |
| `apiKey` | string | — | Immich API key. **Required.** See [permissions](#required-api-key-permissions). |
| `timeout` | number | `10000` | Request timeout in ms. |
| `source` | string | `"memory"` | Where photos come from: `memory`, `album`, `search`, `random`, `anniversary`. |
| `album` | array \| string | — | For `source: "album"`. Accepts album **names or IDs**, mixed freely. Pass an array to pull from **multiple albums** — their assets are merged into one pool before sorting. A bare string works for a single album. |
| `days` | number | `7` | For `source: "memory"`: how many days back to include. |
| `query` | object | `null` | For `search`/`random`/`anniversary`: extra Immich search payload fields. |
| `size` | number | `100` | For `search`/`random`/`anniversary`: how many assets to request. |
| `anniversary.back` / `.forward` | number | `3` | Days around today to include. |
| `anniversary.startYear` / `.endYear` | number | 5 years ago / this year | Year range to scan. |
| `sort` | string | `"none"` | `name`, `created`, `modified`, `taken`, `random`, or `none`. |
| `sortDesc` | boolean | `false` | Reverse the sort order. |
| `activeImmich` | number | `0` | Top-level: which server in the `immich` array to use. |

## Immich integration

The module detects your Immich version and picks the right endpoints, then proxies media through MagicMirror so no credentials reach the browser.

- **Images** — proxied Immich thumbnails. With `performance.lightweight`, the smaller `thumbnail` is tried first, then `preview`, then the original. Otherwise `preview` first.
- **Videos** — the encoded video stream (v1.x `/assets/{id}/video`, v3+ `/assets/{id}/video/playback`) with a thumbnail poster.
- **Large albums** — on Immich v3+, album assets are paged via `/search/metadata` and stream to the browser as they arrive, so a 6,000-photo album starts rendering after the first page instead of blocking.
- **Caching** — the proxy preserves ETag / If-Modified-Since so the browser can reuse cached media.

### Required API-key permissions

When creating the key in Immich (**Account → API Keys**), grant:

| Scope | Used for |
| --- | --- |
| `album.read` | List albums and fetch album metadata |
| `asset.read` | Album listing, search, memories, asset metadata |
| `asset.view` | Thumbnails and video playback |
| `asset.download` | Originals (fallback when a thumbnail is missing) |
| `memory.read` | `source: "memory"` |

On pre-v3 servers `asset.read` also covers thumbnails and originals — the `asset.view` / `asset.download` split arrived in v3.

## Migrating from v1

v2 replaces the flat option list with a mode-driven config. **v1 configs are not read** — the module logs an error naming each legacy option and shows it on screen, so nothing fails silently.

Layout options collapse into `mode`:

| v1 | v2 |
|---|---|
| `autoLayout: true` | `mode: "mosaic"` |
| `autoLayout: false, tileCols: 4, tileRows: 3` | `mode: "grid", cols: 4, rows: 3` |
| `autoLayout: false, tileCols: 1, tileRows: 1` | `mode: "frame"` |
| `tileSpans` | implied by `mode` — remove it |

Renamed options:

| v1 | v2 |
|---|---|
| `updateInterval` | `interval` |
| `transitionDurationMs` | `transitionMs` |
| `randomizeTiles` | `randomize` |
| `initialStaggerMs` | `staggerMs` |
| `imageFit` | `fit` |
| `overlayOpacity` | `dim` |
| `useFullscreenBelow` | `fullscreen` |
| `containerHeightPx` | `heightPx` |
| `validImageFileExtensions` | `imageExtensions` |
| `validVideoFileExtensions` | `videoExtensions` |

Flat groups become objects (or plain booleans):

| v1 | v2 |
|---|---|
| `showCaptions: true, tileInfo: ["date"]` | `captions: { fields: ["date"] }` |
| `featuredAuto` | `featured: true` / `featured: false` |
| `featuredTilesMin`, `featuredTilesMax` | `featured: { min, max }` |
| `featuredShuffleMinutes`, `featuredCenterBand` | `featured: { shuffleMinutes, band }` |
| `enableVideos` | `videos: true` / `videos: false` |
| `imageVideoRatio`, `videoPlacement`, `videoPreferFeatured`, `videoCenterBand` | `videos: { ratio, placement, preferFeatured, centerBand }` |
| `videoMaxConcurrent`, `videoAutoplay`, `videoMuted`, `videoLoop`, `videoPreload` | `videos: { maxConcurrent, autoplay, muted, loop, preload }` |
| `enableScrolling`, `scrollSpeedPxPerSec` | `scroll: { speed }` |
| `lightweightMode`, `maxTiles`, `sizeCacheMax`, `sizeCacheTtlMinutes` | `performance: { lightweight, maxTiles, sizeCacheMax, sizeCacheTtlMinutes }` |
| `tileGapPx`, `backgroundColor` | removed — gap and tile backdrop are handled by CSS |

Immich config is now a single object:

| v1 | v2 |
|---|---|
| `immichConfigs: [{ … }]` | `immich: { … }` (array still allowed for multiple servers) |
| `activeImmichConfigIndex` | `activeImmich` |
| `mode: "album"` (inside the entry) | `source: "album"` |
| `albumId: ["<id>"]` / `albumName: "Name"` | `album: "<id or name>"` — auto-detected |
| `numDaysToInclude` | `days` |
| `querySize` | `size` |
| `anniversaryDatesBack`, `anniversaryDatesForward`, `anniversaryStartYear`, `anniversaryEndYear` | `anniversary: { back, forward, startYear, endYear }` |
| `sortImagesBy` | `sort` |
| `sortImagesDescending` | `sortDesc` |

### Before / after

```js
// v1
config: {
  autoLayout: false, tileCols: 4, tileRows: 3,
  updateInterval: 10000, imageFit: "cover", overlayOpacity: 0.15,
  lightweightMode: true, enableVideos: true, videoMaxConcurrent: 1,
  immichConfigs: [{
    url: "http://immich:2283", apiKey: "KEY", mode: "album",
    albumName: "MagicMirror", sortImagesBy: "random"
  }]
}

// v2
config: {
  mode: "grid", cols: 4, rows: 3,
  interval: 10000, fit: "cover", dim: 0.15,
  performance: { lightweight: true },
  videos: { maxConcurrent: 1 },
  immich: {
    url: "http://immich:2283", apiKey: "KEY", source: "album",
    album: "MagicMirror", sort: "random"
  }
}
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Red error box listing options | v1 config detected | Follow [Migrating from v1](#migrating-from-v1); each listed option names its v2 replacement. |
| Blank screen | `fullscreen_below` hidden by another module | Restart MagicMirror; ensure no module hides that region. For inline rendering set `fullscreen: false` and add a `position`. |
| "Loaded 0 image(s)" | Empty album, wrong `source`, or a name mismatch | Album names are case-sensitive — the log prints all available albums. Try `source: "memory"` to confirm connectivity. |
| Photos load but tiles stay blank | API key missing `asset.view` | Grant the [required scopes](#required-api-key-permissions). |
| Videos show only a poster | Codec unsupported by the browser | Expected fallback. Set `videos: false` to skip them, or re-encode in Immich. |
| Tiles feel too small | Mosaic packs densely by design | Switch to `mode: "grid"` with a low `cols`/`rows`, or `mode: "frame"`. |
| Black/blank cells in the grid | Aspect spans exceed the grid area | In fullscreen/kiosk this can't happen (slots cover the grid exactly). Windowed: use `mode: "grid"` (spans are off) instead of `mode: "mosaic"`. |
| Tiles bleed past the screen edge in mosaic | Browser isn't actually fullscreen, so the fitted layout is off | Launch Chromium with `--kiosk` (or press F11). Set `debug: true` to see the solved `cols × rows` in the on-screen label. |
| Tiles overflow the bottom of the screen | Module older than v2.1.1 — the grid was sized against MagicMirror's region, which can be taller than the window | Update the module. v2.1.1 clamps the grid to the visible viewport and recomputes on any resize. |
| Choppy motion on a Pi | Too many tiles or concurrent videos | Set `performance: { lightweight: true }`, `videos: { maxConcurrent: 1, preload: "none" }`, and raise `interval`. |
| `response.data.assets is not iterable` | Module older than v1.0.1 on Immich v3 | Update the module — v3 album paging is handled since v1.0.1. |

## Raspberry Pi tips

```js
config: {
  mode: "grid", cols: 4, rows: 3,
  interval: 15000,
  performance: { lightweight: true },
  videos: { maxConcurrent: 1, preload: "none" }
}
```

For the smoothest result, run MagicMirror in server mode on a stronger machine and point the Pi's browser at it.

## Compatibility

- MagicMirror² ≥ 2.1.0
- Immich v1.94 → v3.x
- No external CDN resources; all assets are served by the module

## License

MIT — see [LICENSE](LICENSE)
