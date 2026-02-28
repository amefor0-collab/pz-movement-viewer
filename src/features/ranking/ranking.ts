import { getCharacterOnlineIntervals, type CharacterTrack } from '../domain/characters.js'
import { buildCharacterTerminalInfoMap } from '../events/events.js'

export type SnapshotRecord = Record<string, unknown> & {
  name?: string
  playerID?: string
  playerName?: string
  partners?: Record<string, unknown>
}

export type SnapshotData = {
  data?: Record<string, SnapshotRecord>
}

export type TracksData = {
  characters: Record<string, CharacterTrack>
}

export type RankingEntry = {
  id: string
  label: string
  subLabel?: string
  valueLabel: string
}

export type RankingSection = {
  id: string
  title?: string
  entries: RankingEntry[]
}

export type RankingCard = {
  id: string
  title: string
  description: string
  unit: string
  sections: RankingSection[]
}

export type RankingData = {
  characterCards: RankingCard[]
  playerCards: RankingCard[]
  totalCharacters: number
  totalPlayers: number
}

type CharacterMetric = {
  charName: string
  playerName: string
  survivalTime: number
  zombieKills: number
  explorerScore: number
  serveCount: number
  serveCalories: number
  serveWaterIntake: number
  wreckerScore: number
  farming: number
  build: number
  fishCount: number
  fishTrashCount: number
  trapping: number
  mechanics: number
  socialTime: number
  lonerTime: number
}

type PlayerAggregate = {
  playerName: string
  characterNames: string[]
  currentCharacterName: string
  onlineTimeSec: number
  totalSurvivalTime: number
  totalZombieKills: number
  explorerScore: number
  deathCount: number
  serveCount: number
  serveCalories: number
  serveWaterIntake: number
  wreckerScore: number
  farming: number
  build: number
  fishCount: number
  fishTrashCount: number
  trapping: number
  mechanics: number
  socialTime: number
  lonerTime: number
  bestPartnerName: string | null
  bestPartnerSec: number
}

const PACIFIST_MIN_SURVIVAL_SEC = 24 * 60 * 60

