import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { buildContextPacket, formatContextPacket } from '../../retrieval/engine'

export async function contextCommand(projectName?: string, workspacePath?: string): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  let project = projectName
  if (!project && workspacePath) {
    const { getProject } = await import('../../storage/db')
    const p = getProject(db, workspacePath)
    project = p?.name
  }
  if (!project) {
    project = 'default'
  }

  const packet = await buildContextPacket(db, project, '', config)
  console.log(formatContextPacket(packet))
}
