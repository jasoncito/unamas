// The groups chosen on screen 1, kept apart from the ones an exercise of another group added: undoing
// that exercise takes an added group away again, never a chosen one (decided with Jason, 3 oct 2026).
// Local only (not synced): it only matters on the phone where the session is going. NULL (sessions from
// before, or pulled from the server) = every group counts as chosen.
export const v6 = {
  version: 6,
  sql: `ALTER TABLE session ADD COLUMN chosen_groups TEXT;`,
};
