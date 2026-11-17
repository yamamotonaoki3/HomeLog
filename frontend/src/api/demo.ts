import { apiClient } from './client'

// デモ環境かどうか(#534)。失敗したときは通常の画面のままにするため、例外を出さず false を返す。
export async function fetchDemoAvailability(): Promise<boolean> {
  try {
    const { data } = await apiClient.get<{ enabled?: boolean }>('/demo')
    return data.enabled === true
  } catch {
    return false
  }
}
