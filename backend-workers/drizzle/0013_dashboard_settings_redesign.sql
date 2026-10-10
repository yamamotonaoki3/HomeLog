-- Issue #170: dashboard_settings を #169 の再設計形式（eventExpenses・cardOrder・実リスト項目）へ移行する。
-- 旧形式の行（cards.eventExpenses を持たない有効なJSON）だけを書き換え、commonItems 等の廃止項目は落とす。
-- 移行規則は routes/user-settings.ts の fromLegacy と同じ。
UPDATE user_settings
SET dashboard_settings = json_object(
  'cards', json_object(
    'today', json(iif(coalesce(json_extract(dashboard_settings, '$.cards.today'), 1), 'true', 'false')),
    'stock', json(iif(coalesce(json_extract(dashboard_settings, '$.cards.stock'), 1), 'true', 'false')),
    'finance', json(iif(coalesce(json_extract(dashboard_settings, '$.cards.finance'), 1), 'true', 'false')),
    'money', json(iif(coalesce(json_extract(dashboard_settings, '$.cards.money'), 1), 'true', 'false')),
    'eventExpenses', json(iif(
      coalesce(json_extract(dashboard_settings, '$.cards.money'), 1)
        AND coalesce(json_extract(dashboard_settings, '$.items.money.eventSummary'), 1),
      'true', 'false')),
    'calendar', json(iif(coalesce(json_extract(dashboard_settings, '$.cards.calendar'), 1), 'true', 'false'))
  ),
  'cardOrder', json_array('today', 'stock', 'finance', 'money', 'eventExpenses'),
  'items', json_object(
    'today', json_object(
      'balance', json(iif(coalesce(json_extract(dashboard_settings, '$.items.today.balance'), 1), 'true', 'false')),
      'menu', json(iif(coalesce(json_extract(dashboard_settings, '$.items.today.menu'), 1), 'true', 'false')),
      'events', json(iif(coalesce(json_extract(dashboard_settings, '$.items.today.events'), 1), 'true', 'false'))
    ),
    'stock', json_object(
      'shoppingList', json(iif(coalesce(json_extract(dashboard_settings, '$.items.stock.shoppingCount'), 1), 'true', 'false')),
      'inventoryList', json(iif(coalesce(json_extract(dashboard_settings, '$.items.stock.lowStock'), 1), 'true', 'false'))
    ),
    'money', json_object(
      'personal', json(iif(coalesce(json_extract(dashboard_settings, '$.items.money.personal'), 1), 'true', 'false')),
      'householdTotal', json(iif(coalesce(json_extract(dashboard_settings, '$.items.money.householdTotal'), 1), 'true', 'false')),
      'unsettled', json(iif(coalesce(json_extract(dashboard_settings, '$.items.money.unsettled'), 1), 'true', 'false'))
    ),
    'calendar', json_object(
      'income', json(iif(coalesce(json_extract(dashboard_settings, '$.items.calendar.balance'), 1), 'true', 'false')),
      'expense', json(iif(coalesce(json_extract(dashboard_settings, '$.items.calendar.balance'), 1), 'true', 'false')),
      'events', json(iif(coalesce(json_extract(dashboard_settings, '$.items.calendar.events'), 1), 'true', 'false'))
    )
  )
),
updated_at = current_timestamp
WHERE json_valid(dashboard_settings)
  AND json_type(dashboard_settings, '$.cards') = 'object'
  AND json_type(dashboard_settings, '$.cards.eventExpenses') IS NULL;
