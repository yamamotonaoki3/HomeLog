import { describe, expect, it } from 'vitest'
import { resolveOccurrences } from '../../lib/event-recurrence'

describe('resolveOccurrences', () => {
  it('recurrenceType=noneはevent_dateが範囲内なら1回だけ発生する', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2026-08-15', recurrenceType: 'none' },
      '2026-08-01',
      '2026-08-31',
    )
    expect(occurrences).toEqual(['2026-08-15'])
  })

  it('recurrenceType=noneはevent_dateが範囲外なら発生しない', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2026-07-15', recurrenceType: 'none' },
      '2026-08-01',
      '2026-08-31',
    )
    expect(occurrences).toEqual([])
  })

  it('recurrenceType=dailyは範囲内の全日に発生する', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2026-08-01', recurrenceType: 'daily' },
      '2026-08-05',
      '2026-08-08',
    )
    expect(occurrences).toEqual(['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'])
  })

  it('recurrenceType=dailyは開始日(event_date)より前の範囲には発生しない', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2026-08-10', recurrenceType: 'daily' },
      '2026-08-01',
      '2026-08-31',
    )
    expect(occurrences).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
      '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19',
      '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24',
      '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29',
      '2026-08-30', '2026-08-31',
    ])
  })

  it('recurrenceType=weeklyは同じ曜日で毎週発生する', () => {
    // 2026-08-03は月曜日。
    const occurrences = resolveOccurrences(
      { eventDate: '2026-08-03', recurrenceType: 'weekly' },
      '2026-08-01',
      '2026-08-31',
    )
    expect(occurrences).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('recurrenceType=monthlyは同じ日で毎月発生する', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2026-01-15', recurrenceType: 'monthly' },
      '2026-06-01',
      '2026-08-31',
    )
    expect(occurrences).toEqual(['2026-06-15', '2026-07-15', '2026-08-15'])
  })

  it('recurrenceType=monthlyで起点日が31日の場合、その日が存在しない月はスキップする', () => {
    // 1/31起点の場合、2月・4月には31日が存在しないためスキップし、3月末日(31日)には発生する。
    const occurrences = resolveOccurrences(
      { eventDate: '2026-01-31', recurrenceType: 'monthly' },
      '2026-01-01',
      '2026-04-30',
    )
    expect(occurrences).toEqual(['2026-01-31', '2026-03-31'])
  })

  it('recurrenceType=yearlyは同じ月日で毎年発生する', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2024-08-15', recurrenceType: 'yearly' },
      '2026-01-01',
      '2027-12-31',
    )
    expect(occurrences).toEqual(['2026-08-15', '2027-08-15'])
  })

  it('recurrenceType=yearlyで起点日が2/29(うるう年)の場合、うるう年でない年はスキップする', () => {
    const occurrences = resolveOccurrences(
      { eventDate: '2024-02-29', recurrenceType: 'yearly' },
      '2025-01-01',
      '2028-12-31',
    )
    expect(occurrences).toEqual(['2028-02-29'])
  })
})
