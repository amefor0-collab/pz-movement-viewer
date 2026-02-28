export type SeekbarMode = 'full' | 'online' | 'tracked'
export type OverlayMode = 'normal' | 'events'

export type TimeInterval = {
  start: number
  end: number
}

export type TimelineSegment = {
  start: number
  end: number
  virtualStart: number
  virtualEnd: number
}

export type TimelineState = {
  currentTime: number
  windowWidthSec: number
  focusWindowStart: number
  isPlaying: boolean
  playbackSpeed: number
  seekbarMode: SeekbarMode
}

export type TimelineLimits = {
  periodStart: number
  periodEnd: number
  minWindowSec: number
  timelineDuration: number
  timelineSegments: TimelineSegment[]
}

export type TimelineAction =
  | { type: 'initialize'; currentTime: number; windowWidthSec: number; playbackSpeed: number; seekbarMode: SeekbarMode }
  | { type: 'setCurrentTime'; currentTime: number }
  | { type: 'setWindowWidthSec'; windowWidthSec: number }
  | { type: 'setFocusWindowStart'; focusWindowStart: number }
  | { type: 'setPlaying'; isPlaying: boolean }
  | { type: 'setPlaybackSpeed'; playbackSpeed: number }
  | { type: 'setSeekbarMode'; seekbarMode: SeekbarMode }
  | { type: 'clampToLimits'; limits: TimelineLimits }
  | { type: 'ensureCurrentTimeVisible'; limits: TimelineLimits }
  | { type: 'advance'; deltaSec: number; limits: TimelineLimits; overlayMode: OverlayMode }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function createInitialTimelineState(): TimelineState {
  return {
    currentTime: 0,
    windowWidthSec: 24 * 60 * 60,
    focusWindowStart: 0,
    isPlaying: false,
    playbackSpeed: 64,
    seekbarMode: 'online',
  }
}

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  switch (action.type) {
    case 'initialize':
      return {
        currentTime: action.currentTime,
        windowWidthSec: action.windowWidthSec,
        focusWindowStart: 0,
        isPlaying: false,
        playbackSpeed: action.playbackSpeed,
        seekbarMode: action.seekbarMode,
      }
    case 'setCurrentTime':
      return { ...state, currentTime: action.currentTime }
    case 'setWindowWidthSec':
      return { ...state, windowWidthSec: action.windowWidthSec }
    case 'setFocusWindowStart':
      return { ...state, focusWindowStart: action.focusWindowStart }
    case 'setPlaying':
      return { ...state, isPlaying: action.isPlaying }
    case 'setPlaybackSpeed':
      return { ...state, playbackSpeed: action.playbackSpeed }
    case 'setSeekbarMode':
      return { ...state, seekbarMode: action.seekbarMode }
    case 'clampToLimits':
      return clampTimelineState(state, action.limits)
    case 'ensureCurrentTimeVisible':
      return ensureCurrentTimeVisible(state, action.limits)
    case 'advance':
      return advanceTimelineState(
        state,
        action.deltaSec,
        action.limits,
        action.overlayMode,
      ).state
    default:
      return state
  }
}

export function mergeTimeIntervals(
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

export function expandTimeIntervals(
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

export function buildTimelineSegments(
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

export function mapRealToVirtualTime(realTime: number, segments: TimelineSegment[]) {
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

export function mapVirtualToRealTime(virtualTime: number, segments: TimelineSegment[]) {
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

export function getJstDayBoundaryUnixSec(startUnixSec: number, endUnixSec: number) {
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

export function getOverlayWindowRange(
  focusWindowStart: number,
  windowWidthSec: number,
  minWindowSec: number,
  timelineDuration: number,
  timelineSegments: TimelineSegment[],
) {
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
}

export function getTimeWindow(
  focusWindowStart: number,
  windowWidthSec: number,
  minWindowSec: number,
  timelineDuration: number,
) {
  const width = clamp(windowWidthSec, minWindowSec, timelineDuration)
  if (width >= timelineDuration) {
    return { start: 0, end: timelineDuration }
  }
  const maxStart = timelineDuration - width
  const start = clamp(focusWindowStart, 0, maxStart)
  return { start, end: start + width }
}

export function clampTimelineState(
  state: TimelineState,
  limits: TimelineLimits,
) {
  const currentTime = clamp(state.currentTime, limits.periodStart, limits.periodEnd)
  const windowWidthSec = clamp(state.windowWidthSec, limits.minWindowSec, limits.timelineDuration)
  const maxStart = Math.max(0, limits.timelineDuration - windowWidthSec)
  const focusWindowStart = clamp(state.focusWindowStart, 0, maxStart)
  return {
    ...state,
    currentTime,
    windowWidthSec,
    focusWindowStart,
  }
}

export function ensureCurrentTimeVisible(
  state: TimelineState,
  limits: TimelineLimits,
) {
  const currentVirtualTime = mapRealToVirtualTime(state.currentTime, limits.timelineSegments)
  const width = clamp(state.windowWidthSec, limits.minWindowSec, limits.timelineDuration)
  const maxStart = Math.max(0, limits.timelineDuration - width)
  let nextStart = clamp(state.focusWindowStart, 0, maxStart)
  const end = nextStart + width
  if (currentVirtualTime > end) {
    if (state.isPlaying && width < limits.timelineDuration) {
      nextStart = clamp(currentVirtualTime, 0, maxStart)
    } else {
      nextStart = clamp(nextStart + (currentVirtualTime - end), 0, maxStart)
    }
  } else if (currentVirtualTime < nextStart) {
    nextStart = clamp(nextStart - (nextStart - currentVirtualTime), 0, maxStart)
  }

  return {
    ...state,
    focusWindowStart: nextStart,
  }
}

export function advanceTimelineState(
  state: TimelineState,
  deltaSec: number,
  limits: TimelineLimits,
  overlayMode: OverlayMode,
) {
  if (!state.isPlaying) {
    return { state, reachedEnd: false }
  }

  let reachedEnd = false
  if (overlayMode === 'events') {
    const width = clamp(state.windowWidthSec, limits.minWindowSec, limits.timelineDuration)
    const maxStart = Math.max(0, limits.timelineDuration - width)
    if (width >= limits.timelineDuration || maxStart <= 0) {
      return {
        state: { ...state, focusWindowStart: 0, isPlaying: false },
        reachedEnd: true,
      }
    }
    const nextStart = state.focusWindowStart + state.playbackSpeed * deltaSec
    const focusWindowStart = nextStart >= maxStart ? maxStart : clamp(nextStart, 0, maxStart)
    reachedEnd = nextStart >= maxStart
    return {
      state: {
        ...state,
        focusWindowStart,
        isPlaying: reachedEnd ? false : state.isPlaying,
      },
      reachedEnd,
    }
  }

  const currentVirtual = mapRealToVirtualTime(state.currentTime, limits.timelineSegments)
  const nextVirtual = currentVirtual + state.playbackSpeed * deltaSec
  const currentTime =
    nextVirtual >= limits.timelineDuration
      ? mapVirtualToRealTime(limits.timelineDuration, limits.timelineSegments)
      : mapVirtualToRealTime(nextVirtual, limits.timelineSegments)
  reachedEnd = nextVirtual >= limits.timelineDuration
  return {
    state: {
      ...state,
      currentTime,
      isPlaying: reachedEnd ? false : state.isPlaying,
    },
    reachedEnd,
  }
}
