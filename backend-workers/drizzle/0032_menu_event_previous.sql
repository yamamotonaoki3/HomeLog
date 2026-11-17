-- #554: explicit LIFO order; historical event quantities and saved successes stay untouched.
ALTER TABLE menu_consumption_events ADD COLUMN previous_event_id TEXT DEFAULT NULL;
