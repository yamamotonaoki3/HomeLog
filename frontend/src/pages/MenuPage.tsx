import { useCallback, useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { MenuEntry, Recipe } from '../api/kondateTypes'
import { addWeeks, formatWeekOfMonth, formatWeekRange, getMondayOf } from '../lib/week'
import { Toast } from '../components/Toast'
import { RecipeDetailModal } from '../components/kondate/RecipeDetailModal'
import { MenuAddSheet, type AddMode } from '../components/kondate/MenuAddSheet'
import { MenuTitle } from '../components/kondate/MenuTitle'
import { recipeSite } from '../lib/recipeSite'
import { useDialog } from '../hooks/useDialog'
import { AuthContext } from '../context/authContextValue'
import { useMenuInventoryOperation } from '../hooks/useMenuInventoryOperation'
import { captureMenuCredentials, menuCredentialsMatch, updateInventoryMenuLink, verifyMenuScope } from '../api/menuInventory'
import { PurchaseIdentityError, boundConfig } from '../api/shoppingPurchases'
import type { InventoryItem } from '../api/zaikoTypes'
import { LinkedMenuControls, MenuMealConfirmation } from '../components/kondate/LinkedMenuControls'

function displayLabel(entry: MenuEntry): string {
  if (entry.inventoryLinkage) { const link=entry.inventoryLinkage; return (entry.recipeTitle ?? '(削除されたレシピ)') + (link.remainingCount != null ? `×${link.remainingCount}${link.memo ? '｜'+link.memo : ''}` : '') }
  return entry.recipeId !== null ? entry.recipeTitle ?? '(削除されたレシピ)' : entry.freeTextMemo ?? ''
}

// 行の2行目に出す出典。サイト名が分かればサイト名、無ければ登録の種類を示す。
function sourceLabel(entry: MenuEntry, recipe: Recipe | undefined): string | undefined {
  if (entry.inventoryLinkage && entry.recipeId === null) return '削除されたレシピ'
  if (entry.recipeId === null) return '自由メモ'
  if (!recipe || entry.recipeTitle === null) return undefined
  return recipeSite(recipe.url) ?? 'レシピ'
}

function DeleteConfirmation({ entry, busy, error, onClose, onDelete }: {
  entry: MenuEntry; busy: boolean; error: string; onClose: () => void; onDelete: () => void
}) {
  const close = () => { if (!busy) onClose() }
  const ref = useDialog(close, '[data-menu-delete-cancel]')
  return <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={ref} className="modal menu-delete-modal" role="dialog" aria-modal="true" aria-labelledby="menu-delete-title">
      <h2 id="menu-delete-title">献立を削除</h2>
      <p>「{displayLabel(entry)}」を献立から削除しますか？この操作は取り消せません。レシピ原本は削除されません。{entry.inventoryLinkage&&'在庫は戻さず、今後の持ち越しを停止します。'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>献立から削除</button>
        <button type="button" className="btn btn-secondary" data-menu-delete-cancel disabled={busy} onClick={close}>キャンセル</button>
      </div>
    </div>
  </div>
}

export function MenuPage() {
  const auth=useContext(AuthContext)
  const [inventories,setInventories]=useState<InventoryItem[]|null>(null)
  const [inventoryError,setInventoryError]=useState(false)
  const [scopeInvalidated,setScopeInvalidated]=useState(false)
  const [mealTarget,setMealTarget]=useState<{entry:MenuEntry;undo:boolean}|null>(null)
  const [mealError,setMealError]=useState('')
  const [mealSyncRequired,setMealSyncRequired]=useState(false)
  const [linkBusy,setLinkBusy]=useState(false)
  const mealTrigger=useRef<HTMLButtonElement|null>(null)
  const pageGeneration=useRef(0)
  const operation=useMenuInventoryOperation({actorUserId:auth?.user?.id,onDetached:()=>{
    setScopeInvalidated(true);setOrdinaryConfirmationScope(null);pageGeneration.current++;requestIdRef.current++
    setEntries([]);setRecipes([]);setInventories(null);setInventoryError(false)
    setMealTarget(null);setMealError('');setMealSyncRequired(false);setLinkBusy(false)
    setAddOpen(false);setAddMode('recipe');setMemo('');setSelectedIds([]);setRecipeKeyword('')
    setDetailRecipe(null);setDeleteTarget(null);setError('');setDeleteError('');setUncertain(false)
    setSubmitting(false);pending.current=false;setLoading(false)
    mealTrigger.current=null;detailTrigger.current=null;deleteTrigger.current=null
    setToast(previous=>({message:'',showKey:previous.showKey+1}))
  }})
  const [ordinaryConfirmationScope,setOrdinaryConfirmationScope]=useState<typeof operation.verifiedScope>(null)
  const latestVerifiedScope=useRef(operation.verifiedScope)
  latestVerifiedScope.current=operation.verifiedScope
  const requireOrdinaryConfirmation=()=>setOrdinaryConfirmationScope(latestVerifiedScope.current ?? operation.verifiedScope)
  useEffect(()=>{
    // 再確認が失敗して古いscopeが残っていても解除せず、新しい検証結果だけを受け入れる。
    if(operation.verifiedScope && operation.verifiedScope!==ordinaryConfirmationScope)setOrdinaryConfirmationScope(null)
  },[operation.verifiedScope,ordinaryConfirmationScope])
  const fetchInventories=useCallback(async()=>{
    const epoch=pageGeneration.current
    try {const response=await apiClient.get<InventoryItem[]>('/inventory-items');if(epoch===pageGeneration.current){setInventories(response.data);setInventoryError(false)}}
    catch(error){if(epoch===pageGeneration.current){setInventories(null);setInventoryError(true)}throw error}
  },[])
  const [weekStartDate, setWeekStartDate] = useState(() => getMondayOf(new Date()))
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('recipe')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [recipeKeyword, setRecipeKeyword] = useState('')
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null)
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const pending = useRef(false)
  const [deleteTarget, setDeleteTarget] = useState<MenuEntry | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const addTrigger = useRef<HTMLButtonElement>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const [toast, setToast] = useState({ message: '', showKey: 0 })
  const showToast = useCallback((message: string) => setToast(prev => ({ message, showKey: prev.showKey + 1 })), [])
  const requestIdRef = useRef(0)
  const currentWeekRef = useRef(weekStartDate)
  currentWeekRef.current = weekStartDate

  const fetchEntries = useCallback(async (targetWeek: string, signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    const response = await apiClient.get<MenuEntry[]>('/menu-entries', { params: { weekStartDate: targetWeek }, signal })
    if (!signal?.aborted && requestIdRef.current === requestId && currentWeekRef.current === targetWeek) setEntries(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    const scopeEpoch=pageGeneration.current
    const controller = new AbortController()
    setLoading(true)
    setEntries([])
    Promise.allSettled([fetchEntries(weekStartDate, controller.signal), apiClient.get<Recipe[]>('/recipes', { signal: controller.signal })])
      .then(([entriesResult, recipesResult]) => {
        if (cancelled || scopeEpoch!==pageGeneration.current) return
        if (entriesResult.status === 'rejected') showToast(getApiErrorMessage(entriesResult.reason, '献立の取得に失敗しました。時間をおいて再度お試しください'))
        if (recipesResult.status === 'fulfilled') setRecipes([...recipesResult.value.data].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)))
        else showToast(getApiErrorMessage(recipesResult.reason, 'レシピの取得に失敗しました。時間をおいて再度お試しください'))
      }).finally(() => { if (!cancelled && scopeEpoch===pageGeneration.current) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [weekStartDate, fetchEntries, showToast, auth?.user?.id])

  useEffect(()=>{
    if(!scopeInvalidated||!operation.verifiedScope)return
    const epoch=pageGeneration.current
    let cancelled=false
    setLoading(true)
    Promise.all([fetchEntries(currentWeekRef.current),apiClient.get<Recipe[]>('/recipes')]).then(([,response])=>{
      if(cancelled||epoch!==pageGeneration.current)return
      setRecipes([...response.data].sort((a,b)=>Number(b.isFavorite)-Number(a.isFavorite)));setScopeInvalidated(false)
    }).catch(()=>{if(!cancelled&&epoch===pageGeneration.current)showToast('一覧を再取得できません。本人と世帯の再確認からやり直してください')}).finally(()=>{if(!cancelled&&epoch===pageGeneration.current)setLoading(false)})
    return()=>{cancelled=true}
  },[scopeInvalidated,operation.verifiedScope,fetchEntries,showToast])
  const linkedPresent=entries.some(entry=>entry.inventoryLinkage)
  useEffect(()=>{if(linkedPresent)void fetchInventories().catch(()=>{})},[linkedPresent,fetchInventories])
  const synchronizeMeal=async()=>{
    const epoch=pageGeneration.current
    const targetWeek=currentWeekRef.current
    setMealSyncRequired(true)
    const results=await Promise.allSettled([fetchEntries(targetWeek),fetchInventories()])
    if(epoch!==pageGeneration.current)return
    if(results[0].status==='fulfilled')setMealSyncRequired(false)
    else showToast('記録済みです。献立の一覧を再取得してください')
    if(results[1].status==='rejected')showToast('記録済みです。在庫の連携設定を再取得してください')
  }
  const finishMeal=async(recover=false)=>{
    const epoch=pageGeneration.current
    const target=mealTarget
    if(!recover&&!target)return
    const result=recover?await operation.recover():await operation.run({kind:target!.undo?'undo':'consume',entryId:target!.entry.id,mealRevision:target!.entry.inventoryLinkage!.mealRevision})
    if(epoch!==pageGeneration.current)return
    if(result.kind==='success'){
      setMealTarget(null);mealTrigger.current?.focus();await synchronizeMeal();if(epoch===pageGeneration.current)showToast('食事の記録を更新しました')
    }else if(result.kind==='rejected'){
      setMealTarget(null);mealTrigger.current?.focus();showToast(result.message);await synchronizeMeal()
    }else setMealError(result.message)
  }
  const changeCarry=async(entry:MenuEntry,enabled:boolean)=>{
    if(scopeInvalidated||linkBusy||operation.busy||operation.pending||!operation.verifiedScope||entry.inventoryLinkage?.remainingCount !== undefined)return
    const linkage=entry.inventoryLinkage!,credentials=captureMenuCredentials(),epoch=pageGeneration.current
    if(!credentials)return
    const valid=()=>pageGeneration.current===epoch&&menuCredentialsMatch(credentials)
    setLinkBusy(true)
    try{
      const response=await apiClient.get<InventoryItem[]>('/inventory-items')
      if(!valid())return
      setInventories(response.data);setInventoryError(false)
      const inventory=response.data.find(i=>i.id===linkage.inventoryItemId),link=inventory?.menuLinks?.find(l=>l.id===linkage.linkId)
      if(!inventory||!link)throw new Error('在庫または連携設定が変更されました。一覧を再取得してください')
      if(enabled&&inventory.quantity<=0)throw new Error('在庫を補充してから再開してください')
      await updateInventoryMenuLink(link.id,{expectedRevision:link.revision,usageQuantity:link.usageQuantity,enabled:link.enabled,carryEnabled:enabled},operation.verifiedScope,credentials,valid)
      if(valid())await synchronizeMeal()
    }catch(error){
      if(pageGeneration.current===epoch && error instanceof PurchaseIdentityError){operation.invalidate();return}
      if(valid()){setInventories(null);setInventoryError(true);showToast(getApiErrorMessage(error,error instanceof Error?error.message:'連携設定を確認できません。一覧を再取得してください'))}
    }
    finally{if(pageGeneration.current===epoch){
      setLinkBusy(false)
      if(!menuCredentialsMatch(credentials)){setInventories(null);setInventoryError(true)}
    }}
  }
  const closeAdd = () => {
    setAddOpen(false)
    // 明示的な呼出元復帰を優先し、StrictModeのdialog再登録にも依存しない。
    addTrigger.current?.focus()
  }

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (scopeInvalidated || pending.current || uncertain) return
    setError('')
    if (addMode === 'recipe' && selectedIds.length === 0) { setError('レシピを選択してください'); return }
    if (addMode === 'memo' && !memo.trim()) { setError('メモを入力してください'); return }
    if (!operation.verifiedScope || ordinaryConfirmationScope) { setError('本人と世帯の確認が必要です。確認中はお待ちください。確認できない場合は、閉じて本人と世帯を再確認してください'); return }
    const targetWeek = weekStartDate
    const ids = [...selectedIds]
    const mode = addMode
    const epoch = pageGeneration.current
    const credentials = captureMenuCredentials()
    const valid = () => pageGeneration.current === epoch && !!credentials && menuCredentialsMatch(credentials)
    pending.current = true
    setSubmitting(true)
    let successCount = 0
    let failed = false
    let resultUncertain = false
    let refreshFailed = false
    try {
      if (!credentials) { operation.invalidate(); return }
      try { await verifyMenuScope(credentials, operation.verifiedScope, valid) }
      catch (error) { if (pageGeneration.current !== epoch) return; if (error instanceof PurchaseIdentityError || !valid()) operation.invalidate(); else { requireOrdinaryConfirmation(); setError('本人と世帯を再確認してください') } return }
      const payloads = mode === 'recipe' ? ids.map(recipeId => ({ weekStartDate: targetWeek, recipeId })) : [{ weekStartDate: targetWeek, freeTextMemo: memo.trim() }]
      for (const payload of payloads) {
        if (!valid()) return
        try {
          await apiClient.post('/menu-entries', payload, boundConfig(credentials))
          if (!valid()) return
          successCount++
          if ('recipeId' in payload) setSelectedIds(previous => previous.filter(id => id !== payload.recipeId))
          else setMemo('')
        } catch (err) {
          if (!valid()) return
          failed = true
          if (isAxiosError(err) && err.response?.status === 401) requireOrdinaryConfirmation()
          const rejectedBeforeWrite = isAxiosError(err) && [400, 401, 403, 404].includes(err.response?.status ?? 0)
          if (!rejectedBeforeWrite) {
            resultUncertain = true
            setUncertain(true)
            setError('追加結果を確認できません。再送せず、閉じて一覧を確認してください。画面を再読み込みするまで追加は停止します。')
          } else setError((successCount ? successCount + '件追加しました。残りの追加に失敗しました。' : '') + getApiErrorMessage(err, '献立の追加に失敗しました'))
          break
        }
      }
      if (!valid()) return
      if ((successCount > 0 || resultUncertain) && currentWeekRef.current === targetWeek) {
        try { await fetchEntries(targetWeek) }
        catch {
          if (!valid()) return
          refreshFailed = true
          if (resultUncertain) setError(previous => previous + '一覧を更新できませんでした。画面を再読み込みして一覧を確認してください。')
          else showToast('献立は追加済みですが、一覧の取得に失敗しました')
        }
      }
      if (!valid()) return
      if (!failed) {
        closeAdd()
        setRecipeKeyword('')
        if (!refreshFailed) showToast('献立を追加しました')
      }
    } finally {
      if (valid()) { pending.current = false; setSubmitting(false) }
      else if (pageGeneration.current === epoch) operation.invalidate()
    }
  }

  const handleDelete = async () => {
    if (scopeInvalidated || !deleteTarget || pending.current || (deleteTarget.inventoryLinkage && (operation.busy || operation.pending || mealSyncRequired || linkBusy))) return
    if (!operation.verifiedScope || ordinaryConfirmationScope) { setDeleteError('本人と世帯の確認が必要です。確認中はお待ちください。確認できない場合は、閉じて本人と世帯を再確認してください'); return }
    const target = deleteTarget
    const epoch = pageGeneration.current
    const credentials = captureMenuCredentials()
    const valid = () => pageGeneration.current === epoch && !!credentials && menuCredentialsMatch(credentials)
    pending.current = true
    setSubmitting(true)
    setDeleteError('')
    try {
      if (!credentials) { operation.invalidate(); return }
      try { await verifyMenuScope(credentials, operation.verifiedScope, valid) }
      catch (error) { if (pageGeneration.current !== epoch) return; if (error instanceof PurchaseIdentityError || !valid()) operation.invalidate(); else { requireOrdinaryConfirmation(); setDeleteError('本人と世帯を再確認してください') } return }
      if (!valid()) { if (pageGeneration.current === epoch) operation.invalidate(); return }
      await apiClient.delete('/menu-entries/' + target.id, boundConfig(credentials))
      if (!valid()) return
      if (currentWeekRef.current === target.weekStartDate) setEntries(previous => previous.filter(entry => entry.id !== target.id))
      setDeleteTarget(null)
      addTrigger.current?.focus()
      showToast('献立を削除しました')
    } catch (err) { if (pageGeneration.current !== epoch) return; if (err instanceof PurchaseIdentityError || !valid()) { operation.invalidate(); return } if (valid()) { if (isAxiosError(err) && err.response?.status === 401) requireOrdinaryConfirmation(); setDeleteError(getApiErrorMessage(err, '献立の削除に失敗しました')) } }
    finally { if (valid()) { pending.current = false; setSubmitting(false) } else if (pageGeneration.current === epoch) operation.invalidate() }
  }

  const mealDisabled=operation.busy || !!operation.pending || mealSyncRequired || linkBusy || !operation.verifiedScope
  const weekMoveDisabled = submitting || addOpen || deleteTarget !== null || mealTarget !== null || operation.busy || linkBusy

  return <div className="page">
    <div className="ui-narrow" data-testid="menu-panel">
      <header className="ui-page-head">
        <div>
          <h2>献立表</h2>
          <p className="ui-page-sub" data-testid="menu-week-range">{formatWeekRange(weekStartDate)}</p>
        </div>
      </header>
      <div className="ui-card menu-week-nav" role="group" aria-label="週の移動">
        <button type="button" className="menu-week-button" disabled={weekMoveDisabled} onClick={() => setWeekStartDate(value => addWeeks(value, -1))}><span aria-hidden="true">‹</span>前の週</button>
        <span className="menu-week-label">{formatWeekOfMonth(weekStartDate)}</span>
        <button type="button" className="menu-week-button" disabled={weekMoveDisabled} onClick={() => setWeekStartDate(value => addWeeks(value, 1))}>次の週<span aria-hidden="true">›</span></button>
      </div>
      <button ref={addTrigger} type="button" className="ui-action" disabled={loading||scopeInvalidated} onClick={() => { if (!uncertain) setError(''); setAddOpen(true) }}><span aria-hidden="true">＋</span>レシピを追加</button>
      {(linkedPresent||scopeInvalidated||!operation.verifiedScope||ordinaryConfirmationScope) && (operation.message||!operation.verifiedScope||ordinaryConfirmationScope) && <p role="status">{operation.message || '本人と世帯の確認が必要です。確認中はお待ちください。確認できない場合は本人と世帯を再確認してください。下書きは保持されます。'}</p>}
      {operation.pending && <button type="button" className="btn btn-secondary" disabled={operation.busy} onClick={()=>{void finishMeal(true)}}>前回の結果を確認</button>}
      {(!operation.verifiedScope||scopeInvalidated||ordinaryConfirmationScope) && <button type="button" className="btn btn-secondary" disabled={operation.busy} onClick={()=>{void operation.recheck()}}>本人と世帯を再確認</button>}
      {mealSyncRequired && <button type="button" className="btn btn-secondary" disabled={operation.busy} onClick={()=>{void synchronizeMeal()}}>献立の一覧を再取得</button>}
      {inventoryError && <div role="status"><p>連携設定を確認できません。食事の記録とは別に再取得してください。</p><button type="button" className="btn btn-secondary" onClick={()=>{void fetchInventories().catch(()=>{})}}>連携設定を再取得</button></div>}
      {loading ? <p className="ui-empty">読み込み中...</p> : <>
        <h3 className="ui-section-label">登録済みの献立（{entries.length}件）</h3>
        <ul className="menu-list" aria-label="この週の献立">
          {entries.length === 0 ? <li className="ui-empty">この週の献立はまだありません</li> : entries.map(entry => {
            const recipe = recipes.find(item => item.id === entry.recipeId)
            const available = recipe && entry.recipeTitle !== null
            const planned = entry.inventoryLinkage?.remainingCount != null
            const controlsInDetails = !!entry.inventoryLinkage && entry.inventoryLinkage.remainingCount !== undefined
            const controls = entry.inventoryLinkage && <LinkedMenuControls entry={entry} disabled={mealDisabled||mealTarget!==null||submitting} carryReady={inventories!==null} onMeal={(undo,button)=>{mealTrigger.current=button;setMealError('');setMealTarget({entry,undo})}} onCarry={enabled=>{void changeCarry(entry,enabled)}}/>
            return <li key={entry.id} className={planned ? 'ui-card menu-list-row menu-list-row-planned' : 'ui-card menu-list-row'}>
              <MenuTitle text={displayLabel(entry)} siteLabel={planned ? undefined : sourceLabel(entry, recipe)} chevron>
                {available && (recipe.sourceType === 'web' && recipe.url
                  ? <a className="menu-entry-link" href={recipe.url} target="_blank" rel="noopener noreferrer">レシピを見る</a>
                  : <button type="button" className="menu-entry-link" onClick={event => { detailTrigger.current = event.currentTarget; setDetailRecipe(recipe) }}>レシピを見る</button>)}
                <button type="button" className="menu-delete-trigger" disabled={!!entry.inventoryLinkage&&(mealDisabled||mealTarget!==null)} onClick={event => { deleteTrigger.current = event.currentTarget; setDeleteError(''); setDeleteTarget(entry) }}>削除</button>
                {controlsInDetails && controls}
              </MenuTitle>
              {!controlsInDetails && controls}
            </li>
          })}
        </ul>
      </>}
    </div>
    {mealTarget && <MenuMealConfirmation entry={mealTarget.entry} undo={mealTarget.undo} busy={operation.busy} confirmBlocked={!!operation.pending||mealSyncRequired} error={mealError} onClose={()=>{setMealTarget(null);mealTrigger.current?.focus()}} onConfirm={()=>{void finishMeal()}}/>}
    {addOpen && <MenuAddSheet recipes={recipes} registeredRecipeIds={entries.flatMap(entry => entry.recipeId === null ? [] : [entry.recipeId])} mode={addMode} keyword={recipeKeyword} selectedIds={selectedIds} memo={memo} error={error} busy={submitting} uncertain={uncertain}
      onMode={setAddMode} onKeyword={setRecipeKeyword} onToggle={id => setSelectedIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])}
      onClear={() => setSelectedIds([])} onMemo={setMemo} onSubmit={handleAdd} onClose={closeAdd} />}
    {deleteTarget && <DeleteConfirmation entry={deleteTarget} busy={submitting} error={deleteError} onDelete={() => { void handleDelete() }} onClose={() => { setDeleteTarget(null); deleteTrigger.current?.focus() }} />}
    {detailRecipe && <RecipeDetailModal recipe={detailRecipe} onClose={() => { setDetailRecipe(null); detailTrigger.current?.focus() }} />}
    <Toast message={toast.message} showKey={toast.showKey} />
  </div>
}
