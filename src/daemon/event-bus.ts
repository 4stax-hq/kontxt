import { EventEmitter } from 'events'
import type { DaemonEvent } from '../types'

class KontxtEventBus extends EventEmitter {
  emitEvent(event: DaemonEvent): boolean {
    return super.emit('daemon_event', event)
  }

  onEvent(listener: (payload: DaemonEvent) => void): this {
    return super.on('daemon_event', listener)
  }
}

export const eventBus = new KontxtEventBus()
