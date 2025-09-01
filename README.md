# MMM-ImmichTileSlideShow

A tile-based slideshow for MagicMirror² that displays a configurable grid of images. It is designed to fetch photos from Immich (self-hosted photo app) via the module's `node_helper` and an internal proxy, but it also ships with placeholder tiles so it renders out-of-the-box with zero configuration.

- Grid layout (rows/columns, gap, fit: cover/contain)
- Rotates a random tile at a fixed interval with configurable transitions (fade/slide)
- Optional captions
- Future: Immich integration (memory/album/search/random/anniversary) similar to MMM-ImmichSlideShow

<img src="/MMM-ImmichTileSlideShow/screenshot.svg" alt="Screenshot" width="640" />

## Installation

Clone into your MagicMirror `modules/` directory:

```
cd ~/MagicMirror/modules
git clone <repo-url> MMM-ImmichTileSlideShow
cd MMM-ImmichTileSlideShow
npm install
```

No dependencies are required to render placeholders. To integrate Immich later, you will provide your Immich URL and API key in the module config.

## Configuration

Add this module to your `config/config.js`:

```js
{
  module: "MMM-ImmichTileSlideShow",
  position: "top_left", // Any region works; grid scales to container
  header: "Immich Tile Slideshow",
  config: {
    // Grid
    tileRows: 2,
    tileCols: 3,
    tileGapPx: 8,
    imageFit: "cover", // cover | contain

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
  }
}
```

See `examples/config.example.js` for another snippet.

## Options

- tileRows: number (default: 2) — number of rows in the grid.
- tileCols: number (default: 3) — number of columns in the grid.
- tileGapPx: number (default: 8) — spacing between tiles in pixels.
- imageFit: string (default: "cover") — how images fit tiles: "cover" or "contain".
- updateInterval: number (default: 10000) — milliseconds between tile swaps.
- initialStaggerMs: number (default: 250) — stagger fill timing for the initial layout.
- randomizeTiles: boolean (default: true) — rotate a random tile each interval.
- transition: string (default: "fade") — tile swap animation: "fade" or "slide".
- transitionDurationMs: number (default: 600) — animation duration in ms.
- showCaptions: boolean (default: false) — display caption overlay.
- tileInfo: array (default: ["date"]) — which fields to show: "title", "date", "album".
- immichConfigs: array (default: []) — optional Immich connection settings (future integration points).

## Static Assets

- Placeholder image: `/MMM-ImmichTileSlideShow/placeholder.svg`
- Screenshot: `/MMM-ImmichTileSlideShow/screenshot.svg`

## Immich Integration (Roadmap)

The module negotiates Immich API version and sets up an internal proxy for thumbnails. Supported modes: memory, album, search, random, anniversary. It filters/sorts images server-side and streams optimized URLs to the client for smooth tile updates.

Note: If no Immich configuration is provided, the module renders placeholders to verify UI.

## Troubleshooting

- Module shows placeholder tiles only: Ensure Immich URL and API key are valid. Integration will come next; placeholders verify UI renders correctly.
- Tiles don’t rotate: Check `updateInterval` and ensure MagicMirror timeouts aren’t blocked.
- Styling issues: Adjust `tileRows`, `tileCols`, and container position/size.

## Compatibility

- Tested with MagicMirror² >= 2.1.0
- No external CDN resources; assets are served via the module itself.

## License

MIT — see LICENSE

## Changelog

- v0.1.0 — Initial release with working grid UI and placeholders
