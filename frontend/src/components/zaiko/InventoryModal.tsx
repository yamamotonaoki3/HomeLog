import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { InventoryCreateBody, MenuPlanLine, MenuLinkDraft, InventoryMenuLink, InventoryMenuLinkUpdate, Category, Store, InventoryItem } from '../../api/zaikoTypes'
import { validPrice, PRICE_ERROR } from './price'
import { useInventoryDialog } from './useInventoryDialog'
import { quantityValid } from '../../lib/shoppingPending'
import type { Recipe } from '../../api/kondateTypes'
import { InventoryMenuDrafts, menuDraftPayload, type MenuDraft } from './InventoryMenuDrafts'

const CONSUMPTION_ERROR = '1日の消費量は0.1〜99999.9、小数点第一位までで入力してください'

interface Props {
  item?: InventoryItem
  onPlanSave?: (inventory: InventoryCreateBody, enabled: boolean, links: MenuPlanLine[]) => Promise<{ kind: string; message?: string }>
  recipes?: Recipe[]
  onRecipesRequest?: () => void
  linkedReady?: boolean
  linkedMessage?: string
  linkedMessageAlert?: boolean
  onLinkedRecheck?: () => void
  onLinkedRecover?: () => Promise<void>
  recipeError?: string
  onRecipesRetry?: () => void
  linkedBlocked?: boolean
  onLinkedCreate?: (inventory: InventoryCreateBody, menus: MenuLinkDraft[]) => Promise<{ kind: string; message?: string }>
  onLinkSave?: (id: number, body: InventoryMenuLinkUpdate) => Promise<InventoryMenuLink>
  categories: Category[]
  onCategoriesChange: (categories: Category[]) => void
  stores: Store[]
  onStoresChange: (stores: Store[]) => void
  busy?: boolean
  quantityStopped?: boolean
  quantityNotice?: string
  step?: number
  onStep?: (step: number) => void
  onAdjust?: (sign: 1 | -1) => void
  onClose: () => void
  onSaved: (linked?: boolean) => Promise<void>
}

