import { useState } from 'react'
import { Link } from 'react-router-dom'

// ユーザーが作成・共有した「HomeLogに登録」ショートカット(本番URL向け)のiCloud配布リンク。
const SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/3914da403d2f41baa61d24a40ea9c699'

export function RecipeIphoneShortcutPage() {
  const prefix = `${window.location.origin}/recipes/share?url=`
  const [notice, setNotice] = useState('')

  async function copyUrl() {
    setNotice('')
    try {
      await navigator.clipboard.writeText(prefix)
      setNotice('URLをコピーしました。手順の「テキスト」に貼り付けてください。')
    } catch {
      setNotice('コピーできませんでした。URL欄を長押し、または選択して、全文を手動でコピーしてください。')
    }
  }

  return (
    <div className="page">
      <section className="panel recipe-iphone-guide" aria-labelledby="iphone-shortcut-title">
        <h2 id="iphone-shortcut-title">iPhoneショートカットの作り方</h2>
        <a className="btn btn-primary" href={SHORTCUT_ICLOUD_URL} target="_blank" rel="noopener noreferrer">ショートカットを追加</a>
        <p>追加されるショートカットは本番のHomeLogを開きます。追加後、Safariやアプリの共有から「HomeLogに登録」を選んでください。</p>
        <h3>自分で作る場合</h3>
        <p className="hint">アクション名はiOSのバージョンで異なる場合があります</p>
        <label className="shortcut-url-label" htmlFor="shortcut-prefix">登録先URLの接頭辞</label>
        <input id="shortcut-prefix" className="shortcut-url" value={prefix} readOnly onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="btn btn-secondary" onClick={() => { void copyUrl() }}>URLをコピー</button>
        {notice && <p role="status">{notice}</p>}
        <ol>
          <li>iPhoneの「ショートカット」アプリで新規作成し、名前を「HomeLogに登録」にします。</li>
          <li>詳細設定で「共有シートに表示」をオンにし、受け取る種類に「URL」「SafariのWebページ」「テキスト」を含めます（アプリ内の共有に表示させるため）。</li>
          <li>「入力からURLを取得」アクションで「ショートカットの入力」をURLに変換します。複数のURLがある場合は「リストから項目を取得」で先頭の項目だけを取得します。</li>
          <li>「もし」で取得したURLが空か確認し、空なら「このショートカットを停止」で終了します。登録先を開かないようにします。</li>
          <li>「URLエンコード」アクションをエンコードに設定し、取得したURLだけをクエリ値として1回だけエンコードします。接頭辞や連結後のURL全体はエンコードしません。</li>
          <li>「テキスト」アクションに、上の「URLをコピー」でコピーした接頭辞を貼り付けます。末尾の「?url=」の直後に、エンコード結果の変数を挿入します。改行や空白は入れません。</li>
          <li>「URLを開く」アクションに、連結した「テキスト」の結果を渡します。接頭辞だけでは開かないでください。</li>
          <li>保存後、Safariでレシピページを開き、共有メニューから「HomeLogに登録」を実行します。WEB登録画面で内容を確認して「登録」を押してください。未ログインならログイン後に進みます。</li>
        </ol>
        <p className="hint">iPhoneからパソコンのlocalhostには接続できません。iPhoneで利用できるHTTPSのHomeLogを開いてURLをコピーしてください。</p>
        <p className="hint">使えない場合は「レシピを登録」のWEBタブへURLを貼り付けてください。</p>
        <Link className="btn btn-secondary" to="/recipes">レシピ一覧に戻る</Link>
      </section>
    </div>
  )
}
