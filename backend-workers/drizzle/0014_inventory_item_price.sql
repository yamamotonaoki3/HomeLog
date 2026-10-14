ALTER TABLE inventory_items ADD COLUMN price INTEGER
  CHECK (price IS NULL OR (typeof(price) = 'integer' AND price BETWEEN 0 AND 9999999999));
