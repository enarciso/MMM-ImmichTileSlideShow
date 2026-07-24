// modules/MMM-ImmichTileSlideShow/examples/config.example.js
//
// MMM-ImmichTileSlideShow — v2 configuration examples.
// Copy ONE of the blocks below into the `modules: []` array of your
// MagicMirror config/config.js. Each example is complete on its own.

/* ─────────────────────────────────────────────────────────────
 * 1. Minimal — mosaic of your Immich "memories", zero tuning
 * ───────────────────────────────────────────────────────────── */
{
  module: "MMM-ImmichTileSlideShow",
  config: {
    immich: {
      url: "http://your-immich-host:2283",
      apiKey: "<YOUR_API_KEY>",
      source: "memory"
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 2. Digital picture frame — one full-screen photo at a time
 * ───────────────────────────────────────────────────────────── */
{
  module: "MMM-ImmichTileSlideShow",
  config: {
    mode: "frame",
    interval: 15000,
    transition: "fade",
    captions: { fields: ["date", "album"] },
    immich: {
      url: "http://your-immich-host:2283",
      apiKey: "<YOUR_API_KEY>",
      source: "album",
      album: ["Family"],      // names and/or ids; add more to pull from several
      sort: "random"
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 3. Tile wall — uniform 4x3 grid, no blank cells (Raspberry Pi)
 * ───────────────────────────────────────────────────────────── */
{
  module: "MMM-ImmichTileSlideShow",
  config: {
    mode: "grid",
    cols: 4,
    rows: 3,
    interval: 10000,
    dim: 0.15,
    videos: { maxConcurrent: 1, preload: "none" },
    performance: { lightweight: true },
    immich: {
      url: "http://your-immich-host:2283",
      apiKey: "<YOUR_API_KEY>",
      source: "album",
      album: ["MagicMirror"], // add more entries to merge multiple albums
      sort: "random"
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 4. Full mosaic — bento-box layout with featured tiles
 * ───────────────────────────────────────────────────────────── */
{
  module: "MMM-ImmichTileSlideShow",
  config: {
    mode: "mosaic",
    tileSize: "medium",   // "small" | "medium" | "large", or px — mosaic only
    interval: 8000,
    dim: 0.35,
    featured: { min: 2, max: 4, shuffleMinutes: 10 },
    videos: { ratio: "4:1", placement: "center" },
    captions: { fields: ["date"] },
    immich: {
      url: "http://your-immich-host:2283",
      apiKey: "<YOUR_API_KEY>",
      source: "album",
      album: ["Vacations", "3acc2f44-cfe6-4ace-8267-4c440d124f7c"],
      sort: "random"
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 5. Inline (non-fullscreen) — renders inside a normal region
 * ───────────────────────────────────────────────────────────── */
{
  module: "MMM-ImmichTileSlideShow",
  position: "top_left",
  header: "Immich Tile Slideshow",
  config: {
    fullscreen: false,
    heightPx: 360,
    mode: "grid",
    cols: 3,
    rows: 2,
    scroll: { speed: 18 },
    immich: {
      url: "http://your-immich-host:2283",
      apiKey: "<YOUR_API_KEY>",
      source: "memory",
      days: 30
    }
  }
}
