import { Link } from 'react-router-dom'

// ユーザーが作成・共有した「homelogに登録」ショートカット(本番URL向け)のiCloud配布リンク。
// ショートカットを作り直した場合はiCloudリンクを再発行して差し替える(自作手順はF09要件書を参照)。
const SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/3914da403d2f41baa61d24a40ea9c699'

export function RecipeIphoneShortcutPage() {
  return (
    <div className="page">
      <section className="panel recipe-iphone-guide" aria-labelledby="iphone-shortcut-title">
        <h2 id="iphone-shortcut-title">iPhoneショートカットの追加</h2>
        <a className="btn btn-primary" href={SHORTCUT_ICLOUD_URL} target="_blank" rel="noopener noreferrer">ショートカットを追加</a>
        <p>追加されるショートカットは本番のシェファミを開きます。</p>
        <p>配布中のショートカット名は「homelogに登録」です。アプリ名変更前の名前ですが、そのまま利用できます。</p>
        <h3>使い方</h3>
        <ol>
          <li>上のボタンを押し、表示された画面で「ショートカットを追加」を選びます。</li>
          <li>Safariやレシピアプリでページを開き、共有メニューから「homelogに登録」を選びます。</li>
          <li>初回はアクセスの許可を求められるので「許可」を押します。</li>
          <li>URL入力済みのWEB登録画面が開くので、内容を確認して「登録」を押します。未ログインならログイン後に進みます。</li>
        </ol>
        <p className="hint">使えない場合は「レシピを登録」のWEBタブへURLを貼り付けてください。</p>
        <Link className="btn btn-secondary" to="/recipes">レシピ一覧に戻る</Link>
      </section>
    </div>
  )
}
