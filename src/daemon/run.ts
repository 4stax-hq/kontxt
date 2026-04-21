import { startDaemon } from './index'

startDaemon().catch(err => {
  console.error('[daemon] Fatal error:', err)
  process.exit(1)
})
