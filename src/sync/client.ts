import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface KontxtSupabaseConfig {
  supabase_url?: string
  supabase_anon_key?: string
  supabase_access_token?: string
}

export function createUserScopedSupabase(config: KontxtSupabaseConfig): SupabaseClient | null {
  const url = config.supabase_url?.trim()
  const anon = config.supabase_anon_key?.trim()
  const token = config.supabase_access_token?.trim()
  if (!url || !anon || !token) return null

  return createClient(url, anon, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
