# MMM-ImmichTileSlideShow

A tile-based slideshow for MagicMirror² that displays a configurable grid of images. It is designed to fetch photos and (optionally) videos from [Immich (self-hosted photo app)](http://immch.app/) via the module's `node_helper` and internal proxies, but it also ships with placeholder tiles so it renders out-of-the-box with zero configuration.

Performance note (Raspberry Pi / Chromium): this module now requests Immich thumbnails for images and the encoded video stream instead of full originals. For images, it tries `preview` first, then `thumbnail`, and finally falls back to the original if needed. For videos, it tries the encoded `/assets/{id}/video` first, then falls back to the original. This significantly reduces bandwidth and CPU usage on low-power devices while remaining robust.

- Auto grid layout (auto tile count/gap, fit: cover/contain)
- Rotates a random tile at a fixed interval with configurable transitions (fade/slide)
- Optional captions
- Optional video tiles (experimental): muted, autoplay, loop with a concurrency cap (enabled by default)
- Optional auto-scrolling to reveal more tiles (credits-style spacing with fewer columns). When autoLayout is true and scrolling is enabled, setting tileCols/tileRows acts as a hard override for columns/rows with automatic gap.
- Immich integration (memory/album/search/random/anniversary)

<img src="public/screenshot.png" alt="Screenshot" width="640" />

## Installation

Clone into your MagicMirror `modules/` directory:

```
cd ~/MagicMirror/modules
git clone https://github.com/enarciso/MMM-ImmichTileSlideShow.git MMM-ImmichTileSlideShow
cd MMM-ImmichTileSlideShow
npm install
```

No dependencies are required to render placeholders. To integrate Immich later, you will provide your Immich URL and API key in the module config.

## Quick Start (Minimal Immich config)

1) Create an Immich API key in the Immich web app.
2) Add a minimal configuration that uses “memory” mode:

```js
{
  module: "MMM-ImmichTileSlideShow",
  config: {
    overlayOpacity: 0.35,
    immichConfigs: [
      {
        url: "http://<your-immich-host>:2283",
        apiKey: "<YOUR_API_KEY>",
        timeout: 6000,
        mode: "memory",
        numDaysToInclude: 7
      }
    ]
  }
}
```

## Configuration

Add this module to your `config/config.js`.

By default it renders as a fullscreen background in `fullscreen_below` (no position needed, header is not shown) and automatically adjusts the number of tiles and gaps to your screen. To render inside a normal region, set `useFullscreenBelow: false` and provide a `position`.

```js
{
  module: "MMM-ImmichTileSlideShow",
  // Fullscreen background mode (default): no position required; header not shown
  config: {
    // Mosaic grid (auto layout)
    autoLayout: true,
    imageFit: "cover",     // cover | contain
    overlayOpacity: 0.35,   // 0–1 or 0–100 (percentage) to darken tiles

    // Rotation
    updateInterval: 10000,
    randomizeTiles: true,
    initialStaggerMs: 250,

    // Transition
    transition: "fade", // fade | slide
    transitionDurationMs: 600,

    // Captions
    showCaptions: false,
    tileInfo: ["date"], // title | date | album

    // Optional: Immich configuration (not required for placeholders)
    immichConfigs: [
      {
        url: "https://your-immich-host:2283",
        apiKey: "<Your Immich API Key>",
        timeout: 6000,
        mode: "memory", // memory | album | search | random | anniversary
        numDaysToInclude: 7,
        sortImagesBy: "none",
        sortImagesDescending: false
      }
    ]

    // Optional: Video support (experimental)
    // enableVideos: true,            // default: true
    // imageVideoRatio: "4:1",        // images:videos selection ratio
    // videoPlacement: "center",      // center | any | featured
    // videoPreferFeatured: true,      // if featured tiles exist, prefer them
    // videoCenterBand: 0.5,           // center band width (0–1 or 0–100)
    // videoMaxConcurrent: 1,         // play at most N videos at once
    // videoAutoplay: true,
    // videoMuted: true,
    // videoLoop: true,
    // videoPreload: "metadata",      // none | metadata | auto

    // Optional: Scrolling (experimental)
    // enableScrolling: true,
    // scrollSpeedPxPerSec: 18,
  }
}
```

See `examples/config.example.js` for another snippet.

## Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `debug` | boolean | `false` | Enables extra logs and shows a small on-screen status label. |
| `overlayOpacity` | number | `0.25` | Darken overlay over the mosaic. Accepts `0–1` or `0–100` (percentage). |
| `autoLayout` | boolean | `true` | Automatically adjusts tile count and gap based on screen/container size. Set to `false` to use advanced manual layout. |
| `tileRows` | number | `2` | Manual layout rows when `autoLayout=false`. Also acts as a hard override when `autoLayout=true` and `enableScrolling=true`. |
| `tileCols` | number | `3` | Manual layout cols when `autoLayout=false`. Also acts as a hard override when `autoLayout=true` and `enableScrolling=true`. |
| `tileGapPx` | number | — | Deprecated. Gap is automatically calculated. |
| `imageFit` | string | `"cover"` | How images fit within tiles: `"cover"` or `"contain"`. |
| `useFullscreenBelow` | boolean | `true` | If `true`, renders as a fullscreen background in `fullscreen_below` (no `position` needed; `header` not shown). If `false`, renders inline inside the module region. |
| `containerHeightPx` | number | `360` | Inline mode only: fixed height for the grid (px). Set to `0` to let CSS/parent control the height. |
| `updateInterval` | number | `10000` | Milliseconds between tile swaps. |
| `initialStaggerMs` | number | `250` | Stagger timing for initial tile fill (ms). |
| `randomizeTiles` | boolean | `true` | If true, rotates a random tile each interval; otherwise cycles deterministically. |
| `transition` | string | `"fade"` | Tile swap animation: `"fade"` or `"slide"`. |
| `transitionDurationMs` | number | `600` | Animation duration (ms). |
| `showCaptions` | boolean | `false` | Show caption overlay. |
| `tileInfo` | array | `["date"]` | Caption fields: any of `"title"`, `"date"`, `"album"`. |
| `featuredAuto` | boolean | `true` | Automatically picks a few larger (2x2) tiles near the center. |
| `featuredTilesMin` | number | `2` | Used when `featuredAuto=false`: minimum number of featured tiles. |
| `featuredTilesMax` | number | `3` | Used when `featuredAuto=false`: maximum number of featured tiles. |
| `featuredShuffleMinutes` | number | `10` | Periodically reshuffle which tiles are featured. Set `0` to disable. |
| `featuredCenterBand` | number | `0.5` | Used when `featuredAuto=false`: center band where featured tiles are placed. Fraction `0–1` or percent `0–100`. |
| `validImageFileExtensions` | string | `"jpg,jpeg,png,gif,webp,heic"` | Filter by allowed extensions (server-side). |
| `enableVideos` | boolean | `true` | Allow Immich video assets to appear as tiles. |
| `imageVideoRatio` | string/number | `"4:1"` | Deterministic cadence of images vs. videos (images:videos). Pattern repeats (e.g., `image,image,image,image,video`). Accepts `"4:1"` or a number `4` (interpreted as `4:1`). |
| `videoPlacement` | string | `"center"` | Where to place video tiles: `"center"`, `"featured"`, or `"any"`. |
| `videoPreferFeatured` | boolean | `true` | Prefer current featured tiles for video playback when available. |
| `videoCenterBand` | number | `null` | Center band for video placement; defaults to `featuredCenterBand` when `null`. Accepts fraction `0–1` or percent `0–100`. |
| `validVideoFileExtensions` | string | `"mp4,mov,m4v,webm,avi,mkv,3gp"` | Video extensions to include (server-side). |
| `videoMaxConcurrent` | number | `1` | Maximum number of simultaneously playing videos. |
| `videoAutoplay` | boolean | `true` | Autoplay videos if allowed by browser policy. |
| `videoMuted` | boolean | `true` | Mute videos (required for most autoplay policies). |
| `videoLoop` | boolean | `true` | Loop videos. |
| `videoPreload` | string | `"metadata"` | HTML5 `preload` behavior for video elements. |
| `enableScrolling` | boolean | `false` | When true, the mosaic scrolls upward automatically to reveal more tiles (infinite). |
| `scrollSpeedPxPerSec` | number | `18` | Vertical scroll speed in pixels per second. |
| `immichConfigs` | array | `[]` | Immich connection settings array. Provide `url`, `apiKey`, and `mode`. |
| `activeImmichConfigIndex` | number | `0` | Index into `immichConfigs` to use. |
| `lightweightMode` | boolean | `false` | Prefers smaller Immich thumbnails for images (via the module proxy) and falls back to original if necessary. Other behavior remains similar. |
| `maxTiles` | number | `160` | Upper bound for the number of tiles kept in the DOM (auto layout may choose fewer). |
| `sizeCacheMax` | number | `400` | Maximum entries for the client-side image ratio cache. |
| `sizeCacheTtlMinutes` | number | `30` | Periodically clears the ratio cache to free memory. Set `0` to disable. |

