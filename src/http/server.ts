import * as http from 'http'
import type { Database } from '../storage/db'
import type { Config } from '../config'
import { handleRoutes } from './routes'
import type { DaemonEvent } from '../types'

export function createHttpServer(
  db: Database.Database,
  config: Config,
  bus: { emitEvent(e: DaemonEvent): boolean }
): http.Server {
  return http.createServer((req, res) => {
    const remote = req.socket.remoteAddress ?? ''
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      res.writeHead(403)
      res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
      return
    }
    handleRoutes(req, res, db, config, bus)
  })
}
