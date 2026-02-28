import { crossesOfflineGap, type CharacterTrack } from '../domain/characters.js'
import type { EventPoint, OverlayMode } from '../events/events.js'

type Point = { x: number; y: number }
type CameraMetrics = {
  scale: number
  visibleW: number
  visibleH: number
  minX: number
  minY: number
}
type Bounds = {
  mapW: number
  mapH: number
  mapScale?: number
}
type MapViewportRect = {
  sourceX: number
  sourceY: number
  sourceRight: number
  sourceBottom: number
}
type RenderedCharacter = {
  character: CharacterTrack
  sample: { offline: boolean }
  screenX: number
  screenY: number
}
type CharacterLabelPlacement = {
  charName: string
  anchorX: number
  anchorY: number
  left: number
  top: number
  width: number
  height: number
  alpha: number
}
type MapManifestTileLevel = {
  id: string
  scale: number
  width: number
  height: number
  columns: number
  rows: number
  path: string
}
type MapAssetManifest = {
  tiles?: {
    enabled?: boolean
    sizePx?: number
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  if (cleaned.length === 3) {
    const r = Number.parseInt(cleaned[0] + cleaned[0], 16)
    const g = Number.parseInt(cleaned[1] + cleaned[1], 16)
    const b = Number.parseInt(cleaned[2] + cleaned[2], 16)
    return [r, g, b]
  }
  const r = Number.parseInt(cleaned.slice(0, 2), 16)
  const g = Number.parseInt(cleaned.slice(2, 4), 16)
  const b = Number.parseInt(cleaned.slice(4, 6), 16)
  return [r, g, b]
}

function rgbaFromHex(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

function getEventMarkerScale(zoom: number) {
  const safeZoom = Math.max(zoom, 1)
  return clamp(1 + Math.log2(safeZoom) * 0.16, 1, 1.8)
}

function drawEventMarker(
  context: CanvasRenderingContext2D,
  point: EventPoint,
  cameraMetrics: CameraMetrics,
  viewportSize: { width: number; height: number },
  zoom: number,
  alpha: number,
  worldToScreen: (x: number, y: number, metrics: CameraMetrics) => Point,
) {
  if (alpha <= 0) {
    return
  }

  const markerScale = getEventMarkerScale(zoom)
  const respawnRadius = 4.1 * markerScale
  const loginRadius = 4.4 * markerScale
  const crossHalf = 4 * markerScale
  const logoutHalf = 4.6 * markerScale
  const logoutMaybeRadius = 5.2 * markerScale
  const maxRadius =
    point.kind === 'respawn'
      ? respawnRadius
      : point.kind === 'login'
        ? loginRadius
        : point.kind === 'death'
          ? crossHalf * 1.1
          : point.kind === 'logout'
            ? logoutHalf * 1.15
            : logoutMaybeRadius
  const screen = worldToScreen(point.x, point.y, cameraMetrics)

  if (
    screen.x < -maxRadius - 4 ||
    screen.y < -maxRadius - 4 ||
    screen.x > viewportSize.width + maxRadius + 4 ||
    screen.y > viewportSize.height + maxRadius + 4
  ) {
    return
  }

  context.save()
  context.globalAlpha = clamp(alpha, 0, 1)

  if (point.kind === 'respawn') {
    context.lineWidth = Math.max(1.2, 1.2 * markerScale)
    context.fillStyle = 'rgba(24, 125, 56, 0.82)'
    context.beginPath()
    context.arc(screen.x, screen.y, respawnRadius, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = 'rgba(255, 255, 255, 0.72)'
    context.beginPath()
    context.arc(screen.x, screen.y, respawnRadius, 0, Math.PI * 2)
    context.stroke()
    context.restore()
    return
  }

  if (point.kind === 'login') {
    context.lineWidth = Math.max(1.3, 1.3 * markerScale)
    context.fillStyle = 'rgba(44, 118, 224, 0.86)'
    context.beginPath()
    context.arc(screen.x, screen.y, loginRadius, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    context.beginPath()
    context.arc(screen.x, screen.y, loginRadius, 0, Math.PI * 2)
    context.stroke()
    context.restore()
    return
  }

  if (point.kind === 'death') {
    context.strokeStyle = 'rgba(20, 20, 20, 0.9)'
    context.lineWidth = Math.max(2.2, 2.6 * markerScale)
    context.beginPath()
    context.moveTo(screen.x - crossHalf * 1.05, screen.y - crossHalf * 1.05)
    context.lineTo(screen.x + crossHalf * 1.05, screen.y + crossHalf * 1.05)
    context.moveTo(screen.x + crossHalf * 1.05, screen.y - crossHalf * 1.05)
    context.lineTo(screen.x - crossHalf * 1.05, screen.y + crossHalf * 1.05)
    context.stroke()

    context.strokeStyle = 'rgba(178, 45, 45, 0.95)'
    context.lineWidth = Math.max(1.4, 1.5 * markerScale)
    context.beginPath()
    context.moveTo(screen.x - crossHalf, screen.y - crossHalf)
    context.lineTo(screen.x + crossHalf, screen.y + crossHalf)
    context.moveTo(screen.x + crossHalf, screen.y - crossHalf)
    context.lineTo(screen.x - crossHalf, screen.y + crossHalf)
    context.stroke()
    context.restore()
    return
  }

  if (point.kind === 'logout') {
    context.fillStyle = 'rgba(255, 226, 145, 0.96)'
    context.strokeStyle = 'rgba(88, 66, 12, 0.95)'
    context.lineWidth = Math.max(1.4, 1.45 * markerScale)
    context.beginPath()
    context.rect(
      screen.x - logoutHalf,
      screen.y - logoutHalf,
      logoutHalf * 2,
      logoutHalf * 2,
    )
    context.fill()
    context.stroke()

    context.strokeStyle = 'rgba(88, 66, 12, 0.95)'
    context.lineWidth = Math.max(1.3, 1.35 * markerScale)
    context.beginPath()
    context.moveTo(screen.x - logoutHalf * 0.35, screen.y)
    context.lineTo(screen.x + logoutHalf * 0.35, screen.y)
    context.lineTo(screen.x + logoutHalf * 0.1, screen.y - logoutHalf * 0.22)
    context.moveTo(screen.x + logoutHalf * 0.35, screen.y)
    context.lineTo(screen.x + logoutHalf * 0.1, screen.y + logoutHalf * 0.22)
    context.stroke()
    context.restore()
    return
  }

  context.fillStyle = 'rgba(255, 255, 255, 0.94)'
  context.beginPath()
  context.arc(screen.x, screen.y, logoutMaybeRadius, 0, Math.PI * 2)
  context.fill()

  context.strokeStyle = 'rgba(188, 38, 38, 0.96)'
  context.lineWidth = Math.max(1.5, 1.5 * markerScale)
  context.beginPath()
  context.arc(screen.x, screen.y, logoutMaybeRadius, 0, Math.PI * 2)
  context.stroke()

  context.fillStyle = 'rgba(20, 20, 20, 0.96)'
  context.font = `bold ${Math.round(10 + (markerScale - 1) * 3)}px "Segoe UI", "Yu Gothic UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('?', screen.x, screen.y + 0.3)
  context.textAlign = 'start'
  context.textBaseline = 'alphabetic'
  context.restore()
}

function drawLabel(
  context: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  anchorY: number,
  left: number,
  top: number,
  alpha: number,
  accent: string,
  tracked: boolean,
  trackingOutlineColor: string,
) {
  const safeAlpha = clamp(alpha, 0, 1)
  const labelHeight = 16
  const paddingX = 6
  const borderColor = tracked ? trackingOutlineColor : accent
  context.font = '12px "Segoe UI", "Yu Gothic UI", sans-serif'
  const width = context.measureText(text).width + paddingX * 2
  const labelMidY = clamp(anchorY, top + 1, top + labelHeight - 1)

  context.strokeStyle = rgbaFromHex(borderColor, tracked ? 0.92 * safeAlpha : 0.68 * safeAlpha)
  context.lineWidth = tracked ? 1.6 : 1
  context.beginPath()
  context.moveTo(anchorX, anchorY)
  context.lineTo(left, labelMidY)
  context.stroke()

  context.fillStyle = tracked
    ? `rgba(13, 24, 42, ${0.88 * safeAlpha})`
    : `rgba(16, 24, 37, ${0.78 * safeAlpha})`
  context.fillRect(left, top, width, labelHeight)
  context.strokeStyle = rgbaFromHex(borderColor, tracked ? 0.98 * safeAlpha : 0.72 * safeAlpha)
  context.lineWidth = tracked ? 1.6 : 1
  context.strokeRect(left, top, width, labelHeight)
  context.fillStyle = `rgba(255, 255, 255, ${0.98 * safeAlpha})`
  context.fillText(text, left + paddingX, top + 12)
}

export function renderBackgroundLayer(args: {
  context: CanvasRenderingContext2D
  worldRange: { minX: number; maxX: number; minY: number; maxY: number }
  bounds: Bounds
  cameraMetrics: CameraMetrics
  viewportSize: { width: number; height: number }
  mapViewportRect: MapViewportRect
  lowResStatus: 'idle' | 'loading' | 'ready' | 'error'
  lowResImage: HTMLImageElement | null
  selectedTileLevel: MapManifestTileLevel | null
  mapManifest: MapAssetManifest | null
  worldToScreen: (x: number, y: number, metrics: CameraMetrics) => Point
  mapPixelToWorld: (px: number, py: number, bounds: Bounds) => Point
  drawRasterImageFromMapRect: (
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    bounds: Bounds,
    cameraMetrics: CameraMetrics,
    viewportRect: MapViewportRect,
  ) => void
  requestTileImage: (tileUrl: string) => HTMLImageElement | null
  resolveMapAssetUrl: (path: string) => string
}) {
  const {
    context,
    worldRange,
    bounds,
    cameraMetrics,
    viewportSize,
    mapViewportRect,
    lowResStatus,
    lowResImage,
    selectedTileLevel,
    mapManifest,
    worldToScreen,
    mapPixelToWorld,
    drawRasterImageFromMapRect,
    requestTileImage,
    resolveMapAssetUrl,
  } = args

  let drewBackground = false

  if (lowResStatus === 'ready' && lowResImage) {
    drawRasterImageFromMapRect(context, lowResImage, bounds, cameraMetrics, mapViewportRect)
    drewBackground = true
  }

  if (
    selectedTileLevel &&
    mapManifest?.tiles?.enabled &&
    mapManifest.tiles.sizePx != null &&
    mapManifest.tiles.sizePx > 0
  ) {
    const tileSizePx = Math.max(1, Math.floor(mapManifest.tiles.sizePx))
    const levelScale = Math.max(selectedTileLevel.scale, 1e-6)
    const levelLeft = mapViewportRect.sourceX * levelScale
    const levelTop = mapViewportRect.sourceY * levelScale
    const levelRight = mapViewportRect.sourceRight * levelScale
    const levelBottom = mapViewportRect.sourceBottom * levelScale

    const maxColumn = Math.max(0, selectedTileLevel.columns - 1)
    const maxRow = Math.max(0, selectedTileLevel.rows - 1)
    const columnStart = clamp(Math.floor(levelLeft / tileSizePx), 0, maxColumn)
    const rowStart = clamp(Math.floor(levelTop / tileSizePx), 0, maxRow)
    const columnEnd = clamp(Math.floor((levelRight - 1) / tileSizePx), columnStart, maxColumn)
    const rowEnd = clamp(Math.floor((levelBottom - 1) / tileSizePx), rowStart, maxRow)

    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let column = columnStart; column <= columnEnd; column += 1) {
        const tileUrl = resolveMapAssetUrl(`${selectedTileLevel.path}/${column}_${row}.jpg`)
        const tileImage = requestTileImage(tileUrl)
        if (!tileImage) {
          continue
        }

        const tileMapX = (column * tileSizePx) / levelScale
        const tileMapY = (row * tileSizePx) / levelScale
        const topLeftWorld = mapPixelToWorld(tileMapX, tileMapY, bounds)
        const topLeft = worldToScreen(topLeftWorld.x, topLeftWorld.y, cameraMetrics)
        const drawWidth = Math.max(
          1,
          ((tileImage.naturalWidth / levelScale) / Math.max(bounds.mapScale ?? 1, 1e-6)) *
            cameraMetrics.scale,
        )
        const drawHeight = Math.max(
          1,
          ((tileImage.naturalHeight / levelScale) / Math.max(bounds.mapScale ?? 1, 1e-6)) *
            cameraMetrics.scale,
        )
        context.drawImage(tileImage, topLeft.x, topLeft.y, drawWidth, drawHeight)
        drewBackground = true
      }
    }
  }

  if (!drewBackground) {
    context.strokeStyle = 'rgba(91, 109, 133, 0.26)'
    context.lineWidth = 1
    for (let x = worldRange.minX; x <= worldRange.maxX; x += 1000) {
      const p0 = worldToScreen(x, worldRange.minY, cameraMetrics)
      const p1 = worldToScreen(x, worldRange.maxY, cameraMetrics)
      context.beginPath()
      context.moveTo(p0.x, p0.y)
      context.lineTo(p1.x, p1.y)
      context.stroke()
    }
    for (let y = worldRange.minY; y <= worldRange.maxY; y += 1000) {
      const p0 = worldToScreen(worldRange.minX, y, cameraMetrics)
      const p1 = worldToScreen(worldRange.maxX, y, cameraMetrics)
      context.beginPath()
      context.moveTo(p0.x, p0.y)
      context.lineTo(p1.x, p1.y)
      context.stroke()
    }
  }

  context.fillStyle = '#f5f7f3'
  context.globalCompositeOperation = 'destination-over'
  context.fillRect(0, 0, viewportSize.width, viewportSize.height)
  context.globalCompositeOperation = 'source-over'
}

export function renderTrailLayer(args: {
  context: CanvasRenderingContext2D
  renderedCharacters: RenderedCharacter[]
  sceneTime: number
  trailWindowSec: number
  trailColor: string
  allTimeTrail: boolean
  cameraMetrics: CameraMetrics
  worldToScreen: (x: number, y: number, metrics: CameraMetrics) => Point
}) {
  const {
    context,
    renderedCharacters,
    sceneTime,
    trailWindowSec,
    trailColor,
    allTimeTrail,
    cameraMetrics,
    worldToScreen,
  } = args

  for (const { character } of renderedCharacters) {
    const times = character.track.t
    const xs = character.track.x
    const ys = character.track.y
    if (times.length < 2 || xs.length !== times.length || ys.length !== times.length) {
      continue
    }

    const trailStart = allTimeTrail
      ? character.life.start
      : Math.max(character.life.start, sceneTime - trailWindowSec)
    const startIndex = times.findIndex((time: number) => time >= trailStart)
    const safeStartIndex = startIndex >= 0 ? startIndex : times.length
    const endExclusive = times.findIndex((time: number) => time > sceneTime)
    const safeEndExclusive = endExclusive >= 0 ? endExclusive : times.length
    if (safeEndExclusive - safeStartIndex < 2) {
      continue
    }

    context.lineWidth = 1.5
    for (let i = safeStartIndex + 1; i < safeEndExclusive; i += 1) {
      const t0 = times[i - 1]
      const t1 = times[i]
      if (crossesOfflineGap(character.gaps.offline, t0, t1)) {
        continue
      }

      const alpha = allTimeTrail ? 0.8 : clamp(1 - (sceneTime - t1) / trailWindowSec, 0, 1)
      if (alpha <= 0.02) {
        continue
      }

      const p0 = worldToScreen(xs[i - 1], ys[i - 1], cameraMetrics)
      const p1 = worldToScreen(xs[i], ys[i], cameraMetrics)
      context.strokeStyle = rgbaFromHex(trailColor, alpha * 0.85)
      context.beginPath()
      context.moveTo(p0.x, p0.y)
      context.lineTo(p1.x, p1.y)
      context.stroke()
    }
  }
}

export function renderEventLayer(args: {
  context: CanvasRenderingContext2D
  activeEventPoints: EventPoint[]
  overlayMode: OverlayMode
  currentTime: number
  overlayWindowRange: { start: number; end: number }
  playbackSpeed: number
  cameraMetrics: CameraMetrics
  viewportSize: { width: number; height: number }
  zoom: number
  worldToScreen: (x: number, y: number, metrics: CameraMetrics) => Point
  getEventMarkerAlpha: (
    point: EventPoint,
    overlayMode: OverlayMode,
    currentTime: number,
    visibleRange: { start: number; end: number },
    playbackSpeed: number,
  ) => number
}) {
  const {
    context,
    activeEventPoints,
    overlayMode,
    currentTime,
    overlayWindowRange,
    playbackSpeed,
    cameraMetrics,
    viewportSize,
    zoom,
    worldToScreen,
    getEventMarkerAlpha,
  } = args

  const sortedEventPoints = [...activeEventPoints].sort((a, b) => a.time - b.time)
  for (const point of sortedEventPoints) {
    const markerAlpha = getEventMarkerAlpha(
      point,
      overlayMode,
      currentTime,
      overlayWindowRange,
      playbackSpeed,
    )
    drawEventMarker(
      context,
      point,
      cameraMetrics,
      viewportSize,
      zoom,
      markerAlpha,
      worldToScreen,
    )
  }
}

export function renderCharacterLayer(args: {
  context: CanvasRenderingContext2D
  renderedCharacters: RenderedCharacter[]
  iconColor: string
  activeTrackedCharacterName: string | null
  trackingOutlineColor: string
}) {
  const {
    context,
    renderedCharacters,
    iconColor,
    activeTrackedCharacterName,
    trackingOutlineColor,
  } = args

  for (const rendered of renderedCharacters) {
    const { character, sample, screenX, screenY } = rendered
    const alpha = sample.offline ? 0.42 : 1

    context.fillStyle = rgbaFromHex(iconColor, alpha)
    context.beginPath()
    context.arc(screenX, screenY, 3.2, 0, Math.PI * 2)
    context.fill()

    if (activeTrackedCharacterName === character.charName) {
      context.strokeStyle = `rgba(255, 255, 255, ${0.94 * alpha})`
      context.lineWidth = 3.2
      context.beginPath()
      context.arc(screenX, screenY, 6.9, 0, Math.PI * 2)
      context.stroke()

      context.strokeStyle = rgbaFromHex(trackingOutlineColor, alpha)
      context.lineWidth = 2
      context.beginPath()
      context.arc(screenX, screenY, 6.9, 0, Math.PI * 2)
      context.stroke()
    }
  }
}

export function renderLabelLayer(args: {
  context: CanvasRenderingContext2D
  characterLabelPlacements: CharacterLabelPlacement[]
  iconColor: string
  activeTrackedCharacterName: string | null
  trackingOutlineColor: string
}) {
  const {
    context,
    characterLabelPlacements,
    iconColor,
    activeTrackedCharacterName,
    trackingOutlineColor,
  } = args

  for (const label of characterLabelPlacements) {
    drawLabel(
      context,
      label.charName,
      label.anchorX,
      label.anchorY,
      label.left,
      label.top,
      label.alpha,
      iconColor,
      label.charName === activeTrackedCharacterName,
      trackingOutlineColor,
    )
  }
}


