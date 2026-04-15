import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../../vault/db.js'
import { createUserScopedSupabase } from '../../sync/client.js'
import { pushMemoriesToSupabase } from '../../sync/push.js'
import { KONTXT_MEMORIES_TABLE } from '../../sync/base-mapping.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

function readConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function syncStatusCommand() {
  const c = readConfig()
  const url = typeof c.supabase_url === 'string' ? c.supabase_url : ''
  const hasKey = typeof c.supabase_anon_key === 'string' && c.supabase_anon_key.length > 0
  const hasToken =
    typeof c.supabase_access_token === 'string' && c.supabase_access_token.length > 0

  console.log(chalk.cyan('\n  kontxt sync status\n'))
  console.log(
    chalk.gray('  config: ') +
      CONFIG_PATH +
      '\n  supabase_url: ' +
      (url ? chalk.green('set') : chalk.yellow('missing'))
  )
  console.log('  supabase_anon_key: ' + (hasKey ? chalk.green('set') : chalk.yellow('missing')))
  console.log(
    '  supabase_access_token: ' +
      (hasToken ? chalk.green('set') : chalk.yellow('missing (user JWT from Supabase Auth)'))
  )
  console.log(
    chalk.gray(
      '\n  Default push uploads only memories with privacy_level anonymizable or shareable.\n  Use --include-private to push private rows (treat cloud as encrypted backup target only).\n'
    )
  )
  console.log(
    chalk.gray('  Table: public.') + chalk.white(KONTXT_MEMORIES_TABLE) + chalk.gray(' — see supabase/migrations.\n')
  )
}

export async function syncPushCommand(options: {
  includePrivate?: boolean
  dryRun?: boolean
}) {
  const c = readConfig()
  const client = createUserScopedSupabase({
    supabase_url: c.supabase_url as string | undefined,
    supabase_anon_key: c.supabase_anon_key as string | undefined,
    supabase_access_token: c.supabase_access_token as string | undefined,
  })

  if (!client) {
    console.log(
      chalk.red('\n  Supabase not configured. Add to ') +
        CONFIG_PATH +
        chalk.red(':\n') +
        chalk.gray(`  "supabase_url": "https://<ref>.supabase.co",\n`) +
        chalk.gray(`  "supabase_anon_key": "<anon key>",\n`) +
        chalk.gray(`  "supabase_access_token": "<user JWT from Supabase Auth>"\n`)
    )
    return
  }

  const { data: userData, error: userErr } = await client.auth.getUser()
  if (userErr || !userData.user) {
    console.log(
      chalk.red('\n  Invalid or expired access token. Refresh your Supabase session JWT.\n') +
        chalk.gray(String(userErr?.message || ''))
    )
    return
  }

  const db = getDb()
  try {
    const result = await pushMemoriesToSupabase(db, client, userData.user.id, {
      includePrivate: options.includePrivate,
      dryRun: options.dryRun,
    })
    if (options.dryRun) {
      console.log(
        chalk.cyan('\n  dry-run: would push ') +
          result.pushed +
          chalk.cyan(' memories (') +
          result.skipped +
          chalk.cyan(' skipped by privacy filter)\n')
      )
      return
    }
    console.log(
      chalk.green('\n  ✓ pushed ') +
        result.pushed +
        chalk.green(' memories in ') +
        result.batches +
        chalk.green(' batch(es); ') +
        result.skipped +
        chalk.green(' skipped by privacy filter\n')
    )
  } catch (e) {
    console.log(chalk.red('\n  push failed: ' + (e as Error).message + '\n'))
  }
}
