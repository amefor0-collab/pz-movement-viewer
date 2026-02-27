import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import './App.css'
import {
  heatmapSettings,
  viewerColorSettings,
  zoomSettings,
} from './config/viewerSettings'

type Bounds = {
  worldW: number
  worldH: number
  mapW: number
  mapH: number
  worldMinX?: number
  worldMinY?: number
  mapScale?: number
}

type TrackSeries = {
  t: number[]
  x: number[]
  y: number[]
}

type CharacterTrack = {
  charName: string
  playerName: string
  life: {
    start: number
    end: number
  }
  track: TrackSeries
  gaps: {
    offline: Array<[number, number]>
  }
}

type TracksData = {
  meta: {
    timezone: string
    periodJST: {
      start: string
      end: string
    }
    bounds: Bounds
    offlineGapSec: number
  }
  characters: Record<string, CharacterTrack>
}

type SnapshotRecord = Record<string, unknown> & {
  name?: string
  playerName?: string
  deathCount?: number
}

type SnapshotData = {
  data?: Record<string, SnapshotRecord>
}

type Point = {
  x: number
  y: number
}

type CameraMetrics = {
  scale: number
  visibleW: number
  visibleH: number
  minX: number
  minY: number
}

type CharacterSample = {
  x: number
  y: number
  offline: boolean
  beforeStart: boolean
  afterEnd: boolean
}

type RenderedCharacter = {
  character: CharacterTrack
  sample: CharacterSample
  screenX: number
  screenY: number
}

type HeatmapCell = {
  x: number
  y: number
  count: number
  normalized: number
}

type HeatmapData = {
  cells: HeatmapCell[]
  p95: number
  maxCount: number
}

