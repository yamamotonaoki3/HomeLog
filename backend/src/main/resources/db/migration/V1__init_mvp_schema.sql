-- MVP（Phase 1）対象テーブルの初期スキーマ
-- 対応: docs/details/data-model.md

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refresh_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP
);

CREATE TABLE password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP
);

CREATE TABLE user_settings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users (id),
    dashboard_settings JSONB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE households (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(16) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ユーザーは同時に1世帯のみに所属する（common-notes.md 1章）ため user_id は UNIQUE とする
CREATE TABLE household_members (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id),
    user_id BIGINT NOT NULL UNIQUE REFERENCES users (id),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE zaiko_categories (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id),
    name VARCHAR(50) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE stores (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id),
    name VARCHAR(50) NOT NULL
);

CREATE TABLE inventory_items (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id),
    name VARCHAR(50) NOT NULL,
    category_id BIGINT NOT NULL REFERENCES zaiko_categories (id),
    store_id BIGINT REFERENCES stores (id),
    quantity NUMERIC(6, 1) NOT NULL,
    threshold NUMERIC(6, 1) NOT NULL
);

CREATE TABLE shopping_list_items (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id),
    inventory_item_id BIGINT NOT NULL REFERENCES inventory_items (id),
    is_manual BOOLEAN NOT NULL DEFAULT FALSE,
    purchased BOOLEAN NOT NULL DEFAULT FALSE,
    purchased_quantity NUMERIC(6, 1),
    added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);
CREATE INDEX idx_household_members_household_id ON household_members (household_id);
CREATE INDEX idx_zaiko_categories_household_id ON zaiko_categories (household_id);
CREATE INDEX idx_stores_household_id ON stores (household_id);
CREATE INDEX idx_inventory_items_household_id ON inventory_items (household_id);
CREATE INDEX idx_shopping_list_items_household_id ON shopping_list_items (household_id);
CREATE INDEX idx_shopping_list_items_inventory_item_id ON shopping_list_items (inventory_item_id);
