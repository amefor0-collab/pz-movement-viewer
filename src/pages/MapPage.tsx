import {
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import '../App.css'
import { viewerColorSettings, zoomSettings } from '../config/viewerSettings'
import {
  buildAllEventPoints as buildAllEventPointsFeature,
  buildCharacterTerminalInfoMap as buildCharacterTerminalInfoMapFeature,
  filterActiveEventPoints as filterActiveEventPointsFeature,
  getEventMarkerAlpha as getEventMarkerAlphaFeature,
  getEventKindLabel as getEventKindLabelFeature,
  getEventTimeLabel as getEventTimeLabelFeature,
  getCharacterListStateFromEvents as getCharacterListStateFromEventsFeature,
  isPlayerRespawnVisible as isPlayerRespawnVisibleFeature,
} from '../features/events/events'
import {
  getCharacterOnlineIntervals,
  getCurrentOnlineIntervalStart,
  getNearestOnlineTime,
  getNearestOnlineTimeForCharacters,
  getPointAtTime,
  selectTrackingCharacter,
} from '../features/domain/characters'
import {
  renderBackgroundLayer,
  renderCharacterLayer,
  renderEventLayer,
  renderLabelLayer,
  renderTrailLayer,
} from '../features/map/render'
import {
  buildTimelineSegments,
  createInitialTimelineState as createInitialTimelineStateFeature,
  expandTimeIntervals,
  getJstDayBoundaryUnixSec,
  getOverlayWindowRange as getOverlayWindowRangeFeature,
  getTimeWindow as getTimeWindowFeature,
  mapRealToVirtualTime,
  mapVirtualToRealTime,
  mergeTimeIntervals,
  timelineReducer as timelineReducerFeature,
} from '../features/timeline/timeline'

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

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
type SeekbarMode = 'full' | 'online' | 'tracked'
type ListSortMode = 'online' | 'name'

type PeriodRange = {
  start: number
  end: number
}

type OverlayMode = 'normal' | 'events'
type ListMode = 'character' | 'player'
type EventKind = 'respawn' | 'login' | 'logout' | 'death' | 'logoutMaybe'

type EventPoint = {
  id: string
  kind: EventKind
  charName: string
  playerName: string
  x: number
  y: number
  time: number
}

type EventHoverTooltip = {
  clientX: number
  clientY: number
  points: EventPoint[]
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

type CharacterHoverTooltip = {
  clientX: number
  clientY: number
  charNames: string[]
}

type HoveredCharacterEntry = {
  charName: string
  renderedCharacter: RenderedCharacter | null
  snapshotRecord: SnapshotRecord | null
}

const TRACKS_URL = `${import.meta.env.BASE_URL}data/tracks.json`
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/snapshot.json`
const MAP_MANIFEST_URL = `${import.meta.env.BASE_URL}data/map/manifest.json`
const MAP_ASSET_BASE_URL = `${import.meta.env.BASE_URL}data/map/`
const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192] as const
const WINDOW_PRESET_HOURS = [1, 2, 4, 6, 12, 24] as const
const TRAIL_WINDOW_SEC = 30 * 60
const MIN_WINDOW_SEC = 60 * 60
const MAX_ZOOM = 64
const HOVER_RADIUS_PX = 12
const TRACKING_OUTLINE_COLOR = '#4a87f5'
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

function getMapHoverTooltipStyle(
  tooltip: { clientX: number; clientY: number } | null,
  tooltipHeight = 152,
  tooltipWidth = 260,
) {
  if (!tooltip || typeof window === 'undefined') {
    return undefined
  }
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
  fixedCharacterName: string | null,
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
      fixed: fixedCharacterName === character.charName,
    }))

  const placements: CharacterLabelPlacement[] = []
  const placed: Array<{ left: number; top: number; right: number; bottom: number }> = []
  const fixedCandidate = candidates.find((candidate) => candidate.fixed)
  let fixedPlacement: CharacterLabelPlacement | null = null

  if (fixedCandidate) {
    const maxLeft = Math.max(2, viewportWidth - fixedCandidate.width - 2)
    const maxTop = Math.max(2, viewportHeight - labelHeight - 2)
    const left = clamp(fixedCandidate.anchorX + labelOffsetX, 2, maxLeft)
    const top = clamp(fixedCandidate.anchorY - labelOffsetY, 2, maxTop)
    fixedPlacement = {
      charName: fixedCandidate.charName,
      anchorX: fixedCandidate.anchorX,
      anchorY: fixedCandidate.anchorY,
      left,
      top,
      width: fixedCandidate.width,
      height: labelHeight,
      alpha: fixedCandidate.alpha,
    }
    placed.push({
      left,
      top,
      right: left + fixedCandidate.width,
      bottom: top + labelHeight,
    })
  }

  for (const candidate of candidates
    .filter((entry) => !entry.fixed)
    .sort((a, b) => a.anchorY - b.anchorY)) {
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

  if (fixedPlacement) {
    placements.push(fixedPlacement)
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

function MapPage() {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [loadRequestSeq, setLoadRequestSeq] = useState(0)
  const [tracksData, setTracksData] = useState<TracksData | null>(null)
  const [snapshotData, setSnapshotData] = useState<SnapshotData | null>(null)
  const [snapshotLoadStatus, setSnapshotLoadStatus] = useState<LoadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [snapshotWarning, setSnapshotWarning] = useState('')

  const [searchTerm, setSearchTerm] = useState('')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)
  const [listMode, setListMode] = useState<ListMode>('character')
  const [listSortMode, setListSortMode] = useState<ListSortMode>('online')
  const [expandedPlayers, setExpandedPlayers] = useState<Record<string, boolean>>({})
  const [showTips, setShowTips] = useState(true)
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('normal')
  const [visibleEventKinds, setVisibleEventKinds] = useState<Record<EventKind, boolean>>({
    respawn: true,
    login: true,
    logout: true,
    death: true,
    logoutMaybe: true,
  })
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const [selectedCharacterName, setSelectedCharacterName] = useState<string | null>(null)
  const [trackedCharacterName, setTrackedCharacterName] = useState<string | null>(null)
  const [statusWindowPosition, setStatusWindowPosition] = useState<Point | null>(null)

  const [timelineState, timelineDispatch] = useReducer(
    timelineReducerFeature,
    undefined,
    createInitialTimelineStateFeature,
  )
  const timelineStateRef = useRef(timelineState)
  const { currentTime, windowWidthSec, focusWindowStart, isPlaying, playbackSpeed, seekbarMode } =
    timelineState
  const setCurrentTime = (currentTime: number) =>
    timelineDispatch({ type: 'setCurrentTime', currentTime })
  const setWindowWidthSec = (windowWidthSec: number) =>
    timelineDispatch({ type: 'setWindowWidthSec', windowWidthSec })
  const setFocusWindowStart = (focusWindowStart: number) =>
    timelineDispatch({ type: 'setFocusWindowStart', focusWindowStart })
  const setIsPlaying = (isPlaying: boolean) =>
    timelineDispatch({ type: 'setPlaying', isPlaying })
  const setPlaybackSpeed = (playbackSpeed: number) =>
    timelineDispatch({ type: 'setPlaybackSpeed', playbackSpeed })
  const setSeekbarMode = (seekbarMode: SeekbarMode) =>
    timelineDispatch({ type: 'setSeekbarMode', seekbarMode })
  const [trailEnabled, setTrailEnabled] = useState(true)
  const [allTimeTrail, setAllTimeTrail] = useState(false)

  const [iconColor] = useState<string>(viewerColorSettings.iconColorDefault)
  const [trailColor] = useState<string>(viewerColorSettings.trailColorDefault)

  const [zoom, setZoom] = useState<number>(zoomSettings.minZoom)
  const [cameraCenter, setCameraCenter] = useState<Point>(() =>
    getBoundsCenter(FALLBACK_BOUNDS),
  )
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [hoveredCharacterName, setHoveredCharacterName] = useState<string | null>(null)
  const [characterHoverTooltip, setCharacterHoverTooltip] =
    useState<CharacterHoverTooltip | null>(null)
  const [eventHoverTooltip, setEventHoverTooltip] = useState<EventHoverTooltip | null>(null)
  const statusCharacterName = selectedCharacterName

  const [mapManifestStatus, setMapManifestStatus] = useState<LoadStatus>('idle')
  const [mapManifest, setMapManifest] = useState<MapAssetManifest | null>(null)
  const [lowResStatus, setLowResStatus] = useState<LoadStatus>('idle')
  const [tileCacheTick, setTileCacheTick] = useState(0)

  const mapStageRef = useRef<HTMLDivElement | null>(null)
  const infoPanelRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const statusWindowRef = useRef<HTMLElement | null>(null)
  const lowResImageRef = useRef<HTMLImageElement | null>(null)
  const tileCacheRef = useRef<Map<string, HTMLImageElement | 'loading' | 'error'>>(new Map())
  const focusScrubRef = useRef<HTMLDivElement | null>(null)
  const overviewTrackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startCenter: Point
    dragging: boolean
    hitCharacterName: string | null
  } | null>(null)
  const focusDragPointerRef = useRef<number | null>(null)
  const overviewScrubPointerRef = useRef<number | null>(null)
  const overviewWindowDragRef = useRef<{
    pointerId: number
    startClientX: number
    startWindowStart: number
    width: number
    currentOffset: number
  } | null>(null)
  const lastNonFullWindowWidthRef = useRef(24 * 60 * 60)
  const previousOverlayModeRef = useRef<OverlayMode>('normal')
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

  const trackingAnchorCharacter = useMemo(() => {
    if (!trackedCharacterName) {
      return null
    }
    return allCharacters.find((character) => character.charName === trackedCharacterName) ?? null
  }, [allCharacters, trackedCharacterName])

  const trackedPlayerCharacters = useMemo(() => {
    if (!trackingAnchorCharacter) {
      return []
    }

    const playerName = trackingAnchorCharacter.playerName.trim()
    if (!playerName) {
      return [trackingAnchorCharacter]
    }
    return allCharacters.filter((character) => character.playerName.trim() === playerName)
  }, [allCharacters, trackingAnchorCharacter])

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
  const overlayWindowRange = useMemo(
    () =>
      getOverlayWindowRangeFeature(
        focusWindowStart,
        windowWidthSec,
        minWindowSec,
        timelineDuration,
        timelineSegments,
      ),
    [focusWindowStart, minWindowSec, timelineDuration, timelineSegments, windowWidthSec],
  )

  useEffect(() => {
    timelineStateRef.current = timelineState
  }, [timelineState])

  useEffect(() => {
    if (tracksData && loadStatus === 'ready') {
      return
    }

    const controller = new AbortController()

    const loadData = async () => {
      setLoadStatus('loading')
      setErrorMessage('')
      setSnapshotWarning('')
      setSnapshotLoadStatus('loading')

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
        setIsPlaying(true)

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
        setSnapshotLoadStatus('idle')
      }
    }

    void loadData()
    return () => controller.abort()
  }, [loadRequestSeq, tracksData, loadStatus])

  useEffect(() => {
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
  }, [])

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
  }, [loadStatus])

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
  }, [loadStatus])

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
    if (overlayMode !== 'normal' && overlayMode !== 'events') {
      setEventHoverTooltip(null)
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
    timelineDispatch({
      type: 'clampToLimits',
      limits: {
        periodStart: period.start,
        periodEnd: period.end,
        minWindowSec,
        timelineDuration,
        timelineSegments,
      },
    })
  }, [minWindowSec, period.end, period.start, timelineDuration, timelineSegments, tracksData])

  useEffect(() => {
    const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
    if (width < timelineDuration) {
      lastNonFullWindowWidthRef.current = width
    }
  }, [minWindowSec, timelineDuration, windowWidthSec])

  useEffect(() => {
    timelineDispatch({
      type: 'ensureCurrentTimeVisible',
      limits: {
        periodStart: period.start,
        periodEnd: period.end,
        minWindowSec,
        timelineDuration,
        timelineSegments,
      },
    })
  }, [currentTime, focusWindowStart, isPlaying, minWindowSec, period.end, period.start, timelineDuration, timelineSegments, windowWidthSec])

  useEffect(() => {
    let rafId = 0
    let previous = performance.now()

    const onFrame = (now: number) => {
      const deltaSec = Math.min(0.1, (now - previous) / 1000)
      previous = now

      timelineDispatch({
        type: 'advance',
        deltaSec,
        limits: {
          periodStart: period.start,
          periodEnd: period.end,
          minWindowSec,
          timelineDuration,
          timelineSegments,
        },
        overlayMode,
      })

      rafId = window.requestAnimationFrame(onFrame)
    }

    rafId = window.requestAnimationFrame(onFrame)
    return () => window.cancelAnimationFrame(rafId)
  }, [minWindowSec, overlayMode, period.end, period.start, timelineDuration, timelineSegments])

  useEffect(() => {
    if (!tracksData) {
      return
    }
    setCurrentTime(
      mapVirtualToRealTime(mapRealToVirtualTime(currentTime, timelineSegments), timelineSegments),
    )
  }, [currentTime, timelineSegments, tracksData])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (loadStatus !== 'ready') {
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
  }, [loadStatus])

  useEffect(() => {
    let rafId = 0
    let previous = performance.now()

    const onFrame = (now: number) => {
      const deltaSec = Math.min(0.1, (now - previous) / 1000)
      previous = now

      if (
        loadStatus === 'ready' &&
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
    viewportSize.height,
    viewportSize.width,
    zoom,
  ])

  const visibleCharacters = useMemo(
    () => allCharacters.filter((character) => visibility[character.charName] !== false),
    [allCharacters, visibility],
  )

  const characterTerminalInfoMap = useMemo(
    () => buildCharacterTerminalInfoMapFeature(allCharacters),
    [allCharacters],
  )
  const allEventPoints = useMemo(
    () => buildAllEventPointsFeature(allCharacters, characterTerminalInfoMap),
    [allCharacters, characterTerminalInfoMap],
  )
  const activeEventPoints = useMemo(
    () =>
      filterActiveEventPointsFeature(allEventPoints, {
        visibleEventKinds,
        visibility,
        overlayMode,
        currentTime,
        visibleRange: overlayWindowRange,
        playbackSpeed,
      }),
    [allEventPoints, currentTime, overlayMode, overlayWindowRange, playbackSpeed, visibility, visibleEventKinds],
  )

  const panelCharacters = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('ja-JP')
    const currentTrackedCharacterName =
      selectTrackingCharacter(trackedPlayerCharacters, currentTime)?.charName ?? null
    const rows = allCharacters
      .filter((character) =>
        keyword
          ? character.charName.toLocaleLowerCase('ja-JP').includes(keyword)
          : true,
      )
      .map((character) => {
        const state = getCharacterListStateFromEventsFeature(
          character,
          currentTime,
          activeEventPoints,
        )
        return {
          character,
          state,
          active: currentTrackedCharacterName === character.charName,
          onlineStartedAt: getCurrentOnlineIntervalStart(character, currentTime),
          visible: visibility[character.charName] !== false,
        }
      })
    if (listSortMode === 'name') {
      return rows.sort((a, b) =>
        a.character.charName.localeCompare(b.character.charName, 'ja'),
      )
    }
    return rows.sort((a, b) => {
      if (a.active !== b.active) {
        return a.active ? -1 : 1
      }
      if (a.state !== b.state) {
        if (a.state === 'online') {
          return -1
        }
        if (b.state === 'online') {
          return 1
        }
        if (a.state === 'dead') {
          return -1
        }
        if (b.state === 'dead') {
          return 1
        }
      }
      if (a.state === 'online' && b.state === 'online' && a.onlineStartedAt !== b.onlineStartedAt) {
        return b.onlineStartedAt - a.onlineStartedAt
      }
      return a.character.charName.localeCompare(b.character.charName, 'ja')
    })
  }, [
    allCharacters,
    characterTerminalInfoMap,
    currentTime,
    listSortMode,
    overlayMode,
    overlayWindowRange.end,
    overlayWindowRange.start,
    playbackSpeed,
    searchTerm,
    trackedPlayerCharacters,
    visibility,
  ])

  const panelPlayers = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('ja-JP')
    const grouped = new Map<string, CharacterTrack[]>()
    const trackedCharacterNames = new Set(
      trackedPlayerCharacters.map((character) => character.charName),
    )
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
      onlineStartedAt: number
      respawnVisible: boolean
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
        getCharacterListStateFromEventsFeature(character, currentTime, activeEventPoints),
      )
      const hasOnline = states.includes('online')
      const hasDeadRecent = states.includes('dead')
      const state: 'online' | 'dead' | 'inactive' = hasOnline
        ? 'online'
        : hasDeadRecent
          ? 'dead'
          : 'inactive'
      const representative = selectTrackingCharacter(playerCharacters, currentTime)
      const active = playerCharacters.some((character) =>
        trackedCharacterNames.has(character.charName),
      )
      const onlineStartedAt = playerCharacters.reduce((earliest, character) => {
        const intervalStart = getCurrentOnlineIntervalStart(character, currentTime)
        return intervalStart < earliest ? intervalStart : earliest
      }, Number.POSITIVE_INFINITY)
      const respawnVisible = isPlayerRespawnVisibleFeature(
        playerCharacters,
        allEventPoints,
        activeEventPoints,
      )

      rows.push({
        playerName,
        characters: filteredCharacters,
        allCharacters: playerCharacters,
        state,
        representative,
        currentCharacterName: representative?.charName ?? '-',
        active,
        onlineStartedAt,
        respawnVisible,
        visible: filteredCharacters.some(
          (character) => visibility[character.charName] !== false,
        ),
        totalCount: playerCharacters.length,
      })
    }

    if (listSortMode === 'name') {
      return rows.sort((a, b) => a.playerName.localeCompare(b.playerName, 'ja'))
    }

    return rows.sort((a, b) => {
      if (a.active !== b.active) {
        return a.active ? -1 : 1
      }
      if (a.state !== b.state) {
        if (a.state === 'online') {
          return -1
        }
        if (b.state === 'online') {
          return 1
        }
        if (a.state === 'dead') {
          return -1
        }
        if (b.state === 'dead') {
          return 1
        }
      }
      if (a.state === 'online' && b.state === 'online' && a.onlineStartedAt !== b.onlineStartedAt) {
        return b.onlineStartedAt - a.onlineStartedAt
      }
      return a.playerName.localeCompare(b.playerName, 'ja')
    })
  }, [
    allCharacters,
    characterTerminalInfoMap,
    currentTime,
    listSortMode,
    overlayMode,
    overlayWindowRange.end,
    overlayWindowRange.start,
    playbackSpeed,
    searchTerm,
    trackedPlayerCharacters,
    visibility,
  ])

  const allCharactersChecked =
    allCharacters.length > 0 &&
    allCharacters.every((character) => visibility[character.charName] !== false)

  const trackedCharacter = useMemo(
    () => selectTrackingCharacter(trackedPlayerCharacters, currentTime),
    [currentTime, trackedPlayerCharacters],
  )
  const activeTrackedCharacterName = trackedCharacter?.charName ?? null
  const trackedCharacterNameSet = useMemo(
    () => new Set(trackedPlayerCharacters.map((character) => character.charName)),
    [trackedPlayerCharacters],
  )
  const sceneTime = overlayMode === 'normal' ? currentTime : period.start

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
    if (!selectedCharacterName || !trackedCharacter) {
      return
    }
    if (!trackedCharacterNameSet.has(selectedCharacterName)) {
      return
    }
    if (selectedCharacterName === trackedCharacter.charName) {
      return
    }
    setSelectedCharacterName(trackedCharacter.charName)
  }, [selectedCharacterName, trackedCharacter, trackedCharacterNameSet])

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
    if (overlayMode !== 'normal') {
      return []
    }
    const rendered: RenderedCharacter[] = []
    for (const character of visibleCharacters) {
      const sample = getPointAtTime(character, sceneTime)
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
  }, [cameraMetrics, overlayMode, sceneTime, visibleCharacters])
  const characterLabelPlacements = useMemo(
    () => {
      if (overlayMode !== 'normal') {
        return []
      }
      return buildCharacterLabelPlacements(
        renderedCharacters,
        viewportSize.width,
        viewportSize.height,
        zoom,
        hoveredCharacterName,
        activeTrackedCharacterName,
      )
    },
    [
      activeTrackedCharacterName,
      hoveredCharacterName,
      overlayMode,
      renderedCharacters,
      viewportSize.height,
      viewportSize.width,
      zoom,
    ],
  )

  const snapshotIndex = useMemo(() => buildSnapshotIndex(snapshotData), [snapshotData])
  const hoveredCharacterEntries = useMemo<HoveredCharacterEntry[]>(() => {
    if (!characterHoverTooltip) {
      return []
    }

    return characterHoverTooltip.charNames.map((charName) => ({
      charName,
      renderedCharacter:
        renderedCharacters.find(({ character }) => character.charName === charName) ?? null,
      snapshotRecord: pickSnapshotRecord(snapshotIndex.get(charName) ?? []),
    }))
  }, [characterHoverTooltip, renderedCharacters, snapshotIndex])
  const selectedSnapshotRecord = useMemo(() => {
    if (!statusCharacterName) {
      return null
    }
    const records = snapshotIndex.get(statusCharacterName) ?? []
    return pickSnapshotRecord(records)
  }, [snapshotIndex, statusCharacterName])

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

  const timeWindow = useMemo(
    () => getTimeWindowFeature(focusWindowStart, windowWidthSec, minWindowSec, timelineDuration),
    [focusWindowStart, minWindowSec, timelineDuration, windowWidthSec],
  )

  const timeWindowReal = useMemo(
    () => ({
      start: mapVirtualToRealTime(timeWindow.start, timelineSegments),
      end: mapVirtualToRealTime(timeWindow.end, timelineSegments),
    }),
    [timeWindow.end, timeWindow.start, timelineSegments],
  )
  const timelineStatusLabel =
    overlayMode === 'events'
      ? `${formatJst(timeWindowReal.start)} - ${formatJst(timeWindowReal.end)}`
      : formatJst(currentTime)

  const scaleSliderValue = useMemo(() => {
    const minLog = Math.log(minWindowSec)
    const maxLog = Math.log(timelineDuration)
    if (Math.abs(maxLog - minLog) < 1e-9) {
      return 0
    }
    return clamp(((Math.log(windowWidthSec) - minLog) / (maxLog - minLog)) * 1000, 0, 1000)
  }, [minWindowSec, timelineDuration, windowWidthSec])

  const activeTrackedLabel =
    trackedCharacter?.playerName.trim() || trackedCharacter?.charName || null
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
    const previousOverlayMode = previousOverlayModeRef.current
    previousOverlayModeRef.current = overlayMode

    if (overlayMode === 'events' && previousOverlayMode !== 'events') {
      setIsPlaying(false)
      setSeekbarMode('full')
      setWindowWidthSec(timelineDuration)
      setFocusWindowStart(0)
      return
    }

    if (overlayMode === 'normal' && previousOverlayMode === 'events') {
      const restoredWidth = clamp(lastNonFullWindowWidthRef.current, minWindowSec, timelineDuration)
      if (restoredWidth < timelineDuration) {
        const currentVirtual = mapRealToVirtualTime(currentTime, timelineSegments)
        const maxStart = Math.max(0, timelineDuration - restoredWidth)
        setWindowWidthSec(restoredWidth)
        setFocusWindowStart(clamp(currentVirtual - restoredWidth / 2, 0, maxStart))
      }
    }
  }, [currentTime, minWindowSec, overlayMode, timelineDuration, timelineSegments])
  const selectedTileLevel = useMemo(() => {
    if (zoom < zoomSettings.tileSwitchZoom) {
      return null
    }
    if (!mapManifest?.tiles?.enabled || !mapManifest.tiles.levels || mapManifest.tiles.levels.length === 0) {
      return null
    }
    return pickTileLevel(mapManifest.tiles.levels, zoom)
  }, [mapManifest, zoom])

  const hasLowResBackground = lowResStatus === 'ready'
  const hasTileBackground = selectedTileLevel != null
  const backgroundLoading = mapManifestStatus === 'loading' || lowResStatus === 'loading'
  const backgroundUnavailable =
    !hasLowResBackground &&
    !hasTileBackground &&
    (mapManifestStatus === 'error' ||
      lowResStatus === 'error' ||
      (mapManifestStatus === 'ready' &&
        (!mapManifest?.lowRes?.enabled || !mapManifest.lowRes.file)))
  const mapModeLabel = selectedTileLevel
    ? `タイル表示 (${selectedTileLevel.id})`
    : hasLowResBackground
      ? '低画質背景'
      : backgroundUnavailable
        ? 'グリッド背景'
        : '背景読み込み中'
  const statusWindowStyle = statusWindowPosition
    ? { left: `${statusWindowPosition.x}px`, top: `${statusWindowPosition.y}px` }
    : undefined
  const characterTooltipStyle = getMapHoverTooltipStyle(
    characterHoverTooltip,
    Math.min(520, 44 + Math.max(hoveredCharacterEntries.length, 1) * 116),
    280,
  )
  const eventTooltipStyle = getMapHoverTooltipStyle(
    eventHoverTooltip,
    Math.min(520, 44 + (eventHoverTooltip?.points.length ?? 1) * 116),
    280,
  )

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

  const stopPlaybackForManualControl = () => {
    setIsPlaying(false)
  }

  const toggleEventKindVisibility = (kind: EventKind) => {
    setVisibleEventKinds((prev) => ({
      ...prev,
      [kind]: !prev[kind],
    }))
  }

  const handlePlaybackToggle = () => {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }

    if (overlayMode !== 'events') {
      setIsPlaying(true)
      return
    }

    const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
    let nextWidth = width
    if (width >= timelineDuration) {
      const restoredWidth = clamp(
        lastNonFullWindowWidthRef.current,
        minWindowSec,
        timelineDuration,
      )
      if (restoredWidth < timelineDuration) {
        nextWidth = restoredWidth
        const currentVirtual = mapRealToVirtualTime(currentTime, timelineSegments)
        const maxStart = Math.max(0, timelineDuration - restoredWidth)
        setWindowWidthSec(restoredWidth)
        setFocusWindowStart(clamp(currentVirtual - restoredWidth / 2, 0, maxStart))
      }
    }

    if (nextWidth < timelineDuration) {
      setIsPlaying(true)
    }
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

  const setCharacterVisibility = (charName: string, nextVisible: boolean) => {
    setVisibility((prev) => ({
      ...prev,
      [charName]: nextVisible,
    }))
  }

  const setCharactersVisibility = (
    characters: CharacterTrack[],
    nextVisible: boolean,
  ) => {
    setVisibility((prev) => {
      const next = { ...prev }
      for (const character of characters) {
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
    setWindowWidthSec(
      clamp(timelineStateRef.current.windowWidthSec * factor, minWindowSec, timelineDuration),
    )
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

  const moveOverviewWindowByClientX = (clientX: number) => {
    const dragState = overviewWindowDragRef.current
    const track = overviewTrackRef.current
    if (!dragState || !track) {
      return
    }

    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) {
      return
    }

    const deltaVirtual =
      ((clientX - dragState.startClientX) / rect.width) * timelineDuration
    const maxStart = Math.max(0, timelineDuration - dragState.width)
    const nextStart = clamp(dragState.startWindowStart + deltaVirtual, 0, maxStart)
    const nextCurrentVirtual = clamp(
      nextStart + dragState.currentOffset,
      nextStart,
      nextStart + dragState.width,
    )

    setFocusWindowStart(nextStart)
    setCurrentTime(mapVirtualToRealTime(nextCurrentVirtual, timelineSegments))
  }

  const handleOverviewWindowPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || timelineDuration <= timeWindow.end - timeWindow.start) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    stopPlaybackForManualControl()

    overviewWindowDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWindowStart: timeWindow.start,
      width: timeWindow.end - timeWindow.start,
      currentOffset: clamp(currentTimeVirtual - timeWindow.start, 0, timeWindow.end - timeWindow.start),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleOverviewWindowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (overviewWindowDragRef.current?.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
    moveOverviewWindowByClientX(event.clientX)
  }

  const handleOverviewWindowPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (overviewWindowDragRef.current?.pointerId !== event.pointerId) {
      return
    }
    overviewWindowDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const scrubOverviewByClientX = (clientX: number) => {
    const target = overviewTrackRef.current
    if (!target || timelineDuration <= 0) {
      return
    }
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0) {
      return
    }

    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    const desiredVirtual = ratio * timelineDuration
    setCurrentTime(mapVirtualToRealTime(desiredVirtual, timelineSegments))
  }

  const handleOverviewScrubPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    stopPlaybackForManualControl()
    overviewScrubPointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubOverviewByClientX(event.clientX)
  }

  const handleOverviewScrubPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (overviewScrubPointerRef.current !== event.pointerId) {
      return
    }
    event.preventDefault()
    scrubOverviewByClientX(event.clientX)
  }

  const handleOverviewScrubPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (overviewScrubPointerRef.current !== event.pointerId) {
      return
    }
    overviewScrubPointerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
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

  const findNormalCharactersAtCanvasPoint = (x: number, y: number) => {
    const hitNames: string[] = []
    const seen = new Set<string>()

    for (let i = characterLabelPlacements.length - 1; i >= 0; i -= 1) {
      const label = characterLabelPlacements[i]
      if (
        x >= label.left &&
        x <= label.left + label.width &&
        y >= label.top &&
        y <= label.top + label.height &&
        !seen.has(label.charName)
      ) {
        seen.add(label.charName)
        hitNames.push(label.charName)
      }
    }

    const iconHits = renderedCharacters
      .map((character) => {
        const dx = character.screenX - x
        const dy = character.screenY - y
        return {
          charName: character.character.charName,
          distance: dx * dx + dy * dy,
          screenY: character.screenY,
        }
      })
      .filter((entry) => entry.distance <= HOVER_RADIUS_PX * HOVER_RADIUS_PX)
      .sort((a, b) => a.distance - b.distance || b.screenY - a.screenY)

    for (const hit of iconHits) {
      if (seen.has(hit.charName)) {
        continue
      }
      seen.add(hit.charName)
      hitNames.push(hit.charName)
    }

    return hitNames
  }

  const findNormalCharacterAtCanvasPoint = (x: number, y: number) => {
    return findNormalCharactersAtCanvasPoint(x, y)[0] ?? null
  }

  const findHoveredCharacter = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      setHoveredCharacterName(null)
      setCharacterHoverTooltip(null)
      setEventHoverTooltip(null)
      return
    }

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    if (overlayMode === 'normal' || overlayMode === 'events') {
      const hoveredPoints = activeEventPoints
        .map((point) => {
          const screen = worldToScreen(point.x, point.y, cameraMetrics)
          const dx = screen.x - x
          const dy = screen.y - y
          return { point, distance: dx * dx + dy * dy }
        })
        .filter((entry) => entry.distance <= HOVER_RADIUS_PX * HOVER_RADIUS_PX)
        .sort((a, b) => b.point.time - a.point.time)
        .map((entry) => entry.point)

      if (hoveredPoints.length > 0) {
        setHoveredCharacterName(null)
        setCharacterHoverTooltip(null)
        setEventHoverTooltip({
          clientX,
          clientY,
          points: hoveredPoints,
        })
        return
      }

      setEventHoverTooltip(null)
      if (overlayMode === 'events') {
        setHoveredCharacterName(null)
        setCharacterHoverTooltip(null)
        return
      }
    }

    const hoveredCharacters = findNormalCharactersAtCanvasPoint(x, y)
    const primaryCharacter = hoveredCharacters[0] ?? null

    setHoveredCharacterName(primaryCharacter)
    setCharacterHoverTooltip(
      hoveredCharacters.length > 0
        ? {
            clientX,
            clientY,
            charNames: hoveredCharacters,
          }
        : null,
    )
    setEventHoverTooltip(null)
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
      setEventHoverTooltip(null)
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
          clientX: event.clientX,
          clientY: event.clientY,
          charNames: [drag.hitCharacterName],
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
      setEventHoverTooltip(null)
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

    renderBackgroundLayer({
      context,
      worldRange,
      bounds,
      cameraMetrics,
      viewportSize,
      mapViewportRect,
      lowResStatus,
      lowResImage: lowResImageRef.current,
      selectedTileLevel,
      mapManifest,
      worldToScreen,
      mapPixelToWorld: (px, py) => mapPixelToWorld(px, py, bounds),
      drawRasterImageFromMapRect: (layerContext, image, layerBounds, layerCameraMetrics, viewportRect) =>
        drawRasterImageFromMapRect(layerContext, image, layerBounds as Bounds, layerCameraMetrics, viewportRect),
      requestTileImage,
      resolveMapAssetUrl,
    })

    if (overlayMode === 'normal' && trailEnabled) {
      renderTrailLayer({
        context,
        renderedCharacters,
        sceneTime,
        trailWindowSec: TRAIL_WINDOW_SEC,
        trailColor,
        allTimeTrail,
        cameraMetrics,
        worldToScreen,
      })
    }

    if ((overlayMode === 'normal' || overlayMode === 'events') && activeEventPoints.length > 0) {
      renderEventLayer({
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
        getEventMarkerAlpha: getEventMarkerAlphaFeature,
      })
    }

    if (overlayMode === 'normal') {
      renderCharacterLayer({
        context,
        renderedCharacters,
        iconColor,
        activeTrackedCharacterName,
        trackingOutlineColor: TRACKING_OUTLINE_COLOR,
      })
      renderLabelLayer({
        context,
        characterLabelPlacements,
        iconColor,
        activeTrackedCharacterName,
        trackingOutlineColor: TRACKING_OUTLINE_COLOR,
      })
    }
  }, [
    activeTrackedCharacterName,
    activeEventPoints,
    allTimeTrail,
    bounds,
    cameraMetrics,
    iconColor,
    lowResStatus,
    mapManifest,
    overlayWindowRange,
    overlayMode,
    characterLabelPlacements,
    currentTime,
    renderedCharacters,
    sceneTime,
    selectedTileLevel,
    tileCacheTick,
    trailColor,
    trailEnabled,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ])

  const characterCount = allCharacters.length

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

                  <div className="list-header-row">
                    <div className="list-header-spacer">
                      <div className="list-sort-switch" role="group" aria-label="一覧ソート切替">
                        <button
                          className={
                            listSortMode === 'online' ? 'primary-button small' : 'secondary-button small'
                          }
                          onClick={() => setListSortMode('online')}
                        >
                          オンライン順
                        </button>
                        <button
                          className={
                            listSortMode === 'name' ? 'primary-button small' : 'secondary-button small'
                          }
                          onClick={() => setListSortMode('name')}
                        >
                          名前順
                        </button>
                      </div>
                    </div>
                    <label className="list-master-visibility">
                      <span className="list-master-visibility-label">全キャラ表示</span>
                      <input
                        type="checkbox"
                        checked={allCharactersChecked}
                        onChange={(event) => setAllVisibility(event.target.checked)}
                        aria-label="全キャラ表示"
                      />
                    </label>
                  </div>

                  <div className="player-list flat-list">
                    {listMode === 'character' &&
                      panelCharacters.map((row) => (
                        <div
                          className={`character-row ${row.visible ? '' : 'hidden'}`}
                          key={row.character.charName}
                        >
                          <button
                            className={`character-line ${row.state} ${
                              selectedCharacterName === row.character.charName ? 'selected' : ''
                            } ${row.active ? 'tracked' : ''}`}
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
                          <label
                            className="row-visibility-toggle"
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`${row.character.charName} の表示切替`}
                          >
                            <input
                              type="checkbox"
                              checked={row.visible}
                              onChange={(event) =>
                                setCharacterVisibility(
                                  row.character.charName,
                                  event.target.checked,
                                )
                              }
                            />
                          </label>
                        </div>
                      ))}

                    {listMode === 'player' &&
                      panelPlayers.map((row) => {
                        const expanded = expandedPlayers[row.playerName] === true
                        const rowChecked = row.allCharacters.every(
                          (character) => visibility[character.charName] !== false,
                        )
                        return (
                          <div
                            className={`player-entry ${row.visible ? '' : 'hidden'}`}
                            key={row.playerName}
                          >
                            <div
                              className={`player-line ${row.state} ${row.active ? 'tracked' : ''}`}
                            >
                              <div className="player-line-leading">
                                <span className="count-badge">{row.totalCount}</span>
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
                              </div>
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
                                  {row.respawnVisible && (
                                    <span className="new-character-tag">リスポーン</span>
                                  )}
                                </span>
                              </button>
                              <label
                                className="row-visibility-toggle"
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`${row.playerName} の表示切替`}
                              >
                                <input
                                  type="checkbox"
                                  checked={rowChecked}
                                  onChange={(event) =>
                                    setCharactersVisibility(
                                      row.allCharacters,
                                      event.target.checked,
                                    )
                                  }
                                />
                              </label>
                            </div>

                            {expanded && (
                              <div className="player-children">
                                {row.characters.map((character) => {
                                  const childState = getCharacterListStateFromEventsFeature(
                                    character,
                                    currentTime,
                                    activeEventPoints,
                                  )
                                  const childVisible =
                                    visibility[character.charName] !== false
                                  return (
                                    <div
                                      className={`child-character-row ${
                                        childVisible ? '' : 'hidden'
                                      }`}
                                      key={character.charName}
                                    >
                                      <button
                                        className={`child-character ${childState} ${
                                          selectedCharacterName === character.charName
                                            ? 'selected'
                                            : ''
                                        } ${
                                          activeTrackedCharacterName === character.charName
                                            ? 'tracked'
                                            : ''
                                        }`}
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
                                      <label
                                        className="row-visibility-toggle"
                                        onClick={(event) => event.stopPropagation()}
                                        aria-label={`${character.charName} の表示切替`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={childVisible}
                                          onChange={(event) =>
                                            setCharacterVisibility(
                                              character.charName,
                                              event.target.checked,
                                            )
                                          }
                                        />
                                      </label>
                                    </div>
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
                      {overlayMode === 'normal' ? '通常' : 'イベント'}
                    </span>
                    <span className="pill">
                      {zoom >= zoomSettings.labelThreshold
                        ? 'ラベル表示: 常時'
                        : 'ラベル表示: ホバー時のみ'}
                    </span>
                    {activeTrackedLabel && (
                      <span className="pill accent">
                        追跡中: {activeTrackedLabel}
                      </span>
                    )}
                    {backgroundLoading && (
                      <span className="pill">背景アセットを読み込み中...</span>
                    )}
                    {backgroundUnavailable && (
                      <span className="pill warning">
                        背景アセットが読み込めません。グリッド表示で動作中
                      </span>
                    )}
                  </div>
                  <div className="map-mode-switch">
                    <span className="map-mode-switch-title">表示</span>
                    <div className="map-mode-switch-grid">
                      <button
                        className={
                          overlayMode === 'normal'
                            ? 'primary-button small'
                            : 'secondary-button small'
                        }
                        onClick={() => setOverlayMode('normal')}
                      >
                        通常
                      </button>
                      <button
                        className={
                          overlayMode === 'events'
                            ? 'primary-button small'
                            : 'secondary-button small'
                        }
                        onClick={() => setOverlayMode('events')}
                      >
                        イベント
                      </button>
                    </div>
                    <div className="map-mode-filter-group">
                      {(['respawn', 'login', 'logout', 'death', 'logoutMaybe'] as const).map((kind) => (
                        <button
                          key={kind}
                          className={
                            visibleEventKinds[kind]
                              ? 'primary-button small'
                              : 'secondary-button small'
                          }
                          onClick={() => toggleEventKindVisibility(kind)}
                        >
                          {getEventKindLabelFeature(kind)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {overlayMode === 'normal' &&
                    characterHoverTooltip &&
                    hoveredCharacterEntries.length > 0 &&
                    characterTooltipStyle && (
                      <div className="death-hover-tooltip event-hover-tooltip" style={characterTooltipStyle}>
                        <div className="event-hover-entries">
                          {hoveredCharacterEntries.map((entry) => (
                            <section className="event-hover-entry" key={entry.charName}>
                              <div className="death-hover-title">{entry.charName}</div>
                              <dl className="death-hover-list">
                                <div>
                                  <dt>状態</dt>
                                  <dd>
                                    {entry.renderedCharacter?.sample.offline
                                      ? 'オフライン'
                                      : 'オンライン'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>プレイヤー</dt>
                                  <dd>
                                    {readString(entry.snapshotRecord ?? {}, 'playerName') ||
                                      entry.renderedCharacter?.character.playerName ||
                                      '-'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>生存時間(sec)</dt>
                                  <dd>
                                    {formatMetric(
                                      readNumber(entry.snapshotRecord ?? {}, 'survivalTime'),
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>ゾンビキル</dt>
                                  <dd>
                                    {formatMetric(
                                      readNumber(entry.snapshotRecord ?? {}, 'zombieKills'),
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>徒歩移動</dt>
                                  <dd>
                                    {formatMetric(
                                      readNumber(entry.snapshotRecord ?? {}, 'movementOnFoot'),
                                      1,
                                    )}
                                  </dd>
                                </div>
                              </dl>
                            </section>
                          ))}
                        </div>
                      </div>
                    )}
                  {(overlayMode === 'normal' || overlayMode === 'events') &&
                    eventHoverTooltip &&
                    eventTooltipStyle && (
                      <div className="death-hover-tooltip event-hover-tooltip" style={eventTooltipStyle}>
                        <div className="event-hover-entries">
                          {eventHoverTooltip.points.map((point) => {
                            const snapshotRecord = pickSnapshotRecord(
                              snapshotIndex.get(point.charName) ?? [],
                            )
                            return (
                              <section className="event-hover-entry" key={point.id}>
                                <div className="death-hover-title">{point.charName}</div>
                                <dl className="death-hover-list">
                                  <div>
                                    <dt>種別</dt>
                                    <dd>{getEventKindLabelFeature(point.kind)}</dd>
                                  </div>
                                  <div>
                                    <dt>{getEventTimeLabelFeature(point.kind)}</dt>
                                    <dd>{formatJst(point.time)}</dd>
                                  </div>
                                  <div>
                                    <dt>プレイヤー</dt>
                                    <dd>{point.playerName || '-'}</dd>
                                  </div>
                                  <div>
                                    <dt>生存時間(sec)</dt>
                                    <dd>
                                      {formatMetric(
                                        readNumber(snapshotRecord ?? {}, 'survivalTime'),
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>ゾンビキル</dt>
                                    <dd>
                                      {formatMetric(
                                        readNumber(snapshotRecord ?? {}, 'zombieKills'),
                                      )}
                                    </dd>
                                  </div>
                                </dl>
                              </section>
                            )
                          })}
                        </div>
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
                        <p className="timeline-time">{timelineStatusLabel}</p>
                        <div className="playback-controls">
                          <button
                            className={isPlaying ? 'primary-button small' : 'secondary-button small'}
                            onClick={handlePlaybackToggle}
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
                              className={
                                seekbarMode === 'tracked' && activeTrackedCharacterName != null
                                  ? 'primary-button small'
                                  : 'secondary-button small'
                              }
                              onClick={() => setSeekbarMode('tracked')}
                              disabled={activeTrackedCharacterName == null}
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
                        <div
                          className="overview-track"
                          ref={overviewTrackRef}
                          onPointerDown={handleOverviewScrubPointerDown}
                          onPointerMove={handleOverviewScrubPointerMove}
                          onPointerUp={handleOverviewScrubPointerUp}
                          onPointerCancel={handleOverviewScrubPointerUp}
                        >
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
                            onPointerDown={handleOverviewWindowPointerDown}
                            onPointerMove={handleOverviewWindowPointerMove}
                            onPointerUp={handleOverviewWindowPointerUp}
                            onPointerCancel={handleOverviewWindowPointerUp}
                            onLostPointerCapture={handleOverviewWindowPointerUp}
                          />
                          {overlayMode === 'normal' && (
                            <div
                              className="overview-playhead"
                              style={{ left: `${currentTimePercent}%` }}
                              onPointerDown={handleOverviewScrubPointerDown}
                              onPointerMove={handleOverviewScrubPointerMove}
                              onPointerUp={handleOverviewScrubPointerUp}
                              onPointerCancel={handleOverviewScrubPointerUp}
                              onLostPointerCapture={handleOverviewScrubPointerUp}
                            />
                          )}
                        </div>
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
                  {snapshotLoadStatus === 'loading' ? (
                    <p className="muted">snapshot を読み込み中...</p>
                  ) : selectedSnapshotRecord ? (
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
                    className="tips-close-button"
                    onClick={() => setShowTips(false)}
                    aria-label="操作メモを閉じる"
                  >
                    <span aria-hidden="true">×</span>
                    <span>閉じる</span>
                  </button>
                </div>
                <ul className="tips-list">
                  <li>地図: マウスホイールでズーム / ドラッグ・WASDで移動</li>
                  <li>追跡: 一覧・アイコン・ネームタグをクリック</li>
                  <li>表示: 通常 / イベントを切替</li>
                  <li>下部バー: 全体バーで時刻移動 / フォーカスバーで詳細移動</li>
                  <li>フォーカスバー上のホイールで表示幅を変更</li>
                </ul>
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

export default MapPage











