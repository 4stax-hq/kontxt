import { loadConfig, saveConfig } from '../../config'

export function pauseCommand(): void {
  const config = loadConfig()
  if (config.capturePaused) {
    console.log('kontxt background capture is already paused.')
    return
  }
  config.capturePaused = true
  config.capturePausedAt = Date.now()
  saveConfig(config)
  console.log('kontxt background capture paused.')
}
