import {
  getPointAtTime,
  type CharacterTrack,
} from '../domain/characters.js'

export type OverlayMode = 'normal' | 'events'
export type EventKind = 'respawn' | 'login' | 'logout' | 'death' | 'logoutMaybe'
export type CharacterTerminalType = 'death' | 'logoutMaybe'

export type CharacterTerminalInfo = {
  charName: string
  playerName: string
  x: number
  y: number
  terminalTime: number
  terminalType: CharacterTerminalType
}

export type EventPoint = {
  id: string
  kind: EventKind
  charName: string
  playerName: string
  x: number
  y: number
  time: number
}

type EventVisibilityOptions = {
  visibleEventKinds: Record<EventKind, boolean>
  visibility: Record<string, boolean>
  overlayMode: OverlayMode
  currentTime: number
  visibleRange: { start: number; end: number }
  playbackSpeed: number
}

const EVENT_MARKER_DISPLAY_REAL_SEC = 8
const EVENT_MARKER_FADE_REAL_SEC = 2

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizePlayerKey(name: string, charName: string) {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : `__unknown__:${charName}`
}

export function getEventMarkerDisplayWindowSec(playbackSpeed: number) {
  return Math.max(1, playbackSpeed) * EVENT_MARKER_DISPLAY_REAL_SEC
}

export function getEventMarkerFadeWindowSec(playbackSpeed: number) {
  return Math.max(1, playbackSpeed) * EVENT_MARKER_FADE_REAL_SEC
}

export function getEventMarkerAlpha(
  point: EventPoint,
  overlayMode: OverlayMode,
  currentTime: number,
  visibleRange: { start: number; end: number },
  playbackSpeed: number,
) {
  if (overlayMode === 'normal') {
    const displayWindowSec = getEventMarkerDisplayWindowSec(playbackSpeed)
    const fadeWindowSec = Math.min(
      displayWindowSec,
      getEventMarkerFadeWindowSec(playbackSpeed),
    )
    const visibleUntil = point.time + displayWindowSec
    if (currentTime >= visibleUntil) {
      return 0
    }
    if (currentTime <= visibleUntil - fadeWindowSec) {
      return 1
    }
    return clamp((visibleUntil - currentTime) / fadeWindowSec, 0, 1)
  }

  const rangeWidth = Math.max(1, visibleRange.end - visibleRange.start)
  const fadeSec = clamp(rangeWidth * 0.08, 15 * 60, 2 * 60 * 60)
  const fadeIn = clamp((point.time - visibleRange.start) / fadeSec, 0, 1)
  const fadeOut = clamp((visibleRange.end - point.time) / fadeSec, 0, 1)
  return Math.min(fadeIn, fadeOut)
}

export function isEventVisibleOnCurrentScreen(
  eventTime: number,
  overlayMode: OverlayMode,
  currentTime: number,
  visibleRange: { start: number; end: number },
  playbackSpeed: number,
) {
  if (overlayMode === 'events') {
    return eventTime >= visibleRange.start && eventTime <= visibleRange.end
  }
  if (overlayMode === 'normal') {
    const displayWindowSec = getEventMarkerDisplayWindowSec(playbackSpeed)
    return eventTime <= currentTime && currentTime <= eventTime + displayWindowSec
  }
  return false
}

