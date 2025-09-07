// modules/MMM-ImmichTileSlideShow/examples/config.example.js
{
  module: "MMM-ImmichTileSlideShow",
  // Inline rendering example (set useFullscreenBelow: false)
  position: "top_left",
  header: "Immich Tile Slideshow",
  config: {
    useFullscreenBelow: false,
    containerHeightPx: 360,
    autoLayout: true,
    // Grid
    // tileRows/tileCols only used when autoLayout=false; gap is auto-calculated

    // Rotation
    updateInterval: 10000,
    randomizeTiles: true,
    initialStaggerMs: 250,

    // Optional captions
    showCaptions: true,
    tileInfo: ["title", "date"],

    // Transition
    transition: "fade", // fade | slide
    transitionDurationMs: 600,

    // Optional: Immich configuration (not required for placeholders)
    // Provide your own values to enable Immich integration in a follow-up step
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
