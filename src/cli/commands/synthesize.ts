import { getDb, getProject } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { synthesizeUserProfile, synthesizeProject } from '../../pipeline/synthesizer'

export async function synthesizeCommand(workspacePath?: string, projectName?: string): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  if (!config.anthropicKey && !config.openaiKey) {
    console.error('No API key set. Run: kontxt config set anthropic-key <key>')
    process.exit(1)
  }

  // User profile synthesis
  console.log('Synthesizing user profile...')
  const profile = await synthesizeUserProfile(db, config, true)
  if (profile) {
    console.log('\n── User Profile ──────────────────────')
    console.log(profile)
  } else {
    console.log('Not enough global entries yet (need 8+). Add more with: kontxt note --global')
  }

  // Project synthesis
  let project = projectName
  if (!project && workspacePath) {
    const p = getProject(db, workspacePath)
    project = p?.name
  }
  if (!project && workspacePath) {
    project = require('path').basename(workspacePath)
  }

  if (project && project !== '__global__') {
    console.log(`\nSynthesizing project: ${project}...`)
    const synthesis = await synthesizeProject(db, project, config, true)
    if (synthesis) {
      console.log('\n── Project Context ───────────────────')
      console.log(synthesis)
    } else {
      console.log(`Not enough entries for ${project} yet (need 8+).`)
    }
  }
}
