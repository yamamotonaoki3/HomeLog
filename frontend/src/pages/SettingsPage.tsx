import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import {
  CARD_DESCRIPTIONS,
  CARD_LABELS,
  CHECKLIST_ORDER,
  ITEM_LABELS,
  type DashboardCard,
  type DisplaySettings,
  type ItemCard,
  type OrderableCard,
} from '../api/userSettingsTypes'

export function SettingsPage() {
  return (
    <div className="page settings-page">
      <h1>設定</h1>
      <div className="settings-grid">
        <section className="panel settings-card">
          <h2>世帯設定</h2>
          <p>世帯情報やメンバー設定を確認・変更できます。</p>
          <NavLink to="/household/settings">世帯設定を開く</NavLink>
        </section>
        <section className="panel settings-card">
          <h2>表示設定</h2>
          <p>ダッシュボードに表示するカードや項目を調整できます。</p>
          <NavLink to="/settings/display">表示設定を開く</NavLink>
        </section>
        <section className="panel settings-card">
          <h2>アカウント設定</h2>
          <p>表示名・メールアドレス・パスワードを変更できます。</p>
          <NavLink to="/settings/account">アカウント設定を開く</NavLink>
        </section>
      </div>
    </div>
  )
}

function isItemCard(card: DashboardCard): card is ItemCard {
  return card in ITEM_LABELS
}

function moveCard(order: OrderableCard[], card: OrderableCard, target: OrderableCard): OrderableCard[] {
  const without = order.filter((c) => c !== card)
  const index = without.indexOf(target)
  const fromIndex = order.indexOf(card)
  const toIndex = order.indexOf(target)
  without.splice(fromIndex < toIndex ? index + 1 : index, 0, card)
  return without
}

export function DisplaySettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<DisplaySettings | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [dragging, setDragging] = useState<OrderableCard | null>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | null>(null)

  useEffect(() => {
    apiClient
      .get<DisplaySettings>('/user-settings')
      .then((response) => setSettings(response.data))
      .catch((error: unknown) => setLoadError(getApiErrorMessage(error, '表示設定の取得に失敗しました')))
  }, [])

  useEffect(() => {
    if (!pendingFocus.current) return
    const [card, direction] = pendingFocus.current.split(':')
    const button = buttonRefs.current.get(pendingFocus.current)
    // 端まで移動してボタンが無効になったら、反対方向のボタンへフォーカスを移す
    const target = button?.disabled ? buttonRefs.current.get(`${card}:${direction === '1' ? '-1' : '1'}`) : button
    target?.focus()
    pendingFocus.current = null
  })

  if (loadError) return <p role="alert" className="error">{loadError}</p>
  if (!settings) return <p>読み込み中...</p>

  const visibleOrder = settings.cardOrder.filter((card) => settings.cards[card])

  const toggleCard = (card: DashboardCard) =>
    setSettings({ ...settings, cards: { ...settings.cards, [card]: !settings.cards[card] } })

  const toggleItem = <C extends ItemCard>(card: C, key: keyof DisplaySettings['items'][C]) => {
    const items = settings.items[card]
    setSettings({ ...settings, items: { ...settings.items, [card]: { ...items, [key]: !items[key] } } })
  }

  const applyOrder = (card: OrderableCard, target: OrderableCard) => {
    const cardOrder = moveCard(settings.cardOrder, card, target)
    setSettings({ ...settings, cardOrder })
    const position = cardOrder.filter((c) => settings.cards[c]).indexOf(card) + 1
    setAnnouncement(`「${CARD_LABELS[card]}」を${position}番目に移動しました`)
  }

  const moveBy = (card: OrderableCard, direction: -1 | 1) => {
    const target = visibleOrder[visibleOrder.indexOf(card) + direction]
    if (!target) return
    pendingFocus.current = `${card}:${direction}`
    applyOrder(card, target)
  }

  const save = async () => {
    setSaving(true)
    setSaveError('')
    try {
      await apiClient.put('/user-settings', settings)
      navigate('/')
    } catch (error) {
      setSaveError(getApiErrorMessage(error, '表示設定の保存に失敗しました'))
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="panel display-settings">
        <h2>表示設定</h2>
        <h3>ダッシュボードに表示する項目</h3>
        {CHECKLIST_ORDER.map((card) =>
          isItemCard(card) ? (
            <fieldset key={card} className="display-settings-group">
              <legend>
                <label>
                  <input type="checkbox" checked={settings.cards[card]} onChange={() => toggleCard(card)} />
                  {CARD_LABELS[card]}
                </label>
              </legend>
              <div className={settings.cards[card] ? 'display-settings-items' : 'display-settings-items is-disabled'}>
                {(Object.entries(ITEM_LABELS[card]) as [keyof DisplaySettings['items'][typeof card], string][]).map(([key, label]) => (
                  <label key={String(key)}>
                    <input
                      type="checkbox"
                      disabled={!settings.cards[card]}
                      checked={settings.items[card][key] as boolean}
                      onChange={() => toggleItem(card, key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div key={card} className="display-settings-group">
              <label>
                <input type="checkbox" checked={settings.cards[card]} onChange={() => toggleCard(card)} />
                {CARD_LABELS[card]}
              </label>
            </div>
          ),
        )}

        <h3 id="card-order-heading">表示カードの並べ替え</h3>
        <p className="display-settings-hint">ドラッグするか、上へ・下へボタンで並べ替えます。カレンダーは常に最上部に表示されます。</p>
        {visibleOrder.length === 0 ? (
          <p>表示するカードがありません。</p>
        ) : (
          <ol className="card-order-grid" aria-label="ダッシュボードのカード順">
            {visibleOrder.map((card, index) => (
              <li
                key={card}
                data-card={card}
                className={dragging === card ? 'card-order-item is-dragging' : 'card-order-item'}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', card)
                  setDragging(card)
                }}
                onDragOver={(event) => {
                  if (dragging && dragging !== card) event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragging && dragging !== card) applyOrder(dragging, card)
                  setDragging(null)
                }}
                onDragEnd={() => setDragging(null)}
              >
                <div className="card-order-body">
                  <strong>{CARD_LABELS[card]}</strong>
                  <span>{CARD_DESCRIPTIONS[card]}</span>
                </div>
                <div className="card-order-actions">
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) buttonRefs.current.set(`${card}:-1`, element)
                    }}
                    aria-label={`「${CARD_LABELS[card]}」を上へ移動`}
                    disabled={index === 0}
                    onClick={() => moveBy(card, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) buttonRefs.current.set(`${card}:1`, element)
                    }}
                    aria-label={`「${CARD_LABELS[card]}」を下へ移動`}
                    disabled={index === visibleOrder.length - 1}
                    onClick={() => moveBy(card, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p role="status" className="visually-hidden">{announcement}</p>

        {saveError && <p role="alert" className="error">{saveError}</p>}
        <button type="button" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}
