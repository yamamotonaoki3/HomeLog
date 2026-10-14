import { useEffect, useRef, useState } from 'react'
import { createRecipeBookmarklet } from '../../lib/recipeBookmarklet'

export function RecipeBookmarkletGuide() {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    // Reactはjavascript: hrefを拒否するため、アプリ生成の固定コードだけを設定する。
    // 閲覧URLや共有クエリをこのコードへ埋め込まない。
    linkRef.current?.setAttribute('href', createRecipeBookmarklet(window.location.origin))
  }, [])

  return (
    <section className="panel recipe-bookmarklet-guide" aria-labelledby="recipe-bookmarklet-heading">
      <h3 id="recipe-bookmarklet-heading">PCからレシピを登録</h3>
      <a ref={linkRef} className="recipe-bookmarklet-link" draggable onClick={(event) => {
        event.preventDefault()
        setNotice('「HomeLogに登録」をブックマークバーへドラッグして設置してください。')
      }}>HomeLogに登録</a>
      <ol>
        <li>ブラウザのブックマークバーを表示します。</li>
        <li>「HomeLogに登録」をブックマークバーへドラッグします。</li>
        <li>レシピの閲覧ページで、設置した「HomeLogに登録」を押します。</li>
      </ol>
      <p>別タブでURL入力済みのWEB登録画面が開きます。内容を確認して「登録」を押してください。</p>
      <p className="hint">通常のHTTP(S)ページで使えます。使えないページでは「レシピを登録」のWEBタブにURLを貼り付けてください。</p>
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
