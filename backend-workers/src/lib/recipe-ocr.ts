// 手書きレシピ画像のOCR(F-09)で使う外部サービス呼び出しをまとめたモジュール。
// 1. Google Cloud Visionで画像を文字にする
// 2. Workers AI(LLM)でその文字を「タイトル・材料・手順」に整理する
import { z } from 'zod'

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate'
// 日本語の指示に従いやすく、JSON形式での応答(JSON Mode)に対応しているモデル。
export const RECIPE_STRUCTURE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export class ExternalServiceError extends Error {}

export interface StructuredRecipe {
  title: string
  ingredients: string | null
  steps: string | null
}

// ArrayBufferをBase64文字列に変換する(VisionはJSONのcontentに画像をBase64で埋め込んで受け取るため)。
// 大きな画像でString.fromCharCodeの引数上限を超えないよう、一定サイズずつ変換する。
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const visionResponseSchema = z.object({
  responses: z.array(z.object({
    fullTextAnnotation: z.object({ text: z.string() }).optional(),
    error: z.object({ code: z.number(), message: z.string() }).optional(),
  })).min(1),
})

// 画像から文字を読み取る。文字が無ければnullを返す。
// APIキーはURLのクエリ(?key=...)ではなくヘッダーで渡す(URLはログ等に残りやすいため)。
export async function extractTextWithVision(apiKey: string, image: ArrayBuffer): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(VISION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify({
        requests: [
          {
            image: { content: toBase64(image) },
            // DOCUMENT_TEXT_DETECTIONは密度の高い文章・手書き文字向けの読み取りモード。
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['ja'] },
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new ExternalServiceError('vision request failed')
  }
  if (!response.ok) throw new ExternalServiceError(`vision responded ${response.status}`)

  const parsed = visionResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ExternalServiceError('vision response malformed')
  if (parsed.data.responses[0].error) throw new ExternalServiceError('vision annotation failed')
  const text = parsed.data.responses[0].fullTextAnnotation?.text.trim()
  return text ? text : null
}

// 解析されずに24時間を超えて残った一時画像を削除する。
export async function deleteStaleOcrImages(bucket: R2Bucket, now: Date): Promise<number> {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000
  let cursor: string | undefined
  let deleted = 0
  do {
    const page = await bucket.list({ prefix: 'ocr/', ...(cursor ? { cursor } : {}) })
    const keys = page.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key)
    if (keys.length > 0) {
      await bucket.delete(keys)
      deleted += keys.length
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return deleted
}

const structuredRecipeSchema = z.object({
  title: z.string().max(100),
  ingredients: z.string().nullable(),
  steps: z.string().nullable(),
})

const SYSTEM_PROMPT = [
  'あなたは手書きレシピの読み取り結果を整理するアシスタントです。',
  '与えられたテキストはOCRで読み取ったもので、誤字や改行の乱れを含むことがあります。',
  'テキストに書かれている内容だけを使い、title(料理名)・ingredients(材料と分量、1行に1つ)・steps(手順、1行に1つ)に分けてください。',
  '書かれていない材料や手順を補ったり創作したりしてはいけません。該当する内容が無い項目はnullにしてください。',
].join('\n')

// AIが失敗した・想定外の形で答えた場合でも、利用者が確認フォームで手直しできるよう
// 読み取った文字をそのまま手順欄に入れて返す(画像解析の結果そのものは失わない)。
function fallback(rawText: string): StructuredRecipe {
  return { title: '', ingredients: null, steps: rawText }
}

export async function structureRecipeText(ai: Ai, rawText: string): Promise<StructuredRecipe> {
  let result: unknown
  try {
    result = await ai.run(RECIPE_STRUCTURE_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            ingredients: { type: ['string', 'null'] },
            steps: { type: ['string', 'null'] },
          },
          required: ['title', 'ingredients', 'steps'],
        },
      },
    })
  } catch {
    return fallback(rawText)
  }

  // JSON ModeでもモデルによってはオブジェクトではなくJSON文字列で返ることがあるため両方に対応する。
  let candidate = (result as { response?: unknown } | null)?.response
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return fallback(rawText)
    }
  }
  const parsed = structuredRecipeSchema.safeParse(candidate)
  return parsed.success ? parsed.data : fallback(rawText)
}
