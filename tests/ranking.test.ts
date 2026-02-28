import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRankingData, type SnapshotData, type TracksData } from '../src/features/ranking/ranking.js'
import type { CharacterTrack } from '../src/features/domain/characters.js'

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

test('buildRankingData uses track durations for mainstay and terminal deaths for player ranking', () => {
  const tracksData: TracksData = {
    characters: {
      'alice-1': createCharacter('alice-1', 'Alice', 0, 100, [
        [0, 0, 0],
        [100, 10, 10],
      ]),
      'alice-2': createCharacter('alice-2', 'Alice', 120, 220, [
        [120, 20, 20],
        [220, 30, 30],
      ]),
      bob: createCharacter('bob', 'Bob', 0, 50, [
        [0, 0, 0],
        [50, 5, 5],
      ]),
    },
  }

  const snapshotData: SnapshotData = {
    data: {
      a1: { name: 'alice-1', playerName: 'Alice', survivalTime: 100, zombieKills: 2 },
      a2: { name: 'alice-2', playerName: 'Alice', survivalTime: 100, zombieKills: 3 },
      b1: { name: 'bob', playerName: 'Bob', survivalTime: 50, zombieKills: 1 },
    },
  }

  const ranking = buildRankingData(snapshotData, tracksData)
  const mainstayCard = ranking.playerCards.find((card) => card.id === 'mainstay')
  const reaperDotedCard = ranking.playerCards.find((card) => card.id === 'reaper-doted')

  assert.equal(mainstayCard?.sections[0]?.entries[0]?.label, 'Alice')
  assert.equal(reaperDotedCard?.sections[0]?.entries[0]?.label, 'Alice')
  assert.equal(reaperDotedCard?.sections[0]?.entries[0]?.valueLabel, '1 回')
})

test('buildRankingData shows best partner as a single A＆B pair entry', () => {
  const snapshotData: SnapshotData = {
    data: {
      a1: {
        name: 'alice-1',
        playerID: 'p1',
        playerName: 'Alice',
        partners: { 'p2::bob-1': 120 },
      },
      a2: {
        name: 'alice-2',
        playerID: 'p1',
        playerName: 'Alice',
        partners: { 'p2::bob-1': 300 },
      },
      b1: {
        name: 'bob-1',
        playerID: 'p2',
        playerName: 'Bob',
      },
    },
  }

  const ranking = buildRankingData(snapshotData, { characters: {} })
  const partnerCard = ranking.playerCards.find((card) => card.id === 'best-partner')
  const pair = partnerCard?.sections[0]?.entries[0]

  assert.equal(partnerCard?.sections[0]?.entries.length, 1)
  assert.equal(pair?.label, 'Alice＆Bob')
  assert.equal(pair?.subLabel, undefined)
  assert.equal(pair?.valueLabel, '5分')
})

test('buildRankingData hides cards with no collected data', () => {
  const snapshotData: SnapshotData = {
    data: {
      c1: {
        name: 'char-1',
        playerName: 'P1',
        survivalTime: 3600,
        zombieKills: 10,
      },
    },
  }

  const ranking = buildRankingData(snapshotData, { characters: {} })

  assert.equal(ranking.characterCards.some((card) => card.id === 'builder'), false)
  assert.equal(ranking.characterCards.some((card) => card.id === 'woodcutter'), false)
  assert.equal(ranking.playerCards.some((card) => card.id === 'builder'), false)
})

test('buildRankingData creates survivor and social sections from snapshot metrics', () => {
  const snapshotData: SnapshotData = {
    data: {
      c1: {
        name: 'char-1',
        playerName: 'P1',
        survivalTime: 3600,
        zombieKills: 10,
        socialTime: 7200,
        lonerTime: 1200,
      },
      c2: {
        name: 'char-2',
        playerName: 'P2',
        survivalTime: 5400,
        zombieKills: 0,
        socialTime: 1800,
        lonerTime: 8400,
      },
    },
  }

  const ranking = buildRankingData(snapshotData, { characters: {} })
  const survivorCard = ranking.characterCards.find((card) => card.id === 'survivor')
  const socialCard = ranking.characterCards.find((card) => card.id === 'social')

  assert.equal(survivorCard?.sections[0]?.entries[0]?.label, 'char-2')
  assert.equal(socialCard?.sections[0]?.entries[0]?.label, 'char-1')
  assert.equal(socialCard?.sections[1]?.entries[0]?.label, 'char-2')
})

test('buildRankingData keeps all ranking entries for UI-side expansion', () => {
  const snapshotData: SnapshotData = {
    data: {
      c1: { name: 'char-1', playerName: 'P1', survivalTime: 1000 },
      c2: { name: 'char-2', playerName: 'P2', survivalTime: 2000 },
      c3: { name: 'char-3', playerName: 'P3', survivalTime: 3000 },
      c4: { name: 'char-4', playerName: 'P4', survivalTime: 4000 },
    },
  }

  const ranking = buildRankingData(snapshotData, { characters: {} })
  const survivorCard = ranking.characterCards.find((card) => card.id === 'survivor')

  assert.equal(survivorCard?.sections[0]?.entries.length, 4)
  assert.equal(survivorCard?.sections[0]?.entries[0]?.label, 'char-4')
  assert.equal(survivorCard?.sections[0]?.entries[3]?.label, 'char-1')
})