function normalizePlayerName(name: string, fallback: string) {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function readString(record: SnapshotRecord, key: string) {
  const raw = record[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function readNumber(record: SnapshotRecord, key: string) {
  const raw = record[key]
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString('ja-JP')
}

function formatDecimal(value: number) {
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: value % 1 === 0 ? 0 : 1,
  })
}

function formatDurationShort(totalSec: number) {
  const clamped = Math.max(0, Math.round(totalSec))
  const days = Math.floor(clamped / 86400)
  const hours = Math.floor((clamped % 86400) / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)

  if (days > 0) {
    return hours > 0 ? `${days}日 ${hours}時間` : `${days}日`
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}時間 ${minutes}分` : `${hours}時間`
  }
  return `${Math.max(1, minutes)}分`
}

function collectCharacterMetrics(snapshotData: SnapshotData | null) {
  if (!snapshotData?.data) {
    return []
  }

  const metrics: CharacterMetric[] = []
  for (const record of Object.values(snapshotData.data)) {
    const charName = readString(record, 'name')
    if (!charName) {
      continue
    }

    metrics.push({
      charName,
      playerName: normalizePlayerName(
        readString(record, 'playerName'),
        readString(record, 'playerID') || charName,
      ),
      survivalTime: readNumber(record, 'survivalTime'),
      zombieKills: readNumber(record, 'zombieKills'),
      explorerScore: readNumber(record, 'explorerScore'),
      serveCount: readNumber(record, 'serveCount'),
      serveCalories: readNumber(record, 'serveCalories'),
      serveWaterIntake: readNumber(record, 'serveWaterIntake'),
      wreckerScore: readNumber(record, 'wreckerScore'),
      farming: readNumber(record, 'farming'),
      build: readNumber(record, 'build'),
      fishCount: readNumber(record, 'fishCount'),
      fishTrashCount: readNumber(record, 'fishTrashCount'),
      trapping: readNumber(record, 'trapping'),
      mechanics: readNumber(record, 'mechanics'),
      socialTime: readNumber(record, 'socialTime'),
      lonerTime: readNumber(record, 'lonerTime'),
    })
  }

  return metrics
}

function resolvePartnerName(
  partnerKey: string,
  playerIdToName: Map<string, string>,
  charNameToPlayerName: Map<string, string>,
) {
  const [partnerPlayerId, partnerCharName] = partnerKey.split('::')
  const byId = partnerPlayerId ? playerIdToName.get(partnerPlayerId) : null
  if (byId && byId.trim()) {
    return byId
  }
  const byChar = partnerCharName ? charNameToPlayerName.get(partnerCharName) : null
  if (byChar && byChar.trim()) {
    return byChar
  }
  return partnerCharName?.trim() || partnerPlayerId?.trim() || partnerKey
}

function createEmptyPlayerAggregate(playerName: string, currentCharacterName: string): PlayerAggregate {
  return {
    playerName,
    characterNames: [],
    currentCharacterName,
    onlineTimeSec: 0,
    totalSurvivalTime: 0,
    totalZombieKills: 0,
    explorerScore: 0,
    deathCount: 0,
    serveCount: 0,
    serveCalories: 0,
    serveWaterIntake: 0,
    wreckerScore: 0,
    farming: 0,
    build: 0,
    fishCount: 0,
    fishTrashCount: 0,
    trapping: 0,
    mechanics: 0,
    socialTime: 0,
    lonerTime: 0,
    bestPartnerName: null,
    bestPartnerSec: 0,
  }
}

function buildPlayerAggregates(
  snapshotData: SnapshotData | null,
  tracksData: TracksData | null,
) {
  const groups = new Map<string, PlayerAggregate>()
  const playerIdToName = new Map<string, string>()
  const charNameToPlayerName = new Map<string, string>()
  const partnerMaps = new Map<string, Map<string, number>>()
  const snapshotRecords = snapshotData?.data ? Object.values(snapshotData.data) : []

  for (const record of snapshotRecords) {
    const charName = readString(record, 'name')
    if (!charName) {
      continue
    }
    const playerID = readString(record, 'playerID')
    const playerName = normalizePlayerName(readString(record, 'playerName'), playerID || charName)
    if (playerID) {
      playerIdToName.set(playerID, playerName)
    }
    charNameToPlayerName.set(charName, playerName)
  }

  for (const record of snapshotRecords) {
    const charName = readString(record, 'name')
    if (!charName) {
      continue
    }

    const playerID = readString(record, 'playerID')
    const playerName = normalizePlayerName(readString(record, 'playerName'), playerID || charName)
    const aggregate =
      groups.get(playerName) ?? createEmptyPlayerAggregate(playerName, charName)

    if (!aggregate.characterNames.includes(charName)) {
      aggregate.characterNames.push(charName)
    }

    aggregate.totalSurvivalTime += readNumber(record, 'survivalTime')
    aggregate.totalZombieKills += readNumber(record, 'zombieKills')
    aggregate.explorerScore = Math.max(aggregate.explorerScore, readNumber(record, 'explorerScore'))
    aggregate.serveCount += readNumber(record, 'serveCount')
    aggregate.serveCalories += readNumber(record, 'serveCalories')
    aggregate.serveWaterIntake += readNumber(record, 'serveWaterIntake')
    aggregate.wreckerScore += readNumber(record, 'wreckerScore')
    aggregate.farming += readNumber(record, 'farming')
    aggregate.build += readNumber(record, 'build')
    aggregate.fishCount += readNumber(record, 'fishCount')
    aggregate.fishTrashCount += readNumber(record, 'fishTrashCount')
    aggregate.trapping += readNumber(record, 'trapping')
    aggregate.mechanics += readNumber(record, 'mechanics')
    aggregate.socialTime += readNumber(record, 'socialTime')
    aggregate.lonerTime += readNumber(record, 'lonerTime')

    const rawPartners = record.partners
    if (rawPartners && typeof rawPartners === 'object' && !Array.isArray(rawPartners)) {
      const partnerMap = partnerMaps.get(playerName) ?? new Map<string, number>()
      for (const [partnerKey, rawValue] of Object.entries(rawPartners)) {
        const duration =
          typeof rawValue === 'number'
            ? rawValue
            : typeof rawValue === 'string'
              ? Number(rawValue)
              : 0
        if (!Number.isFinite(duration) || duration <= 0) {
          continue
        }
        const resolvedName = resolvePartnerName(partnerKey, playerIdToName, charNameToPlayerName)
        if (!resolvedName || resolvedName === playerName) {
          continue
        }
        partnerMap.set(resolvedName, Math.max(partnerMap.get(resolvedName) ?? 0, duration))
      }
      partnerMaps.set(playerName, partnerMap)
    }

    groups.set(playerName, aggregate)
  }

  if (tracksData?.characters) {
    const allCharacters = Object.values(tracksData.characters)
    const terminalInfo = buildCharacterTerminalInfoMap(allCharacters)

    for (const character of allCharacters) {
      const playerName = normalizePlayerName(character.playerName, character.charName)
      const aggregate =
        groups.get(playerName) ?? createEmptyPlayerAggregate(playerName, character.charName)

      if (!aggregate.characterNames.includes(character.charName)) {
        aggregate.characterNames.push(character.charName)
      }

      const currentCharacter =
        tracksData.characters[aggregate.currentCharacterName] ?? null
      if (!currentCharacter || character.life.end > currentCharacter.life.end) {
        aggregate.currentCharacterName = character.charName
      }

      const onlineTime = getCharacterOnlineIntervals(character).reduce(
        (sum, interval) => sum + Math.max(0, interval.end - interval.start),
        0,
      )
      aggregate.onlineTimeSec += onlineTime

      if (terminalInfo.get(character.charName)?.terminalType === 'death') {
        aggregate.deathCount += 1
      }

      groups.set(playerName, aggregate)
    }
  }

  for (const [playerName, aggregate] of groups.entries()) {
    const partnerMap = partnerMaps.get(playerName)
    if (!partnerMap || partnerMap.size === 0) {
      continue
    }
    const best = [...partnerMap.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'),
    )[0]
    if (!best) {
      continue
    }
    aggregate.bestPartnerName = best[0]
    aggregate.bestPartnerSec = best[1]
  }

  return [...groups.values()].sort((a, b) => a.playerName.localeCompare(b.playerName, 'ja'))
}

function createSingleCard(
  id: string,
  title: string,
  description: string,
  unit: string,
  entries: RankingEntry[],
) {
  if (entries.length === 0) {
    return null
  }
  return {
    id,
    title,
    description,
    unit,
    sections: [
      {
        id: `${id}:main`,
        entries,
      },
    ],
  } satisfies RankingCard
}

function createSection(
  id: string,
  title: string | undefined,
  entries: RankingEntry[],
) {
  if (entries.length === 0) {
    return null
  }
  return {
    id,
    title,
    entries,
  } satisfies RankingSection
}

function buildCharacterCards(characterMetrics: CharacterMetric[]) {
  const survivors = [...characterMetrics]
    .filter((character) => character.survivalTime > 0)
    .sort((a, b) => b.survivalTime - a.survivalTime || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDurationShort(character.survivalTime),
    }))

  const reapers = [...characterMetrics]
    .filter((character) => character.zombieKills > 0)
    .sort((a, b) => b.zombieKills - a.zombieKills || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: `${formatCount(character.zombieKills)} キル`,
    }))

  const pacifistPool = characterMetrics.filter((character) => character.survivalTime > 0)
  const pacifistCandidates = pacifistPool.some(
    (character) => character.survivalTime >= PACIFIST_MIN_SURVIVAL_SEC,
  )
    ? pacifistPool.filter((character) => character.survivalTime >= PACIFIST_MIN_SURVIVAL_SEC)
    : pacifistPool
  const pacifists = [...pacifistCandidates]
    .sort(
      (a, b) =>
        a.zombieKills - b.zombieKills ||
        b.survivalTime - a.survivalTime ||
        a.charName.localeCompare(b.charName, 'ja'),
    )
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: `${character.playerName} / ${formatDurationShort(character.survivalTime)}`,
      valueLabel: `キル ${formatCount(character.zombieKills)}`,
    }))

  const chefs = [...characterMetrics]
    .filter(
      (character) =>
        character.serveCount > 0 ||
        character.serveCalories > 0 ||
        character.serveWaterIntake > 0,
    )
    .sort(
      (a, b) =>
        b.serveCount - a.serveCount ||
        b.serveCalories - a.serveCalories ||
        b.serveWaterIntake - a.serveWaterIntake ||
        a.charName.localeCompare(b.charName, 'ja'),
    )
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel:
        character.serveCount > 0
          ? `提供 ${formatCount(character.serveCount)} 回`
          : `提供 ${formatDecimal(character.serveCalories)} kcal`,
    }))

  const wreckers = [...characterMetrics]
    .filter((character) => character.wreckerScore > 0)
    .sort((a, b) => b.wreckerScore - a.wreckerScore || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatCount(character.wreckerScore),
    }))

  const farmers = [...characterMetrics]
    .filter((character) => character.farming > 0)
    .sort((a, b) => b.farming - a.farming || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDecimal(character.farming),
    }))

  const builders = [...characterMetrics]
    .filter((character) => character.build > 0)
    .sort((a, b) => b.build - a.build || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDecimal(character.build),
    }))

  const anglers = [...characterMetrics]
    .filter((character) => character.fishCount > 0)
    .sort((a, b) => b.fishCount - a.fishCount || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: `${character.playerName} / 外道 ${formatCount(character.fishTrashCount)}`,
      valueLabel: `${formatCount(character.fishCount)} 匹`,
    }))

  const trappers = [...characterMetrics]
    .filter((character) => character.trapping > 0)
    .sort((a, b) => b.trapping - a.trapping || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDecimal(character.trapping),
    }))

  const mechanics = [...characterMetrics]
    .filter((character) => character.mechanics > 0)
    .sort((a, b) => b.mechanics - a.mechanics || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: character.charName,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDecimal(character.mechanics),
    }))

  const socials = [...characterMetrics]
    .filter((character) => character.socialTime > 0)
    .sort((a, b) => b.socialTime - a.socialTime || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: `social:${character.charName}`,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDurationShort(character.socialTime),
    }))

  const loners = [...characterMetrics]
    .filter((character) => character.lonerTime > 0)
    .sort((a, b) => b.lonerTime - a.lonerTime || a.charName.localeCompare(b.charName, 'ja'))
    .map((character) => ({
      id: `loner:${character.charName}`,
      label: character.charName,
      subLabel: character.playerName,
      valueLabel: formatDurationShort(character.lonerTime),
    }))

  const socialCardSectionCandidates: Array<RankingSection | null> = [
    createSection('social:section', '社交家', socials),
    createSection('loner:section', '一匹狼', loners),
  ]
  const socialCardSections = socialCardSectionCandidates.filter(
    (section): section is RankingSection => section != null,
  )

  const cards = [
    createSingleCard('survivor', '生存者', '最も長く生き残ったキャラクターです。', 'キャラ', survivors),
    createSingleCard('reaper-possessed', '死神: 憑依', 'ゾンビキル数が多いキャラクターです。', 'キャラ', reapers),
    createSingleCard('pacifist', '平和主義者', '長時間生存しつつキル数が少ないキャラクターです。', 'キャラ', pacifists),
    createSingleCard('chef', '料理長', '提供行動が多いキャラクターです。', 'キャラ', chefs),
    createSingleCard('wrecker', '廃車屋', '車両破壊や損傷スコアが高いキャラクターです。', 'キャラ', wreckers),
    createSingleCard('farmer', '農場主', '農業系の行動量が多いキャラクターです。', 'キャラ', farmers),
    createSingleCard('builder', '建築家', '建築・設置系の行動量が多いキャラクターです。', 'キャラ', builders),
    createSingleCard('angler', '釣り人', '釣果が多いキャラクターです。', 'キャラ', anglers),
    createSingleCard('trapper', '罠師', '罠設置や回収が多いキャラクターです。', 'キャラ', trappers),
    createSingleCard('mechanic', '整備士', '車両整備の行動量が多いキャラクターです。', 'キャラ', mechanics),
    socialCardSections.length > 0
      ? {
          id: 'social',
          title: '社交家 / 一匹狼',
          description: 'socialTime と lonerTime の上位です。',
          unit: 'キャラ',
          sections: socialCardSections,
        }
      : null,
  ]

  return cards.filter((card): card is RankingCard => card != null)
}

function buildPlayerCards(playerAggregates: PlayerAggregate[]) {
  const survivors = [...playerAggregates]
    .filter((player) => player.totalSurvivalTime > 0)
    .sort(
      (a, b) =>
        b.totalSurvivalTime - a.totalSurvivalTime ||
        a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `survivor:${player.playerName}`,
      label: player.playerName,
      subLabel: `現在 ${player.currentCharacterName}`,
      valueLabel: formatDurationShort(player.totalSurvivalTime),
    }))

  const mainstays = [...playerAggregates]
    .filter((player) => player.onlineTimeSec > 0)
    .sort(
      (a, b) => b.onlineTimeSec - a.onlineTimeSec || a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `mainstay:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ / 現在 ${player.currentCharacterName}`,
      valueLabel: formatDurationShort(player.onlineTimeSec),
    }))

  const reapers = [...playerAggregates]
    .filter((player) => player.totalZombieKills > 0)
    .sort(
      (a, b) =>
        b.totalZombieKills - a.totalZombieKills ||
        a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `reaper:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: `${formatCount(player.totalZombieKills)} キル`,
    }))

  const pacifistPool = playerAggregates.filter((player) => player.totalSurvivalTime > 0)
  const pacifistCandidates = pacifistPool.some(
    (player) => player.totalSurvivalTime >= PACIFIST_MIN_SURVIVAL_SEC,
  )
    ? pacifistPool.filter((player) => player.totalSurvivalTime >= PACIFIST_MIN_SURVIVAL_SEC)
    : pacifistPool
  const pacifists = [...pacifistCandidates]
    .sort(
      (a, b) =>
        a.totalZombieKills - b.totalZombieKills ||
        b.totalSurvivalTime - a.totalSurvivalTime ||
        a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `pacifist:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ / ${formatDurationShort(player.totalSurvivalTime)}`,
      valueLabel: `キル ${formatCount(player.totalZombieKills)}`,
    }))

  const explorers = [...playerAggregates]
    .filter((player) => player.explorerScore > 0)
    .sort(
      (a, b) =>
        b.explorerScore - a.explorerScore ||
        a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `explorer:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatCount(player.explorerScore),
    }))

  const chefs = [...playerAggregates]
    .filter(
      (player) =>
        player.serveCount > 0 ||
        player.serveCalories > 0 ||
        player.serveWaterIntake > 0,
    )
    .sort(
      (a, b) =>
        b.serveCount - a.serveCount ||
        b.serveCalories - a.serveCalories ||
        b.serveWaterIntake - a.serveWaterIntake ||
        a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `chef:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel:
        player.serveCount > 0
          ? `提供 ${formatCount(player.serveCount)} 回`
          : `提供 ${formatDecimal(player.serveCalories)} kcal`,
    }))

  const wreckers = [...playerAggregates]
    .filter((player) => player.wreckerScore > 0)
    .sort(
      (a, b) => b.wreckerScore - a.wreckerScore || a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `wrecker:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatCount(player.wreckerScore),
    }))

  const farmers = [...playerAggregates]
    .filter((player) => player.farming > 0)
    .sort((a, b) => b.farming - a.farming || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `farmer:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatDecimal(player.farming),
    }))

  const builders = [...playerAggregates]
    .filter((player) => player.build > 0)
    .sort((a, b) => b.build - a.build || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `builder:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatDecimal(player.build),
    }))

  const anglers = [...playerAggregates]
    .filter((player) => player.fishCount > 0)
    .sort((a, b) => b.fishCount - a.fishCount || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `angler:${player.playerName}`,
      label: player.playerName,
      subLabel: `外道 ${formatCount(player.fishTrashCount)}`,
      valueLabel: `${formatCount(player.fishCount)} 匹`,
    }))

  const trappers = [...playerAggregates]
    .filter((player) => player.trapping > 0)
    .sort((a, b) => b.trapping - a.trapping || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `trapper:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatDecimal(player.trapping),
    }))

  const mechanics = [...playerAggregates]
    .filter((player) => player.mechanics > 0)
    .sort((a, b) => b.mechanics - a.mechanics || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `mechanic:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatDecimal(player.mechanics),
    }))

  const socials = [...playerAggregates]
    .filter((player) => player.socialTime > 0)
    .sort(
      (a, b) => b.socialTime - a.socialTime || a.playerName.localeCompare(b.playerName, 'ja'),
    )
    .map((player) => ({
      id: `social:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatDurationShort(player.socialTime),
    }))

  const loners = [...playerAggregates]
    .filter((player) => player.lonerTime > 0)
    .sort((a, b) => b.lonerTime - a.lonerTime || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `loner:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: formatDurationShort(player.lonerTime),
    }))

  const reaperDoted = [...playerAggregates]
    .filter((player) => player.deathCount > 0)
    .sort((a, b) => b.deathCount - a.deathCount || a.playerName.localeCompare(b.playerName, 'ja'))
    .map((player) => ({
      id: `death:${player.playerName}`,
      label: player.playerName,
      subLabel: `${player.characterNames.length} キャラ`,
      valueLabel: `${formatCount(player.deathCount)} 回`,
    }))

  const bestPartnerPairs = new Map<
    string,
    { label: string; durationSec: number; sortNames: [string, string] }
  >()
  for (const player of playerAggregates) {
    if (!player.bestPartnerName || player.bestPartnerSec <= 0) {
      continue
    }

    const pairNames = [player.playerName, player.bestPartnerName].sort((a, b) =>
      a.localeCompare(b, 'ja'),
    ) as [string, string]
    const pairKey = `${pairNames[0]}::${pairNames[1]}`
    const previous = bestPartnerPairs.get(pairKey)
    if (previous && previous.durationSec >= player.bestPartnerSec) {
      continue
    }

    bestPartnerPairs.set(pairKey, {
      label: `${pairNames[0]}＆${pairNames[1]}`,
      durationSec: player.bestPartnerSec,
      sortNames: pairNames,
    })
  }

  const bestPartners = [...bestPartnerPairs.entries()]
    .sort(
      (a, b) =>
        b[1].durationSec - a[1].durationSec ||
        a[1].sortNames[0].localeCompare(b[1].sortNames[0], 'ja') ||
        a[1].sortNames[1].localeCompare(b[1].sortNames[1], 'ja'),
    )
    .map(([pairKey, pair]) => ({
      id: `partner:${pairKey}`,
      label: pair.label,
      valueLabel: formatDurationShort(pair.durationSec),
    }))

  const socialSectionCandidates: Array<RankingSection | null> = [
    createSection('player-social', '社交家', socials),
    createSection('player-loner', '一匹狼', loners),
  ]
  const socialSections = socialSectionCandidates.filter(
    (section): section is RankingSection => section != null,
  )

  const cards = [
    createSingleCard('mainstay', '大黒柱', 'オンライン時間が長いプレイヤーです。', 'プレイヤー', mainstays),
    createSingleCard('survivor', '生存者', '総生存時間が長いプレイヤーです。', 'プレイヤー', survivors),
    createSingleCard('reaper-possessed', '死神: 憑依', 'ゾンビキル数合計が多いプレイヤーです。', 'プレイヤー', reapers),
    createSingleCard('pacifist', '平和主義者', '総生存時間に対してキル数が少ないプレイヤーです。', 'プレイヤー', pacifists),
    createSingleCard('explorer', '探索者', '探索済みマップ範囲が広いプレイヤーです。', 'プレイヤー', explorers),
    createSingleCard('chef', '料理長', '提供行動が多いプレイヤーです。', 'プレイヤー', chefs),
    createSingleCard('wrecker', '廃車屋', '車両破壊や損傷スコア合計が高いプレイヤーです。', 'プレイヤー', wreckers),
    createSingleCard('farmer', '農場主', '農業系の行動量が多いプレイヤーです。', 'プレイヤー', farmers),
    createSingleCard('builder', '建築家', '建築・設置系の行動量が多いプレイヤーです。', 'プレイヤー', builders),
    createSingleCard('angler', '釣り人', '釣果が多いプレイヤーです。', 'プレイヤー', anglers),
    createSingleCard('trapper', '罠師', '罠設置や回収が多いプレイヤーです。', 'プレイヤー', trappers),
    createSingleCard('mechanic', '整備士', '車両整備の行動量が多いプレイヤーです。', 'プレイヤー', mechanics),
    socialSections.length > 0
      ? {
          id: 'social',
          title: '社交家 / 一匹狼',
          description: 'socialTime と lonerTime の合計上位です。',
          unit: 'プレイヤー',
          sections: socialSections,
        }
      : null,
    createSingleCard('reaper-doted', '死神: 寵愛', '死亡回数が多いプレイヤーです。', 'プレイヤー', reaperDoted),
    createSingleCard('best-partner', 'ベストパートナー', '最も長く一緒に行動した相手がいるプレイヤーです。', 'プレイヤー', bestPartners),
  ]

  return cards.filter((card): card is RankingCard => card != null)
}

export function buildRankingData(
  snapshotData: SnapshotData | null,
  tracksData: TracksData | null,
): RankingData {
  const characterMetrics = collectCharacterMetrics(snapshotData)
  const playerAggregates = buildPlayerAggregates(snapshotData, tracksData)

  return {
    characterCards: buildCharacterCards(characterMetrics),
    playerCards: buildPlayerCards(playerAggregates),
    totalCharacters: characterMetrics.length,
    totalPlayers: playerAggregates.length,
  }
}
