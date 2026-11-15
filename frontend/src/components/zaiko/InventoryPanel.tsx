import { isAxiosError } from 'axios'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Category, InventoryItem, Store } from '../../api/zaikoTypes'
import { InventoryModal } from './InventoryModal'
import { InventoryDeleteDialog } from './InventoryDeleteDialog'
import { filterByKeyword } from '../../lib/keyword'
import type { Recipe } from '../../api/kondateTypes'
import { PurchaseIdentityError, boundConfig } from '../../api/shoppingPurchases'
import { captureMenuCredentials, menuCredentialsMatch, verifyMenuScope } from '../../api/menuInventory'
import { useMenuInventoryOperation } from '../../hooks/useMenuInventoryOperation'

interface Props {
  actorUserId?: number
  onScopeDetached?: () => void
  inventory: InventoryItem[]
  categories: Category[]
  onCategoriesChange: (categories: Category[]) => void
  stores: Store[]
  onStoresChange: (stores: Store[]) => void
  onRefresh: () => Promise<void>
  onNotify: (message: string) => void
}

export function InventoryPanel({ inventory, categories, onCategoriesChange, stores, onStoresChange, onRefresh, onNotify, actorUserId, onScopeDetached }: Props) {
  const [recipes, setRecipes] = useState<Recipe[]>([]), [recipeError, setRecipeError] = useState(''), [recipesLoaded, setRecipesLoaded] = useState(false)
  const [linkSyncFailed, setLinkSyncFailed] = useState(false)
  const [rejectedReload, setRejectedReload] = useState(false)
  const life = useRef({ alive: true, generation: 0, actorUserId })
  life.current.actorUserId = actorUserId
  useEffect(() => { life.current.alive = true; return () => { life.current.alive = false; life.current.generation++ } }, [])
  const [selectedId, setSelectedId] = useState<number>()
  const [selectedSnapshot, setSelectedSnapshot] = useState<InventoryItem>()
  const [formOpen, setFormOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number>()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [quantityErrors, setQuantityErrors] = useState<Record<number, string>>({})
  const [uncertainIds, setUncertainIds] = useState<Set<number>>(new Set())
  const uncertain = useRef(new Set<number>())
  const uncertainMessage = '数量変更の結果を確認できません。重複を防ぐため、この品目の数量変更を停止しています。一覧を確認し、画面を再読み込みしてください。'
  const [steps, setSteps] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const searchId = useId()
  const filterName = useId()
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem>()
  const deleteOrigin = useRef<HTMLButtonElement | null>(null)
  const pending = useRef(false)
  const quantityOwner = useRef<object | null>(null)
  const origin = useRef<HTMLButtonElement | null>(null)
  const register = useRef<HTMLButtonElement>(null)
  const everVerified = useRef(false), previousActor = useRef(actorUserId), actorChanged = useRef(false)
  if (previousActor.current !== actorUserId) { actorChanged.current = true; previousActor.current = actorUserId }
  const detachInventory = () => {
    if (!everVerified.current && !actorChanged.current) return
    life.current.generation++; quantityOwner.current = null; pending.current = false; setBusy(false); setRejectedReload(false); setFormOpen(false); setSelectedId(undefined); setSelectedSnapshot(undefined); setDeleteTarget(undefined); setExpandedId(undefined); setDrafts({}); setQuantityErrors({}); setRecipes([]); setRecipesLoaded(false); onScopeDetached?.()
  }
  const operation = useMenuInventoryOperation({ actorUserId, onDetached: detachInventory })
  const initialLinkUnverified = !everVerified.current && !actorChanged.current && !operation.verifiedScope && !operation.pending && (operation.outcome === null || operation.outcome.kind === 'detached' || operation.outcome.kind === 'blocked')
  useEffect(() => { if (operation.verifiedScope) everVerified.current = true }, [operation.verifiedScope])
  const loadRecipes = useCallback(async (force = false) => {
    if (recipesLoaded && !force) return
    const generation = life.current.generation, actor = life.current.actorUserId, credentials = captureMenuCredentials()
    try {
      const { data } = await apiClient.get<Recipe[]>('/recipes')
      if (!life.current.alive || generation !== life.current.generation || actor !== life.current.actorUserId || !credentials || !menuCredentialsMatch(credentials)) return
      setRecipes(data); setRecipesLoaded(true); setRecipeError('')
    } catch { if (life.current.alive && generation === life.current.generation) setRecipeError('レシピを取得できません。新しい料理名の入力は利用できます。') }
  }, [recipesLoaded])
  const requestRecipes = useCallback(() => { void loadRecipes() }, [loadRecipes])
  const refreshRejected = async () => {
    const credentials = captureMenuCredentials(), generation = life.current.generation, scope = operation.verifiedScope
    const valid = () => life.current.alive && generation === life.current.generation && !!credentials && menuCredentialsMatch(credentials)
    if (!credentials || !scope) { operation.invalidate(); return }
    try {
      await verifyMenuScope(credentials, scope, valid)
      if (!valid()) { if (generation === life.current.generation) operation.invalidate(); return }
      await onRefresh()
      if (valid()) setRejectedReload(false)
      else if (generation === life.current.generation) operation.invalidate()
    } catch (error) {
      if (generation !== life.current.generation) return
      if (!valid() || error instanceof PurchaseIdentityError) operation.invalidate()
      else onNotify('一覧の再取得に失敗しました')
    }
  }
  const refreshLinked = async () => {
    try { await onRefresh(); setLinkSyncFailed(false) }
    catch { setLinkSyncFailed(true); throw new Error('記録済みです。一覧の再取得をやり直してください') }
  }
  const recoverLinked = async () => {
    const result = await operation.recover()
    if (result.kind !== 'success') return
    setFormOpen(false); setSelectedId(undefined); setSelectedSnapshot(undefined)
    try { await refreshLinked(); onNotify('前回の結果を確認しました') }
    catch { onNotify('記録済みです。一覧の再取得をやり直してください') }
  }
  const selected = selectedSnapshot
  const inCategory = categoryId === '' ? inventory : inventory.filter(item => String(item.categoryId) === categoryId)
  const visible = filterByKeyword(inCategory, keyword, (item) => item.name)
  useEffect(() => {
    if (categoryId !== '' && !categories.some(category => String(category.id) === categoryId)) setCategoryId('')
  }, [categories, categoryId])
  const closeDelete = () => {
    setDeleteTarget(undefined)
    queueMicrotask(() => (deleteOrigin.current?.isConnected ? deleteOrigin.current : register.current)?.focus())
  }
  const focusRequested = useRef(false)
  const closeForm = () => { focusRequested.current = true; setSelectedId(undefined); setSelectedSnapshot(undefined); setFormOpen(false) }
  useEffect(() => {
    if (!focusRequested.current || formOpen || busy) return
    focusRequested.current = false
    const target = origin.current?.isConnected ? origin.current : register.current
    if (target && !target.closest('[hidden], [inert]')) target.focus()
  }, [formOpen, busy])
  useEffect(() => {
    if (selectedId !== undefined && !inventory.some(item => item.id === selectedId)) {
      setSelectedId(undefined)
      setSelectedSnapshot(undefined)
      setFormOpen(false)
      register.current?.focus()
    }
  }, [inventory, selectedId])

  const adjustQuantity = async (item: InventoryItem, delta: number, consumeDraft = false) => {
    if (pending.current || uncertain.current.has(item.id) || operation.pending || !operation.verifiedScope) return
    const total = (item.menuLinks ?? []).reduce((sum, link) => sum + (link.remainingCount ?? 0), 0)
    if (Math.round((item.quantity + delta) * 10) < total * 10) {
      const message = '予定回数の合計が在庫個数を超えています。先に予定回数を減らしてください'
      setQuantityErrors(previous => ({ ...previous, [item.id]: message })); onNotify(message); return
    }
    const credentials = captureMenuCredentials(), generation = life.current.generation
    const valid = () => life.current.alive && generation === life.current.generation && !!credentials && menuCredentialsMatch(credentials)
    if (!credentials) { operation.invalidate(); return }
    pending.current = true
    const owner = {}
    quantityOwner.current = owner
    setBusy(true)
    setQuantityErrors(previous => ({ ...previous, [item.id]: '' }))
    let success = false
    let unknown = false
    try { try {
      await verifyMenuScope(credentials, operation.verifiedScope, valid)
      if (!valid()) { if (generation === life.current.generation) operation.invalidate(); return }
      const { data } = await apiClient.patch<{ quantity: number }>(`/inventory-items/${item.id}/quantity`, { delta }, boundConfig(credentials))
      if (!valid()) { if (generation === life.current.generation) operation.invalidate(); return }
      if (!Number.isFinite(data?.quantity) || data.quantity < 0 || data.quantity > 99999.9 || Math.abs(data.quantity * 10 - Math.round(data.quantity * 10)) >= 1e-9) throw new Error('Invalid quantity response')
      success = true
      if (consumeDraft) setDrafts(previous => ({ ...previous, [item.id]: '' }))
    } catch (err) {
      if (!valid() || err instanceof PurchaseIdentityError) { if (generation === life.current.generation) operation.invalidate(); return }
      const status = isAxiosError(err) ? err.response?.status : undefined
      if (status === 400 || status === 401 || status === 409) {
        const message = getApiErrorMessage(err, '在庫個数の更新に失敗しました')
        setQuantityErrors(previous => ({ ...previous, [item.id]: message }))
        onNotify(message)
      } else {
        unknown = true
        uncertain.current.add(item.id)
        setUncertainIds(new Set(uncertain.current))
        onNotify(uncertainMessage)
      }
    }
    try {
      if (success || unknown) await onRefresh()
    } catch {
      if (valid()) onNotify(success ? '在庫個数を更新しました。一覧の再取得に失敗しました' : '数量変更の結果を確認できません。一覧の再取得にも失敗しました。画面を再読み込みしてください。')
    } } finally {
      if (quantityOwner.current === owner) { quantityOwner.current = null; pending.current = false; if (life.current.alive) setBusy(false) }
    }
  }
  const adjustStep = (item: InventoryItem, sign: 1 | -1) => {
    const delta = sign * (steps[item.id] ?? 1)
    if (Math.round((item.quantity + delta) * 10) < 0) { onNotify('在庫個数は0未満にできません'); return }
    void adjustQuantity(item, delta)
  }
  const applyDraft = (item: InventoryItem) => {
    if (pending.current || uncertain.current.has(item.id)) return
    const value = (drafts[item.id] ?? '').trim()
    const delta = Number(value)
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(delta) || Math.abs(delta) > 99999.9 || Math.abs(delta * 10 - Math.round(delta * 10)) >= 1e-9) {
      setQuantityErrors(previous => ({ ...previous, [item.id]: '増減量は-99999.9〜99999.9、小数点第一位までで入力してください' }))
      return
    }
    void adjustQuantity(item, delta, true)
  }

  return <div className="ui-narrow" data-testid="inventory-panel">
    <header className="ui-page-head">
      <div>
        <h2>在庫一覧</h2>
        <p className="ui-page-sub">行を押すと数量を変更できます</p>
      </div>
    </header>
    <label className="ui-field-label inventory-search-label" htmlFor={searchId}>商品を探す</label>
    <input id={searchId} type="search" className="ui-search" placeholder="商品名で検索" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
    <fieldset className="ui-chips inventory-category-filter">
      <legend className="visually-hidden">カテゴリーで絞り込み</legend>
      {/* 横に流す枠は fieldset の内側に置く(fieldset 自体をスクロール枠にしない)。 */}
      <div className="ui-chips-row">
        <label><input type="radio" name={filterName} value="" checked={categoryId === ''} onChange={() => setCategoryId('')} /><span>すべて</span></label>
        {categories.map(category => <label key={category.id}>
          <input type="radio" name={filterName} value={category.id} checked={categoryId === String(category.id)} onChange={() => setCategoryId(String(category.id))} /><span>{category.name}</span>
        </label>)}
      </div>
    </fieldset>
    {!formOpen && operation.message && <p className={initialLinkUnverified ? 'hint' : undefined} role={initialLinkUnverified ? undefined : 'alert'}>{operation.message}</p>}
    {!formOpen && operation.pending && <button type="button" className="btn btn-secondary" disabled={operation.busy} onClick={() => void recoverLinked()}>前回の結果を確認</button>}
    {!formOpen && !operation.verifiedScope && !operation.busy && <button type="button" className="btn btn-secondary" onClick={() => void operation.recheck()}>献立連携の本人と世帯を再確認</button>}
    {!formOpen && rejectedReload && <div><p role="alert">保存が拒否されました。一覧を再取得してから編集し直してください。</p><button type="button" className="btn btn-secondary" disabled={!operation.verifiedScope || operation.busy} onClick={() => void refreshRejected()}>一覧を再取得</button></div>}
    {linkSyncFailed && <div><p role="alert">記録済みです。一覧を再取得してから次の操作をしてください。</p><button type="button" className="btn btn-secondary" onClick={() => void refreshLinked().catch(() => onNotify('一覧の再取得に失敗しました'))}>一覧を再取得</button></div>}
    <button ref={register} type="button" className="ui-action" disabled={!!operation.pending || linkSyncFailed} onClick={() => { origin.current = register.current; setSelectedId(undefined); setSelectedSnapshot(undefined); setFormOpen(true) }}><span aria-hidden="true">＋</span>在庫を登録</button>
    <div className="inventory-list-head">
      <h3 className="ui-section-label">商品一覧</h3>
      {/* 行の「！」の意味を示す凡例。読み上げでは各行の説明(在庫が閾値以下)で伝える。 */}
      <p className="inventory-low-legend" aria-hidden="true"><span className="inventory-low-stock is-low">！</span>補充対象</p>
    </div>
    {inventory.length === 0 ? <p className="ui-empty">在庫がありません</p> : visible.length === 0 ? <p className="ui-empty">該当する品目がありません</p> : null}
    {visible.length > 0 && <ul className="inventory-list" aria-label="在庫一覧">
      {visible.map((item) => {
        const low = item.quantity <= item.threshold
        const stopped = uncertainIds.has(item.id)
        const expanded = expandedId === item.id
        const categoryName = categories.find(category => category.id === item.categoryId)?.name
        return <li key={item.id} className={expanded ? 'ui-card inventory-card is-open' : 'ui-card inventory-card'}>
          <div className="inventory-row">
            <button type="button" className="inventory-row-button" aria-label={`${item.name}の詳細`} aria-describedby={`inventory-summary-${item.id}`}
              aria-expanded={expanded} aria-controls={`inventory-quantity-${item.id}`} disabled={busy}
              onClick={() => setExpandedId(expanded ? undefined : item.id)}>
              <span className={low ? 'inventory-low-stock is-low' : 'inventory-low-stock'} aria-hidden="true">{low ? '！' : ''}</span>
              <span className="inventory-row-main">
                <span className="inventory-row-name">{item.name}</span>
                {categoryName && <span className="inventory-row-category">{categoryName}</span>}
              </span>
              <span className="inventory-list-quantity">{item.quantity.toFixed(1)}</span>
              <span className="inventory-chevron" aria-hidden="true" />
            </button>
            <span id={`inventory-summary-${item.id}`} className="sr-only">在庫数 {item.quantity.toFixed(1)}{low ? ' 在庫が閾値以下' : ''}</span>
            <button type="button" className="inventory-delete-button" disabled={busy} aria-label={`${item.name}を削除`} onClick={(event) => { deleteOrigin.current = event.currentTarget; setDeleteTarget(item) }}>×</button>
          </div>
          {expanded && <section id={`inventory-quantity-${item.id}`} className="inventory-expanded" role="region" aria-label={`${item.name}の数量変更`} hidden={formOpen}>
            <p className="inventory-expanded-title">在庫を変更</p>
            <p className="inventory-expanded-caption">現在の数量</p>
            <div className="inventory-stepper">
              <button type="button" className="inventory-stepper-button" disabled={busy || stopped} aria-label={`${item.name}を減らす`} onClick={() => adjustStep(item, -1)}>－</button>
              <span className="inventory-current-quantity" aria-live="polite">{item.quantity.toFixed(1)}</span>
              <button type="button" className="inventory-stepper-button" disabled={busy || stopped} aria-label={`${item.name}を増やす`} onClick={() => adjustStep(item, 1)}>＋</button>
            </div>
            <div className="inventory-step-options" role="group" aria-label="増減幅"><span>増減幅</span>{[1, 0.1].map(value => <button key={value} type="button" className="btn btn-secondary" aria-pressed={(steps[item.id] ?? 1) === value} disabled={busy || stopped} onClick={() => setSteps(previous => ({ ...previous, [item.id]: value }))}>{value}</button>)}</div>
            <form className="inventory-delta-form" noValidate onSubmit={event => { event.preventDefault(); applyDraft(item) }}>
              <div className="inventory-delta-row">
                <label className="ui-tag" htmlFor={`inventory-delta-${item.id}`}>増減量</label>
                <input id={`inventory-delta-${item.id}`} type="text" inputMode="text" placeholder="例：1、-0.5" value={drafts[item.id] ?? ''} disabled={busy || stopped}
                  aria-describedby={`inventory-delta-hint-${item.id}`} aria-invalid={Boolean(quantityErrors[item.id])}
                  onChange={event => setDrafts(previous => ({ ...previous, [item.id]: event.target.value }))} />
              </div>
              <p id={`inventory-delta-hint-${item.id}`} className="hint">正の数は加算、負の数は減算します。適用後は取り消せません。</p>
              <button type="submit" className="ui-action" disabled={busy || stopped}>数量を適用</button>
            </form>
            {stopped ? <p className="error" role="alert">{uncertainMessage}</p> : quantityErrors[item.id] && <p className="error" role="alert">{quantityErrors[item.id]}</p>}
            <div className="inventory-expanded-footer">
              <span>補充基準：{item.threshold.toFixed(1)}</span>
              <button type="button" className="inventory-details-button" disabled={busy || rejectedReload} aria-label={`${item.name}の詳細を編集`} onClick={event => { origin.current = event.currentTarget; setSelectedId(item.id); setSelectedSnapshot(structuredClone(item)); setFormOpen(true) }}>詳細を編集<span aria-hidden="true">›</span></button>
            </div>
          </section>}
        </li>
      })}
    </ul>}
    {deleteTarget && <InventoryDeleteDialog item={deleteTarget} onClose={closeDelete} onDeleted={async () => {
      // 削除は確定済み。再取得のcommit前に残る旧行へフォーカスを戻さない。
      deleteOrigin.current = null
      try { await onRefresh(); onNotify('在庫を削除しました') }
      catch { onNotify('削除しました。一覧の再取得に失敗しました') }
    }} />}
    {formOpen && <InventoryModal item={selected} categories={categories} onCategoriesChange={onCategoriesChange} stores={stores} onStoresChange={onStoresChange}
      recipes={recipes} recipeError={recipeError} onRecipesRequest={requestRecipes} onRecipesRetry={() => void loadRecipes(true)}
      linkedReady={!!operation.verifiedScope && !operation.busy} linkedBlocked={!!operation.pending || linkSyncFailed || rejectedReload} linkedMessage={rejectedReload ? '下書きを閉じて一覧を再取得し、編集し直してください。' : linkSyncFailed ? '保存済みです。閉じて一覧を再取得してください' : operation.message}
      linkedMessageAlert={!rejectedReload && (!initialLinkUnverified || linkSyncFailed)} onLinkedRecheck={() => void operation.recheck()}
      onPlanSave={async (body, enabled, links) => {
        const generation = life.current.generation
        const result = selected
          ? await operation.run({ kind: 'plan-replace', itemId: selected.id, expectedMenuPlanRevision: selected.menuPlanRevision ?? 0, inventory: body, enabled, links })
          : await operation.run({ kind: 'plan-create', inventory: body, enabled, links })
        if (selected && result.kind === 'rejected' && life.current.alive && generation === life.current.generation) setRejectedReload(true)
        return result
      }}
      onLinkedRecover={operation.pending ? recoverLinked : undefined}
      busy={busy || operation.busy} quantityStopped={selected ? uncertainIds.has(selected.id) : false} quantityNotice={selected && uncertainIds.has(selected.id) ? uncertainMessage : undefined}
      step={selected ? steps[selected.id] ?? 1 : 1}
      onStep={step => { if (selected) setSteps(previous => ({ ...previous, [selected.id]: step })) }}
      onClose={closeForm} onSaved={async (linked = false) => {
        pending.current = true
        setBusy(true)
        const message = selected ? '在庫を編集しました' : '在庫を登録しました'
        try { await onRefresh(); onNotify(message) }
        catch { if (linked) setLinkSyncFailed(true); onNotify(`${message}。一覧の再取得に失敗しました`) }
        finally { pending.current = false; setBusy(false); closeForm() }
      }} />}
  </div>
}