### Immich `immichConfigs[]` items

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | — | Immich base URL (e.g., `https://host:2283`). |
| `apiKey` | string | — | Immich API key (created in Immich Web). |
| `timeout` | number | `6000` | Request timeout in ms. |
| `mode` | string | `"memory"` | One of: `memory`, `album`, `search`, `random`, `anniversary`. |
| `numDaysToInclude` | number | `7` | For `memory` mode: days including today to include. |
| `albumId` | string/array | `null` | For `album` mode: album ID or array of IDs. |
| `albumName` | string/array | `null` | For `album` mode: album name(s), case-sensitive; resolved to ID. |
| `query` | object | `null` | For `search`/`random`/`anniversary`: Immich search payload additions. |
| `querySize` | number | `100` | For `search`/`random`/`anniversary`: number of assets to request. |
| `anniversaryDatesBack` | number | `3` | Anniversary: days before today to include. |
| `anniversaryDatesForward` | number | `3` | Anniversary: days after today to include. |
| `anniversaryStartYear` | number | `2020` | Anniversary: starting year. |
| `anniversaryEndYear` | number | `2025` | Anniversary: ending year. |
| `sortImagesBy` | string | `"none"` | Sorting: `name`, `created`, `modified`, `taken`, `random`, or `none`. |
| `sortImagesDescending` | boolean | `false` | Reverse sort order. |

## Static Assets

- Placeholder image: `/MMM-ImmichTileSlideShow/public/placeholder.svg`
- Screenshot: `/MMM-ImmichTileSlideShow/public/screenshot.png`

## Immich Integration

The module negotiates Immich API version and sets up internal proxies for thumbnails and (when enabled) basic video playback. Supported modes: memory, album, search, random, anniversary. It filters/sorts assets server-side and streams optimized URLs to the client for smooth tile updates.

- Images: served via module proxy using Immich thumbnails/previews. In `lightweightMode`, the proxy prefers the smaller `thumbnail` first and falls back to `preview`/original. Otherwise, it tries `preview` first, then `thumbnail`, then original.
- Videos: served as Immich encoded video (v1.x: `/assets/{id}/video`; v3+: `/assets/{id}/video/playback`) with a poster from the image thumbnail
- HTTP caching: the internal proxy forwards and preserves ETag/If-Modified-Since headers for images and videos where applicable. Clients can reuse cached responses efficiently.

### Required API-key permissions

When creating the Immich API key, grant these scopes (Immich → Account → API Keys):

| Scope | Used for |
| --- | --- |
| `album.read` | List albums and fetch album metadata (`/albums`, `/albums/{id}`) |
| `asset.read` | Album asset listing, search, memories, asset metadata (`/search/metadata`, `/search/random`, `/search/smart`, `/memories`, `/assets/{id}`) |
| `asset.view` | Thumbnails and video playback (`/assets/{id}/thumbnail`, `/assets/{id}/video/playback`) |
| `asset.download` | Original image/video (used as fallback when thumbnail/preview 404s) |
| `memory.read` | Memory Lane mode (`mode: "memory"`) |

For pre-v3 Immich servers, `asset.read` covers thumbnails/originals as well — the `asset.view` / `asset.download` split was introduced in v3.

Notes:
- Video support uses Immich's encoded video endpoint via the module's proxy. Depending on your Immich version and codec support on your device, playback may fall back to showing the poster image.
- If no Immich configuration is provided, the module renders placeholders to verify UI.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Blank screen | MagicMirror hid the `fullscreen_below` container | In fullscreen mode the module forces visibility; restart MM. Ensure no other module forcibly hides it. For inline mode, set `useFullscreenBelow: false`. |
| Footer shows “waiting for data” | Slow Immich server / API timeout | Increase `timeout` to `6000–10000`. Verify Immich URL and API key. |
| “Loaded 0 image(s)” | Album empty, wrong filter, or wrong mode | For album mode, set `albumId` or `albumName` exactly. Add `heic` to `validImageFileExtensions` if needed. Try `mode: "memory"` to validate connectivity. |
| No thumbnails | Proxy blocked or headers issue | Check network for `/immichtilesslideshow/<id>` responses (should be 200). Ensure Immich reachable from MagicMirror host. |
| Tiles overlap modules | Make the mosaic darker | Increase `overlayOpacity` (e.g., `0.4–0.6`). |
| Choppy motion | Too many large tiles or tiny device | Lower `updateInterval` frequency, reduce `featuredTilesMax`, or set `imageFit: "contain"`. |

## Raspberry Pi Tips

- Enable the built-in optimizations: `lightweightMode: true`.
- Consider disabling videos: `enableVideos: false`.
- If you keep videos, set `videoPreload: "none"` and `videoMaxConcurrent: 1`.
- Increase rotation interval: `updateInterval: 15000` or higher.
- Reduce tiles if rendering inline: set a smaller `containerHeightPx`.
- The module uses Immich thumbnails and encoded streams; if a preview/thumbnail is missing, it falls back to original.

## Compatibility

- Tested with MagicMirror² >= 2.1.0
- No external CDN resources; assets are served via the module itself.

## License

MIT — see LICENSE

### Inline (non-fullscreen) example

```js
{
  module: "MMM-ImmichTileSlideShow",
  position: "top_left",
  header: "Immich Tile Slideshow",
  config: {
    useFullscreenBelow: false,
    containerHeightPx: 360,
    autoLayout: true,
    enableScrolling: true,
    scrollSpeedPxPerSec: 18,
    showCaptions: true
  }
}
```
