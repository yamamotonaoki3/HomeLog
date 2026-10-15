ALTER TABLE accounts ADD COLUMN deleted_at TEXT;

-- Reject deleted account references inside the writing transaction.
CREATE TRIGGER incomes_active_account_insert
BEFORE INSERT ON incomes
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER incomes_active_account_update
BEFORE UPDATE OF account_id ON incomes
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER expenses_active_account_insert
BEFORE INSERT ON expenses
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM cards JOIN accounts ON accounts.id = cards.account_id
    WHERE cards.id = NEW.card_id AND accounts.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER expenses_active_account_update
BEFORE UPDATE OF account_id, card_id ON expenses
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM cards JOIN accounts ON accounts.id = cards.account_id
    WHERE cards.id = NEW.card_id AND accounts.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER cards_active_account_insert
BEFORE INSERT ON cards
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER cards_active_account_update
BEFORE UPDATE OF account_id ON cards
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER card_charges_active_account_insert
BEFORE INSERT ON card_charges
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.from_account_id AND deleted_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM cards JOIN accounts ON accounts.id = cards.account_id
    WHERE cards.id = NEW.card_id AND accounts.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER card_charges_active_account_update
BEFORE UPDATE OF from_account_id, card_id ON card_charges
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.from_account_id AND deleted_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM cards JOIN accounts ON accounts.id = cards.account_id
    WHERE cards.id = NEW.card_id AND accounts.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER fixed_costs_active_account_insert
BEFORE INSERT ON fixed_costs
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM cards JOIN accounts ON accounts.id = cards.account_id
    WHERE cards.id = NEW.card_id AND accounts.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER fixed_costs_active_account_update
BEFORE UPDATE OF account_id, card_id ON fixed_costs
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND deleted_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM cards JOIN accounts ON accounts.id = cards.account_id
    WHERE cards.id = NEW.card_id AND accounts.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

-- Optional settlement accounts stay nullable.
CREATE TRIGGER expense_splits_active_debtor_account_update
BEFORE UPDATE OF debtor_account_id ON expense_splits
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.debtor_account_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

-- Soft deletion itself must remain possible; only guard balance writes.
CREATE TRIGGER accounts_active_balance_update
BEFORE UPDATE OF balance ON accounts
WHEN OLD.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;

CREATE TRIGGER cards_active_balance_update
BEFORE UPDATE OF balance ON cards
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_ACCOUNT_DELETED');
END;
