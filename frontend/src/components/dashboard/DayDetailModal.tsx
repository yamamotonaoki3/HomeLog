import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../api/client'
import type { DashboardDayDetail, FixedCostPostingStatus } from '../../api/dashboardTypes'
import type { Recipe } from '../../api/kondateTypes'
import { useDialog } from '../../hooks/useDialog'
import { RecipeDetailModal } from '../kondate/RecipeDetailModal'
import { EventDetailModal } from './EventDetailModal'
import type { CalendarDay, CalendarEvent } from './CalendarPanel'

type Loadable = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: DashboardDayDetail }
type SectionKey = 'menu' | 'events' | 'finance' | 'fixed'
type Child = { kind: 'event'; event: CalendarEvent } | { kind: 'recipe'; recipe: Recipe }
const STATUS_LABELS: Record<FixedCostPostingStatus, string> = {
  posted: '支出に計上済み', scheduled: '計上予定', missing: '計上記録なし',
  suppressed: '再計上しない', not_applicable: '計上対象外', unknown: '確認できません',
}
const yen = (value: number) => value.toLocaleString('ja-JP') + '円'
function DetailSection({ title, count, open, onToggle, children }: { title: string; count: number | null; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId()
  return <section className="day-detail-section">
    <h3><button type="button" className="day-section-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>{title}{count === null ? '' : ' ' + count + '件'}</button></h3>
    <div id={id} role="region" aria-label={title} hidden={!open}>{children}</div>
  </section>
}

function DayDetailContent({ day, onClose }: { day: CalendarDay; onClose: () => void }) {
  const [state, setState] = useState<Loadable>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<SectionKey[]>([])
  const [child, setChild] = useState<Child | null>(null)
  const [recipeBusy, setRecipeBusy] = useState(false)
  const [recipeError, setRecipeError] = useState('')
  const recipeRequest = useRef<AbortController | null>(null)
  const childTrigger = useRef<HTMLButtonElement | null>(null)
  const parentOrigin = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!parentOrigin.current && document.activeElement instanceof HTMLElement) parentOrigin.current = document.activeElement
  }, [])
  const close = () => {
    onClose()
    parentOrigin.current?.focus({ preventScroll: true })
  }
  const ref = useDialog(close, '[data-day-close]')
  useLayoutEffect(() => {
    if (!child && childTrigger.current?.isConnected) childTrigger.current.focus({ preventScroll: true })
  }, [child])
  useEffect(() => {
    const controller = new AbortController()
    apiClient.get<DashboardDayDetail>('/dashboard/day-detail', { params: { date: day.date }, signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setState({ status: 'ok', data: response.data }) })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [day.date, attempt])
  useEffect(() => () => recipeRequest.current?.abort(), [])

  const openRecipe = async (id: number, trigger: HTMLButtonElement) => {
    if (recipeRequest.current) return
    const controller = new AbortController()
    recipeRequest.current = controller
    childTrigger.current = trigger
    setRecipeBusy(true)
    setRecipeError('')
    try {
      const response = await apiClient.get<Recipe[]>('/recipes', { signal: controller.signal })
      if (controller.signal.aborted || recipeRequest.current !== controller) return
      const recipe = response.data.find(item => item.id === id)
      if (recipe) setChild({ kind: 'recipe', recipe })
      else setRecipeError('レシピが見つかりませんでした')
    } catch {
      if (!controller.signal.aborted && recipeRequest.current === controller) setRecipeError('レシピを取得できませんでした')
    } finally {
      if (!controller.signal.aborted && recipeRequest.current === controller) {
        recipeRequest.current = null
        setRecipeBusy(false)
      }
    }
  }
  const toggle = (key: SectionKey) => setOpen(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key])
  const data = state.status === 'ok' ? state.data : null
  return <>
    <div className="modal-overlay day-detail-overlay" role="dialog" aria-modal="true" aria-label="日次詳細" inert={child ? true : undefined}
      onClick={event => { if (!child && event.target === event.currentTarget) close() }}>
      <div ref={ref} className="modal day-detail-modal">
        <header className="day-detail-header"><h2>{day.date} の詳細</h2><button type="button" data-day-close className="day-close-icon" aria-label="日付詳細を閉じる" onClick={close}>×</button></header>
        <div className="day-detail-body">
          {state.status === 'loading' && <p role="status">日付詳細を読み込み中...</p>}
          {state.status === 'error' && <div><p role="alert">日付詳細を取得できませんでした</p><button type="button" className="btn btn-secondary" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1) }}>再試行</button></div>}
          <DetailSection title="今週の献立" count={data ? data.menuEntries.length : null} open={open.includes('menu')} onToggle={() => toggle('menu')}>
            {data && <>
              {data.menuEntries.length ? <ul className="day-detail-list">{data.menuEntries.map(entry => <li key={entry.id}>
                {entry.recipeId !== null && entry.recipeTitle !== null
                  ? <button type="button" className="day-item-button" aria-label={'レシピ「' + entry.recipeTitle + '」の詳細'} disabled={recipeBusy}
                    onClick={event => { void openRecipe(entry.recipeId!, event.currentTarget) }}>{entry.recipeTitle}</button>
                  : entry.freeTextMemo ?? '(削除されたレシピ)'}
              </li>)}</ul> : <p>この週の献立はありません</p>}
              {recipeBusy && <p role="status">レシピを読み込み中...</p>}
              {recipeError && <p className="error" role="alert">{recipeError}</p>}
              <Link to={'/menu?week=' + data.weekStartDate}>この週の献立を編集</Link>
            </>}
          </DetailSection>
          <DetailSection title="イベント" count={data ? data.events.length : null} open={open.includes('events')} onToggle={() => toggle('events')}>
            {data && <>{data.events.length ? <ul className="day-detail-list">{data.events.map(item => <li key={item.id}><button type="button" className="day-item-button"
              aria-label={'イベント「' + item.name + '」の詳細'} onClick={event => {
                recipeRequest.current?.abort()
                recipeRequest.current = null
                setRecipeBusy(false)
                setRecipeError('')
                childTrigger.current = event.currentTarget
                setChild({ kind: 'event', event: item })
              }}>{item.name}</button></li>)}</ul> : <p>この日の予定はありません</p>}
              <Link to="/events">イベントを追加</Link></>}
          </DetailSection>
          <DetailSection title="収支" count={data ? data.finance.incomes.length + data.finance.expenses.length : null} open={open.includes('finance')} onToggle={() => toggle('finance')}>
            {data && <>
              <div className="day-finance-summary"><p>収入: {yen(data.finance.income)}</p><p>支出: {yen(data.finance.expense)}</p><p>収支: {yen(data.finance.balance)}</p></div>
              {data.finance.incomes.length + data.finance.expenses.length ? <>
                <ul className="day-detail-list" aria-label="収入明細">{data.finance.incomes.map(item => <li key={item.id}>収入 {item.content}: {yen(item.amount)}</li>)}</ul>
                <ul className="day-detail-list" aria-label="支出明細">{data.finance.expenses.map(item => <li key={item.id}>支出 {item.purpose || '内容なし'}: {yen(item.amount)}</li>)}</ul>
              </> : <p>この日の収支明細はありません</p>}
              <Link to="/kakeibo">支出を登録</Link>
            </>}
          </DetailSection>
          <DetailSection title="固定費" count={data ? data.fixedCosts.length : null} open={open.includes('fixed')} onToggle={() => toggle('fixed')}>
            {data && <>
              {data.fixedCosts.length ? <><p className="day-detail-note">「支出に計上済み」は支出記録の作成済みを表し、銀行引き落とし・カード決済・精算の完了ではありません。</p>
                <ul className="day-detail-list">{data.fixedCosts.map(cost => <li key={cost.id}>
                  <strong>{cost.name}</strong><p>予定額: {yen(cost.amount)}</p><p className="day-posting-status">{STATUS_LABELS[cost.postingStatus]}</p>
                  {cost.postingStatus === 'posted' && cost.postedExpense && <p>計上記録: {yen(cost.postedExpense.amount)}（{cost.postedExpense.expenseDate}）</p>}
                </li>)}</ul></> : <p>この日の固定費はありません</p>}
              <Link to="/fixed-costs">固定費管理を見る</Link>
            </>}
          </DetailSection>
          <button type="button" className="btn btn-secondary day-bottom-close" onClick={close}>閉じる</button>
        </div>
      </div>
    </div>
    {child?.kind === 'event' && <EventDetailModal key={child.event.id} event={child.event} date={day.date} onClose={() => setChild(null)} />}
    {child?.kind === 'recipe' && <RecipeDetailModal key={child.recipe.id} recipe={child.recipe} onClose={() => setChild(null)} />}
  </>
}

export function DayDetailModal(props: { day: CalendarDay; onClose: () => void }) {
  return <DayDetailContent key={props.day.date} {...props} />
}
