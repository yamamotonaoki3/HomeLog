import { Link } from 'react-router-dom'
import { useIsDemoUser } from '../../context/useIsDemoUser'
import { DEMO_UNAVAILABLE_NOTE } from './recipeGuideNotes'

export function RecipeIphoneShortcutGuide() {
  // 配布しているショートカットは本番のURLを開くため、デモでは使えない(#541)。
  const isDemo = useIsDemoUser()
  return (
    <section className="ui-card recipe-guide recipe-iphone-guide" aria-labelledby="recipe-iphone-heading">
      <h3 id="recipe-iphone-heading">iPhoneからレシピを登録</h3>
      {isDemo && <p className="ui-note">{DEMO_UNAVAILABLE_NOTE}</p>}
      <p>ショートカットを追加すると、Safariやアプリの共有からURL入力済みのWEB登録画面を開けます。</p>
      <Link className="btn btn-secondary" to="/recipes/iphone-shortcut">ショートカットを追加する</Link>
      <p className="hint">ショートカットが使えない場合は「レシピを登録」のWEBタブにURLを貼り付けてください。</p>
    </section>
  )
}
