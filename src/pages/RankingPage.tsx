import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import '../App.css'
import {
  buildRankingData,
  buildPlayerPartnerLists,
  type RankingCard,
  type RankingEntry,
  type PlayerPartnerEntry,
  type SnapshotData,
  type TracksData,
} from '../features/ranking/ranking'

type RankingMode = 'character' | 'player'
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
const DEFAULT_VISIBLE_ENTRIES = 3

const TRACKS_URL = `${import.meta.env.BASE_URL}data/tracks.json`
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/snapshot.json`

function goToHash(hash: '#/map' | '#/') {
  if (typeof window === 'undefined') {
    return
  }
  window.location.hash = hash === '#/' ? '' : hash.slice(1)
}

function normalizePlayerName(name: string) {
  return name.trim()
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

function RankingCardView({
  card,
  expanded,
  onToggle,
  selectedPlayerName,
  rankingMode,
  expandedSelectedSectionIds,
  onToggleSelectedSection,
}: {
  card: RankingCard
  expanded: boolean
  onToggle: () => void
  selectedPlayerName: string
  rankingMode: RankingMode
  expandedSelectedSectionIds: Set<string>
  onToggleSelectedSection: (sectionKey: string) => void
}) {
  const isExpandable = card.sections.some((section) => section.entries.length > DEFAULT_VISIBLE_ENTRIES)
  const visibleCount = expanded ? Number.POSITIVE_INFINITY : DEFAULT_VISIBLE_ENTRIES
  const totalEntries = card.sections.reduce((sum, section) => sum + section.entries.length, 0)
  const visibleEntries = card.sections.reduce(
    (sum, section) => sum + Math.min(section.entries.length, visibleCount),
    0,
  )
  const hiddenEntries = Math.max(0, totalEntries - visibleEntries)

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isExpandable) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }

  const handleSelectedSectionKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    sectionKey: string,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      onToggleSelectedSection(sectionKey)
    }
  }

  const getVisibleEntries = (entries: RankingEntry[]) => {
    return entries.slice(0, visibleCount).map((entry, index) => ({ entry, rank: index + 1 }))
  }

  const getSelectedEntries = (entries: RankingEntry[]) => {
    if (!selectedPlayerName) {
      return []
    }
    return entries
      .map((entry, index) => ({ entry, rank: index + 1 }))
      .filter(({ entry }) => entry.playerName === selectedPlayerName)
  }

  return (
    <article
      className={`ranking-category-card${isExpandable ? ' ranking-category-card--expandable' : ''}${expanded ? ' is-expanded' : ''}`}
      onClick={isExpandable ? onToggle : undefined}
      onKeyDown={handleKeyDown}
      role={isExpandable ? 'button' : undefined}
      tabIndex={isExpandable ? 0 : undefined}
      aria-expanded={isExpandable ? expanded : undefined}
    >
      <div className="ranking-category-head">
        <div className="ranking-category-title-group">
          <h2>{card.title}</h2>
          {isExpandable && (
            <span className="ranking-expand-hint">
              {expanded ? 'クリックで閉じる' : 'クリックで全員表示'}
            </span>
          )}
        </div>
        <div className="ranking-category-meta">
          {isExpandable && (
            <span className="ranking-category-count">
              {totalEntries.toLocaleString('ja-JP')}件
            </span>
          )}
          <span className="ranking-category-badge">{card.unit}</span>
        </div>
      </div>
      <p>{card.description}</p>
      <div className="ranking-data-stack">
        {card.sections.map((section) => (
          <section key={section.id} className="ranking-data-section">
            {section.title && <h3 className="ranking-section-title">{section.title}</h3>}
            {(() => {
              const sectionKey = `${rankingMode}:${card.id}:${section.id}`
              const selectedSectionExpanded = expandedSelectedSectionIds.has(sectionKey)
              const visibleEntries = getVisibleEntries(section.entries)
              const selectedEntries = getSelectedEntries(section.entries)

              let displayedSelectedEntries: Array<{ entry: RankingEntry; rank: number }> = []
              let canToggleSelectedEntries = false

              if (rankingMode === 'character') {
                displayedSelectedEntries = selectedSectionExpanded
                  ? selectedEntries
                  : selectedEntries.slice(0, 1)
                canToggleSelectedEntries = selectedEntries.length > 1
              } else {
                displayedSelectedEntries = selectedEntries
              }

              return (
                <>
                  <div className="ranking-entry-list">
                  {visibleEntries.map(({ entry, rank }) => (
                    <div
                      key={entry.id}
                      className={`ranking-entry-row${
                        selectedPlayerName && entry.playerName === selectedPlayerName
                          ? ' is-selected-player'
                          : ''
                      }`}
                    >
                      <div className="ranking-entry-rank">{rank}</div>
                      <div className="ranking-entry-body">
                        <strong>{entry.label}</strong>
                        {entry.subLabel && <span>{entry.subLabel}</span>}
                      </div>
                      <div className="ranking-entry-value">{entry.valueLabel}</div>
                    </div>
                  ))}
                  </div>
                  {displayedSelectedEntries.length > 0 && (
                    <div
                      className={`ranking-selected-player-block${
                        canToggleSelectedEntries ? ' is-clickable' : ''
                      }`}
                      onClick={
                        canToggleSelectedEntries
                          ? (event) => {
                              event.stopPropagation()
                              onToggleSelectedSection(sectionKey)
                            }
                          : undefined
                      }
                      onKeyDown={
                        canToggleSelectedEntries
                          ? (event) => handleSelectedSectionKeyDown(event, sectionKey)
                          : undefined
                      }
                      role={canToggleSelectedEntries ? 'button' : undefined}
                      tabIndex={canToggleSelectedEntries ? 0 : undefined}
                      aria-expanded={canToggleSelectedEntries ? selectedSectionExpanded : undefined}
                    >
                      <div className="ranking-selected-player-label">選択プレイヤー</div>
                      <div className="ranking-entry-list ranking-entry-list-selected">
                        {displayedSelectedEntries.map(({ entry, rank }) => (
                          <div
                            key={`${section.id}:${entry.id}:selected`}
                            className="ranking-entry-row is-selected-player"
                          >
                            <div className="ranking-entry-rank">{rank}</div>
                            <div className="ranking-entry-body">
                              <strong>{entry.label}</strong>
                              {entry.subLabel && <span>{entry.subLabel}</span>}
                            </div>
                            <div className="ranking-entry-value">{entry.valueLabel}</div>
                          </div>
                        ))}
                      </div>
                      {canToggleSelectedEntries && (
                        <div className="ranking-selected-player-toggle">
                          {selectedSectionExpanded ? '選択キャラ収納' : '選択キャラ展開'}
                        </div>
                      )}
                    </div>
                  )}
                  {displayedSelectedEntries.length === 0 && canToggleSelectedEntries && (
                    <button
                      type="button"
                      className="ranking-selected-player-toggle standalone"
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleSelectedSection(sectionKey)
                      }}
                    >
                      {selectedSectionExpanded ? '選択キャラ収納' : '選択キャラ展開'}
                    </button>
                  )}
                </>
              )
            })()}
          </section>
        ))}
      </div>
      {isExpandable && (
        <div className="ranking-expand-footer">
          {expanded ? (
            <span>全件を表示中</span>
          ) : (
            <span>残り {hiddenEntries.toLocaleString('ja-JP')} 件を表示</span>
          )}
        </div>
      )}
    </article>
  )
}

function SelectedPlayerPartnerCard({
  playerName,
  partners,
}: {
  playerName: string
  partners: PlayerPartnerEntry[]
}) {
  return (
    <section className="ranking-partner-card" aria-label="パートナー一覧">
      <div className="ranking-partner-head">
        <div>
          <h2>パートナー一覧</h2>
          <p>{playerName}</p>
        </div>
        <span className="ranking-category-badge">プレイヤー</span>
      </div>
      {partners.length === 0 ? (
        <p className="ranking-partner-empty">
          {playerName ? 'パートナー情報はありません。' : 'プレイヤーを選択してください。'}
        </p>
      ) : (
        <div className="ranking-entry-list ranking-partner-list">
          {partners.map((partner, index) => (
            <div key={`${playerName}:${partner.partnerName}`} className="ranking-entry-row">
              <div className="ranking-entry-rank">{index + 1}</div>
              <div className="ranking-entry-body">
                <strong>{partner.partnerName}</strong>
              </div>
              <div className="ranking-entry-value">{formatDurationShort(partner.durationSec)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function RankingPage() {
  const [rankingMode, setRankingMode] = useState<RankingMode>('character')
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [loadRequestSeq, setLoadRequestSeq] = useState(0)
  const [tracksData, setTracksData] = useState<TracksData | null>(null)
  const [snapshotData, setSnapshotData] = useState<SnapshotData | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedCardIds, setExpandedCardIds] = useState<string[]>([])
  const [expandedSelectedSectionIds, setExpandedSelectedSectionIds] = useState<string[]>([])
  const [selectedPlayerName, setSelectedPlayerName] = useState('')
  const [showPlayerPicker, setShowPlayerPicker] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      setLoadStatus('loading')
      setErrorMessage('')

      try {
        const [tracksResponse, snapshotResponse] = await Promise.all([
          fetch(TRACKS_URL, { signal: controller.signal }),
          fetch(SNAPSHOT_URL, { signal: controller.signal }),
        ])

        if (!tracksResponse.ok) {
          throw new Error(`tracks.json の読み込みに失敗しました (HTTP ${tracksResponse.status})`)
        }
        if (!snapshotResponse.ok) {
          throw new Error(`snapshot.json の読み込みに失敗しました (HTTP ${snapshotResponse.status})`)
        }

        const [loadedTracks, loadedSnapshot] = (await Promise.all([
          tracksResponse.json(),
          snapshotResponse.json(),
        ])) as [TracksData, SnapshotData]

        if (controller.signal.aborted) {
          return
        }

        setTracksData(loadedTracks)
        setSnapshotData(loadedSnapshot)
        setLoadStatus('ready')
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setTracksData(null)
        setSnapshotData(null)
        setLoadStatus('error')
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'ランキング用データの読み込みに失敗しました。',
        )
      }
    }

    void load()
    return () => controller.abort()
  }, [loadRequestSeq])

  const rankingData = useMemo(
    () => buildRankingData(snapshotData, tracksData),
    [snapshotData, tracksData],
  )

  const activeCards =
    rankingMode === 'character' ? rankingData.characterCards : rankingData.playerCards

  const playerOptions = useMemo(() => {
    const names = new Set<string>()

    if (snapshotData?.data) {
      for (const record of Object.values(snapshotData.data)) {
        const name = typeof record.playerName === 'string' ? normalizePlayerName(record.playerName) : ''
        if (name) {
          names.add(name)
        }
      }
    }

    if (tracksData?.characters) {
      for (const character of Object.values(tracksData.characters)) {
        const name = normalizePlayerName(character.playerName)
        if (name) {
          names.add(name)
        }
      }
    }

    return [...names].sort((a, b) => a.localeCompare(b, 'ja'))
  }, [snapshotData, tracksData])

  const playerPartnerLists = useMemo(() => buildPlayerPartnerLists(snapshotData), [snapshotData])

  const selectedPlayerPartners = useMemo(() => {
    if (!selectedPlayerName) {
      return []
    }
    return playerPartnerLists.get(selectedPlayerName) ?? []
  }, [playerPartnerLists, selectedPlayerName])

  useEffect(() => {
    if (selectedPlayerName && !playerOptions.includes(selectedPlayerName)) {
      setSelectedPlayerName('')
    }
  }, [playerOptions, selectedPlayerName])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }
    if (selectedPlayerName) {
      setShowPlayerPicker(false)
      return
    }
    if (playerOptions.length > 0) {
      setShowPlayerPicker(true)
    }
  }, [loadStatus, playerOptions, selectedPlayerName])

  const expandedCardIdSet = useMemo(() => new Set(expandedCardIds), [expandedCardIds])
  const expandedSelectedSectionIdSet = useMemo(
    () => new Set(expandedSelectedSectionIds),
    [expandedSelectedSectionIds],
  )
  const showPartnerSidebar = rankingMode === 'player'
  const rankingColumnWidth = '18rem'

  const toggleCardExpansion = (cardId: string) => {
    setExpandedCardIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    )
  }

  const toggleSelectedSectionExpansion = (sectionKey: string) => {
    setExpandedSelectedSectionIds((prev) =>
      prev.includes(sectionKey)
        ? prev.filter((id) => id !== sectionKey)
        : [...prev, sectionKey],
    )
  }

  return (
    <div className="ranking-screen">
      <main
        className="ranking-shell"
        style={{ ['--ranking-card-width' as const]: rankingColumnWidth } as CSSProperties}
      >
        <section className="ranking-hero">
          <div className="ranking-hero-head">
            <div>
              <p className="intro-kicker">PZ 行動履歴ビューア</p>
              <h1>ランキングページ</h1>
            </div>
            <div className="ranking-hero-actions">
              <button className="secondary-button" onClick={() => goToHash('#/')}>
                トップへ戻る
              </button>
              <button className="primary-button" onClick={() => goToHash('#/map')}>
                マップを開く
              </button>
            </div>
          </div>
        </section>

        <section className="ranking-panel">
          <div className="ranking-toolbar">
            <div className="ranking-switch-panel">
              <div className="ranking-switch" role="tablist" aria-label="ランキング表示切替">
                <button
                  className={`ranking-switch-option${rankingMode === 'character' ? ' is-active' : ''}`}
                  onClick={() => setRankingMode('character')}
                  role="tab"
                  aria-selected={rankingMode === 'character'}
                >
                  <strong>キャラクター統計</strong>
                  <span>各キャラクターごとの成績を表示</span>
                </button>
                <button
                  className={`ranking-switch-option${rankingMode === 'player' ? ' is-active' : ''}`}
                  onClick={() => setRankingMode('player')}
                  role="tab"
                  aria-selected={rankingMode === 'player'}
                >
                  <strong>プレイヤー統計</strong>
                  <span>同一プレイヤー配下のキャラを集約して表示</span>
                </button>
              </div>
            </div>
            <label className="ranking-player-filter">
              <span>プレイヤー選択</span>
              <select
                value={selectedPlayerName}
                onChange={(event) => setSelectedPlayerName(event.target.value)}
              >
                <option value="">選択なし</option>
                {playerOptions.map((playerName) => (
                  <option key={playerName} value={playerName}>
                    {playerName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadStatus === 'loading' && (
            <section className="status-card">
              <h2>ランキングデータを読み込み中...</h2>
              <p>
                <code>public/data/snapshot.json</code> と
                {' '}
                <code>public/data/tracks.json</code>
                {' '}
                を取得しています。
              </p>
            </section>
          )}

          {loadStatus === 'error' && (
            <section className="status-card">
              <h2>ランキングデータの読み込みに失敗しました</h2>
              <p className="error-message">{errorMessage}</p>
              <button
                className="primary-button"
                onClick={() => setLoadRequestSeq((prev) => prev + 1)}
              >
                再試行
              </button>
            </section>
          )}

          {loadStatus === 'ready' && activeCards.length === 0 && (
            <section className="status-card">
              <h2>表示できるランキングがありません</h2>
              <p>現在のデータでは、この表示単位で集計できる項目がありません。</p>
            </section>
          )}

          {loadStatus === 'ready' && activeCards.length > 0 && (
            <div className={`ranking-content-layout${showPartnerSidebar ? ' has-sidebar' : ''}`}>
              <section className="ranking-grid">
                {activeCards.map((card) => (
                <RankingCardView
                  key={`${rankingMode}:${card.id}`}
                  card={card}
                  expanded={expandedCardIdSet.has(`${rankingMode}:${card.id}`)}
                  onToggle={() => toggleCardExpansion(`${rankingMode}:${card.id}`)}
                  selectedPlayerName={selectedPlayerName}
                  rankingMode={rankingMode}
                  expandedSelectedSectionIds={expandedSelectedSectionIdSet}
                  onToggleSelectedSection={toggleSelectedSectionExpansion}
                />
              ))}
            </section>

              {showPartnerSidebar && (
                <aside className="ranking-sidebar">
                  <SelectedPlayerPartnerCard
                    playerName={selectedPlayerName}
                    partners={selectedPlayerPartners}
                  />
                </aside>
              )}
            </div>
          )}
        </section>
      </main>
      {showPlayerPicker && (
        <div className="ranking-player-picker-backdrop">
          <section className="ranking-player-picker" aria-label="プレイヤー選択">
            <h2>プレイヤーを選択</h2>
            <p>ランキング内で自分の位置とパートナー一覧を表示します。</p>
            <label className="ranking-player-filter ranking-player-filter-modal">
              <span>プレイヤー選択</span>
              <select
                value={selectedPlayerName}
                onChange={(event) => setSelectedPlayerName(event.target.value)}
              >
                <option value="">選択してください</option>
                {playerOptions.map((playerName) => (
                  <option key={`modal:${playerName}`} value={playerName}>
                    {playerName}
                  </option>
                ))}
              </select>
            </label>
            <div className="ranking-player-picker-actions">
              <button
                className="secondary-button"
                onClick={() => setShowPlayerPicker(false)}
              >
                あとで選ぶ
              </button>
              <button
                className="primary-button"
                onClick={() => setShowPlayerPicker(false)}
                disabled={!selectedPlayerName}
              >
                表示する
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default RankingPage
