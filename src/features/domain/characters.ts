export type TimeInterval = {
  start: number
  end: number
}

export type CharacterTrack = {
  charName: string
  playerName: string
  life: {
    start: number
    end: number
  }
  track: {
    t: number[]
    x: number[]
    y: number[]
  }
  gaps: {
    offline: Array<[number, number]>
  }
}

export type CharacterSample = {
  x: number
  y: number
  offline: boolean
  beforeStart: boolean
  afterEnd: boolean
}

const OFFLINE_THRESHOLD_SEC = 2 * 60 * 60

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

export function isOfflineAtTime(gaps: Array<[number, number]>, time: number) {
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

export function crossesOfflineGap(
  gaps: Array<[number, number]>,
  start: number,
  end: number,
) {
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

export function getCharacterOnlineIntervals(character: CharacterTrack): TimeInterval[] {
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

export function getPointAtTime(character: CharacterTrack, time: number): CharacterSample | null {
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

export function getNearestOnlineTime(character: CharacterTrack, currentTime: number) {
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

export function selectTrackingCharacter(candidates: CharacterTrack[], time: number) {
  if (candidates.length === 0) {
    return null
  }

  const online = candidates
    .filter((character) => {
      const sample = getPointAtTime(character, time)
      return sample != null && !sample.beforeStart && !sample.afterEnd && !sample.offline
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
    const distanceA = Math.min(Math.abs(time - a.life.start), Math.abs(time - a.life.end))
    const distanceB = Math.min(Math.abs(time - b.life.start), Math.abs(time - b.life.end))
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

export function getNearestOnlineTimeForCharacters(
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

export function getCurrentOnlineIntervalStart(
  character: CharacterTrack,
  currentTime: number,
) {
  const sample = getPointAtTime(character, currentTime)
  if (!sample || sample.beforeStart || sample.afterEnd || sample.offline) {
    return Number.POSITIVE_INFINITY
  }

  const intervals = getCharacterOnlineIntervals(character)
  for (const interval of intervals) {
    if (currentTime >= interval.start && currentTime <= interval.end) {
      return interval.start
    }
  }

  return Number.POSITIVE_INFINITY
}
