# MMM-ImmichTileSlideShow

A tile-based slideshow for MagicMirror² that displays a configurable grid of images. It is designed to fetch photos and (optionally) videos from Immich (self-hosted photo app) via the module's `node_helper` and internal proxies, but it also ships with placeholder tiles so it renders out-of-the-box with zero configuration.

- Grid layout (rows/columns, gap, fit: cover/contain)
- Rotates a random tile at a fixed interval with configurable transitions (fade/slide)
- Optional captions
- Optional video tiles (experimental): muted, autoplay, loop with a concurrency cap
- Immich integration (memory/album/search/random/anniversary)

<img src="/MMM-ImmichTileSlideShow/screenshot.png" alt="Screenshot" width="640" />

## Installation

Clone into your MagicMirror `modules/` directory:

```
cd ~/MagicMirror/modules
git clone <repo-url> MMM-ImmichTileSlideShow
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

Add this module to your `config/config.js`. No position is required; the module mounts to the built-in `fullscreen_below` region automatically and acts as a background behind other modules:

```js
{
  module: "MMM-ImmichTileSlideShow",
  // no position needed; module renders fullscreen background
  header: "Immich Tile Slideshow",
  config: {
    // Mosaic grid (auto-scaled by viewport)
    tileRows: 2,           // initial hint for tile count; actual layout is responsive
    tileCols: 3,           // initial hint for tile count; actual layout is responsive
    tileGapPx: 8,
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
    // enableVideos: true,            // default: false
    // imageVideoRatio: "4:1",        // images:videos selection ratio
    // videoPlacement: "center",      // center | any | featured
    // videoPreferFeatured: true,      // if featured tiles exist, prefer them
    // videoCenterBand: 0.5,           // center band width (0–1 or 0–100)
    // videoMaxConcurrent: 1,         // play at most N videos at once
    // videoAutoplay: true,
    // videoMuted: true,
    // videoLoop: true,
    // videoPreload: "metadata",      // none | metadata | auto
  }
}
```

See `examples/config.example.js` for another snippet.

## Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `debug` | boolean | `false` | Enables extra logs and shows a small on-screen status label. |
| `overlayOpacity` | number | `0.25` | Darken overlay over the mosaic. Accepts `0–1` or `0–100` (percentage). |
| `tileRows` | number | `2` | Hint for initial tile count; layout is responsive and auto-fills based on viewport. |
| `tileCols` | number | `3` | Hint for initial tile count; layout is responsive and auto-fills based on viewport. |
| `tileGapPx` | number | `8` | Spacing between tiles (px). |
| `imageFit` | string | `"cover"` | How images fit within tiles: `"cover"` or `"contain"`. |
| `updateInterval` | number | `10000` | Milliseconds between tile swaps. |
| `initialStaggerMs` | number | `250` | Stagger timing for initial tile fill (ms). |
| `randomizeTiles` | boolean | `true` | If true, rotates a random tile each interval; otherwise cycles deterministically. |
| `transition` | string | `"fade"` | Tile swap animation: `"fade"` or `"slide"`. |
| `transitionDurationMs` | number | `600` | Animation duration (ms). |
| `showCaptions` | boolean | `false` | Show caption overlay. |
| `tileInfo` | array | `["date"]` | Caption fields: any of `"title"`, `"date"`, `"album"`. |
| `featuredTilesMin` | number | `2` | Minimum number of large (2x2) featured tiles placed near the center. |
| `featuredTilesMax` | number | `3` | Maximum number of large (2x2) featured tiles placed near the center. |
| `featuredShuffleMinutes` | number | `10` | Periodically reshuffle which tiles are featured. Set `0` to disable. |
| `featuredCenterBand` | number | `0.5` | Center band (fraction or percent) where featured tiles are placed. Accepts `0–1` or `0–100`; values closer to 1 widen the center band. |
| `validImageFileExtensions` | string | `"jpg,jpeg,png,gif,webp,heic"` | Filter by allowed extensions (server-side). |
| `enableVideos` | boolean | `false` | Allow Immich video assets to appear as tiles. |
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
| `immichConfigs` | array | `[]` | Immich connection settings array. Provide `url`, `apiKey`, and `mode`. |
| `activeImmichConfigIndex` | number | `0` | Index into `immichConfigs` to use. |

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

- Placeholder image: `/MMM-ImmichTileSlideShow/placeholder.svg`
- Screenshot: `/MMM-ImmichTileSlideShow/screenshot.png`

## Immich Integration

The module negotiates Immich API version and sets up internal proxies for thumbnails and (when enabled) basic video playback. Supported modes: memory, album, search, random, anniversary. It filters/sorts assets server-side and streams optimized URLs to the client for smooth tile updates.

Notes:
- Video support uses Immich's asset video endpoint via the module's proxy. Depending on your Immich version and codec support on your device, playback may fall back to showing the poster image.
- If no Immich configuration is provided, the module renders placeholders to verify UI.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Blank screen | MagicMirror hid the `fullscreen_below` container | The module forces visibility; restart MM. Ensure no other module forcibly hides it. |
| Footer shows “waiting for data” | Slow Immich server / API timeout | Increase `timeout` to `6000–10000`. Verify Immich URL and API key. |
| “Loaded 0 image(s)” | Album empty, wrong filter, or wrong mode | For album mode, set `albumId` or `albumName` exactly. Add `heic` to `validImageFileExtensions` if needed. Try `mode: "memory"` to validate connectivity. |
| No thumbnails | Proxy blocked or headers issue | Check network for `/immichtilesslideshow/<id>` responses (should be 200). Ensure Immich reachable from MagicMirror host. |
| Tiles overlap modules | Make the mosaic darker | Increase `overlayOpacity` (e.g., `0.4–0.6`). |
| Choppy motion | Too many large tiles or tiny device | Lower `updateInterval` frequency, reduce `featuredTilesMax`, or set `imageFit: "contain"`. |

## Compatibility

- Tested with MagicMirror² >= 2.1.0
- No external CDN resources; assets are served via the module itself.

## License

MIT — see LICENSE

## Changelog

- v0.1.0 — Initial release with working grid UI and placeholders