export function InventoryModal({ item, categories, onCategoriesChange, stores, onStoresChange, onClose, onSaved, busy = false, quantityStopped = false, quantityNotice, step: initialStep = 1, recipes = [], recipeError, onRecipesRetry, linkedBlocked = false, onPlanSave, onRecipesRequest, linkedReady = true, linkedMessage, linkedMessageAlert = true, onLinkedRecheck, onLinkedRecover }: Props) {
  const [linkRecipes, setLinkRecipes] = useState(item?.menuPlanEnabled ?? false)
  const [menuDrafts, setMenuDrafts] = useState<MenuDraft[]>(() => (item?.menuLinks ?? []).map(link => ({ key: link.id, linkId: link.id, recipeId: link.recipeId ?? undefined, title: link.recipeTitle, remaining: link.remainingCount == null ? '' : String(link.remainingCount), memo: link.memo ?? '', carry: link.carryEnabled, legacy: link.remainingCount == null, legacyEnabled: link.enabled, legacyUsage: link.usageQuantity })))
  const showRecipePicker = linkRecipes || menuDrafts.length > 0
  useEffect(() => { if (showRecipePicker) onRecipesRequest?.() }, [showRecipePicker, onRecipesRequest])
  const [step, setStep] = useState(initialStep)
  const [linkedUnknown, setLinkedUnknown] = useState(false)
  const [name, setName] = useState(item?.name ?? '')
  const [categoryId, setCategoryId] = useState(String(item?.categoryId ?? categories[0]?.id ?? ''))
  const [storeId, setStoreId] = useState(item?.storeId == null ? '' : String(item.storeId))
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [threshold, setThreshold] = useState(String(item?.threshold ?? 0.5))
  const [price, setPrice] = useState(item?.price == null ? '' : String(item.price))
  const [dailyConsumption, setDailyConsumption] = useState(item?.dailyConsumption == null ? '' : String(item.dailyConsumption))
  const [autoConsumptionEnabled, setAutoConsumptionEnabled] = useState(item?.autoConsumptionEnabled ?? false)
  const [consumptionCorrectionOpen, setConsumptionCorrectionOpen] = useState(false)
  const categoryPending = useRef(false)
  const categoryNameInput = useRef<HTMLInputElement>(null)
  const categorySelect = useRef<HTMLSelectElement>(null)
  const categoryFocusRequested = useRef(false)
  const categoryToggle = useRef<HTMLButtonElement>(null)
  const [categoryFormOpen, setCategoryFormOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [categorySubmitting, setCategorySubmitting] = useState(false)
  const pending = useRef(false)
  const [storeFormOpen, setStoreFormOpen] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const close = () => { if (!submitting && !busy && !categoryPending.current) onClose() }
  const dialogRef = useInventoryDialog(close, '#inv-name')

  const locked = submitting || saved || busy || categorySubmitting || linkedUnknown || linkedBlocked || quantityStopped
  const allocated = menuDrafts.reduce((total, draft) => total + (Number.isInteger(Number(draft.remaining)) && Number(draft.remaining) >= 0 ? Number(draft.remaining) : 0), 0)
  const linkageActive = allocated > 0
  const changeQuantity = (value: string) => {
    if (value.trim() && quantityValid(Number(value)) && Number(value) < allocated) { setError('予定回数の合計が在庫個数を超えています。先に予定回数を減らしてください'); return }
    setQuantity(value); setError('')
  }
  const adjustDraft = (sign: 1 | -1) => {
    const next = Math.round((Number(quantity) + sign * step) * 10) / 10
    if (!quantityValid(next)) { setError('在庫個数は0〜99999.9で入力してください'); return }
    changeQuantity(String(next))
  }

  useEffect(() => {
    if (!categoryFocusRequested.current || locked || categoryFormOpen) return
    categoryFocusRequested.current = false
    const select = categorySelect.current
    // rAFはReactのDOM更新完了を保証しない。disabled解除後のcommitで一度だけ戻す。
    if (select?.isConnected && !select.disabled && !select.closest('[hidden]')) select.focus()
  }, [locked, categoryFormOpen])

  const handleAddCategory = async () => {
    if (pending.current || categoryPending.current || busy || saved) return
    const trimmed = newCategoryName.trim()
    if (trimmed.length < 1 || trimmed.length > 50) {
      setCategoryError('カテゴリー名は1〜50文字で入力してください')
      return
    }
    categoryPending.current = true
    setCategorySubmitting(true)
    setCategoryError('')
    try {
      const response = await apiClient.post<Category>('/zaiko-categories', { name: trimmed })
      onCategoriesChange([...categories, response.data])
      setCategoryId(String(response.data.id))
      setNewCategoryName('')
      categoryFocusRequested.current = true
      setCategoryFormOpen(false)
    } catch (err) {
      setCategoryError(getApiErrorMessage(err, 'カテゴリーの登録に失敗しました'))
    } finally {
      categoryPending.current = false
      setCategorySubmitting(false)
    }
  }

  const handleAddStore = async () => {
    if (pending.current || categoryPending.current || busy || saved) return
    const trimmed = newStoreName.trim()
    if (!trimmed) {
      setError('店名を入力してください')
      return
    }
    setError('')
    try {
      const response = await apiClient.post<Store>('/stores', { name: trimmed })
      onStoresChange([...stores, response.data])
      setStoreId(String(response.data.id))
      setNewStoreName('')
      setStoreFormOpen(false)
    } catch (err) {
      setError(getApiErrorMessage(err, '店の登録に失敗しました'))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (pending.current || busy || categoryPending.current || saved || linkedUnknown || linkedBlocked || quantityStopped) return
    if (!linkedReady) { setError('本人と世帯を確認してから登録してください'); return }
    const daily = dailyConsumption.trim() === '' ? null : Number(dailyConsumption)
    if ((autoConsumptionEnabled && daily === null) || (daily !== null && (!Number.isFinite(daily) || daily < 0.1 || daily > 99999.9 || Math.abs(daily * 10 - Math.round(daily * 10)) > 1e-7))) {
      if (!autoConsumptionEnabled) setConsumptionCorrectionOpen(true)
      setError(CONSUMPTION_ERROR)
      return
    }
    if (!validPrice(price)) { setError(PRICE_ERROR); return }
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('品名は1〜50文字で入力してください')
      return
    }
    const trimmedQuantity = quantity.trim()
    const trimmedThreshold = threshold.trim()
    if (trimmedQuantity === '' || trimmedThreshold === '') {
      setError('在庫個数・閾値は0以上で入力してください')
      return
    }
    const quantityValue = Number(trimmedQuantity)
    const thresholdValue = Number(trimmedThreshold)
    if (!quantityValid(quantityValue) || !quantityValid(thresholdValue)) {
      setError('在庫個数・閾値は0以上で入力してください')
      return
    }
    const menus = menuDraftPayload(menuDrafts)
    if (!menus) { setError('残り予定回数は0〜99999の整数で入力してください。旧設定の料理も回数を入力するか関連を外してください'); return }
    if (allocated > quantityValue) { setError('予定回数の合計が在庫個数を超えています。先に予定回数を減らしてください'); return }
    if (allocated > 0 && autoConsumptionEnabled) { setError('予定を割り当てるには毎日の自動消費をオフにしてください。設定した消費量は保持します'); return }
    if (!onPlanSave) { setError('本人と世帯を確認してから保存してください'); return }
    setError('')
    pending.current = true
    setSubmitting(true)
    try {
      const body = {
        dailyConsumption: daily,
        autoConsumptionEnabled: daily !== null && autoConsumptionEnabled,
        name: trimmedName,
        categoryId: Number(categoryId),
        storeId: storeId === '' ? null : Number(storeId),
        threshold: thresholdValue,
        price: price.trim() === '' ? null : Number(price),
      }
      const outcome = await onPlanSave({ ...body, quantity: quantityValue }, linkRecipes, menus)
      if (outcome.kind !== 'success') {
        setLinkedUnknown(outcome.kind === 'unknown' || outcome.kind === 'detached')
        setError(outcome.message ?? '結果を確認できません。前回の結果を確認してください')
        pending.current = false; setSubmitting(false); return
      }
    } catch (err) {
      setError(getApiErrorMessage(err, item ? '在庫の編集に失敗しました' : '在庫の登録に失敗しました'))
      pending.current = false
      setSubmitting(false)
      return
    }
    // The save already succeeded. A refresh failure must never enable resending it.
    setSaved(true)
    try { await onSaved(true) }
    catch { setSubmitting(false); setError('保存しました。一覧の再取得に失敗しました。閉じて再読み込みしてください') }
  }

  // 登録では在庫個数の右、編集では数量操作の下に置く。
  const priceField = <div>
    <label htmlFor="inv-price">値段（円・任意）</label>
    <input id="inv-price" type="text" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
  </div>

  return (
    <div className="modal-overlay inventory-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialogRef} className="modal inventory-modal inventory-form-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title">
        <h2 id="inventory-modal-title">{item ? '在庫の詳細編集' : '在庫を登録'}</h2>
        <form onSubmit={handleSubmit} noValidate>
          <fieldset className="inventory-form-fields" disabled={locked}>
          <legend className="visually-hidden">在庫の入力</legend>
          <label htmlFor="inv-name">品名</label>
          <input id="inv-name" type="text" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="inventory-category-heading">
            <label htmlFor="inv-category">カテゴリー</label>
            <button ref={categoryToggle} type="button" className="btn btn-tiny" disabled={locked}
              aria-expanded={categoryFormOpen} aria-controls="inventory-category-form"
              onClick={() => { setCategoryError(''); setCategoryFormOpen(!categoryFormOpen); if (!categoryFormOpen) requestAnimationFrame(() => categoryNameInput.current?.focus()) }}>＋カテゴリーを登録</button>
          </div>
          <select ref={categorySelect} id="inv-category" disabled={locked} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {categoryFormOpen && <div id="inventory-category-form" className="inventory-category-form">
            <label htmlFor="inv-new-category">カテゴリー名</label>
            <input ref={categoryNameInput} id="inv-new-category" type="text" maxLength={50} disabled={locked}
              value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void handleAddCategory() } }} />
            <p className="hint">カテゴリーは追加時に保存され、在庫をキャンセルしても残ります</p>
            {categoryError && <p className="error" role="alert">{categoryError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-small" disabled={locked} onClick={handleAddCategory}>カテゴリーを追加</button>
              <button type="button" className="btn btn-small" disabled={locked}
                onClick={() => { setCategoryFormOpen(false); setCategoryError(''); requestAnimationFrame(() => categoryToggle.current?.focus()) }}>追加をやめる</button>
            </div>
          </div>}
          <div className="inventory-category-heading">
            <label htmlFor="inv-store">買う店（任意）</label>
            <button type="button" className="btn btn-tiny" disabled={locked} aria-expanded={storeFormOpen} onClick={() => setStoreFormOpen((open) => !open)}>
              ＋店を登録
            </button>
          </div>
          <select id="inv-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">なし</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {storeFormOpen && (
            <div className="inventory-category-form">
              <label htmlFor="store-name">店名</label>
              <input
                id="store-name"
                type="text"
                placeholder="例：スーパーC"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
              />
              <button type="button" className="btn btn-small" disabled={locked} onClick={handleAddStore}>
                店を追加
              </button>
            </div>
          )}
          <div className="inventory-form-pair">
            <div>
              <label htmlFor="inv-quantity">在庫個数</label>
              <input id="inv-quantity" type="number" step="0.1" min="0" max="99999.9" value={quantity} onChange={event => changeQuantity(event.target.value)} />
            </div>
            {priceField}
          </div>
          {item && <>
            <div className="inventory-quantity-controls inventory-quantity-inline">
              <button type="button" className="btn btn-secondary" disabled={locked} aria-label={`${item.name}を増やす`} onClick={() => adjustDraft(1)}>＋</button>
              <button type="button" className="btn btn-secondary" disabled={locked} aria-label={`${item.name}を減らす`} onClick={() => adjustDraft(-1)}>－</button>
            </div>
            <div className="inventory-step-options" role="group" aria-label="増減幅"><span>増減幅</span>{[1, 0.1].map(value => <button key={value} type="button" className="btn btn-secondary" aria-pressed={step === value} disabled={locked} onClick={() => setStep(value)}>{value}</button>)}</div>
          </>}
          <p className="hint">在庫個数と料理の変更は、下の「保存」でまとめて反映します。キャンセルすると変更を破棄します。</p>
          <label htmlFor="inv-threshold">買い物リスト追加閾値</label>
          <input
            id="inv-threshold"
            type="number"
            step="0.1"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <p className="hint">在庫個数がこの数以下になると、買い物リストに自動追加されます</p>
          <div className="ui-card inventory-consumption-card">
            <div className="inventory-consumption-head">
              <div>
                <p id="inv-consumption-title" className="inventory-consumption-title">毎日の自動消費</p>
                <p className="hint">オンのときだけ1日の消費量を入力します</p>
              </div>
              <button type="button" role="switch" aria-labelledby="inv-consumption-title" aria-checked={autoConsumptionEnabled}
                aria-controls="inventory-consumption-fields" className="ui-switch" disabled={locked || (!autoConsumptionEnabled && linkageActive)}
                onClick={() => { setConsumptionCorrectionOpen(false); setAutoConsumptionEnabled(enabled => !enabled) }}>
                <span className="ui-switch-track" aria-hidden="true" />
                <span className="ui-switch-state" aria-hidden="true">{autoConsumptionEnabled ? 'オン' : 'オフ'}</span>
              </button>
            </div>
            {(autoConsumptionEnabled || consumptionCorrectionOpen) && <div id="inventory-consumption-fields">
              <label htmlFor="inv-consumption">1日の消費量（任意）</label>
              <input id="inv-consumption" type="number" step="0.1" min="0.1" max="99999.9"
                disabled={locked} value={dailyConsumption}
                aria-invalid={error === CONSUMPTION_ERROR || undefined}
                aria-describedby={error === CONSUMPTION_ERROR ? 'inv-consumption-hint inv-consumption-error' : 'inv-consumption-hint'}
                onChange={event => setDailyConsumption(event.target.value)} />
              <p id="inv-consumption-hint" className="hint">オンで保存するには消費量を入力してください。オフにしても入力した量は保持します。</p>
              {error === CONSUMPTION_ERROR && <p id="inv-consumption-error" className="error" role="alert">{error}</p>}
            </div>}
            <p className="hint">毎日1:00（日本時間）に減ります。開始・再開は翌日から。停止・消費量変更時は到来済みの未処理分を旧設定で精算します。</p>
          </div>
          {linkageActive && <p className="hint">献立との連携中は毎日の自動消費を開始できません。</p>}
          <section className="ui-card inventory-menu-registration">
            <label className="inventory-menu-check"><input type="checkbox" checked={linkRecipes} disabled={locked || !linkedReady} onChange={event => setLinkRecipes(event.target.checked)} />献立と連携する</label>
            <p className="hint">オフでも料理の予定と持ち越し設定を保持します。食事の記録と新しい週への持ち越しは停止します。</p>
            {autoConsumptionEnabled && <p className="hint">予定を割り当てる前に、毎日の自動消費を明示的にオフにしてください。入力した消費量は保持します。</p>}
            <p className="inventory-menu-plan-summary" aria-live="polite">予定合計 {allocated}回 ／ 在庫 {quantity || '—'}個 ／ 未割当 {quantityValid(Number(quantity)) ? Math.round((Number(quantity) - allocated) * 10) / 10 : '—'}個</p>
            {showRecipePicker && <InventoryMenuDrafts recipes={recipes} drafts={menuDrafts} disabled={locked} recipeError={recipeError} onRecipesRetry={onRecipesRetry} onChange={setMenuDrafts} />}
          </section>
          </fieldset>
          {quantityNotice && <p role="alert" className="error">{quantityNotice}</p>}
          {linkedMessage && (!error || !linkedMessageAlert) && <p className={linkedMessageAlert ? 'error' : 'hint'} role={linkedMessageAlert ? 'alert' : undefined}>{linkedMessage}</p>}
          {!linkedReady && onLinkedRecheck && <button type="button" className="btn btn-secondary" disabled={submitting || busy} onClick={onLinkedRecheck}>献立連携の本人と世帯を再確認</button>}
          {(linkedUnknown || linkedBlocked) && onLinkedRecover && <button type="button" className="btn btn-secondary" disabled={submitting || busy} onClick={() => void onLinkedRecover()}>同じ内容で確認</button>}
          {error && error !== CONSUMPTION_ERROR && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions ui-form-actions">
            <button type="button" className="ui-form-cancel" disabled={submitting || busy || categorySubmitting} onClick={close}>
              キャンセル
            </button>
            <button type="submit" className="ui-action" disabled={locked}>
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
