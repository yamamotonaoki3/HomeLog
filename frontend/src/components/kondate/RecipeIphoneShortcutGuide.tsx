import { Link } from 'react-router-dom'

export function RecipeIphoneShortcutGuide() {
  return (
    <section className="panel recipe-iphone-guide" aria-labelledby="recipe-iphone-heading">
      <h3 id="recipe-iphone-heading">iPhoneからレシピを登録</h3>
      <p>ショートカットを作ると、Safariの共有からURL入力済みのWEB登録画面を開けます。</p>
      <Link className="btn btn-secondary" to="/recipes/iphone-shortcut">ショートカットの作り方</Link>
      <p className="hint">ショートカットが使えない場合は「レシピを登録」のWEBタブにURLを貼り付けてください。</p>
    </section>
  )
}
