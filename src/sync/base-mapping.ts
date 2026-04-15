/**
 * Field mapping between local kontxt `Memory` rows and Supabase tables used by
 * 4StaX base / app.4stax.com. Adjust names in your base repo migrations to match,
 * or add a thin view that aliases these columns.
 *
 * ## public.kontxt_memories (this repo migration)
 *
 * | Supabase column      | Local `Memory` field   | Notes |
 * |---------------------|------------------------|-------|
 * | id                  | id                     | Same UUID string |
 * | user_id             | (auth)                 | Set from JWT `sub` on push |
 * | project             | project                | Optional slug/name |
 * | content             | content                | |
 * | summary             | summary                | |
 * | source              | source                 | e.g. `living-md:...` |
 * | type                | type                   | memory type enum |
 * | privacy_level       | privacy_level          | `private` \| `anonymizable` \| `shareable` |
 * | embedding_tier      | embedding_tier         | For server-side re-embed policy |
 * | tags                | tags                   | JSON array |
 * | related_ids         | related_ids            | JSON array |
 * | importance_score    | importance_score       | |
 * | client_updated_at   | accessed_at or created_at | Last known client timestamp |
 * | updated_at          | (push time)               | Set on each upsert from CLI |
 *
 * ## Future base-app tables (not migrated here)
 *
 * - `profiles` — link `auth.users.id` to display name, avatar; kontxt does not own this row.
 * - `projects` — optional; if base uses `project_id` UUIDs, map `Memory.project` string via a local slug table or rename column in a view.
 * - `memory_grants` / `audit_log` — marketplace and consent; push does not write these; base app owns grant lifecycle.
 *
 * ## REST / Edge shape
 *
 * Base apps should treat `kontxt_memories` as read-mostly mirror: kontxt CLI upserts with user JWT.
 * For wiki rendering, prefer filtering `privacy_level in ('shareable')` or signed URLs + RLS-only private reads.
 */

export const KONTXT_MEMORIES_TABLE = 'kontxt_memories' as const
