export const viewerColorSettings = {
  iconColorDefault: '#1f77b4',
  trailColorDefault: '#ff7f0e',
  heatmapColorStops: [
    '#313695',
    '#4575b4',
    '#74add1',
    '#abd9e9',
    '#fee090',
    '#fdae61',
    '#f46d43',
    '#d73027',
  ],
} as const

export const heatmapSettings = {
  cellSizeCandidates: [100, 10],
  defaultCellSize: 10,
  normalization: 'percentile95',
} as const

export const zoomSettings = {
  minZoom: 1,
  labelThreshold: 1.5,
  smoothWheel: true,
  tileSwitchZoom: 2.5,
  tileDetailZoom: 5.5,
} as const
