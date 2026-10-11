import { describe, expect, it } from 'vitest'
import { fitWithin } from '../../lib/ocrImage'

describe('fitWithin', () => {
  it('長い辺が上限以下ならそのままの大きさを返す', () => {
    expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 })
    expect(fitWithin(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 })
  })

  it('横長の画像は幅を上限に合わせて縦横比を保つ', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
  })

  it('縦長の画像は高さを上限に合わせて縦横比を保つ', () => {
    expect(fitWithin(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 })
  })
})
