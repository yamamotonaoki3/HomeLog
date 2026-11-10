import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { UiIcon, type UiIconName } from '../components/UiIcon'
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

// 設定の入口(S-25)。各設定の中身はここでは取得せず、行き先を選ぶだけの画面にする。
const SETTINGS_ENTRIES: { title: string; description: string; to: string; icon: UiIconName }[] = [
  { title: '世帯設定', description: '世帯グループ名・招待コード・メンバーを確認できます。', to: '/household/settings', icon: 'household' },
  { title: '表示設定', description: 'ダッシュボードに表示するカードや項目、並び順を調整できます。', to: '/settings/display', icon: 'display' },
  { title: 'アカウント設定', description: '表示名・メールアドレス・パスワードの変更、退会の手続きができます。', to: '/settings/account', icon: 'account' },
]

export function SettingsPage() {
  return (
    <div className="page settings-page">
      <div className="ui-narrow" data-testid="settings-panel">
        <header className="ui-page-head">
          <div>
            <h2>設定</h2>
            <p className="ui-page-sub">世帯・表示・アカウントの設定を開きます</p>
          </div>
        </header>
        <ul className="settings-menu" aria-label="設定の種類">
          {SETTINGS_ENTRIES.map((entry) => (
            <li key={entry.to} className="ui-card settings-menu-item">
              <UiIcon name={entry.icon} />
              <div className="settings-menu-text">
                <h3>{entry.title}</h3>
                <p>{entry.description}</p>
              </div>
              {/* 表示は短くし、読み上げ名は行き先が分かる従来の名前のままにする。 */}
              <NavLink to={entry.to} className="settings-menu-open" aria-label={entry.title + 'を開く'}>
                開く<span aria-hidden="true">›</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const CARD_ICONS: Record<DashboardCard, UiIconName> = {
  today: 'today',
  stock: 'cart',
  finance: 'coins',
  money: 'yen',
  eventExpenses: 'event',
  calendar: 'calendar',
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
  // 取得した時点の内容。今の内容と比べて、未保存の変更があるかを判定する。
  const [loadedSnapshot, setLoadedSnapshot] = useState('')
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
      .then((response) => {
        setSettings(response.data)
        setLoadedSnapshot(JSON.stringify(response.data))
      })
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

  // 読み込み中・取得失敗でも、戻る導線のある同じ枠の中に表示する。
  const frame = (content: ReactNode) => (
    <div className="page display-settings-page">
      <div className="ui-narrow display-settings" data-testid="display-settings-panel">
        <Link to="/settings" className="ui-back-link">
          <span aria-hidden="true">‹</span>設定に戻る
        </Link>
        <header className="ui-page-head">
          <div>
            <h2>表示設定</h2>
            <p className="ui-page-sub">ダッシュボードに表示する項目を選び、順番を並べ替えられます</p>
          </div>
        </header>
        {content}
      </div>
    </div>
  )

  if (loadError) return frame(<p role="alert" className="error">{loadError}</p>)
  if (!settings) return frame(<p role="status">読み込み中...</p>)

  const dirty = JSON.stringify(settings) !== loadedSnapshot

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

  return frame(
    <>
      <h3 className="ui-section-label">ダッシュボードに表示する項目</h3>
      {CHECKLIST_ORDER.map((card) => {
        const shown = settings.cards[card]
        return (
          <div key={card} role="group" aria-label={CARD_LABELS[card]} className="ui-card display-card">
            {/* 親項目。見た目はスイッチだが中身はチェックボックスで、保存ボタンを押すまで反映しない。 */}
            <label className="display-card-head">
              <UiIcon name={CARD_ICONS[card]} />
              <span className="display-card-title">{CARD_LABELS[card]}</span>
              <input type="checkbox" className="ui-switch-input" checked={shown} onChange={() => toggleCard(card)} />
              <span className="ui-switch-state" aria-hidden="true">{shown ? '表示' : '非表示'}</span>
              <span className="ui-switch-track" aria-hidden="true" />
            </label>
            {isItemCard(card) && (
              <div className={shown ? 'display-card-items' : 'display-card-items is-disabled'}>
                {(Object.entries(ITEM_LABELS[card]) as [keyof DisplaySettings['items'][typeof card], string][]).filter(([key]) => card !== 'today' || key !== 'balance').map(([key, label]) => (
                  <label key={String(key)} className="display-card-item">
                    <input
                      type="checkbox"
                      disabled={!shown}
                      checked={settings.items[card][key] as boolean}
                      onChange={() => toggleItem(card, key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {card === 'today' && <p className="display-settings-hint">今日の収支はカレンダーの日付詳細で確認できます</p>}
          </div>
        )
      })}

      <h3 id="card-order-heading" className="ui-section-label">表示カードの並べ替え</h3>
      <p className="display-settings-hint">ドラッグするか、上へ・下へボタンで並べ替えます。カレンダーは常に最上部に表示されます。</p>
      {visibleOrder.length === 0 ? (
        <p className="ui-empty">表示するカードがありません。</p>
      ) : (
        <ol className="card-order-grid" aria-label="ダッシュボードのカード順">
          {visibleOrder.map((card, index) => (
            <li
              key={card}
              data-card={card}
              className={dragging === card ? 'ui-card card-order-item is-dragging' : 'ui-card card-order-item'}
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
              <svg className="card-order-handle" aria-hidden="true" viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
                <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
              </svg>
              <UiIcon name={CARD_ICONS[card]} />
              <div className="card-order-body">
                <strong>{CARD_LABELS[card]}</strong>
                <span>{CARD_DESCRIPTIONS[card]}</span>
              </div>
              <div className="card-order-actions">
                <button
                  type="button"
                  className="ui-icon-button"
                  ref={(element) => {
                    if (element) buttonRefs.current.set(`${card}:-1`, element)
                  }}
                  aria-label={`「${CARD_LABELS[card]}」を上へ移動`}
                  disabled={index === 0}
                  onClick={() => moveBy(card, -1)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
                </button>
                <button
                  type="button"
                  className="ui-icon-button"
                  ref={(element) => {
                    if (element) buttonRefs.current.set(`${card}:1`, element)
                  }}
                  aria-label={`「${CARD_LABELS[card]}」を下へ移動`}
                  disabled={index === visibleOrder.length - 1}
                  onClick={() => moveBy(card, 1)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p role="status" className="visually-hidden">{announcement}</p>

      {dirty && <p className="ui-note display-settings-unsaved">未保存の変更があります。「保存」を押すとダッシュボードに反映されます。</p>}
      {saveError && <p role="alert" className="error">{saveError}</p>}
      <button type="button" className="ui-action" onClick={save} disabled={saving}>
        {saving ? '保存中...' : '保存'}
      </button>
    </>,
  )
}
