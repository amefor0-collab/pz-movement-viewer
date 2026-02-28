import fs from 'node:fs'
import path from 'node:path'

function parseCsvLine(line) {
  return line.split(',').map((value) => value.trim())
}

function unixSecFromJst(y, m, d, hh = 0, mm = 0, ss = 0) {
  const utcMs = Date.UTC(y, m - 1, d, hh - 9, mm, ss)
  return Math.floor(utcMs / 1000)
}

function sanitizePlayerName(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed === 'ㅤㅤㅤ') {
    return ''
  }
  if (trimmed.toLowerCase() === 'admin') {
    return ''
  }
  return trimmed
}

const PERIOD_START = unixSecFromJst(2026, 2, 1, 21, 0, 0)
const PERIOD_END = unixSecFromJst(2026, 2, 28, 23, 0, 0)
const OFFLINE_GAP_SEC = 2 * 60 * 60

const ROOT = process.cwd()
const dataDir = path.join(ROOT, 'data')
const publicDataDir = path.join(ROOT, 'public', 'data')
const csvPath = path.join(dataDir, 'movement.csv')
const snapshotPath = path.join(dataDir, 'snapshot.json')
const mapLatestPath = path.join(dataDir, 'map_latest.bmp')
const tracksOutPath = path.join(publicDataDir, 'tracks.json')
const snapshotOutPath = path.join(publicDataDir, 'snapshot.json')
const mapLatestOutPath = path.join(publicDataDir, 'map_latest.bmp')

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'))
const publicSnapshot = JSON.parse(JSON.stringify(snapshot))
const charToPlayerName = new Map()

for (const entry of Object.values(snapshot.data ?? {})) {
  const charName = String(entry?.name ?? '').trim()
  const playerName = sanitizePlayerName(entry?.playerName)
  if (!charName) {
    continue
  }
  if (charToPlayerName.has(charName)) {
    throw new Error(`Duplicate character name in snapshot: "${charName}"`)
  }
  charToPlayerName.set(charName, playerName)
}

for (const entry of Object.values(publicSnapshot.data ?? {})) {
  if (!entry || typeof entry !== 'object') {
    continue
  }
  entry.playerName = sanitizePlayerName(entry.playerName)
}

const characters = new Map()

function getOrCreateCharacter(charName) {
  if (!characters.has(charName)) {
    characters.set(charName, {
      charName,
      playerName: charToPlayerName.get(charName) ?? '',
      life: { start: null, end: null },
      track: { t: [], x: [], y: [] },
      gaps: { offline: [] },
    })
  }
  return characters.get(charName)
}

const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean)

for (const line of lines) {
  const cols = parseCsvLine(line)
  if (cols.length < 6) {
    continue
  }

  const t = Number.parseInt(cols[0], 10)
  const charName = String(cols[2] ?? '').trim()
  const x = Number.parseInt(cols[3], 10)
  const y = Number.parseInt(cols[4], 10)
  const event = cols.length >= 7 ? String(cols[6] ?? '').trim() : 'move'

  if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) {
    continue
  }
  if (!charName) {
    continue
  }
  if (event !== 'move') {
    continue
  }
  if (t < PERIOD_START || t > PERIOD_END) {
    continue
  }

  const character = getOrCreateCharacter(charName)
  const times = character.track.t
  const xs = character.track.x
  const ys = character.track.y
  const count = times.length

  if (count > 0) {
    const prevT = times[count - 1]
    const prevX = xs[count - 1]
    const prevY = ys[count - 1]

    if (t < prevT) {
      continue
    }
    if (t === prevT && prevX === x && prevY === y) {
      continue
    }
    if (t - prevT > OFFLINE_GAP_SEC) {
      character.gaps.offline.push([prevT, t])
    }
  }

  times.push(t)
  xs.push(x)
  ys.push(y)

  if (character.life.start == null) {
    character.life.start = t
  }
  character.life.end = t
}

const tracks = {
  meta: {
    timezone: 'Asia/Tokyo',
    periodJST: {
      start: '2026-02-01T21:00:00+09:00',
      end: '2026-02-28T23:00:00+09:00',
    },
    bounds: {
      worldW: 15000 - 3000,
      worldH: 13500 - 900,
      mapW: 22562,
      mapH: 23690,
      worldMinX: 3000,
      worldMinY: 900,
      mapScale: 1.88,
    },
    offlineGapSec: OFFLINE_GAP_SEC,
  },
  characters: Object.fromEntries(characters.entries()),
}

fs.mkdirSync(publicDataDir, { recursive: true })
fs.writeFileSync(tracksOutPath, JSON.stringify(tracks), 'utf-8')
fs.writeFileSync(snapshotOutPath, JSON.stringify(publicSnapshot), 'utf-8')
const copiedMaps = []
if (fs.existsSync(mapLatestPath)) {
  fs.copyFileSync(mapLatestPath, mapLatestOutPath)
  copiedMaps.push(mapLatestOutPath)
}

console.log('Wrote', tracksOutPath)
console.log('Copied', snapshotOutPath)
for (const copiedMapPath of copiedMaps) {
  console.log('Copied', copiedMapPath)
}
if (copiedMaps.length === 0) {
  console.log('Map image not found in data/:', 'map_latest.bmp')
}
console.log('Characters:', characters.size)
