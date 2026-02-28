function goToHash(hash: '#/map' | '#/ranking') {
  if (typeof window === 'undefined') {
    return
  }
  window.location.hash = hash.slice(1)
}

function IntroPage() {
  return (
    <div className="intro-screen">
      <div className="intro-card">
        <p className="intro-kicker">PZ 行動履歴ビューア</p>
        <h1>あんぞん統計情報</h1>
        <div className="intro-layout">
          <section className="intro-action-panel" aria-label="画面を選ぶ">
            <h2>開く画面</h2>
            <div className="intro-actions">
              <button
                className="intro-action-button intro-action-button-map"
                onClick={() => goToHash('#/map')}
              >
                <strong>マップ画面</strong>
                <span>時系列の移動履歴とイベントを確認します</span>
              </button>
              <button
                className="intro-action-button intro-action-button-ranking"
                onClick={() => goToHash('#/ranking')}
              >
                <strong>ランキングページ</strong>
                <span>キャラ統計とプレイヤー統計を確認します</span>
              </button>
            </div>
          </section>
          <section className="intro-note-panel" aria-label="利用前の案内">
            <h2>利用前の案内</h2>
            <ul className="intro-notes">
              <li>大量の通信を行います</li>
              <li>Chrome 環境を推奨します</li>
              <li>フルスクリーン表示を推奨します</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

export default IntroPage
