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
        <h1>プレロード画面</h1>
        <p>
          マップ画面を開くまで <code>tracks.json</code> などの読込は始まりません。
          <br />
          大きなデータを扱うための案内用プレロード画面です。
        </p>
        <ul className="intro-notes">
          <li>大量の通信を行います</li>
          <li>Chrome 環境を推奨します</li>
          <li>フルスクリーン表示を推奨します</li>
        </ul>
        <div className="intro-actions">
          <button className="primary-button" onClick={() => goToHash('#/map')}>
            マップ画面を開く
          </button>
          <button className="secondary-button" onClick={() => goToHash('#/ranking')}>
            ランキングページを開く
          </button>
        </div>
      </div>
    </div>
  )
}

export default IntroPage
