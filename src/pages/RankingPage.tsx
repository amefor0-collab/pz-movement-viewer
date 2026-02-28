import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import '../App.css'
import {
  buildRankingData,
  type RankingCard,
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

function RankingCardView({
  card,
  expanded,
  onToggle,
}: {
  card: RankingCard
  expanded: boolean
  onToggle: () => void
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
            <div className="ranking-entry-list">
              {section.entries.slice(0, visibleCount).map((entry, index) => (
                <div key={entry.id} className="ranking-entry-row">
                  <div className="ranking-entry-rank">{index + 1}</div>
                  <div className="ranking-entry-body">
                    <strong>{entry.label}</strong>
                    {entry.subLabel && <span>{entry.subLabel}</span>}
                  </div>
                  <div className="ranking-entry-value">{entry.valueLabel}</div>
                </div>
              ))}
            </div>
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

function RankingPage() {
  const [rankingMode, setRankingMode] = useState<RankingMode>('character')
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [loadRequestSeq, setLoadRequestSeq] = useState(0)
  const [tracksData, setTracksData] = useState<TracksData | null>(null)
  const [snapshotData, setSnapshotData] = useState<SnapshotData | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedCardIds, setExpandedCardIds] = useState<string[]>([])

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

  const expandedCardIdSet = useMemo(() => new Set(expandedCardIds), [expandedCardIds])

  const toggleCardExpansion = (cardId: string) => {
    setExpandedCardIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    )
  }

  return (
    <div className="ranking-screen">
      <main className="ranking-shell">
        <section className="ranking-hero">
          <p className="intro-kicker">PZ 行動履歴ビューア</p>
          <h1>ランキングページ</h1>
          <p>
            `snapshot.json` と `tracks.json` から実データを読み込み、集計できた項目だけを表示します。
            <br />
            プレイヤー単位で集約できる項目は、プレイヤー統計として再計算して表示します。
          </p>
          <div className="intro-actions">
            <button className="secondary-button" onClick={() => goToHash('#/')}>
              トップへ戻る
            </button>
            <button className="primary-button" onClick={() => goToHash('#/map')}>
              マップを開く
            </button>
          </div>
        </section>

        <section className="ranking-panel">
          <div className="ranking-switch" role="tablist" aria-label="ランキング表示切替">
            <button
              className={rankingMode === 'character' ? 'primary-button' : 'secondary-button'}
              onClick={() => setRankingMode('character')}
              role="tab"
              aria-selected={rankingMode === 'character'}
            >
              キャラクター統計
            </button>
            <button
              className={rankingMode === 'player' ? 'primary-button' : 'secondary-button'}
              onClick={() => setRankingMode('player')}
              role="tab"
              aria-selected={rankingMode === 'player'}
            >
              プレイヤー統計
            </button>
          </div>

          <div className="ranking-meta-row">
            <span className="pill">
              {rankingMode === 'character' ? 'キャラクター単位' : 'プレイヤー単位'}
            </span>
            <span className="pill">
              {rankingData.totalCharacters.toLocaleString('ja-JP')} キャラ
            </span>
            <span className="pill">
              {rankingData.totalPlayers.toLocaleString('ja-JP')} プレイヤー
            </span>
            <span className={`pill ${loadStatus === 'ready' ? '' : 'warning'}`}>
              {loadStatus === 'ready' ? '実データ接続済み' : '読込待機中'}
            </span>
          </div>

          {rankingMode === 'player' && (
            <section className="ranking-collapsed-card" aria-label="キャラクター統計は収納表示中">
              <div className="ranking-collapsed-head">
                <span className="ranking-collapsed-icon">格納</span>
                <div>
                  <strong>キャラクター統計は収納中</strong>
                  <p>
                    プレイヤー統計表示中は、キャラクター単位カードを一覧から外しています。
                    上の切替でいつでも戻せます。
                  </p>
                </div>
              </div>
            </section>
          )}

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
            <section className="ranking-grid">
              {activeCards.map((card) => (
                <RankingCardView
                  key={`${rankingMode}:${card.id}`}
                  card={card}
                  expanded={expandedCardIdSet.has(`${rankingMode}:${card.id}`)}
                  onToggle={() => toggleCardExpansion(`${rankingMode}:${card.id}`)}
                />
              ))}
            </section>
          )}
        </section>
      </main>
    </div>
  )
}

export default RankingPage
