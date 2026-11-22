-- Compare titles with the same whitespace set as JavaScript String.prototype.trim().
-- The household index already scopes each lookup; existing duplicate rows are left intact.
CREATE TRIGGER recipes_unique_title_insert
BEFORE INSERT ON recipes
WHEN EXISTS (
  SELECT 1
  FROM recipes
  WHERE household_id = NEW.household_id
    AND trim(title, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
      = trim(NEW.title, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
)
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_RECIPE_TITLE_CONFLICT');
END;

-- Allow edits of legacy recipes that keep their existing normalized title and household.
CREATE TRIGGER recipes_unique_title_update
BEFORE UPDATE OF title, household_id ON recipes
WHEN (
    OLD.household_id <> NEW.household_id
    OR trim(OLD.title, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
      <> trim(NEW.title, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
  )
  AND EXISTS (
    SELECT 1
    FROM recipes
    WHERE household_id = NEW.household_id
      AND id <> OLD.id
      AND trim(title, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
        = trim(NEW.title, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
  )
BEGIN
  SELECT RAISE(ABORT, 'HOMELOG_RECIPE_TITLE_CONFLICT');
END;
