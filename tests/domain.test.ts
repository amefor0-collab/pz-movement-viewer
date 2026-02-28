import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getCurrentOnlineIntervalStart,
  getNearestOnlineTimeForCharacters,
  selectTrackingCharacter,
  type CharacterTrack,
} from '../src/features/domain/characters.js'

function createCharacter(
  charName: string,
  playerName: string,
  start: number,
  end: number,
  samples: Array<[number, number, number]>,
  offline: Array<[number, number]> = [],
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
    gaps: { offline },
  }
}

test('selectTrackingCharacter prefers the online character for the player', () => {
  const older = createCharacter('old', 'alice', 0, 100, [
    [0, 0, 0],
    [100, 10, 10],
  ])
  const newer = createCharacter('new', 'alice', 120, 220, [
    [120, 20, 20],
    [220, 30, 30],
  ])

  assert.equal(selectTrackingCharacter([older, newer], 150)?.charName, 'new')
})

test('getCurrentOnlineIntervalStart returns the current online segment start', () => {
  const character = createCharacter(
    'alice-1',
    'alice',
    0,
    300,
    [
      [0, 0, 0],
      [100, 10, 10],
      [200, 20, 20],
      [300, 30, 30],
    ],
    [[100, 220]],
  )

  assert.equal(getCurrentOnlineIntervalStart(character, 50), 0)
  assert.equal(getCurrentOnlineIntervalStart(character, 250), 220)
})

test('getNearestOnlineTimeForCharacters finds the closest playable timestamp', () => {
  const first = createCharacter(
    'alpha',
    'p1',
    0,
    200,
    [
      [0, 0, 0],
      [200, 20, 20],
    ],
    [[40, 150]],
  )
  const second = createCharacter('beta', 'p1', 220, 400, [
    [220, 20, 20],
    [400, 50, 50],
  ])

  const nearest = getNearestOnlineTimeForCharacters([first, second], 215)
  assert.equal(nearest?.character.charName, 'beta')
  assert.equal(nearest?.time, 220)
})
