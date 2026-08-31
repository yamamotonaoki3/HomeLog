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
  isFavorite: boolean
}
