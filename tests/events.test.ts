import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAllEventPoints,
  buildCharacterTerminalInfoMap,
  filterActiveEventPoints,
  getEventKindLabel,
  getEventTimeLabel,
  isPlayerRespawnVisible,
} from '../src/features/events/events.js'
import type { CharacterTrack } from '../src/features/domain/characters.js'

function createCharacter(
  charName: string,
  playerName: string,
  start: number,
  end: number,
  samples: Array<[number, number, number]>,
  offlineGaps: Array<[number, number]> = [],
): CharacterTrack {
  return {
    charName,
    playerName,
    life: { start, end },
    track: {
      t: samples.map(([t]) => t),
      x: samples.map(([, x]) => x),
      y: samples.map(([, , y]) => y),
    },
    gaps: { offline: offlineGaps },
  }
}

test('buildCharacterTerminalInfoMap marks a replaced character as death', () => {
  const first = createCharacter('alice-1', 'alice', 0, 100, [
    [0, 0, 0],
    [100, 10, 10],
  ])
  const second = createCharacter('alice-2', 'alice', 120, 200, [
    [120, 20, 20],
    [200, 30, 30],
  ])

  const info = buildCharacterTerminalInfoMap([first, second])
  assert.equal(info.get('alice-1')?.terminalType, 'death')
  assert.equal(info.get('alice-2')?.terminalType, 'logoutMaybe')
})

test('filterActiveEventPoints respects time window and visibility toggles', () => {
  const character = createCharacter('alice-1', 'alice', 0, 100, [
    [0, 0, 0],
    [100, 10, 10],
  ])
  const terminals = buildCharacterTerminalInfoMap([character])
  const allPoints = buildAllEventPoints([character], terminals)

  const active = filterActiveEventPoints(allPoints, {
    visibleEventKinds: {
      respawn: true,
      login: false,
      logout: false,
      death: true,
      logoutMaybe: false,
    },
    visibility: { 'alice-1': true },
    overlayMode: 'normal',
    currentTime: 1,
    visibleRange: { start: 0, end: 100 },
    playbackSpeed: 1,
  })

  assert.equal(active.length, 1)
  assert.equal(active[0]?.kind, 'respawn')
})

test('isPlayerRespawnVisible turns on when a death is followed by a spawn', () => {
  const first = createCharacter('alice-1', 'alice', 0, 100, [
    [0, 0, 0],
    [100, 10, 10],
  ])
  const second = createCharacter('alice-2', 'alice', 120, 200, [
    [120, 20, 20],
    [200, 30, 30],
  ])
  const terminals = buildCharacterTerminalInfoMap([first, second])
  const allPoints = buildAllEventPoints([first, second], terminals)
  const activePoints = allPoints.filter((point) => point.kind === 'respawn' && point.charName === 'alice-2')

  assert.equal(isPlayerRespawnVisible([first, second], allPoints, activePoints), true)
})

test('getEventKindLabel returns the Japanese UI label', () => {
  assert.equal(getEventKindLabel('logoutMaybe'), 'ログアウト?')
})

test('event labels cover login and logout variants', () => {
  assert.equal(getEventKindLabel('login'), 'ログイン')
  assert.equal(getEventKindLabel('logout'), 'ログアウト')
  assert.equal(getEventTimeLabel('login'), 'ログイン時刻')
  assert.equal(getEventTimeLabel('logout'), 'ログアウト時刻')
})

test('buildAllEventPoints adds login and logout around offline gaps', () => {
  const character = createCharacter(
    'alice-1',
    'alice',
    0,
    120,
    [
      [0, 0, 0],
      [10, 10, 10],
      [100, 30, 30],
      [120, 40, 40],
    ],
    [[10, 100]],
  )

  const terminals = buildCharacterTerminalInfoMap([character])
  const allPoints = buildAllEventPoints([character], terminals)

  assert.equal(allPoints.some((point) => point.kind === 'logout' && point.time === 10), true)
  assert.equal(allPoints.some((point) => point.kind === 'login' && point.time === 100), true)
})
