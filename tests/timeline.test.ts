import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceTimelineState,
  buildTimelineSegments,
  createInitialTimelineState,
  ensureCurrentTimeVisible,
  getOverlayWindowRange,
  mapRealToVirtualTime,
  mapVirtualToRealTime,
  timelineReducer,
} from '../src/features/timeline/timeline.js'

test('timeline mapping compresses gaps out of virtual time', () => {
  const segments = buildTimelineSegments(
    [
      { start: 0, end: 100 },
      { start: 200, end: 300 },
    ],
    0,
    300,
  )

  assert.equal(mapRealToVirtualTime(50, segments), 50)
  assert.equal(mapRealToVirtualTime(250, segments), 150)
  assert.equal(mapVirtualToRealTime(150, segments), 250)
})

test('ensureCurrentTimeVisible shifts the focus window when cursor exits view', () => {
  const segments = buildTimelineSegments([{ start: 0, end: 500 }], 0, 500)
  const state = {
    ...createInitialTimelineState(),
    currentTime: 350,
    windowWidthSec: 100,
    focusWindowStart: 0,
    isPlaying: false,
  }

  const next = ensureCurrentTimeVisible(state, {
    periodStart: 0,
    periodEnd: 500,
    minWindowSec: 60,
    timelineDuration: 500,
    timelineSegments: segments,
  })

  assert.equal(next.focusWindowStart, 250)
})

test('advanceTimelineState moves currentTime in normal mode and stops at end', () => {
  const segments = buildTimelineSegments([{ start: 0, end: 10 }], 0, 10)
  const state = {
    ...createInitialTimelineState(),
    currentTime: 8,
    windowWidthSec: 4,
    isPlaying: true,
    playbackSpeed: 4,
  }

  const advanced = advanceTimelineState(
    state,
    1,
    {
      periodStart: 0,
      periodEnd: 10,
      minWindowSec: 1,
      timelineDuration: 10,
      timelineSegments: segments,
    },
    'normal',
  )

  assert.equal(advanced.state.currentTime, 10)
  assert.equal(advanced.state.isPlaying, false)
  assert.equal(advanced.reachedEnd, true)
})

test('overlayWindowRange resolves real-time bounds from virtual window', () => {
  const segments = buildTimelineSegments(
    [
      { start: 0, end: 100 },
      { start: 200, end: 260 },
    ],
    0,
    260,
  )

  assert.deepEqual(getOverlayWindowRange(80, 40, 10, 160, segments), {
    start: 80,
    end: 220,
  })
})

test('timelineReducer clamps state through reducer action', () => {
  const segments = buildTimelineSegments([{ start: 0, end: 500 }], 0, 500)
  const state = {
    ...createInitialTimelineState(),
    currentTime: 900,
    windowWidthSec: 700,
    focusWindowStart: 900,
  }

  const next = timelineReducer(state, {
    type: 'clampToLimits',
    limits: {
      periodStart: 0,
      periodEnd: 500,
      minWindowSec: 60,
      timelineDuration: 500,
      timelineSegments: segments,
    },
  })

  assert.equal(next.currentTime, 500)
  assert.equal(next.windowWidthSec, 500)
  assert.equal(next.focusWindowStart, 0)
})

test('timelineReducer advances focus window in events mode', () => {
  const segments = buildTimelineSegments([{ start: 0, end: 100 }], 0, 100)
  const state = {
    ...createInitialTimelineState(),
    windowWidthSec: 20,
    focusWindowStart: 10,
    isPlaying: true,
    playbackSpeed: 5,
  }

  const next = timelineReducer(state, {
    type: 'advance',
    deltaSec: 2,
    limits: {
      periodStart: 0,
      periodEnd: 100,
      minWindowSec: 10,
      timelineDuration: 100,
      timelineSegments: segments,
    },
    overlayMode: 'events',
  })

  assert.equal(next.focusWindowStart, 20)
  assert.equal(next.isPlaying, true)
})
