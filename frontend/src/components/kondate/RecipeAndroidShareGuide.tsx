// Androidの共有メニューからレシピを登録する案内(#520)。インストールしたシェファミが共有先に出る(Web Share Target)。
export function RecipeAndroidShareGuide() {
  return (
    <section className="ui-card recipe-guide recipe-android-guide" aria-labelledby="recipe-android-heading">
      <h3 id="recipe-android-heading">Androidからレシピを登録</h3>
      <p>シェファミをChromeでインストールすると、ブラウザやアプリの共有メニューからURL入力済みのWEB登録画面を開けます。</p>
      <ol>
        <li>Chromeでシェファミを開き、メニュー（︙）の「アプリをインストール」または「ホーム画面に追加」から、インストールします。</li>
        <li>レシピのページやアプリで共有ボタンを押し、一覧から「シェファミ」を選びます。</li>
        <li>開いた登録画面で内容を確認して「登録」を押します。</li>
      </ol>
      <p className="hint">共有の一覧に「シェファミ」が無いときは、インストールし直してください。それでも使えない場合は「レシピを登録」のWEBタブにURLを貼り付けてください。</p>
    </section>
  )
}