type MapManifestLowRes = {
  enabled?: boolean
  file?: string
  width?: number
  height?: number
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

type MapManifestTiles = {
  enabled?: boolean
  sizePx?: number
  levels?: MapManifestTileLevel[]
}

type MapAssetManifest = {
  lowRes?: MapManifestLowRes
  tiles?: MapManifestTiles
}

type MapViewportRect = {
  sourceX: number
  sourceY: number
  sourceRight: number
  sourceBottom: number
}

type ViewMode = 'intro' | 'map'
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
type SeekbarMode = 'full' | 'online' | 'tracked'

type PeriodRange = {
  start: number
  end: number
}

type OverlayMode = 'normal' | 'heatmap' | 'respawn' | 'death'
type ListMode = 'character' | 'player'

type TimeInterval = {
  start: number
  end: number
}

type TimelineSegment = {
  start: number
  end: number
  virtualStart: number
  virtualEnd: number
}

type CharacterTerminalType = 'death' | 'logout'

type CharacterTerminalInfo = {
  charName: string
  playerName: string
  x: number
  y: number
  terminalTime: number
  terminalType: CharacterTerminalType
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

type DeathHoverTooltip = {
  charName: string
  clientX: number
  clientY: number
}

const INTRO_HASH = '#/'
const MAP_HASH = '#/map'
const TRACKS_URL = `${import.meta.env.BASE_URL}data/tracks.json`
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/snapshot.json`
const MAP_MANIFEST_URL = `${import.meta.env.BASE_URL}data/map/manifest.json`
const MAP_ASSET_BASE_URL = `${import.meta.env.BASE_URL}data/map/`
const MAP_IMAGE_CANDIDATES = [
  `${import.meta.env.BASE_URL}data/PZfullmap.png`,
] as const
const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2024] as const
const WINDOW_PRESET_HOURS = [1, 2, 4, 6, 12, 24] as const
const TRAIL_WINDOW_SEC = 30 * 60
const MIN_WINDOW_SEC = 60 * 60
const MAX_ZOOM = 32
const HOVER_RADIUS_PX = 12
const DEATH_HIGHLIGHT_SEC = 12 * 60 * 60
const OFFLINE_THRESHOLD_SEC = 2 * 60 * 60
const TRACKED_MODE_PADDING_SEC = 5
const FIXED_PERIOD_START_SEC = Date.parse('2026-02-01T21:00:00+09:00') / 1000
const FIXED_PERIOD_END_SEC = Date.parse('2026-02-28T23:00:00+09:00') / 1000
const FALLBACK_BOUNDS: Bounds = {
  worldW: 15000 - 3000,
  worldH: 13500 - 900,
  mapW: 22562,
  mapH: 23690,
  worldMinX: 3000,
  worldMinY: 900,
  mapScale: 1.88,
}

const jstDateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const jstShortFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

let labelMeasureContext: CanvasRenderingContext2D | null = null

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getEventMarkerScale(zoom: number) {
  const safeZoom = Math.max(zoom, 1)
  return clamp(1 + Math.log2(safeZoom) * 0.16, 1, 1.8)
}

function getMapHoverTooltipStyle(tooltip: DeathHoverTooltip | null) {
  if (!tooltip || typeof window === 'undefined') {
    return undefined
  }
  const tooltipWidth = 260
  const tooltipHeight = 152
  const left = clamp(tooltip.clientX + 14, 8, window.innerWidth - tooltipWidth - 8)
  const top = clamp(tooltip.clientY + 14, 8, window.innerHeight - tooltipHeight - 8)
  return {
    left: `${left}px`,
    top: `${top}px`,
  }
}

function measureCharacterLabelWidth(text: string) {
  if (typeof document === 'undefined') {
    return text.length * 12
  }
  if (!labelMeasureContext) {
    const canvas = document.createElement('canvas')
    labelMeasureContext = canvas.getContext('2d')
  }
  if (!labelMeasureContext) {
    return text.length * 12
  }
  labelMeasureContext.font = '12px "Segoe UI", "Yu Gothic UI", sans-serif'
  return labelMeasureContext.measureText(text).width
}

function buildCharacterLabelPlacements(
  renderedCharacters: RenderedCharacter[],
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  hoveredCharacterName: string | null,
) {
  const showAllLabels = zoom >= zoomSettings.labelThreshold
  const labelHeight = 16
  const labelOffsetX = 8
  const labelOffsetY = 20
  const labelPadding = 2
  const labelPaddingX = 6
  const candidates = renderedCharacters
    .filter(
      ({ character }) => showAllLabels || hoveredCharacterName === character.charName,
    )
    .map(({ character, sample, screenX, screenY }) => ({
      charName: character.charName,
      anchorX: screenX,
      anchorY: screenY,
      alpha: sample.offline ? 0.42 : 1,
      width: measureCharacterLabelWidth(character.charName) + labelPaddingX * 2,
    }))
    .sort((a, b) => a.anchorY - b.anchorY)

  const placements: CharacterLabelPlacement[] = []
  const placed: Array<{ left: number; top: number; right: number; bottom: number }> = []

  for (const candidate of candidates) {
    const maxLeft = Math.max(2, viewportWidth - candidate.width - 2)
    const maxTop = Math.max(2, viewportHeight - labelHeight - 2)
    const left = clamp(candidate.anchorX + labelOffsetX, 2, maxLeft)
    let top = clamp(candidate.anchorY - labelOffsetY, 2, maxTop)

    let adjusted = true
    let guard = 0
    while (adjusted && guard < 24) {
      adjusted = false
      guard += 1
      for (const rect of placed) {
        const overlapX = left < rect.right && left + candidate.width > rect.left
        const overlapY = top < rect.bottom && top + labelHeight > rect.top
        if (overlapX && overlapY) {
          top = clamp(rect.bottom + labelPadding, 2, maxTop)
          adjusted = true
        }
      }
    }

    placements.push({
      charName: candidate.charName,
      anchorX: candidate.anchorX,
      anchorY: candidate.anchorY,
      left,
      top,
      width: candidate.width,
      height: labelHeight,
      alpha: candidate.alpha,
    })
    placed.push({
      left,
      top,
      right: left + candidate.width,
      bottom: top + labelHeight,
    })
  }

  return placements
}

function clampFloatingPosition(
  position: Point,
  panelWidth: number,
  panelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
): Point {
  const maxX = Math.max(padding, viewportWidth - panelWidth - padding)
  const maxY = Math.max(padding, viewportHeight - panelHeight - padding)
  return {
    x: clamp(position.x, padding, maxX),
    y: clamp(position.y, padding, maxY),
  }
}

function lowerBound(values: number[], target: number) {
  let left = 0
  let right = values.length
  while (left < right) {
    const mid = (left + right) >> 1
    if (values[mid] < target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function upperBound(values: number[], target: number) {
  let left = 0
  let right = values.length
  while (left < right) {
    const mid = (left + right) >> 1
    if (values[mid] <= target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function parseIsoToUnixSec(iso: string | undefined) {
  if (!iso) {
    return NaN
  }
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed / 1000 : NaN
}

function getPeriodRange(tracks: TracksData): PeriodRange {
  if (
    Number.isFinite(FIXED_PERIOD_START_SEC) &&
    Number.isFinite(FIXED_PERIOD_END_SEC) &&
    FIXED_PERIOD_END_SEC > FIXED_PERIOD_START_SEC
  ) {
    return {
      start: FIXED_PERIOD_START_SEC,
      end: FIXED_PERIOD_END_SEC,
    }
  }

  const startMeta = parseIsoToUnixSec(tracks.meta.periodJST?.start)
  const endMeta = parseIsoToUnixSec(tracks.meta.periodJST?.end)
  if (Number.isFinite(startMeta) && Number.isFinite(endMeta) && endMeta > startMeta) {
    return { start: startMeta, end: endMeta }
  }

  return { start: 0, end: 1 }
}

function formatJst(unixSec: number) {
  if (!Number.isFinite(unixSec)) {
    return '-'
  }
  return jstDateTimeFormatter.format(new Date(unixSec * 1000))
}

function formatJstShort(unixSec: number) {
  if (!Number.isFinite(unixSec)) {
    return '-'
  }
  return jstShortFormatter.format(new Date(unixSec * 1000))
}

function normalizePlayerName(name: string) {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : '(unknown)'
}

function normalizeBounds(rawBounds: Bounds | undefined | null): Bounds {
  if (!rawBounds) {
    return FALLBACK_BOUNDS
  }

  const hasExplicitMapTransform =
    rawBounds.worldMinX != null || rawBounds.worldMinY != null || rawBounds.mapScale != null
  if (!hasExplicitMapTransform) {
    return FALLBACK_BOUNDS
  }

  const worldW =
    Number.isFinite(rawBounds.worldW) && rawBounds.worldW > 0
      ? rawBounds.worldW
      : FALLBACK_BOUNDS.worldW
  const worldH =
    Number.isFinite(rawBounds.worldH) && rawBounds.worldH > 0
      ? rawBounds.worldH
      : FALLBACK_BOUNDS.worldH
  const mapW =
    Number.isFinite(rawBounds.mapW) && rawBounds.mapW > 0
      ? rawBounds.mapW
      : FALLBACK_BOUNDS.mapW
  const mapH =
    Number.isFinite(rawBounds.mapH) && rawBounds.mapH > 0
      ? rawBounds.mapH
      : FALLBACK_BOUNDS.mapH
  const worldMinX =
    Number.isFinite(rawBounds.worldMinX) && rawBounds.worldMinX != null
      ? rawBounds.worldMinX
      : (FALLBACK_BOUNDS.worldMinX ?? 0)
  const worldMinY =
    Number.isFinite(rawBounds.worldMinY) && rawBounds.worldMinY != null
      ? rawBounds.worldMinY
      : (FALLBACK_BOUNDS.worldMinY ?? 0)
  const mapScale =
    Number.isFinite(rawBounds.mapScale) && rawBounds.mapScale != null && rawBounds.mapScale > 0
      ? rawBounds.mapScale
      : (FALLBACK_BOUNDS.mapScale ?? 1)

  return {
    worldW,
    worldH,
    mapW,
    mapH,
    worldMinX,
    worldMinY,
    mapScale,
  }
}

function getWorldRange(bounds: Bounds) {
  const minX = bounds.worldMinX ?? 0
  const minY = bounds.worldMinY ?? 0
  return {
    minX,
    minY,
    maxX: minX + bounds.worldW,
    maxY: minY + bounds.worldH,
  }
}

function getBoundsCenter(bounds: Bounds): Point {
  const range = getWorldRange(bounds)
  return {
    x: (range.minX + range.maxX) / 2,
    y: (range.minY + range.maxY) / 2,
  }
}

function worldToMapPixel(x: number, y: number, bounds: Bounds): Point {
  const mapScale = bounds.mapScale ?? 1
  const minX = bounds.worldMinX ?? 0
  const minY = bounds.worldMinY ?? 0
  return {
    x: (x - minX) * mapScale,
    y: (y - minY) * mapScale,
  }
}

function mapPixelToWorld(px: number, py: number, bounds: Bounds): Point {
  const mapScale = bounds.mapScale ?? 1
  const minX = bounds.worldMinX ?? 0
  const minY = bounds.worldMinY ?? 0
  return {
    x: minX + px / mapScale,
    y: minY + py / mapScale,
  }
}

function resolveMapAssetUrl(path: string) {
  return `${MAP_ASSET_BASE_URL}${path.replace(/^\/+/, '')}`
}

function getMapViewportRect(bounds: Bounds, cameraMetrics: CameraMetrics): MapViewportRect {
  const worldLeft = cameraMetrics.minX
  const worldTop = cameraMetrics.minY
  const worldRight = cameraMetrics.minX + cameraMetrics.visibleW
  const worldBottom = cameraMetrics.minY + cameraMetrics.visibleH
  const sourceTopLeft = worldToMapPixel(worldLeft, worldTop, bounds)
  const sourceBottomRight = worldToMapPixel(worldRight, worldBottom, bounds)

  const sourceX = clamp(Math.floor(sourceTopLeft.x), 0, bounds.mapW - 1)
  const sourceY = clamp(Math.floor(sourceTopLeft.y), 0, bounds.mapH - 1)
  const sourceRight = clamp(Math.ceil(sourceBottomRight.x), sourceX + 1, bounds.mapW)
  const sourceBottom = clamp(Math.ceil(sourceBottomRight.y), sourceY + 1, bounds.mapH)

  return { sourceX, sourceY, sourceRight, sourceBottom }
}

function drawRasterImageFromMapRect(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  bounds: Bounds,
  cameraMetrics: CameraMetrics,
  viewportRect: MapViewportRect,
) {
  const mapScale = bounds.mapScale ?? 1
  const sourceWidth = viewportRect.sourceRight - viewportRect.sourceX
  const sourceHeight = viewportRect.sourceBottom - viewportRect.sourceY

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return
  }

  const imageScaleX = image.naturalWidth / Math.max(bounds.mapW, 1)
  const imageScaleY = image.naturalHeight / Math.max(bounds.mapH, 1)
  const imageX = clamp(
    Math.floor(viewportRect.sourceX * imageScaleX),
    0,
    Math.max(0, image.naturalWidth - 1),
  )
  const imageY = clamp(
    Math.floor(viewportRect.sourceY * imageScaleY),
    0,
    Math.max(0, image.naturalHeight - 1),
  )
  const imageRight = clamp(
    Math.ceil(viewportRect.sourceRight * imageScaleX),
    imageX + 1,
    image.naturalWidth,
  )
  const imageBottom = clamp(
    Math.ceil(viewportRect.sourceBottom * imageScaleY),
    imageY + 1,
    image.naturalHeight,
  )
  const imageWidth = imageRight - imageX
  const imageHeight = imageBottom - imageY

  if (imageWidth <= 0 || imageHeight <= 0) {
    return
  }

  const drawTopLeftWorld = mapPixelToWorld(viewportRect.sourceX, viewportRect.sourceY, bounds)
  const drawTopLeft = worldToScreen(drawTopLeftWorld.x, drawTopLeftWorld.y, cameraMetrics)
  const drawWidth = Math.max(1, (sourceWidth / mapScale) * cameraMetrics.scale)
  const drawHeight = Math.max(1, (sourceHeight / mapScale) * cameraMetrics.scale)

  context.drawImage(
    image,
    imageX,
    imageY,
    imageWidth,
    imageHeight,
    drawTopLeft.x,
    drawTopLeft.y,
    drawWidth,
    drawHeight,
  )
}

function pickTileLevel(levels: MapManifestTileLevel[], zoom: number) {
  if (levels.length === 0) {
    return null
  }
  const sorted = [...levels].sort((a, b) => b.scale - a.scale)
  if (zoom >= zoomSettings.tileDetailZoom) {
    return sorted[0]
  }
  return sorted[Math.min(1, sorted.length - 1)]
}

function getVisibleMetrics(bounds: Bounds, width: number, height: number, zoom: number) {
  const safeWidth = Math.max(width, 1)
  const safeHeight = Math.max(height, 1)
  const baseScale = Math.min(safeWidth / bounds.worldW, safeHeight / bounds.worldH)
  const scale = Math.max(baseScale * zoom, 1e-6)
  return {
    scale,
    visibleW: safeWidth / scale,
    visibleH: safeHeight / scale,
  }
}

function clampCameraCenter(
  center: Point,
  bounds: Bounds,
  _width: number,
  _height: number,
  _zoom: number,
): Point {
  const worldRange = getWorldRange(bounds)
  const clampedX = clamp(center.x, worldRange.minX, worldRange.maxX)
  const clampedY = clamp(center.y, worldRange.minY, worldRange.maxY)

  return { x: clampedX, y: clampedY }
}

function buildCameraMetrics(
  bounds: Bounds,
  width: number,
  height: number,
  zoom: number,
  center: Point,
): CameraMetrics {
  const clampedCenter = clampCameraCenter(center, bounds, width, height, zoom)
  const { scale, visibleW, visibleH } = getVisibleMetrics(bounds, width, height, zoom)
  return {
    scale,
    visibleW,
    visibleH,
    minX: clampedCenter.x - visibleW / 2,
    minY: clampedCenter.y - visibleH / 2,
  }
}

function worldToScreen(x: number, y: number, metrics: CameraMetrics): Point {
  return {
    x: (x - metrics.minX) * metrics.scale,
    y: (y - metrics.minY) * metrics.scale,
  }
}

function screenToWorld(x: number, y: number, metrics: CameraMetrics): Point {
  return {
    x: metrics.minX + x / metrics.scale,
    y: metrics.minY + y / metrics.scale,
  }
}

function isOfflineAtTime(gaps: Array<[number, number]>, time: number) {
  for (const [start, end] of gaps) {
    if (end - start < OFFLINE_THRESHOLD_SEC) {
      continue
    }
    if (time >= start && time <= end) {
      return true
    }
  }
  return false
}

function crossesOfflineGap(gaps: Array<[number, number]>, start: number, end: number) {
  for (const [gapStart, gapEnd] of gaps) {
    if (gapEnd - gapStart < OFFLINE_THRESHOLD_SEC) {
      continue
    }
    if (start < gapEnd && end > gapStart) {
      return true
    }
  }
  return false
}

function getCharacterOnlineIntervals(character: CharacterTrack): TimeInterval[] {
  const result: TimeInterval[] = []
  if (!Number.isFinite(character.life.start) || !Number.isFinite(character.life.end)) {
    return result
  }
  if (character.life.end <= character.life.start) {
    return result
  }

  const gaps = [...character.gaps.offline].sort((a, b) => a[0] - b[0])
  let cursor = character.life.start
  for (const [rawStart, rawEnd] of gaps) {
    const gapStart = clamp(rawStart, character.life.start, character.life.end)
    const gapEnd = clamp(rawEnd, character.life.start, character.life.end)
    if (gapEnd <= gapStart) {
      continue
    }
    if (gapStart > cursor) {
      result.push({ start: cursor, end: gapStart })
    }
    cursor = Math.max(cursor, gapEnd)
  }

  if (cursor < character.life.end) {
    result.push({ start: cursor, end: character.life.end })
  }
  return result
}

function mergeTimeIntervals(
  intervals: TimeInterval[],
  minStart: number,
  maxEnd: number,
): TimeInterval[] {
  if (maxEnd <= minStart) {
    return []
  }
  const normalized = intervals
    .map((interval) => ({
      start: clamp(interval.start, minStart, maxEnd),
      end: clamp(interval.end, minStart, maxEnd),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start)

  if (normalized.length === 0) {
    return []
  }

  const merged: TimeInterval[] = [normalized[0]]
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i]
    const last = merged[merged.length - 1]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}

function expandTimeIntervals(
  intervals: TimeInterval[],
  paddingSec: number,
  minStart: number,
  maxEnd: number,
) {
  return intervals.map((interval) => ({
    start: clamp(interval.start - paddingSec, minStart, maxEnd),
    end: clamp(interval.end + paddingSec, minStart, maxEnd),
  }))
}

function buildTimelineSegments(
  intervals: TimeInterval[],
  fallbackStart: number,
  fallbackEnd: number,
): TimelineSegment[] {
  const source =
    intervals.length > 0
      ? intervals
      : fallbackEnd > fallbackStart
        ? [{ start: fallbackStart, end: fallbackEnd }]
        : [{ start: 0, end: 1 }]

  let virtualStart = 0
  const segments: TimelineSegment[] = []
  for (const interval of source) {
    const duration = Math.max(interval.end - interval.start, 1e-6)
    segments.push({
      start: interval.start,
      end: interval.end,
      virtualStart,
      virtualEnd: virtualStart + duration,
    })
    virtualStart += duration
  }
  return segments
}

function mapRealToVirtualTime(realTime: number, segments: TimelineSegment[]) {
  if (segments.length === 0) {
    return 0
  }
  const first = segments[0]
  const last = segments[segments.length - 1]
  const clampedReal = clamp(realTime, first.start, last.end)

  for (const segment of segments) {
    if (clampedReal < segment.start) {
      return segment.virtualStart
    }
    if (clampedReal <= segment.end) {
      return segment.virtualStart + (clampedReal - segment.start)
    }
  }

  return last.virtualEnd
}

function mapVirtualToRealTime(virtualTime: number, segments: TimelineSegment[]) {
  if (segments.length === 0) {
    return virtualTime
  }
  const last = segments[segments.length - 1]
  const clampedVirtual = clamp(virtualTime, 0, last.virtualEnd)

  for (const segment of segments) {
    if (clampedVirtual <= segment.virtualEnd) {
      return segment.start + (clampedVirtual - segment.virtualStart)
    }
  }

  return last.end
}

function getJstDayBoundaryUnixSec(startUnixSec: number, endUnixSec: number) {
  if (!Number.isFinite(startUnixSec) || !Number.isFinite(endUnixSec) || endUnixSec <= startUnixSec) {
    return []
  }

  const boundaries: number[] = []
  const jstOffsetSec = 9 * 60 * 60
  const startJst = new Date((startUnixSec + jstOffsetSec) * 1000)
  let nextBoundary =
    Date.UTC(
      startJst.getUTCFullYear(),
      startJst.getUTCMonth(),
      startJst.getUTCDate() + 1,
      0,
      0,
      0,
    ) /
      1000 -
    jstOffsetSec

  while (nextBoundary < endUnixSec) {
    if (nextBoundary > startUnixSec) {
      boundaries.push(nextBoundary)
    }
    nextBoundary += 24 * 60 * 60
  }

  return boundaries
}

function getPointAtTime(character: CharacterTrack, time: number): CharacterSample | null {
  const times = character.track.t
  const xs = character.track.x
  const ys = character.track.y

  if (times.length === 0 || xs.length !== times.length || ys.length !== times.length) {
    return null
  }

  let x = xs[0]
  let y = ys[0]

  if (time <= times[0]) {
    x = xs[0]
    y = ys[0]
  } else if (time >= times[times.length - 1]) {
    x = xs[xs.length - 1]
    y = ys[ys.length - 1]
  } else {
    const right = upperBound(times, time)
    const i = clamp(right - 1, 0, times.length - 2)
    const t0 = times[i]
    const t1 = times[i + 1]
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const y0 = ys[i]
    const y1 = ys[i + 1]
    const span = Math.max(t1 - t0, 1e-9)
    const u = clamp((time - t0) / span, 0, 1)
    const distance = Math.hypot(x1 - x0, y1 - y0)

    if (distance > 100) {
      if (u < 0.5) {
        x = x0
        y = y0
      } else {
        x = x1
        y = y1
      }
    } else {
      x = x0 + (x1 - x0) * u
      y = y0 + (y1 - y0) * u
    }
  }

  return {
    x,
    y,
    offline: isOfflineAtTime(character.gaps.offline, time),
    beforeStart: time < character.life.start,
    afterEnd: time > character.life.end,
  }
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

function sampleGradient(
  stops: ReadonlyArray<[number, number, number]>,
  value: number,
): [number, number, number] {
  if (stops.length === 0) {
    return [0, 0, 0]
  }
  if (stops.length === 1) {
    return stops[0]
  }

  const normalized = clamp(value, 0, 1)
  const scaled = normalized * (stops.length - 1)
  const index = Math.floor(scaled)
  const local = scaled - index
  const left = stops[index]
  const right = stops[Math.min(index + 1, stops.length - 1)]

  return [
    Math.round(left[0] + (right[0] - left[0]) * local),
    Math.round(left[1] + (right[1] - left[1]) * local),
    Math.round(left[2] + (right[2] - left[2]) * local),
  ]
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
) {
  const safeAlpha = clamp(alpha, 0, 1)
  const labelHeight = 16
  const paddingX = 6
  context.font = '12px "Segoe UI", "Yu Gothic UI", sans-serif'
  const width = context.measureText(text).width + paddingX * 2
  const labelMidY = clamp(anchorY, top + 1, top + labelHeight - 1)

  context.strokeStyle = rgbaFromHex(accent, 0.68 * safeAlpha)
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(anchorX, anchorY)
  context.lineTo(left, labelMidY)
  context.stroke()

  context.fillStyle = `rgba(16, 24, 37, ${0.78 * safeAlpha})`
  context.fillRect(left, top, width, labelHeight)
  context.strokeStyle = rgbaFromHex(accent, 0.72 * safeAlpha)
  context.lineWidth = 1
  context.strokeRect(left, top, width, labelHeight)
  context.fillStyle = `rgba(255, 255, 255, ${0.98 * safeAlpha})`
  context.fillText(text, left + paddingX, top + 12)
}

function buildSnapshotIndex(snapshotData: SnapshotData | null) {
  const index = new Map<string, SnapshotRecord[]>()
  if (!snapshotData?.data) {
    return index
  }

  for (const record of Object.values(snapshotData.data)) {
    const charName = typeof record.name === 'string' ? record.name.trim() : ''
    if (!charName) {
      continue
    }
    const existing = index.get(charName)
    if (existing) {
      existing.push(record)
    } else {
      index.set(charName, [record])
    }
  }

  return index
}

function getDeathCount(record: SnapshotRecord) {
  const raw = record.deathCount
  if (typeof raw === 'number') {
    return raw
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function pickSnapshotRecord(records: SnapshotRecord[]) {
  const alive = records.find((record) => getDeathCount(record) === 0)
  return alive ?? records[0] ?? null
}

function readNumber(record: SnapshotRecord, key: string) {
  const raw = record[key]
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readString(record: SnapshotRecord, key: string) {
  const raw = record[key]
  return typeof raw === 'string' ? raw : ''
}

function formatMetric(value: number | null, fractionDigits = 0) {
  if (value == null) {
    return '-'
  }
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

function getNearestOnlineTime(character: CharacterTrack, currentTime: number) {
  const times = character.track.t
  if (times.length === 0) {
    return null
  }

  if (currentTime <= character.life.start) {
    return character.life.start
  }
  if (currentTime >= character.life.end) {
    return character.life.end
  }
  if (!isOfflineAtTime(character.gaps.offline, currentTime)) {
    return currentTime
  }

  const index = lowerBound(times, currentTime)
  const left = index > 0 ? times[index - 1] : null
  const right = index < times.length ? times[index] : null
  if (left == null) {
    return right
  }
  if (right == null) {
    return left
  }
  return Math.abs(currentTime - left) <= Math.abs(currentTime - right) ? left : right
}

function selectTrackingCharacter(candidates: CharacterTrack[], time: number) {
  if (candidates.length === 0) {
    return null
  }

  const online = candidates
    .filter((character) => {
      const sample = getPointAtTime(character, time)
      return (
        sample != null &&
        !sample.beforeStart &&
        !sample.afterEnd &&
        !sample.offline
      )
    })
    .sort((a, b) => {
      if (a.life.start !== b.life.start) {
        return b.life.start - a.life.start
      }
      return a.charName.localeCompare(b.charName, 'ja')
    })

  if (online.length > 0) {
    return online[0]
  }

  const ranked = [...candidates].sort((a, b) => {
    const distanceA = Math.min(
      Math.abs(time - a.life.start),
      Math.abs(time - a.life.end),
    )
    const distanceB = Math.min(
      Math.abs(time - b.life.start),
      Math.abs(time - b.life.end),
    )
    if (distanceA !== distanceB) {
      return distanceA - distanceB
    }
    if (a.life.end !== b.life.end) {
      return b.life.end - a.life.end
    }
    return a.charName.localeCompare(b.charName, 'ja')
  })

  return ranked[0] ?? null
}

function getNearestOnlineTimeForCharacters(
  characters: CharacterTrack[],
  currentTime: number,
) {
  let best: { character: CharacterTrack; time: number; distance: number } | null = null
  for (const character of characters) {
    const nearest = getNearestOnlineTime(character, currentTime)
    if (nearest == null) {
      continue
    }
    const distance = Math.abs(nearest - currentTime)
    if (!best || distance < best.distance) {
      best = { character, time: nearest, distance }
    }
  }
  return best
}

function getCharacterListState(
  character: CharacterTrack,
  currentTime: number,
  terminalType: CharacterTerminalType,
  terminalTime: number,
): 'online' | 'dead' | 'inactive' {
  const sample = getPointAtTime(character, currentTime)
  const isOnline =
    sample != null &&
    !sample.beforeStart &&
    !sample.afterEnd &&
    !sample.offline
  const isDeadRecent =
    terminalType === 'death' &&
    currentTime >= terminalTime &&
    currentTime <= terminalTime + DEATH_HIGHLIGHT_SEC

  if (isOnline) {
    return 'online'
  }
  if (isDeadRecent) {
    return 'dead'
  }
  return 'inactive'
}

function buildHeatmap(
  characters: CharacterTrack[],
  rangeStart: number,
  rangeEnd: number,
  cellSize: number,
): HeatmapData {
  const cellCounter = new Map<string, number>()

  for (const character of characters) {
    const times = character.track.t
    const xs = character.track.x
    const ys = character.track.y
    if (times.length === 0 || xs.length !== times.length || ys.length !== times.length) {
      continue
    }

    const start = lowerBound(times, rangeStart)
    const endExclusive = upperBound(times, rangeEnd)
    for (let i = start; i < endExclusive; i += 1) {
      const cellX = Math.floor(xs[i] / cellSize)
      const cellY = Math.floor(ys[i] / cellSize)
      const key = `${cellX}:${cellY}`
      cellCounter.set(key, (cellCounter.get(key) ?? 0) + 1)
    }
  }

  const values = [...cellCounter.values()]
  if (values.length === 0) {
    return { cells: [], p95: 1, maxCount: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const p95Index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))
  const p95 = Math.max(sorted[p95Index], 1)
  const maxCount = sorted[sorted.length - 1]

  const cells: HeatmapCell[] = []
  for (const [key, count] of cellCounter.entries()) {
    const [rawX, rawY] = key.split(':')
    const cellX = Number(rawX)
    const cellY = Number(rawY)
    cells.push({
      x: cellX * cellSize,
      y: cellY * cellSize,
      count,
      normalized: clamp(count / p95, 0, 1),
    })
  }

  return { cells, p95, maxCount }
}

function resolveViewModeFromHash(): ViewMode {
  return window.location.hash === MAP_HASH ? 'map' : 'intro'
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') {
      return 'intro'
    }
    return resolveViewModeFromHash()
  })
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [loadRequestSeq, setLoadRequestSeq] = useState(0)
  const [tracksData, setTracksData] = useState<TracksData | null>(null)
  const [snapshotData, setSnapshotData] = useState<SnapshotData | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [snapshotWarning, setSnapshotWarning] = useState('')

  const [searchTerm, setSearchTerm] = useState('')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)
  const [listMode, setListMode] = useState<ListMode>('character')
  const [expandedPlayers, setExpandedPlayers] = useState<Record<string, boolean>>({})
  const [showTips, setShowTips] = useState(true)
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('normal')
  const [seekbarMode, setSeekbarMode] = useState<SeekbarMode>('online')
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const [selectedCharacterName, setSelectedCharacterName] = useState<string | null>(null)
  const [trackedCharacterName, setTrackedCharacterName] = useState<string | null>(null)
  const [statusWindowPosition, setStatusWindowPosition] = useState<Point | null>(null)

  const [currentTime, setCurrentTime] = useState(0)
  const [windowWidthSec, setWindowWidthSec] = useState(24 * 60 * 60)
  const [focusWindowStart, setFocusWindowStart] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
  const [trailEnabled, setTrailEnabled] = useState(true)
  const [allTimeTrail, setAllTimeTrail] = useState(false)

  const [heatmapCellSize] = useState<number>(heatmapSettings.defaultCellSize)

  const [iconColor] = useState<string>(viewerColorSettings.iconColorDefault)
  const [trailColor] = useState<string>(viewerColorSettings.trailColorDefault)

  const [zoom, setZoom] = useState<number>(zoomSettings.minZoom)
  const [cameraCenter, setCameraCenter] = useState<Point>(() =>
    getBoundsCenter(FALLBACK_BOUNDS),
  )
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [hoveredCharacterName, setHoveredCharacterName] = useState<string | null>(null)
  const [characterHoverTooltip, setCharacterHoverTooltip] =
    useState<DeathHoverTooltip | null>(null)
  const [hoveredRespawnCharacterName, setHoveredRespawnCharacterName] =
    useState<string | null>(null)
  const [hoveredDeathCharacterName, setHoveredDeathCharacterName] =
    useState<string | null>(null)
  const [respawnHoverTooltip, setRespawnHoverTooltip] =
    useState<DeathHoverTooltip | null>(null)
  const [deathHoverTooltip, setDeathHoverTooltip] =
    useState<DeathHoverTooltip | null>(null)
  const statusCharacterName =
    overlayMode === 'death' && hoveredDeathCharacterName
      ? hoveredDeathCharacterName
      : selectedCharacterName

  const [mapManifestStatus, setMapManifestStatus] = useState<LoadStatus>('idle')
  const [mapManifest, setMapManifest] = useState<MapAssetManifest | null>(null)
  const [lowResStatus, setLowResStatus] = useState<LoadStatus>('idle')
  const [mapImageLoaded, setMapImageLoaded] = useState(false)
  const [mapImageError, setMapImageError] = useState(false)
  const [tileCacheTick, setTileCacheTick] = useState(0)

  const mapStageRef = useRef<HTMLDivElement | null>(null)
  const infoPanelRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const statusWindowRef = useRef<HTMLElement | null>(null)
  const lowResImageRef = useRef<HTMLImageElement | null>(null)
  const mapImageRef = useRef<HTMLImageElement | null>(null)
  const tileCacheRef = useRef<Map<string, HTMLImageElement | 'loading' | 'error'>>(new Map())
  const focusScrubRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startCenter: Point
    dragging: boolean
    hitCharacterName: string | null
  } | null>(null)
  const focusDragPointerRef = useRef<number | null>(null)
  const pressedKeysRef = useRef(new Set<string>())
  const keyHoldStartRef = useRef<number | null>(null)
  const keysHandledRef = useRef(false)
  const statusDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPos: Point
  } | null>(null)

  const bounds = useMemo(
    () => normalizeBounds(tracksData?.meta.bounds),
    [tracksData],
  )
  const period = useMemo(
    () => (tracksData ? getPeriodRange(tracksData) : { start: 0, end: 1 }),
    [tracksData],
  )
  const periodDuration = Math.max(1, period.end - period.start)
  const allCharacters = useMemo(() => {
    if (!tracksData) {
      return []
    }
    return Object.values(tracksData.characters).sort((a, b) =>
      a.charName.localeCompare(b.charName, 'ja'),
    )
  }, [tracksData])

  const trackedPlayerCharacters = useMemo(() => {
    if (!trackedCharacterName) {
      return []
    }
    const tracked = allCharacters.find((character) => character.charName === trackedCharacterName)
    if (!tracked) {
      return []
    }

    const playerName = tracked.playerName.trim()
    if (!playerName) {
      return [tracked]
    }
    return allCharacters.filter((character) => character.playerName.trim() === playerName)
  }, [allCharacters, trackedCharacterName])

  const onlineTimelineIntervals = useMemo(
    () =>
      mergeTimeIntervals(
        allCharacters.flatMap((character) => getCharacterOnlineIntervals(character)),
        period.start,
        period.end,
      ),
    [allCharacters, period.end, period.start],
  )

  const trackedTimelineIntervals = useMemo(
    () =>
      mergeTimeIntervals(
        expandTimeIntervals(
          trackedPlayerCharacters.flatMap((character) => getCharacterOnlineIntervals(character)),
          TRACKED_MODE_PADDING_SEC,
          period.start,
          period.end,
        ),
        period.start,
        period.end,
      ),
    [period.end, period.start, trackedPlayerCharacters],
  )

  const timelineSegments = useMemo(() => {
    const full = [{ start: period.start, end: period.end }]
    if (seekbarMode === 'online') {
      return buildTimelineSegments(onlineTimelineIntervals, period.start, period.end)
    }
    if (seekbarMode === 'tracked') {
      const tracked =
        trackedTimelineIntervals.length > 0 ? trackedTimelineIntervals : full
      return buildTimelineSegments(tracked, period.start, period.end)
    }
    return buildTimelineSegments(full, period.start, period.end)
  }, [
    onlineTimelineIntervals,
    period.end,
    period.start,
    seekbarMode,
    trackedTimelineIntervals,
  ])

  const timelineDuration = Math.max(
    1,
    timelineSegments[timelineSegments.length - 1]?.virtualEnd ?? periodDuration,
  )
  const minWindowSec = Math.min(MIN_WINDOW_SEC, timelineDuration)

  useEffect(() => {
    const onHashChange = () => {
      setViewMode(resolveViewModeFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (viewMode !== 'map') {
      return
    }
    if (tracksData && loadStatus === 'ready') {
      return
    }

    const controller = new AbortController()

    const loadData = async () => {
      setLoadStatus('loading')
      setErrorMessage('')
      setSnapshotWarning('')

      try {
        const tracksResponse = await fetch(TRACKS_URL, { signal: controller.signal })
        if (!tracksResponse.ok) {
          throw new Error(
            `tracks.json の読み込みに失敗しました (HTTP ${tracksResponse.status})`,
          )
        }
        const loadedTracks = (await tracksResponse.json()) as TracksData
        if (controller.signal.aborted) {
          return
        }
        const loadedBounds = normalizeBounds(loadedTracks.meta.bounds)
        setTracksData({
          ...loadedTracks,
          meta: {
            ...loadedTracks.meta,
            bounds: loadedBounds,
          },
        })

        const nextVisibility: Record<string, boolean> = {}
        for (const name of Object.keys(loadedTracks.characters)) {
          nextVisibility[name] = true
        }
        setVisibility(nextVisibility)
        setSelectedCharacterName(null)
        setTrackedCharacterName(null)
        setStatusWindowPosition(null)
        setSearchTerm('')
        setListMode('character')
        setExpandedPlayers({})
        setOverlayMode('normal')
        setSeekbarMode('online')
        setSpeedMenuOpen(false)
        setTimelineCollapsed(false)

        const loadedPeriod = getPeriodRange(loadedTracks)
        const loadedDuration = Math.max(1, loadedPeriod.end - loadedPeriod.start)
        setCurrentTime(loadedPeriod.start)
        setWindowWidthSec(Math.min(24 * 60 * 60, loadedDuration))
        setFocusWindowStart(0)
        setZoom(zoomSettings.minZoom)
        setCameraCenter(getBoundsCenter(loadedBounds))

        setLoadStatus('ready')

        try {
          const snapshotResponse = await fetch(SNAPSHOT_URL, { signal: controller.signal })
          if (!snapshotResponse.ok) {
            throw new Error(`snapshot.json HTTP ${snapshotResponse.status}`)
          }
          const loadedSnapshot = (await snapshotResponse.json()) as SnapshotData
          if (!controller.signal.aborted) {
            setSnapshotData(loadedSnapshot)
          }
        } catch {
          if (!controller.signal.aborted) {
            setSnapshotData(null)
            setSnapshotWarning(
              'snapshot.json の読み込みに失敗しました。ステータス表示は一部利用できません。',
            )
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        const message =
          error instanceof Error
            ? error.message
            : 'tracks.json の読み込みに失敗しました。'
        setErrorMessage(message)
        setLoadStatus('error')
      }
    }

    void loadData()
    return () => controller.abort()
  }, [loadRequestSeq, viewMode])

  useEffect(() => {
    if (viewMode !== 'map') {
      return
    }

    const controller = new AbortController()
    let canceled = false
    setMapManifestStatus('loading')
    setMapManifest(null)

    const loadManifest = async () => {
      try {
        const response = await fetch(MAP_MANIFEST_URL, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`manifest.json HTTP ${response.status}`)
        }

        const manifest = (await response.json()) as MapAssetManifest
        if (canceled || controller.signal.aborted) {
          return
        }
        setMapManifest(manifest)
        setMapManifestStatus('ready')
      } catch {
        if (canceled || controller.signal.aborted) {
          return
        }
        setMapManifest(null)
        setMapManifestStatus('error')
      }
    }

    void loadManifest()
    return () => {
      canceled = true
      controller.abort()
    }
  }, [viewMode])

  useEffect(() => {
    if (mapManifestStatus !== 'ready' || !mapManifest?.lowRes?.enabled || !mapManifest.lowRes.file) {
      lowResImageRef.current = null
      setLowResStatus('idle')
      return
    }

    let canceled = false
    setLowResStatus('loading')
    const image = new Image()
    image.decoding = 'async'
    image.src = resolveMapAssetUrl(mapManifest.lowRes.file)
    image.onload = () => {
      if (canceled) {
        return
      }
      lowResImageRef.current = image
      setLowResStatus('ready')
    }
    image.onerror = () => {
      if (canceled) {
        return
      }
      lowResImageRef.current = null
      setLowResStatus('error')
    }

    return () => {
      canceled = true
      lowResImageRef.current = null
    }
  }, [mapManifest, mapManifestStatus])

  useEffect(() => {
    tileCacheRef.current.clear()
    setTileCacheTick((prev) => prev + 1)
  }, [mapManifest])

  const shouldLoadFallbackMapImage =
    mapManifestStatus === 'error' ||
    (mapManifestStatus === 'ready' &&
      (!mapManifest?.lowRes?.enabled || !mapManifest.lowRes.file || lowResStatus === 'error'))

  useEffect(() => {
    if (!shouldLoadFallbackMapImage) {
      mapImageRef.current = null
      setMapImageLoaded(false)
      setMapImageError(false)
      return
    }

    let canceled = false
    setMapImageLoaded(false)
    setMapImageError(false)

    const tryLoad = (index: number) => {
      if (canceled) {
        return
      }
      if (index >= MAP_IMAGE_CANDIDATES.length) {
        mapImageRef.current = null
        setMapImageLoaded(false)
        setMapImageError(true)
        return
      }

      const image = new Image()
      image.decoding = 'async'
      image.src = MAP_IMAGE_CANDIDATES[index]
      image.onload = () => {
        if (canceled) {
          return
        }
        mapImageRef.current = image
        setMapImageLoaded(true)
        setMapImageError(false)
      }
      image.onerror = () => {
        tryLoad(index + 1)
      }
    }

    tryLoad(0)
    return () => {
      canceled = true
      mapImageRef.current = null
    }
  }, [shouldLoadFallbackMapImage])

  useEffect(() => {
    const target = mapStageRef.current
    if (!target) {
      return
    }

    const updateSize = () => {
      const rect = target.getBoundingClientRect()
      setViewportSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(target)
    return () => observer.disconnect()
  }, [loadStatus, viewMode])

  useEffect(() => {
    const stage = mapStageRef.current
    if (!stage) {
      return
    }

    const blockWheelScroll = (event: WheelEvent) => {
      event.preventDefault()
    }

    stage.addEventListener('wheel', blockWheelScroll, { passive: false })
    return () => {
      stage.removeEventListener('wheel', blockWheelScroll)
    }
  }, [loadStatus, viewMode])

  useEffect(() => {
    if (!tracksData || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return
    }
    setCameraCenter((prev) => {
      const next = clampCameraCenter(
        prev,
        bounds,
        viewportSize.width,
        viewportSize.height,
        zoom,
      )
      if (Math.abs(prev.x - next.x) < 0.0001 && Math.abs(prev.y - next.y) < 0.0001) {
        return prev
      }
      return next
    })
  }, [bounds, tracksData, viewportSize.height, viewportSize.width, zoom])

  useEffect(() => {
    if (overlayMode !== 'normal') {
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
    }
    if (overlayMode !== 'respawn') {
      setHoveredRespawnCharacterName(null)
      setRespawnHoverTooltip(null)
    }
    if (overlayMode !== 'death') {
      setHoveredDeathCharacterName(null)
      setDeathHoverTooltip(null)
    }
  }, [overlayMode])

  useEffect(() => {
    if (timelineCollapsed) {
      setSpeedMenuOpen(false)
    }
  }, [timelineCollapsed])

  useEffect(() => {
    if (!statusCharacterName || statusWindowPosition) {
      return
    }

    const panelRect = infoPanelRef.current?.getBoundingClientRect()
    const width = statusWindowRef.current?.offsetWidth ?? 320
    const height = statusWindowRef.current?.offsetHeight ?? 220
    const desiredX = panelRect ? panelRect.left : 12
    const desiredY = panelRect ? panelRect.bottom + 8 : 92
    setStatusWindowPosition(
      clampFloatingPosition(
        { x: desiredX, y: desiredY },
        width,
        height,
        window.innerWidth,
        window.innerHeight,
      ),
    )
  }, [statusCharacterName, statusWindowPosition])

  useEffect(() => {
    const onResize = () => {
      if (!statusWindowPosition) {
        return
      }
      const width = statusWindowRef.current?.offsetWidth ?? 320
      const height = statusWindowRef.current?.offsetHeight ?? 220
      setStatusWindowPosition((prev) =>
        prev
          ? clampFloatingPosition(
              prev,
              width,
              height,
              window.innerWidth,
              window.innerHeight,
            )
          : prev,
      )
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [statusWindowPosition])

  useEffect(() => {
    if (!tracksData) {
      return
    }
    setCurrentTime((prev) => clamp(prev, period.start, period.end))
    setWindowWidthSec((prev) => clamp(prev, minWindowSec, timelineDuration))
    setFocusWindowStart((prev) => {
      const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
      const maxStart = Math.max(0, timelineDuration - width)
      return clamp(prev, 0, maxStart)
    })
  }, [
    minWindowSec,
    period.start,
    tracksData,
    timelineDuration,
    windowWidthSec,
    period.end,
  ])

  useEffect(() => {
    const currentVirtualTime = mapRealToVirtualTime(currentTime, timelineSegments)
    setFocusWindowStart((prev) => {
      const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
      const maxStart = Math.max(0, timelineDuration - width)
      let nextStart = clamp(prev, 0, maxStart)
      const end = nextStart + width
      if (currentVirtualTime > end) {
        if (isPlaying && width < timelineDuration) {
          nextStart = clamp(currentVirtualTime, 0, maxStart)
        } else {
          nextStart = clamp(nextStart + (currentVirtualTime - end), 0, maxStart)
        }
      } else if (currentVirtualTime < nextStart) {
        nextStart = clamp(nextStart - (nextStart - currentVirtualTime), 0, maxStart)
      }
      if (Math.abs(nextStart - prev) < 1e-6) {
        return prev
      }
      return nextStart
    })
  }, [
    currentTime,
    isPlaying,
    minWindowSec,
    timelineDuration,
    timelineSegments,
    windowWidthSec,
  ])

  useEffect(() => {
    let rafId = 0
    let previous = performance.now()

    const onFrame = (now: number) => {
      const deltaSec = Math.min(0.1, (now - previous) / 1000)
      previous = now

      if (isPlaying) {
        let reachedEnd = false
        setCurrentTime((prev) => {
          const currentVirtual = mapRealToVirtualTime(prev, timelineSegments)
          const nextVirtual = currentVirtual + playbackSpeed * deltaSec
          if (nextVirtual >= timelineDuration) {
            reachedEnd = true
            return mapVirtualToRealTime(timelineDuration, timelineSegments)
          }
          return mapVirtualToRealTime(nextVirtual, timelineSegments)
        })
        if (reachedEnd) {
          setIsPlaying(false)
        }
      }

      rafId = window.requestAnimationFrame(onFrame)
    }

    rafId = window.requestAnimationFrame(onFrame)
    return () => window.cancelAnimationFrame(rafId)
  }, [isPlaying, playbackSpeed, timelineDuration, timelineSegments])

  useEffect(() => {
    if (!tracksData) {
      return
    }
    setCurrentTime((prev) =>
      mapVirtualToRealTime(mapRealToVirtualTime(prev, timelineSegments), timelineSegments),
    )
  }, [timelineSegments, tracksData])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (viewMode !== 'map' || loadStatus !== 'ready') {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName.toLowerCase() ?? ''
      const typing =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable
      if (typing) {
        return
      }

      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        return
      }

      event.preventDefault()
      if (!pressedKeysRef.current.has(event.code)) {
        pressedKeysRef.current.add(event.code)
        if (keyHoldStartRef.current == null) {
          keyHoldStartRef.current = performance.now()
        }
      }

      if (!keysHandledRef.current) {
        clearTrackingCharacter()
        keysHandledRef.current = true
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        return
      }
      pressedKeysRef.current.delete(event.code)
      if (pressedKeysRef.current.size === 0) {
        keyHoldStartRef.current = null
        keysHandledRef.current = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [loadStatus, viewMode])

  useEffect(() => {
    let rafId = 0
    let previous = performance.now()

    const onFrame = (now: number) => {
      const deltaSec = Math.min(0.1, (now - previous) / 1000)
      previous = now

      if (
        loadStatus === 'ready' &&
        viewMode === 'map' &&
        tracksData &&
        viewportSize.width > 0 &&
        viewportSize.height > 0 &&
        pressedKeysRef.current.size > 0
      ) {
        const holdSec =
          keyHoldStartRef.current == null ? 0 : (now - keyHoldStartRef.current) / 1000
        const accel = 1 + Math.min(holdSec * 0.9, 4)
        const metrics = getVisibleMetrics(
          bounds,
          viewportSize.width,
          viewportSize.height,
          zoom,
        )
        const oneStep = metrics.visibleW / 100
        const move = oneStep * accel * (deltaSec * 60)

        let x = 0
        let y = 0
        if (pressedKeysRef.current.has('KeyA')) {
          x -= 1
        }
        if (pressedKeysRef.current.has('KeyD')) {
          x += 1
        }
        if (pressedKeysRef.current.has('KeyW')) {
          y -= 1
        }
        if (pressedKeysRef.current.has('KeyS')) {
          y += 1
        }

        const length = Math.hypot(x, y) || 1
        const dx = (x / length) * move
        const dy = (y / length) * move

        if (dx !== 0 || dy !== 0) {
          setCameraCenter((prev) =>
            clampCameraCenter(
              { x: prev.x + dx, y: prev.y + dy },
              bounds,
              viewportSize.width,
              viewportSize.height,
              zoom,
            ),
          )
        }
      }

      rafId = window.requestAnimationFrame(onFrame)
    }

    rafId = window.requestAnimationFrame(onFrame)
    return () => window.cancelAnimationFrame(rafId)
  }, [
    bounds,
    loadStatus,
    tracksData,
    viewMode,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ])

  const visibleCharacters = useMemo(
    () => allCharacters.filter((character) => visibility[character.charName] !== false),
    [allCharacters, visibility],
  )

  const characterTerminalInfoMap = useMemo(() => {
    const grouped = new Map<string, CharacterTrack[]>()
    for (const character of allCharacters) {
      const playerKey = normalizePlayerName(character.playerName)
      const list = grouped.get(playerKey)
      if (list) {
        list.push(character)
      } else {
        grouped.set(playerKey, [character])
      }
    }

    const terminalTimeByName = new Map<string, number>()
    for (const character of allCharacters) {
      const times = character.track.t
      const fallback = character.life.end
      const terminalTime =
        times.length > 0 ? times[times.length - 1] : fallback
      terminalTimeByName.set(character.charName, terminalTime)
    }

    const infoMap = new Map<string, CharacterTerminalInfo>()
    for (const character of allCharacters) {
      const playerKey = normalizePlayerName(character.playerName)
      const siblings = grouped.get(playerKey) ?? []
      const terminalTime = terminalTimeByName.get(character.charName) ?? character.life.end
      const hasNextCharacter = siblings.some((other) => {
        if (other.charName === character.charName) {
          return false
        }
        const otherLast = terminalTimeByName.get(other.charName) ?? other.life.end
        return otherLast > terminalTime
      })
      const terminalType: CharacterTerminalType = hasNextCharacter ? 'death' : 'logout'
      const hasTrackPoint =
        character.track.t.length > 0 &&
        character.track.x.length > 0 &&
        character.track.y.length > 0
      const lastIndex = Math.max(0, character.track.t.length - 1)
      const terminalX = hasTrackPoint ? character.track.x[lastIndex] : Number.NaN
      const terminalY = hasTrackPoint ? character.track.y[lastIndex] : Number.NaN

      infoMap.set(character.charName, {
        charName: character.charName,
        playerName: character.playerName,
        x: terminalX,
        y: terminalY,
        terminalTime,
        terminalType,
      })
    }

    return infoMap
  }, [allCharacters])

  const panelCharacters = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('ja-JP')
    return allCharacters
      .filter((character) =>
        keyword
          ? character.charName.toLocaleLowerCase('ja-JP').includes(keyword)
          : true,
      )
      .map((character) => {
        const terminalInfo = characterTerminalInfoMap.get(character.charName)
        const state = getCharacterListState(
          character,
          currentTime,
          terminalInfo?.terminalType ?? 'logout',
          terminalInfo?.terminalTime ?? character.life.end,
        )
        return {
          character,
          state,
          visible: visibility[character.charName] !== false,
        }
      })
      .sort((a, b) => {
        const rank = (state: 'online' | 'dead' | 'inactive') =>
          state === 'online' ? 0 : state === 'dead' ? 1 : 2
        const rankDiff = rank(a.state) - rank(b.state)
        if (rankDiff !== 0) {
          return rankDiff
        }
        return a.character.charName.localeCompare(b.character.charName, 'ja')
      })
  }, [allCharacters, characterTerminalInfoMap, currentTime, searchTerm, visibility])

  const panelPlayers = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('ja-JP')
    const grouped = new Map<string, CharacterTrack[]>()
    for (const character of allCharacters) {
      const playerName = normalizePlayerName(character.playerName)
      const list = grouped.get(playerName)
      if (list) {
        list.push(character)
      } else {
        grouped.set(playerName, [character])
      }
    }

    const rows: Array<{
      playerName: string
      characters: CharacterTrack[]
      allCharacters: CharacterTrack[]
      state: 'online' | 'dead' | 'inactive'
      representative: CharacterTrack | null
      currentCharacterName: string
      active: boolean
      visible: boolean
      totalCount: number
    }> = []

    for (const [playerName, playerCharacters] of grouped.entries()) {
      const playerMatch = playerName.toLocaleLowerCase('ja-JP').includes(keyword)
      const filteredCharacters = keyword
        ? playerMatch
          ? playerCharacters
          : playerCharacters.filter((character) =>
              character.charName.toLocaleLowerCase('ja-JP').includes(keyword),
            )
        : playerCharacters

      if (filteredCharacters.length === 0) {
        continue
      }

      const states = playerCharacters.map((character) =>
        getCharacterListState(
          character,
          currentTime,
          characterTerminalInfoMap.get(character.charName)?.terminalType ?? 'logout',
          characterTerminalInfoMap.get(character.charName)?.terminalTime ?? character.life.end,
        ),
      )
      const hasOnline = states.includes('online')
      const hasDeadRecent = states.includes('dead')
      const state: 'online' | 'dead' | 'inactive' = hasOnline
        ? 'online'
        : hasDeadRecent
          ? 'dead'
          : 'inactive'
      const representative = selectTrackingCharacter(playerCharacters, currentTime)
      const active =
        trackedCharacterName != null &&
        playerCharacters.some((character) => character.charName === trackedCharacterName)

      rows.push({
        playerName,
        characters: filteredCharacters,
        allCharacters: playerCharacters,
        state,
        representative,
        currentCharacterName: representative?.charName ?? '-',
        active,
        visible: filteredCharacters.some(
          (character) => visibility[character.charName] !== false,
        ),
        totalCount: playerCharacters.length,
      })
    }

    return rows.sort((a, b) => {
      const rank = (state: 'online' | 'dead' | 'inactive') =>
        state === 'online' ? 0 : state === 'dead' ? 1 : 2
      const rankDiff = rank(a.state) - rank(b.state)
      if (rankDiff !== 0) {
        return rankDiff
      }
      return a.playerName.localeCompare(b.playerName, 'ja')
    })
  }, [
    allCharacters,
    characterTerminalInfoMap,
    currentTime,
    searchTerm,
    trackedCharacterName,
    visibility,
  ])

  const allCharactersChecked =
    allCharacters.length > 0 &&
    allCharacters.every((character) => visibility[character.charName] !== false)

  const trackedCharacter = useMemo(() => {
    if (!trackedCharacterName) {
      return null
    }
    return allCharacters.find((character) => character.charName === trackedCharacterName) ?? null
  }, [allCharacters, trackedCharacterName])

  const cameraMetrics = useMemo(
    () =>
      buildCameraMetrics(
        bounds,
        viewportSize.width,
        viewportSize.height,
        zoom,
        cameraCenter,
      ),
    [bounds, cameraCenter, viewportSize.height, viewportSize.width, zoom],
  )

  useEffect(() => {
    if (
      !trackedCharacter ||
      !tracksData ||
      viewportSize.width <= 0 ||
      viewportSize.height <= 0
    ) {
      return
    }

    const sample = getPointAtTime(trackedCharacter, currentTime)
    if (!sample) {
      return
    }

    setCameraCenter((prev) => {
      const next = clampCameraCenter(
        { x: sample.x, y: sample.y },
        bounds,
        viewportSize.width,
        viewportSize.height,
        zoom,
      )
      if (Math.abs(prev.x - next.x) < 0.1 && Math.abs(prev.y - next.y) < 0.1) {
        return prev
      }
      return next
    })
  }, [
    bounds,
    currentTime,
    trackedCharacter,
    tracksData,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ])

  const renderedCharacters = useMemo(() => {
    const rendered: RenderedCharacter[] = []
    for (const character of visibleCharacters) {
      const sample = getPointAtTime(character, currentTime)
      if (!sample || sample.beforeStart || sample.afterEnd) {
        continue
      }
      const screen = worldToScreen(sample.x, sample.y, cameraMetrics)
      rendered.push({
        character,
        sample,
        screenX: screen.x,
        screenY: screen.y,
      })
    }
    return rendered
  }, [cameraMetrics, currentTime, visibleCharacters])
  const characterLabelPlacements = useMemo(
    () =>
      buildCharacterLabelPlacements(
        renderedCharacters,
        viewportSize.width,
        viewportSize.height,
        zoom,
        hoveredCharacterName,
      ),
    [
      hoveredCharacterName,
      renderedCharacters,
      viewportSize.height,
      viewportSize.width,
      zoom,
    ],
  )

  const snapshotIndex = useMemo(() => buildSnapshotIndex(snapshotData), [snapshotData])
  const hoveredCharacterSnapshotRecord = useMemo(() => {
    if (!hoveredCharacterName) {
      return null
    }
    const records = snapshotIndex.get(hoveredCharacterName) ?? []
    return pickSnapshotRecord(records)
  }, [hoveredCharacterName, snapshotIndex])
  const hoveredRenderedCharacter = useMemo(
    () =>
      hoveredCharacterName
        ? renderedCharacters.find(
            ({ character }) => character.charName === hoveredCharacterName,
          ) ?? null
        : null,
    [hoveredCharacterName, renderedCharacters],
  )
  const selectedSnapshotRecord = useMemo(() => {
    if (!statusCharacterName) {
      return null
    }
    const records = snapshotIndex.get(statusCharacterName) ?? []
    return pickSnapshotRecord(records)
  }, [snapshotIndex, statusCharacterName])

  const overlayWindowRange = useMemo(() => {
    const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
    const maxStart = Math.max(0, timelineDuration - width)
    const startVirtual = width >= timelineDuration ? 0 : clamp(focusWindowStart, 0, maxStart)
    const endVirtual = startVirtual + width
    const start = mapVirtualToRealTime(startVirtual, timelineSegments)
    const end = mapVirtualToRealTime(endVirtual, timelineSegments)
    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
    }
  }, [
    focusWindowStart,
    minWindowSec,
    timelineDuration,
    timelineSegments,
    windowWidthSec,
  ])

  const heatmapData = useMemo(() => {
    if (overlayMode !== 'heatmap' || !tracksData) {
      return null
    }
    return buildHeatmap(
      allCharacters,
      overlayWindowRange.start,
      overlayWindowRange.end,
      heatmapCellSize,
    )
  }, [
    allCharacters,
    heatmapCellSize,
    overlayMode,
    overlayWindowRange.end,
    overlayWindowRange.start,
    tracksData,
  ])

  const respawnPoints = useMemo(
    () =>
      allCharacters
        .filter((character) => character.track.t.length > 0)
        .map((character) => {
          const spawnTime = character.track.t[0] ?? character.life.start
          return {
            charName: character.charName,
            playerName: character.playerName,
            x: character.track.x[0],
            y: character.track.y[0],
            spawnTime,
          }
        })
        .filter(
          (point) =>
            point.spawnTime >= overlayWindowRange.start &&
            point.spawnTime <= overlayWindowRange.end,
        ),
    [allCharacters, overlayWindowRange.end, overlayWindowRange.start],
  )
  const hoveredRespawnPoint = useMemo(() => {
    if (!hoveredRespawnCharacterName) {
      return null
    }
    return respawnPoints.find((point) => point.charName === hoveredRespawnCharacterName) ?? null
  }, [hoveredRespawnCharacterName, respawnPoints])
  const hoveredRespawnSnapshotRecord = useMemo(() => {
    if (!hoveredRespawnCharacterName) {
      return null
    }
    const records = snapshotIndex.get(hoveredRespawnCharacterName) ?? []
    return pickSnapshotRecord(records)
  }, [hoveredRespawnCharacterName, snapshotIndex])

  const deathPoints = useMemo(
    () => {
      return [...characterTerminalInfoMap.values()].filter(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.terminalTime >= overlayWindowRange.start &&
          point.terminalTime <= overlayWindowRange.end,
      )
    },
    [characterTerminalInfoMap, overlayWindowRange.end, overlayWindowRange.start],
  )
  const hoveredDeathPoint = useMemo(() => {
    if (!hoveredDeathCharacterName) {
      return null
    }
    return deathPoints.find((point) => point.charName === hoveredDeathCharacterName) ?? null
  }, [deathPoints, hoveredDeathCharacterName])
  const hoveredDeathSnapshotRecord = useMemo(() => {
    if (!hoveredDeathCharacterName) {
      return null
    }
    const records = snapshotIndex.get(hoveredDeathCharacterName) ?? []
    return pickSnapshotRecord(records)
  }, [hoveredDeathCharacterName, snapshotIndex])

  const heatmapStopRgb = useMemo(
    () => viewerColorSettings.heatmapColorStops.map((hex) => hexToRgb(hex)),
    [],
  )

  const currentTimeVirtual = useMemo(
    () => mapRealToVirtualTime(currentTime, timelineSegments),
    [currentTime, timelineSegments],
  )

  const dayBoundaryVirtualTimes = useMemo(() => {
    const boundaries = getJstDayBoundaryUnixSec(period.start, period.end)
    const deduped: number[] = []
    for (const boundary of boundaries) {
      const virtual = mapRealToVirtualTime(boundary, timelineSegments)
      if (virtual <= 0 || virtual >= timelineDuration) {
        continue
      }
      if (deduped.some((value) => Math.abs(value - virtual) < 0.25)) {
        continue
      }
      deduped.push(virtual)
    }
    return deduped
  }, [period.end, period.start, timelineDuration, timelineSegments])

  const timeWindow = useMemo(() => {
    const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
    if (width >= timelineDuration) {
      return { start: 0, end: timelineDuration }
    }
    const maxStart = timelineDuration - width
    const start = clamp(focusWindowStart, 0, maxStart)
    return { start, end: start + width }
  }, [focusWindowStart, minWindowSec, timelineDuration, windowWidthSec])

  const timeWindowReal = useMemo(
    () => ({
      start: mapVirtualToRealTime(timeWindow.start, timelineSegments),
      end: mapVirtualToRealTime(timeWindow.end, timelineSegments),
    }),
    [timeWindow.end, timeWindow.start, timelineSegments],
  )

  const scaleSliderValue = useMemo(() => {
    const minLog = Math.log(minWindowSec)
    const maxLog = Math.log(timelineDuration)
    if (Math.abs(maxLog - minLog) < 1e-9) {
      return 0
    }
    return clamp(((Math.log(windowWidthSec) - minLog) / (maxLog - minLog)) * 1000, 0, 1000)
  }, [minWindowSec, timelineDuration, windowWidthSec])

  const activeTrackedCharacterName = trackedCharacter?.charName ?? null
  const focusWindowStartPercent = clamp(
    (timeWindow.start / timelineDuration) * 100,
    0,
    100,
  )
  const focusWindowEndPercent = clamp(
    (timeWindow.end / timelineDuration) * 100,
    0,
    100,
  )
  const currentTimePercent = clamp(
    (currentTimeVirtual / timelineDuration) * 100,
    0,
    100,
  )
  const focusCurrentPercent = clamp(
    ((currentTimeVirtual - timeWindow.start) / Math.max(1, timeWindow.end - timeWindow.start)) *
      100,
    0,
    100,
  )
  const overviewDayBoundaryPercents = useMemo(
    () => dayBoundaryVirtualTimes.map((value) => clamp((value / timelineDuration) * 100, 0, 100)),
    [dayBoundaryVirtualTimes, timelineDuration],
  )
  const focusDayBoundaryPercents = useMemo(() => {
    const windowSize = Math.max(1, timeWindow.end - timeWindow.start)
    return dayBoundaryVirtualTimes
      .filter((value) => value >= timeWindow.start && value <= timeWindow.end)
      .map((value) => clamp(((value - timeWindow.start) / windowSize) * 100, 0, 100))
  }, [dayBoundaryVirtualTimes, timeWindow.end, timeWindow.start])

  useEffect(() => {
    if (overlayMode === 'normal') {
      return
    }
    setSeekbarMode('full')
    setWindowWidthSec(timelineDuration)
    setFocusWindowStart(0)
  }, [overlayMode, timelineDuration])
  const selectedTileLevel = useMemo(() => {
    if (zoom < zoomSettings.tileSwitchZoom) {
      return null
    }
    if (!mapManifest?.tiles?.enabled || !mapManifest.tiles.levels || mapManifest.tiles.levels.length === 0) {
      return null
    }
    return pickTileLevel(mapManifest.tiles.levels, zoom)
  }, [mapManifest, zoom])

  const backgroundLoading =
    mapManifestStatus === 'loading' ||
    lowResStatus === 'loading' ||
    (shouldLoadFallbackMapImage && !mapImageLoaded && !mapImageError)
  const backgroundUnavailable =
    !mapImageLoaded &&
    mapImageError &&
    (lowResStatus === 'error' || mapManifestStatus === 'error')
  const mapModeLabel = selectedTileLevel
    ? `タイル表示 (${selectedTileLevel.id})`
    : lowResStatus === 'ready'
      ? '低画質背景'
      : mapImageLoaded
        ? '単一背景画像'
        : backgroundUnavailable
          ? 'グリッド背景'
          : '背景読み込み中'
  const statusWindowStyle = statusWindowPosition
    ? { left: `${statusWindowPosition.x}px`, top: `${statusWindowPosition.y}px` }
    : undefined
  const characterTooltipStyle = getMapHoverTooltipStyle(characterHoverTooltip)
  const respawnTooltipStyle = getMapHoverTooltipStyle(respawnHoverTooltip)
  const deathTooltipStyle = getMapHoverTooltipStyle(deathHoverTooltip)

  const requestTileImage = (tileUrl: string) => {
    const cache = tileCacheRef.current
    const cached = cache.get(tileUrl)
    if (cached instanceof HTMLImageElement) {
      return cached
    }
    if (cached === 'loading' || cached === 'error') {
      return null
    }

    cache.set(tileUrl, 'loading')
    const image = new Image()
    image.decoding = 'async'
    image.src = tileUrl
    image.onload = () => {
      cache.set(tileUrl, image)
      setTileCacheTick((prev) => prev + 1)
    }
    image.onerror = () => {
      cache.set(tileUrl, 'error')
      setTileCacheTick((prev) => prev + 1)
    }
    return null
  }

  const retryLoad = () => {
    setLoadStatus('idle')
    setErrorMessage('')
    setLoadRequestSeq((prev) => prev + 1)
  }

  const startMap = () => {
    if (window.location.hash !== MAP_HASH) {
      window.location.hash = '/map'
      return
    }
    setViewMode('map')
  }

  const backToIntro = () => {
    if (window.location.hash !== INTRO_HASH) {
      window.location.hash = '/'
      return
    }
    setViewMode('intro')
  }

  const stopPlaybackForManualControl = () => {
    setIsPlaying(false)
  }

  const beginTrackingCharacter = (charName: string) => {
    setTrackedCharacterName(charName)
    setSeekbarMode('tracked')
  }

  const clearTrackingCharacter = () => {
    setTrackedCharacterName(null)
    setSeekbarMode('online')
  }

  const setAllVisibility = (nextVisible: boolean) => {
    setVisibility((prev) => {
      const next = { ...prev }
      for (const character of allCharacters) {
        next[character.charName] = nextVisible
      }
      return next
    })
  }

  const setWindowWidthBySlider = (sliderValue: number) => {
    const ratio = clamp(sliderValue / 1000, 0, 1)
    const minLog = Math.log(minWindowSec)
    const maxLog = Math.log(timelineDuration)
    const width = Math.exp(minLog + (maxLog - minLog) * ratio)
    setWindowWidthSec(clamp(width, minWindowSec, timelineDuration))
  }

  const handleFocusWheelScale = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    stopPlaybackForManualControl()
    const factor = Math.exp(event.deltaY * 0.0012)
    setWindowWidthSec((prev) => clamp(prev * factor, minWindowSec, timelineDuration))
  }

  const scrubFocusByClientX = (clientX: number) => {
    const target = focusScrubRef.current
    if (!target) {
      return
    }
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0) {
      return
    }

    const ratio = (clientX - rect.left) / rect.width
    const desiredVirtual = timeWindow.start + ratio * (timeWindow.end - timeWindow.start)
    setCurrentTime(mapVirtualToRealTime(desiredVirtual, timelineSegments))
  }

  const handleFocusPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    stopPlaybackForManualControl()
    focusDragPointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubFocusByClientX(event.clientX)
  }

  const handleFocusPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (focusDragPointerRef.current !== event.pointerId) {
      return
    }
    event.preventDefault()
    scrubFocusByClientX(event.clientX)
  }

  const handleFocusPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (focusDragPointerRef.current !== event.pointerId) {
      return
    }
    focusDragPointerRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleWheelZoom = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!tracksData || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return
    }

    event.preventDefault()

    const rect = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const pointerWorld = screenToWorld(pointerX, pointerY, cameraMetrics)
    const delta = zoomSettings.smoothWheel ? event.deltaY : Math.sign(event.deltaY) * 100
    const nextZoom = clamp(zoom * Math.exp(-delta * 0.0015), zoomSettings.minZoom, MAX_ZOOM)
    if (Math.abs(nextZoom - zoom) < 1e-8) {
      return
    }

    const nextVisible = getVisibleMetrics(
      bounds,
      viewportSize.width,
      viewportSize.height,
      nextZoom,
    )
    const ratioX = clamp(pointerX / viewportSize.width, 0, 1)
    const ratioY = clamp(pointerY / viewportSize.height, 0, 1)
    const nextCenter = clampCameraCenter(
      {
        x: pointerWorld.x + nextVisible.visibleW * (0.5 - ratioX),
        y: pointerWorld.y + nextVisible.visibleH * (0.5 - ratioY),
      },
      bounds,
      viewportSize.width,
      viewportSize.height,
      nextZoom,
    )

    setZoom(nextZoom)
    setCameraCenter(nextCenter)
  }

  const findNormalCharacterAtCanvasPoint = (x: number, y: number) => {
    for (let i = characterLabelPlacements.length - 1; i >= 0; i -= 1) {
      const label = characterLabelPlacements[i]
      if (
        x >= label.left &&
        x <= label.left + label.width &&
        y >= label.top &&
        y <= label.top + label.height
      ) {
        return label.charName
      }
    }

    let nearest: string | null = null
    let bestDistance = HOVER_RADIUS_PX * HOVER_RADIUS_PX
    for (const character of renderedCharacters) {
      const dx = character.screenX - x
      const dy = character.screenY - y
      const distance = dx * dx + dy * dy
      if (distance <= bestDistance) {
        bestDistance = distance
        nearest = character.character.charName
      }
    }
    return nearest
  }

  const findHoveredCharacter = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
      setHoveredRespawnCharacterName(null)
      setHoveredDeathCharacterName(null)
      setRespawnHoverTooltip(null)
      setDeathHoverTooltip(null)
      return
    }

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    if (overlayMode === 'respawn') {
      let nearestRespawn: string | null = null
      let bestRespawnDistance = HOVER_RADIUS_PX * HOVER_RADIUS_PX
      for (const point of respawnPoints) {
        const screen = worldToScreen(point.x, point.y, cameraMetrics)
        const dx = screen.x - x
        const dy = screen.y - y
        const distance = dx * dx + dy * dy
        if (distance <= bestRespawnDistance) {
          bestRespawnDistance = distance
          nearestRespawn = point.charName
        }
      }
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
      setHoveredRespawnCharacterName(nearestRespawn)
      setHoveredDeathCharacterName(null)
      setRespawnHoverTooltip(
        nearestRespawn
          ? {
              charName: nearestRespawn,
              clientX,
              clientY,
            }
          : null,
      )
      setDeathHoverTooltip(null)
      return
    }

    if (overlayMode === 'death') {
      let nearestDeath: string | null = null
      let bestDeathDistance = HOVER_RADIUS_PX * HOVER_RADIUS_PX
      for (const point of deathPoints) {
        const screen = worldToScreen(point.x, point.y, cameraMetrics)
        const dx = screen.x - x
        const dy = screen.y - y
        const distance = dx * dx + dy * dy
        if (distance <= bestDeathDistance) {
          bestDeathDistance = distance
          nearestDeath = point.charName
        }
      }
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
      setHoveredRespawnCharacterName(null)
      setHoveredDeathCharacterName(nearestDeath)
      setRespawnHoverTooltip(null)
      setDeathHoverTooltip(
        nearestDeath
          ? {
              charName: nearestDeath,
              clientX,
              clientY,
            }
          : null,
      )
      return
    }

    const nearest = findNormalCharacterAtCanvasPoint(x, y)

    setHoveredCharacterName(nearest)
    setCharacterHoverTooltip(
      nearest
        ? {
            charName: nearest,
            clientX,
            clientY,
          }
        : null,
    )
    setHoveredRespawnCharacterName(null)
    setHoveredDeathCharacterName(null)
    setRespawnHoverTooltip(null)
    setDeathHoverTooltip(null)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!tracksData || event.button !== 0) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const hitCharacterName =
      overlayMode === 'normal'
        ? findNormalCharacterAtCanvasPoint(
            event.clientX - rect.left,
            event.clientY - rect.top,
          )
        : null
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: cameraCenter,
      dragging: false,
      hitCharacterName,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!tracksData || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return
    }

    const drag = dragRef.current
    if (!drag) {
      findHoveredCharacter(event.clientX, event.clientY)
      return
    }
    if (drag.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    const moveDistance = Math.hypot(deltaX, deltaY)
    if (!drag.dragging) {
      if (drag.hitCharacterName && moveDistance < 5) {
        findHoveredCharacter(event.clientX, event.clientY)
        return
      }
      dragRef.current = {
        ...drag,
        dragging: true,
      }
      clearTrackingCharacter()
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
      setHoveredRespawnCharacterName(null)
      setHoveredDeathCharacterName(null)
      setRespawnHoverTooltip(null)
      setDeathHoverTooltip(null)
    }
    const worldDeltaX = deltaX / cameraMetrics.scale
    const worldDeltaY = deltaY / cameraMetrics.scale

    setCameraCenter(
      clampCameraCenter(
        {
          x: drag.startCenter.x - worldDeltaX,
          y: drag.startCenter.y - worldDeltaY,
        },
        bounds,
        viewportSize.width,
        viewportSize.height,
        zoom,
      ),
    )
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) {
      if (!drag.dragging && drag.hitCharacterName) {
        beginTrackingCharacter(drag.hitCharacterName)
        setSelectedCharacterName(drag.hitCharacterName)
        setHoveredCharacterName(drag.hitCharacterName)
        setCharacterHoverTooltip({
          charName: drag.hitCharacterName,
          clientX: event.clientX,
          clientY: event.clientY,
        })
      }
      dragRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }

  const handlePointerLostCapture = () => {
    dragRef.current = null
  }

  const handlePointerLeave = () => {
    if (!dragRef.current) {
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
      setHoveredRespawnCharacterName(null)
      setHoveredDeathCharacterName(null)
      setRespawnHoverTooltip(null)
      setDeathHoverTooltip(null)
    }
  }

  const handleStatusPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    const target = event.target as HTMLElement
    if (target.closest('button')) {
      return
    }

    const current = statusWindowPosition ?? { x: 12, y: 92 }
    statusDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPos: current,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleStatusPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = statusDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()

    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    const width = statusWindowRef.current?.offsetWidth ?? 320
    const height = statusWindowRef.current?.offsetHeight ?? 220
    setStatusWindowPosition(
      clampFloatingPosition(
        { x: drag.startPos.x + deltaX, y: drag.startPos.y + deltaY },
        width,
        height,
        window.innerWidth,
        window.innerHeight,
      ),
    )
  }

  const handleStatusPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!statusDragRef.current || statusDragRef.current.pointerId !== event.pointerId) {
      return
    }
    statusDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleStatusLostPointerCapture = () => {
    statusDragRef.current = null
  }

  useEffect(() => {
    const clearPointerDrags = () => {
      dragRef.current = null
      statusDragRef.current = null
      focusDragPointerRef.current = null
    }
    window.addEventListener('blur', clearPointerDrags)
    window.addEventListener('pointerup', clearPointerDrags)
    window.addEventListener('pointercancel', clearPointerDrags)
    return () => {
      window.removeEventListener('blur', clearPointerDrags)
      window.removeEventListener('pointerup', clearPointerDrags)
      window.removeEventListener('pointercancel', clearPointerDrags)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.max(1, Math.round(viewportSize.width * dpr))
    const pixelHeight = Math.max(1, Math.round(viewportSize.height * dpr))
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, viewportSize.width, viewportSize.height)
    context.fillStyle = '#f5f7f3'
    context.fillRect(0, 0, viewportSize.width, viewportSize.height)

    const worldRange = getWorldRange(bounds)
    const mapViewportRect = getMapViewportRect(bounds, cameraMetrics)
    const mapScale = bounds.mapScale ?? 1
    let drewBackground = false

    const lowResImage = lowResImageRef.current
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
            ((tileImage.naturalWidth / levelScale) / mapScale) * cameraMetrics.scale,
          )
          const drawHeight = Math.max(
            1,
            ((tileImage.naturalHeight / levelScale) / mapScale) * cameraMetrics.scale,
          )
          context.drawImage(tileImage, topLeft.x, topLeft.y, drawWidth, drawHeight)
          drewBackground = true
        }
      }
    }

    const mapImage = mapImageRef.current
    if (!drewBackground && mapImageLoaded && mapImage && !mapImageError) {
      drawRasterImageFromMapRect(context, mapImage, bounds, cameraMetrics, mapViewportRect)
      drewBackground = true
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

    if (overlayMode === 'heatmap' && heatmapData) {
      for (const cell of heatmapData.cells) {
        const [r, g, b] = sampleGradient(heatmapStopRgb, cell.normalized)
        const alpha = 0.15 + cell.normalized * 0.55
        const x0 = (cell.x - cameraMetrics.minX) * cameraMetrics.scale
        const y0 = (cell.y - cameraMetrics.minY) * cameraMetrics.scale
        const size = heatmapCellSize * cameraMetrics.scale
        if (
          x0 > viewportSize.width ||
          y0 > viewportSize.height ||
          x0 + size < 0 ||
          y0 + size < 0
        ) {
          continue
        }
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
        context.fillRect(x0, y0, size, size)
      }
    }

    if (overlayMode === 'respawn') {
      const markerScale = getEventMarkerScale(zoom)
      const radius = 4.1 * markerScale
      context.lineWidth = Math.max(1.2, 1.2 * markerScale)
      for (const point of respawnPoints) {
        const screen = worldToScreen(point.x, point.y, cameraMetrics)
        if (
          screen.x < -radius - 4 ||
          screen.y < -radius - 4 ||
          screen.x > viewportSize.width + radius + 4 ||
          screen.y > viewportSize.height + radius + 4
        ) {
          continue
        }
        context.fillStyle = 'rgba(24, 125, 56, 0.82)'
        context.beginPath()
        context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
        context.fill()
        context.strokeStyle = 'rgba(255, 255, 255, 0.72)'
        context.beginPath()
        context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
        context.stroke()
      }
    }

    if (overlayMode === 'death') {
      const markerScale = getEventMarkerScale(zoom)
      const crossHalf = 4 * markerScale
      const logoutRadius = 5.2 * markerScale
      for (const point of deathPoints) {
        const screen = worldToScreen(point.x, point.y, cameraMetrics)
        if (
          screen.x < -logoutRadius - 4 ||
          screen.y < -logoutRadius - 4 ||
          screen.x > viewportSize.width + logoutRadius + 4 ||
          screen.y > viewportSize.height + logoutRadius + 4
        ) {
          continue
        }
        if (point.terminalType === 'death') {
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
        } else {
          context.fillStyle = 'rgba(255, 255, 255, 0.94)'
          context.beginPath()
          context.arc(screen.x, screen.y, logoutRadius, 0, Math.PI * 2)
          context.fill()

          context.strokeStyle = 'rgba(188, 38, 38, 0.96)'
          context.lineWidth = Math.max(1.5, 1.5 * markerScale)
          context.beginPath()
          context.arc(screen.x, screen.y, logoutRadius, 0, Math.PI * 2)
          context.stroke()

          context.fillStyle = 'rgba(20, 20, 20, 0.96)'
          context.font = `bold ${Math.round(10 + (markerScale - 1) * 3)}px "Segoe UI", "Yu Gothic UI", sans-serif`
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText('?', screen.x, screen.y + 0.3)
        }
      }
      context.textAlign = 'start'
      context.textBaseline = 'alphabetic'
    }

    if (overlayMode === 'normal' && trailEnabled) {
      for (const { character } of renderedCharacters) {
        const times = character.track.t
        const xs = character.track.x
        const ys = character.track.y
        if (times.length < 2 || xs.length !== times.length || ys.length !== times.length) {
          continue
        }

        const trailStart = allTimeTrail
          ? character.life.start
          : Math.max(character.life.start, currentTime - TRAIL_WINDOW_SEC)
        const startIndex = lowerBound(times, trailStart)
        const endExclusive = upperBound(times, currentTime)
        if (endExclusive - startIndex < 2) {
          continue
        }

        context.lineWidth = 1.5
        for (let i = startIndex + 1; i < endExclusive; i += 1) {
          const t0 = times[i - 1]
          const t1 = times[i]
          if (crossesOfflineGap(character.gaps.offline, t0, t1)) {
            continue
          }

          const alpha = allTimeTrail
            ? 0.8
            : clamp(1 - (currentTime - t1) / TRAIL_WINDOW_SEC, 0, 1)
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

    if (overlayMode === 'normal') {
      for (const rendered of renderedCharacters) {
        const { character, sample, screenX, screenY } = rendered
        const alpha = sample.offline ? 0.42 : 1

        context.fillStyle = rgbaFromHex(iconColor, alpha)
        context.beginPath()
        context.arc(screenX, screenY, 3.2, 0, Math.PI * 2)
        context.fill()

        if (activeTrackedCharacterName === character.charName) {
          context.strokeStyle = 'rgba(24, 36, 56, 0.85)'
          context.lineWidth = 1.5
          context.beginPath()
          context.arc(screenX, screenY, 6.8, 0, Math.PI * 2)
          context.stroke()
        }
      }
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
        )
      }
    }
  }, [
    activeTrackedCharacterName,
    allTimeTrail,
    bounds,
    cameraMetrics,
    currentTime,
    deathPoints,
    heatmapCellSize,
    heatmapData,
    heatmapStopRgb,
    iconColor,
    lowResStatus,
    mapManifest,
    mapImageError,
    mapImageLoaded,
    overlayMode,
    characterLabelPlacements,
    renderedCharacters,
    respawnPoints,
    selectedTileLevel,
    tileCacheTick,
    trailColor,
    trailEnabled,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ])

  const characterCount = allCharacters.length

  if (viewMode === 'intro') {
    return (
      <div className="intro-screen">
        <div className="intro-card">
          <p className="intro-kicker">PZ 行動履歴ビューア</p>
          <h1>プレロード画面</h1>
          <p>
            マップ画面を開くまで <code>tracks.json</code> の読み込みは開始されません。
            <br />
            大きなデータを扱う前のプレロード画面です。
          </p>
          <button className="primary-button" onClick={startMap}>
            マップ画面を開く
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="map-screen app-shell">
      <main className="app-main">
        {loadStatus === 'loading' && (
          <section className="status-card">
            <h2>データを読み込み中...</h2>
            <p>
              <code>public/data/tracks.json</code> を取得しています。
            </p>
          </section>
        )}

        {loadStatus === 'error' && (
          <section className="status-card">
            <h2>データの読み込みに失敗しました</h2>
            <p className="error-message">{errorMessage}</p>
            <button className="primary-button" onClick={retryLoad}>
              再試行
            </button>
          </section>
        )}

        {loadStatus === 'ready' && tracksData && (
          <>
            <div className={`viewer-layout ${panelCollapsed ? 'panel-collapsed' : ''}`}>
              <aside
                className={`info-panel ${panelCollapsed ? 'collapsed' : ''}`}
                ref={infoPanelRef}
              >
                <button
                  className="panel-handle panel-toggle panel-toggle-left"
                  onClick={() => setPanelCollapsed((prev) => !prev)}
                  aria-label={panelCollapsed ? 'キャラクター一覧を開く' : 'キャラクター一覧を閉じる'}
                >
                  {panelCollapsed ? '▶' : '◀'}
                </button>
                <div className="panel-content" aria-hidden={panelCollapsed}>
                  <div className="panel-title-row">
                    <h2>{listMode === 'player' ? 'プレイヤー一覧' : 'キャラクター一覧'}</h2>
                  </div>
                  <div className="panel-controls">
                    <label className="master-visibility">
                      <input
                        type="checkbox"
                        checked={allCharactersChecked}
                        onChange={(event) => setAllVisibility(event.target.checked)}
                      />
                      全キャラ表示
                    </label>
                    <div className="list-mode-switch">
                      <button
                        className={listMode === 'player' ? 'primary-button small' : 'secondary-button small'}
                        onClick={() => setListMode('player')}
                      >
                        プレイヤー
                      </button>
                      <button
                        className={listMode === 'character' ? 'primary-button small' : 'secondary-button small'}
                        onClick={() => setListMode('character')}
                      >
                        キャラ
                      </button>
                    </div>
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder={
                        listMode === 'player'
                          ? 'プレイヤー名 / キャラ名で検索'
                          : 'キャラ名で検索'
                      }
                    />
                  </div>

                  <div className="player-list flat-list">
                    {listMode === 'character' &&
                      panelCharacters.map((row) => (
                        <button
                          className={`character-line ${row.state} ${
                            selectedCharacterName === row.character.charName ? 'selected' : ''
                          } ${row.visible ? '' : 'hidden'}`}
                          key={row.character.charName}
                          onClick={() => {
                            setSelectedCharacterName(row.character.charName)
                            beginTrackingCharacter(row.character.charName)
                            setHoveredCharacterName(null)
                            if (row.state === 'inactive') {
                              const jumpTime = getNearestOnlineTime(
                                row.character,
                                currentTime,
                              )
                              if (jumpTime != null) {
                                stopPlaybackForManualControl()
                                setCurrentTime(clamp(jumpTime, period.start, period.end))
                              }
                            }
                          }}
                        >
                          <span className="character-name">{row.character.charName}</span>
                          <span className="line-meta">
                            <span className="life-range">
                              {formatJstShort(row.character.life.start)} -{' '}
                              {formatJstShort(row.character.life.end)}
                            </span>
                          </span>
                        </button>
                      ))}

                    {listMode === 'player' &&
                      panelPlayers.map((row) => {
                        const expanded = expandedPlayers[row.playerName] === true
                        return (
                          <div
                            className={`player-entry ${row.visible ? '' : 'hidden'}`}
                            key={row.playerName}
                          >
                            <div
                              className={`player-line ${row.state} ${
                                row.active ? 'selected' : ''
                              }`}
                            >
                              <button
                                className="player-expand-button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setExpandedPlayers((prev) => ({
                                    ...prev,
                                    [row.playerName]: !expanded,
                                  }))
                                }}
                                aria-label={
                                  expanded
                                    ? `${row.playerName} のキャラを閉じる`
                                    : `${row.playerName} のキャラを開く`
                                }
                              >
                                {expanded ? '▲' : '▼'}
                              </button>
                              <button
                                className="player-main-button"
                                onClick={() => {
                                  const primary =
                                    row.representative ?? row.allCharacters[0] ?? null
                                  if (!primary) {
                                    return
                                  }
                                  setSelectedCharacterName(primary.charName)
                                  beginTrackingCharacter(primary.charName)
                                  setHoveredCharacterName(null)
                                  if (row.state === 'inactive') {
                                    const nearest = getNearestOnlineTimeForCharacters(
                                      row.allCharacters,
                                      currentTime,
                                    )
                                    if (nearest) {
                                      stopPlaybackForManualControl()
                                      setCurrentTime(
                                        clamp(nearest.time, period.start, period.end),
                                      )
                                      setSelectedCharacterName(nearest.character.charName)
                                      beginTrackingCharacter(nearest.character.charName)
                                    }
                                  }
                                }}
                              >
                                <span className="player-name-wrap">
                                  <span className="player-name">{row.playerName}</span>
                                  <span className="player-current-character">
                                    ({row.currentCharacterName})
                                  </span>
                                  {row.state === 'dead' && (
                                    <span className="new-character-tag">NewCheracter!!</span>
                                  )}
                                </span>
                                <span className="count-badge">{row.totalCount}</span>
                              </button>
                            </div>

                            {expanded && (
                              <div className="player-children">
                                {row.characters.map((character) => {
                                  const terminalInfo =
                                    characterTerminalInfoMap.get(character.charName)
                                  const childState = getCharacterListState(
                                    character,
                                    currentTime,
                                    terminalInfo?.terminalType ?? 'logout',
                                    terminalInfo?.terminalTime ?? character.life.end,
                                  )
                                  const childVisible =
                                    visibility[character.charName] !== false
                                  return (
                                    <button
                                      className={`child-character ${childState} ${
                                        selectedCharacterName === character.charName
                                          ? 'selected'
                                          : ''
                                      } ${childVisible ? '' : 'hidden'}`}
                                      key={character.charName}
                                      onClick={() => {
                                        setSelectedCharacterName(character.charName)
                                        beginTrackingCharacter(character.charName)
                                        setHoveredCharacterName(null)
                                        if (childState === 'inactive') {
                                          const jumpTime = getNearestOnlineTime(
                                            character,
                                            currentTime,
                                          )
                                          if (jumpTime != null) {
                                            stopPlaybackForManualControl()
                                            setCurrentTime(
                                              clamp(jumpTime, period.start, period.end),
                                            )
                                          }
                                        }
                                      }}
                                    >
                                      <span className="character-name">
                                        {character.charName}
                                      </span>
                                      <span className="life-range">
                                        {formatJstShort(character.life.start)} -{' '}
                                        {formatJstShort(character.life.end)}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              </aside>

              <section className="map-panel">
                <div className="map-toolbar">
                  <div className="toolbar-group">
                    <button
                      className={overlayMode === 'normal' ? 'primary-button small' : 'secondary-button small'}
                      onClick={() => setOverlayMode('normal')}
                    >
                      通常
                    </button>
                    <button
                      className={overlayMode === 'heatmap' ? 'primary-button small' : 'secondary-button small'}
                      onClick={() => setOverlayMode('heatmap')}
                    >
                      ヒートマップ
                    </button>
                    <button
                      className={overlayMode === 'respawn' ? 'primary-button small' : 'secondary-button small'}
                      onClick={() => setOverlayMode('respawn')}
                    >
                      リスポーン
                    </button>
                    <button
                      className={overlayMode === 'death' ? 'primary-button small' : 'secondary-button small'}
                      onClick={() => setOverlayMode('death')}
                    >
                      死亡位置
                    </button>
                    <button
                      className={trailEnabled ? 'primary-button small' : 'secondary-button small'}
                      onClick={() => setTrailEnabled((prev) => !prev)}
                      disabled={overlayMode !== 'normal'}
                    >
                      軌跡: {trailEnabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      className={allTimeTrail ? 'primary-button small' : 'secondary-button small'}
                      onClick={() => setAllTimeTrail((prev) => !prev)}
                      disabled={overlayMode !== 'normal'}
                    >
                      全時間表示: {allTimeTrail ? 'ON' : 'OFF'}
                    </button>
                    <button className="secondary-button small" onClick={backToIntro}>
                      戻る
                    </button>
                    {!showTips && (
                      <button
                        className="secondary-button small"
                        onClick={() => setShowTips(true)}
                      >
                        操作メモ
                      </button>
                    )}
                  </div>
                </div>

                <div className="map-stage" ref={mapStageRef}>
                  <canvas
                    ref={canvasRef}
                    onWheel={handleWheelZoom}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onLostPointerCapture={handlePointerLostCapture}
                    onPointerLeave={handlePointerLeave}
                  />
                  <div className="map-overlays">
                    <span className="pill">{characterCount} キャラ</span>
                    <span className="pill">{mapModeLabel}</span>
                    <span className="pill">ズーム {zoom.toFixed(2)}x</span>
                    <span className="pill">
                      表示モード:
                      {overlayMode === 'normal'
                        ? '通常'
                        : overlayMode === 'heatmap'
                          ? 'ヒートマップ'
                          : overlayMode === 'respawn'
                            ? 'リスポーン位置'
                            : '死亡位置'}
                    </span>
                    <span className="pill">
                      {zoom >= zoomSettings.labelThreshold
                        ? 'ラベル表示: 常時'
                        : 'ラベル表示: ホバー時のみ'}
                    </span>
                    {activeTrackedCharacterName && (
                      <span className="pill accent">
                        追跡中: {activeTrackedCharacterName}
                      </span>
                    )}
                    {backgroundLoading && (
                      <span className="pill">背景アセットを読み込み中...</span>
                    )}
                    {lowResStatus === 'error' && mapImageLoaded && (
                      <span className="pill warning">
                        低画質背景の読み込みに失敗。単一背景画像で表示中
                      </span>
                    )}
                    {backgroundUnavailable && (
                      <span className="pill warning">
                        背景アセットが読み込めません。グリッド表示で動作中
                      </span>
                    )}
                  </div>
                  {overlayMode === 'normal' &&
                    characterHoverTooltip &&
                    hoveredCharacterName &&
                    characterTooltipStyle && (
                      <div className="death-hover-tooltip" style={characterTooltipStyle}>
                        <div className="death-hover-title">{hoveredCharacterName}</div>
                        <dl className="death-hover-list">
                          <div>
                            <dt>状態</dt>
                            <dd>
                              {hoveredRenderedCharacter?.sample.offline ? 'オフライン' : 'オンライン'}
                            </dd>
                          </div>
                          <div>
                            <dt>プレイヤー</dt>
                            <dd>
                              {readString(hoveredCharacterSnapshotRecord ?? {}, 'playerName') ||
                                hoveredRenderedCharacter?.character.playerName ||
                                '-'}
                            </dd>
                          </div>
                          <div>
                            <dt>生存時間(sec)</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredCharacterSnapshotRecord ?? {}, 'survivalTime'),
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>ゾンビキル</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredCharacterSnapshotRecord ?? {}, 'zombieKills'),
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>徒歩移動</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredCharacterSnapshotRecord ?? {}, 'movementOnFoot'),
                                1,
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  {overlayMode === 'respawn' &&
                    respawnHoverTooltip &&
                    hoveredRespawnPoint &&
                    respawnTooltipStyle && (
                      <div className="death-hover-tooltip" style={respawnTooltipStyle}>
                        <div className="death-hover-title">{hoveredRespawnPoint.charName}</div>
                        <dl className="death-hover-list">
                          <div>
                            <dt>種別</dt>
                            <dd>リスポーン</dd>
                          </div>
                          <div>
                            <dt>リスポーン時刻</dt>
                            <dd>{formatJst(hoveredRespawnPoint.spawnTime)}</dd>
                          </div>
                          <div>
                            <dt>プレイヤー</dt>
                            <dd>{hoveredRespawnPoint.playerName || '-'}</dd>
                          </div>
                          <div>
                            <dt>生存時間(sec)</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredRespawnSnapshotRecord ?? {}, 'survivalTime'),
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>ゾンビキル</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredRespawnSnapshotRecord ?? {}, 'zombieKills'),
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  {overlayMode === 'death' &&
                    deathHoverTooltip &&
                    hoveredDeathPoint &&
                    deathTooltipStyle && (
                      <div className="death-hover-tooltip" style={deathTooltipStyle}>
                        <div className="death-hover-title">{hoveredDeathPoint.charName}</div>
                        <dl className="death-hover-list">
                          <div>
                            <dt>種別</dt>
                            <dd>
                              {hoveredDeathPoint.terminalType === 'death'
                                ? '死亡'
                                : 'ログアウト?'}
                            </dd>
                          </div>
                          <div>
                            <dt>
                              {hoveredDeathPoint.terminalType === 'death'
                                ? '死亡時刻'
                                : 'ログアウト?時刻'}
                            </dt>
                            <dd>{formatJst(hoveredDeathPoint.terminalTime)}</dd>
                          </div>
                          <div>
                            <dt>プレイヤー</dt>
                            <dd>{hoveredDeathPoint.playerName || '-'}</dd>
                          </div>
                          <div>
                            <dt>生存時間(sec)</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredDeathSnapshotRecord ?? {}, 'survivalTime'),
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>ゾンビキル</dt>
                            <dd>
                              {formatMetric(
                                readNumber(hoveredDeathSnapshotRecord ?? {}, 'zombieKills'),
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                </div>

                <section className={`timeline-panel ${timelineCollapsed ? 'collapsed' : ''}`}>
                  <button
                    className="panel-handle panel-toggle panel-toggle-bottom timeline-handle"
                    onClick={() => setTimelineCollapsed((prev) => !prev)}
                    aria-label={timelineCollapsed ? 'シークバーを開く' : 'シークバーを収納'}
                  >
                    {timelineCollapsed ? '▲' : '▼'}
                  </button>
                  <div className="timeline-content" aria-hidden={timelineCollapsed}>
                    <div className="timeline-main">
                      <div className="timeline-top">
                        <p className="timeline-time">{formatJst(currentTime)}</p>
                        <div className="playback-controls">
                          <button
                            className={isPlaying ? 'primary-button small' : 'secondary-button small'}
                            onClick={() => setIsPlaying((prev) => !prev)}
                          >
                            {isPlaying ? '停止' : '再生'}
                          </button>
                          <div className={`speed-menu ${speedMenuOpen ? 'open' : ''}`}>
                            <button
                              className="secondary-button small speed-current"
                              onClick={() => setSpeedMenuOpen((prev) => !prev)}
                            >
                              x{playbackSpeed}
                            </button>
                            {speedMenuOpen && (
                              <div className="speed-menu-list">
                                {PLAYBACK_SPEEDS.map((speed) => (
                                  <button
                                    className={
                                      playbackSpeed === speed
                                        ? 'primary-button small'
                                        : 'secondary-button small'
                                    }
                                    key={speed}
                                    onClick={() => {
                                      setPlaybackSpeed(speed)
                                      setSpeedMenuOpen(false)
                                    }}
                                  >
                                    x{speed}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {overlayMode === 'normal' && (
                        <div className="timeline-mode-row">
                          <span className="mode-label">時間軸</span>
                          <div className="seekbar-mode-group">
                            <button
                              className={seekbarMode === 'full' ? 'primary-button small' : 'secondary-button small'}
                              onClick={() => setSeekbarMode('full')}
                            >
                              フルタイム
                            </button>
                            <button
                              className={seekbarMode === 'online' ? 'primary-button small' : 'secondary-button small'}
                              onClick={() => setSeekbarMode('online')}
                            >
                              オンラインタイム
                            </button>
                            <button
                              className={seekbarMode === 'tracked' ? 'primary-button small' : 'secondary-button small'}
                              onClick={() => setSeekbarMode('tracked')}
                            >
                              追跡対象
                            </button>
                          </div>
                        </div>
                      )}

                      {overlayMode === 'normal' && (
                        <div className="focus-editor" onWheel={handleFocusWheelScale}>
                          <div className="focus-editor-head">
                            <span>
                              フォーカスバー（{formatJst(timeWindowReal.start)} - {formatJst(timeWindowReal.end)}）
                            </span>
                            <span className="focus-hint">
                              ホイールで拡大幅 / 端外ドラッグで繰り越し
                            </span>
                          </div>
                          <div
                            className="focus-scrub"
                            ref={focusScrubRef}
                            onPointerDown={handleFocusPointerDown}
                            onPointerMove={handleFocusPointerMove}
                            onPointerUp={handleFocusPointerUp}
                            onPointerCancel={handleFocusPointerUp}
                          >
                            <div className="focus-track-visual">
                              <div className="focus-track-grid" />
                              {focusDayBoundaryPercents.map((percent, index) => (
                                <div
                                  className="timeline-day-line"
                                  key={`focus-day-${index}-${percent.toFixed(3)}`}
                                  style={{ left: `${percent}%` }}
                                />
                              ))}
                              <div
                                className="focus-track-playhead"
                                style={{ left: `${focusCurrentPercent}%` }}
                              />
                            </div>
                            <div className="focus-scrub-hit" />
                          </div>
                        </div>
                      )}

                      <div className="window-controls">
                        <span className="window-controls-label">表示幅</span>
                        <div className="window-preset-group">
                          {WINDOW_PRESET_HOURS.map((hours) => (
                            <button
                              className="secondary-button small"
                              key={hours}
                              onClick={() => setWindowWidthSec(hours * 60 * 60)}
                              title={`${hours}時間`}
                            >
                              {hours}
                            </button>
                          ))}
                        </div>
                        <span className="window-controls-unit">時間</span>
                        <label className="zoom-inline">
                          <span>拡大率</span>
                          <input
                            className="zoom-inline-range"
                            type="range"
                            min={0}
                            max={1000}
                            step={1}
                            value={scaleSliderValue}
                            onPointerDown={stopPlaybackForManualControl}
                            onChange={(event) => setWindowWidthBySlider(Number(event.target.value))}
                          />
                        </label>
                      </div>

                      <label className="slider-label overview-label">
                        全体バー（フォーカス範囲表示）
                        <div className="overview-track">
                          {overviewDayBoundaryPercents.map((percent, index) => (
                            <div
                              className="timeline-day-line"
                              key={`overview-day-${index}-${percent.toFixed(3)}`}
                              style={{ left: `${percent}%` }}
                            />
                          ))}
                          <div
                            className="overview-window"
                            style={{
                              left: `${focusWindowStartPercent}%`,
                              width: `${Math.max(
                                focusWindowEndPercent - focusWindowStartPercent,
                                0.5,
                              )}%`,
                            }}
                          />
                          <div
                            className="overview-playhead"
                            style={{ left: `${currentTimePercent}%` }}
                          />
                        </div>
                        <input
                          className="overview-slider"
                          type="range"
                          min={0}
                          max={timelineDuration}
                          step={1}
                          value={Math.round(currentTimeVirtual)}
                          onPointerDown={stopPlaybackForManualControl}
                          onChange={(event) =>
                            setCurrentTime(
                              mapVirtualToRealTime(Number(event.target.value), timelineSegments),
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                </section>
              </section>

              {statusCharacterName != null && (
                <aside
                  className="status-window"
                  ref={statusWindowRef}
                  style={statusWindowStyle}
                >
                  <div
                    className="panel-title-row status-drag-handle"
                    onPointerDown={handleStatusPointerDown}
                    onPointerMove={handleStatusPointerMove}
                    onPointerUp={handleStatusPointerUp}
                    onPointerCancel={handleStatusPointerUp}
                    onLostPointerCapture={handleStatusLostPointerCapture}
                  >
                    <h2>キャラステータス</h2>
                    {selectedCharacterName != null && (
                      <button
                        className="secondary-button small"
                        onClick={() => setSelectedCharacterName(null)}
                        aria-label="ステータスを閉じる"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <p className="status-name">{statusCharacterName}</p>
                  {selectedSnapshotRecord ? (
                    <dl className="status-list">
                      <div>
                        <dt>プレイヤー名</dt>
                        <dd>{readString(selectedSnapshotRecord, 'playerName') || '-'}</dd>
                      </div>
                      <div>
                        <dt>生存時間(sec)</dt>
                        <dd>{formatMetric(readNumber(selectedSnapshotRecord, 'survivalTime'))}</dd>
                      </div>
                      <div>
                        <dt>ゾンビキル</dt>
                        <dd>{formatMetric(readNumber(selectedSnapshotRecord, 'zombieKills'))}</dd>
                      </div>
                      <div>
                        <dt>徒歩移動</dt>
                        <dd>
                          {formatMetric(readNumber(selectedSnapshotRecord, 'movementOnFoot'), 1)}
                        </dd>
                      </div>
                      <div>
                        <dt>車両移動</dt>
                        <dd>
                          {formatMetric(
                            readNumber(selectedSnapshotRecord, 'movementInVehicle'),
                            1,
                          )}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="muted">snapshot に該当データがありません。</p>
                  )}
                </aside>
              )}
            </div>

            {showTips && (
              <section className="tips-card">
                <div className="panel-title-row">
                  <h2>操作メモ</h2>
                  <button
                    className="secondary-button small"
                    onClick={() => setShowTips(false)}
                    aria-label="操作メモを閉じる"
                  >
                    ×
                  </button>
                </div>
                <p>
                  マウスホイール: スムーズズーム / ドラッグ: パン / WASD:
                  画面幅1/100を基準に移動（長押し加速）
                  <br />
                  WASD・ドラッグ操作で追跡モードは解除されます。
                </p>
              </section>
            )}

            {snapshotWarning && (
              <section className="snapshot-warning">
                <p>{snapshotWarning}</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App


