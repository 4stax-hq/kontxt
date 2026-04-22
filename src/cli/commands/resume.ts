import { loadConfig, saveConfig } from '../../config'
import { refreshCommand } from './refresh'

export async function resumeCommand(options?: { workspacePath?: string; catchUp?: boolean }): Promise<void> {
  const config = loadConfig()
  if (!config.capturePaused) {
    console.log('kontxt background capture is already running.')
    return
  }
  const pausedAt = config.capturePausedAt ?? 0
  config.capturePaused = false
  config.capturePausedAt = 0
  saveConfig(config)

  if (options?.catchUp) {
    const workspacePath = options.workspacePath ?? process.cwd()
    console.log('kontxt background capture resumed. Catching up missed changes...')
    const stored = await refreshCommand(workspacePath, undefined, {
      incremental: true,
      sinceTimestamp: pausedAt || Date.now(),
    })
    if (stored > 0) {
      console.log(`Caught up: ${stored} new entries`)
    } else {
      console.log('No high-value missed changes found while capture was paused.')
    }
    return
  }

  console.log('kontxt background capture resumed from the current workspace state.')
}