export function buildCharacterTerminalInfoMap(allCharacters: CharacterTrack[]) {
  const grouped = new Map<string, CharacterTrack[]>()
  for (const character of allCharacters) {
    const playerKey = normalizePlayerKey(character.playerName, character.charName)
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
    const terminalTime = times.length > 0 ? times[times.length - 1] : character.life.end
    terminalTimeByName.set(character.charName, terminalTime)
  }

  const infoMap = new Map<string, CharacterTerminalInfo>()
  for (const character of allCharacters) {
    const playerKey = normalizePlayerKey(character.playerName, character.charName)
    const siblings = grouped.get(playerKey) ?? []
    const terminalTime = terminalTimeByName.get(character.charName) ?? character.life.end
    const hasNextCharacter = siblings.some((other) => {
      if (other.charName === character.charName) {
        return false
      }
      const otherLast = terminalTimeByName.get(other.charName) ?? other.life.end
      return otherLast > terminalTime
    })
    const terminalType: CharacterTerminalType = hasNextCharacter ? 'death' : 'logoutMaybe'
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
}

function buildSessionEventPoints(character: CharacterTrack) {
  const points: EventPoint[] = []
  const times = character.track.t
  const xs = character.track.x
  const ys = character.track.y

  if (times.length === 0 || xs.length !== times.length || ys.length !== times.length) {
    return points
  }

  const offlinePairs = new Set(
    character.gaps.offline
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
      .map(([start, end]) => `${start}:${end}`),
  )

  points.push({
    id: `respawn:${character.charName}:${times[0]}`,
    kind: 'respawn',
    charName: character.charName,
    playerName: character.playerName,
    x: xs[0],
    y: ys[0],
    time: times[0],
  })

  for (let index = 1; index < times.length; index += 1) {
    const previousTime = times[index - 1]
    const nextTime = times[index]
    if (!offlinePairs.has(`${previousTime}:${nextTime}`)) {
      continue
    }

    points.push({
      id: `logout:${character.charName}:${previousTime}`,
      kind: 'logout',
      charName: character.charName,
      playerName: character.playerName,
      x: xs[index - 1],
      y: ys[index - 1],
      time: previousTime,
    })
    points.push({
      id: `login:${character.charName}:${nextTime}`,
      kind: 'login',
      charName: character.charName,
      playerName: character.playerName,
      x: xs[index],
      y: ys[index],
      time: nextTime,
    })
  }

  return points
}

export function buildAllEventPoints(
  allCharacters: CharacterTrack[],
  characterTerminalInfoMap: Map<string, CharacterTerminalInfo>,
) {
  const points: EventPoint[] = []
  for (const character of allCharacters) {
    points.push(...buildSessionEventPoints(character))

    const terminalInfo = characterTerminalInfoMap.get(character.charName)
    if (terminalInfo && Number.isFinite(terminalInfo.x) && Number.isFinite(terminalInfo.y)) {
      points.push({
        id: `${terminalInfo.terminalType}:${character.charName}:${terminalInfo.terminalTime}`,
        kind: terminalInfo.terminalType,
        charName: character.charName,
        playerName: terminalInfo.playerName,
        x: terminalInfo.x,
        y: terminalInfo.y,
        time: terminalInfo.terminalTime,
      })
    }
  }
  return points
}

export function filterActiveEventPoints(
  allEventPoints: EventPoint[],
  options: EventVisibilityOptions,
) {
  const {
    visibleEventKinds,
    visibility,
    overlayMode,
    currentTime,
    visibleRange,
    playbackSpeed,
  } = options

  return allEventPoints.filter(
    (point) =>
      visibleEventKinds[point.kind] &&
      visibility[point.charName] !== false &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      isEventVisibleOnCurrentScreen(
        point.time,
        overlayMode,
        currentTime,
        visibleRange,
        playbackSpeed,
      ),
  )
}

export function getCharacterListStateFromEvents(
  character: CharacterTrack,
  currentTime: number,
  activeEventPoints: EventPoint[],
): 'online' | 'dead' | 'inactive' {
  const sample = getPointAtTime(character, currentTime)
  const isOnline =
    sample != null &&
    !sample.beforeStart &&
    !sample.afterEnd &&
    !sample.offline

  if (isOnline) {
    return 'online'
  }

  const hasVisibleDeath = activeEventPoints.some(
    (point) => point.charName === character.charName && point.kind === 'death',
  )

  return hasVisibleDeath ? 'dead' : 'inactive'
}

export function isPlayerRespawnVisible(
  playerCharacters: CharacterTrack[],
  allEventPoints: EventPoint[],
  activeEventPoints: EventPoint[],
) {
  return playerCharacters.some((character) => {
    const spawnPoint = activeEventPoints.find(
      (point) => point.charName === character.charName && point.kind === 'respawn',
    )
    if (!spawnPoint) {
      return false
    }
    return playerCharacters.some(
      (other) =>
        other.charName !== character.charName &&
        allEventPoints.some(
          (point) =>
            point.charName === other.charName &&
            point.kind === 'death' &&
            point.time < spawnPoint.time,
        ),
    )
  })
}

export function getEventKindLabel(kind: EventKind) {
  if (kind === 'respawn') {
    return 'スポーン'
  }
  if (kind === 'login') {
    return 'ログイン'
  }
  if (kind === 'logout') {
    return 'ログアウト'
  }
  if (kind === 'death') {
    return '死亡位置'
  }
  return 'ログアウト?'
}

export function getEventTimeLabel(kind: EventKind) {
  if (kind === 'respawn') {
    return 'スポーン時刻'
  }
  if (kind === 'login') {
    return 'ログイン時刻'
  }
  if (kind === 'logout') {
    return 'ログアウト時刻'
  }
  if (kind === 'death') {
    return '死亡時刻'
  }
  return 'ログアウト?時刻'
}
