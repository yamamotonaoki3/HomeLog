// `interface`はTypeScript独自の書き方で、「このオブジェクトはどんなプロパティを持つか」を
// 定義する型注釈。Javaで言うと、フィールドしか持たないクラス(あるいはレコード/DTO)に近い。
// ここではAPI(GET /api/recipes等)から返ってくるレシピ1件分のJSONの形を表している。
export interface Recipe {
  id: number
  title: string
  // `string | null`は「string型かnull型のどちらか」という意味(TypeScriptの合併型=union型)。
  // 材料・手順は未入力(null)で登録できるため、この型になっている。
  ingredients: string | null
  steps: string | null
  // 本来は 'manual' | 'ocr' | 'web' の3値だが、バックエンドのレスポンス型と合わせて
  // 単純にstringとして受け取っている(現時点ではAPIが'manual'しか返さないため)。
  sourceType: string
  // WEBレシピ登録(sourceType='web')の場合のみ設定される。手動・OCR登録では常にnull。
  url: string | null
  thumbnailUrl: string | null
  memo: string | null
  isFavorite: boolean
}

// GET /api/menu-entries?weekStartDate=... から返ってくる献立リストの1件分の形。
export interface MenuEntry {
  id: number
  // 確定登録(レシピ選択)の場合のみ設定される。ラフ登録の場合はnull。
  recipeId: number | null
  // recipeIdが設定されているエントリのレシピ名。ただしレシピが削除済みの場合はnullになる
  // (recipeIdはあるがrecipeTitleがnullの状態=「削除されたレシピ」を意味する)。
  recipeTitle: string | null
  // ラフ登録(自由メモ)の場合のみ設定される。確定登録の場合はnull。
  freeTextMemo: string | null
  weekStartDate: string
}
