import * as vscode from 'vscode'
import * as path from 'path'
import { KontxtSidebarProvider } from './sidebar-provider'
import {
  isDaemonRunning,
  startDaemonDetached,
  syncApiKeys,
  hasApiKey,
  hasProjectContext,
  isCapturePaused,
  preflightKontxtCli,
  runKontxtCli,
  readContextMd,
  ensureGitignore,
} from './kontxt-client'

let sidebarProvider: KontxtSidebarProvider
let fileWatcher: vscode.FileSystemWatcher | undefined
let pollInterval: ReturnType<typeof setInterval> | undefined

export function activate(context: vscode.ExtensionContext) {
  sidebarProvider = new KontxtSidebarProvider(context.extensionUri)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KontxtSidebarProvider.viewId, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )

  registerCommands(context)
  setupWorkspace(context)

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => setupWorkspace(context))
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kontxt')) {
        syncKeysFromSettings()
        sidebarProvider.refresh()
      }
    })
  )
}

function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

async function setupWorkspace(context: vscode.ExtensionContext) {
  const workspacePath = getWorkspacePath()
  syncKeysFromSettings()

  if (workspacePath) {
    sidebarProvider.setWorkspacePath(workspacePath)
    ensureGitignore(workspacePath)
  }

  const cfg = vscode.workspace.getConfiguration('kontxt')
  if (cfg.get<boolean>('autoStartDaemon', true) && !isDaemonRunning() && workspacePath) {
    startDaemonDetached(workspacePath)
    setTimeout(() => sidebarProvider.refresh(), 1500)
  }

  if (!hasApiKey()) {
    const shown = context.globalState.get<boolean>('setupPromptShown')
    if (!shown) {
      context.globalState.update('setupPromptShown', true)
      const choice = await vscode.window.showInformationMessage(
        'kontxt needs an Anthropic API key to capture context.',
        'Open Settings', 'Later'
      )
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'kontxt.anthropicKey')
      }
    }
    return
  }

  if (!workspacePath) { sidebarProvider.refresh(); return }

  if (cfg.get<boolean>('autoInit', true) && !hasProjectContext(workspacePath)) {
    const name = path.basename(workspacePath)
    const choice = await vscode.window.showInformationMessage(
      `kontxt: No context found for "${name}". Initialize now?`,
      'Initialize', 'Not now'
    )
    if (choice === 'Initialize') {
      vscode.commands.executeCommand('kontxt.init')
      return
    }
  }

  sidebarProvider.refresh()
  setupFileWatcher(workspacePath)
  setupPollInterval()
}

function setupFileWatcher(workspacePath: string) {
  fileWatcher?.dispose()
  const pattern = new vscode.RelativePattern(workspacePath, '.kontxt/CONTEXT.md')
  fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)
  fileWatcher.onDidChange(() => sidebarProvider.refresh())
  fileWatcher.onDidCreate(() => sidebarProvider.refresh())
}

function setupPollInterval() {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(() => sidebarProvider.refresh(), 30000)
}

function syncKeysFromSettings() {
  const cfg = vscode.workspace.getConfiguration('kontxt')
  const anthropicKey = cfg.get<string>('anthropicKey', '')
  const openaiKey = cfg.get<string>('openaiKey', '')
  if (anthropicKey || openaiKey) syncApiKeys(anthropicKey, openaiKey)
}

function requireApiKey(): boolean {
  if (hasApiKey()) return true
  sidebarProvider.setActivity(null)
  sidebarProvider.setNotice('warn', 'Set an Anthropic API key in Settings to enable capture.')
  vscode.window.showErrorMessage('kontxt: Set an Anthropic API key in Settings → kontxt')
  return false
}

function requireCliHealthy(): boolean {
  const error = preflightKontxtCli()
  if (!error) return true
  sidebarProvider.setActivity(null)
  sidebarProvider.setNotice('error', `Runtime blocked: ${error}`)
  vscode.window.showErrorMessage(`kontxt runtime blocked: ${error}`)
  return false
}

function registerCommands(context: vscode.ExtensionContext) {
  // UI-only reload (does not call the CLI)
  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.uiRefresh', () => sidebarProvider.refresh())
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.toggleCapturePause', async () => {
      const paused = isCapturePaused()
      await vscode.commands.executeCommand(paused ? 'kontxt.resumeCapture' : 'kontxt.pauseCapture')
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.pauseCapture', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireCliHealthy()) return
      try {
        sidebarProvider.setActivity('daemon', 'Pausing capture...')
        await runKontxtCli(['pause'], wp)
        sidebarProvider.clearNotice()
        sidebarProvider.setActivity(null)
        sidebarProvider.refresh()
        vscode.window.setStatusBarMessage('kontxt: capture paused', 3000)
      } catch (err) {
        sidebarProvider.setActivity(null)
        sidebarProvider.setNotice('error', `Pause failed: ${err instanceof Error ? err.message : String(err)}`)
        vscode.window.showErrorMessage(`kontxt pause failed: ${err}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.resumeCapture', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireCliHealthy()) return
      try {
        sidebarProvider.setActivity('daemon', 'Resuming capture...')
        await runKontxtCli(['resume', '--workspace', wp], wp)
        sidebarProvider.clearNotice()
        sidebarProvider.setActivity(null)
        sidebarProvider.refresh()
        vscode.window.setStatusBarMessage('kontxt: capture resumed', 3000)
      } catch (err) {
        sidebarProvider.setActivity(null)
        sidebarProvider.setNotice('error', `Resume failed: ${err instanceof Error ? err.message : String(err)}`)
        vscode.window.showErrorMessage(`kontxt resume failed: ${err}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.resumeCaptureCatchUp', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireApiKey() || !requireCliHealthy()) return
      try {
        sidebarProvider.setActivity('daemon', 'Resuming and catching up...')
        await runKontxtCli(['resume', '--workspace', wp, '--catch-up'], wp)
        sidebarProvider.clearNotice()
        sidebarProvider.setActivity(null)
        sidebarProvider.refresh()
        vscode.window.setStatusBarMessage('kontxt: capture resumed with catch-up', 3000)
      } catch (err) {
        sidebarProvider.setActivity(null)
        sidebarProvider.setNotice('error', `Resume catch-up failed: ${err instanceof Error ? err.message : String(err)}`)
        vscode.window.showErrorMessage(`kontxt resume catch-up failed: ${err}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.startDaemon', () => {
      const wp = getWorkspacePath()
      if (!wp) { vscode.window.showErrorMessage('kontxt: No workspace open'); return }
      if (isDaemonRunning()) {
        sidebarProvider.setActivity(null)
        sidebarProvider.setNotice('info', 'Daemon already running.')
        vscode.window.showInformationMessage('kontxt: Daemon already running')
        return
      }
      sidebarProvider.setActivity('daemon', 'Starting daemon...')
      startDaemonDetached(wp)
      sidebarProvider.clearNotice()
      sidebarProvider.setActivity(null)
      vscode.window.setStatusBarMessage('kontxt: Daemon started', 3000)
      setTimeout(() => sidebarProvider.refresh(), 1500)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.init', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireApiKey() || !requireCliHealthy()) return
      sidebarProvider.setActivity('init', 'Analyzing repository...')
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'kontxt: Analyzing repository...', cancellable: false },
        async () => {
          try {
            const output = await runKontxtCli(['init', '--workspace', wp], wp)
            sidebarProvider.clearNotice()
            sidebarProvider.setActivity(null)
            ensureGitignore(wp)
            const count = output.split('\n').filter(l => l.startsWith('  [')).length
            vscode.window.showInformationMessage(`kontxt: Initialized with ${count} entries`)
            sidebarProvider.refresh()
            setupFileWatcher(wp)
          } catch (err) {
            sidebarProvider.setActivity(null)
            sidebarProvider.setNotice('error', `Init failed: ${err instanceof Error ? err.message : String(err)}`)
            vscode.window.showErrorMessage(`kontxt init failed: ${err}`)
          }
        }
      )
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.update', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireApiKey() || !requireCliHealthy()) return
      sidebarProvider.setActivity('update', 'Applying incremental update...')
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'kontxt: Applying incremental update...', cancellable: false },
        async () => {
          try {
            const output = await runKontxtCli(['update', '--workspace', wp], wp)
            sidebarProvider.clearNotice()
            sidebarProvider.setActivity(null)
            const count = output.split('\n').filter(l => l.startsWith('  [')).length
            if (count > 0) {
              vscode.window.showInformationMessage(`kontxt: +${count} new entries from incremental changes`)
            } else {
              sidebarProvider.setNotice('info', 'Incremental update completed with no new knowledge.')
              vscode.window.setStatusBarMessage('kontxt: No high-value incremental update found', 4000)
            }
            sidebarProvider.refresh()
          } catch (err) {
            sidebarProvider.setActivity(null)
            sidebarProvider.setNotice('error', `Update failed: ${err instanceof Error ? err.message : String(err)}`)
            vscode.window.showErrorMessage(`kontxt update failed: ${err}`)
          }
        }
      )
    })
  )

  // CLI refresh — scans recently changed files, one API call
  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.refresh', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireApiKey() || !requireCliHealthy()) return
      sidebarProvider.setActivity('refresh', 'Running broader recent-change refresh...')
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'kontxt: Running broader refresh...', cancellable: false },
        async () => {
          try {
            const output = await runKontxtCli(['refresh', '--workspace', wp], wp)
            sidebarProvider.clearNotice()
            sidebarProvider.setActivity(null)
            const count = output.split('\n').filter(l => l.startsWith('  [')).length
            if (count > 0) {
              vscode.window.showInformationMessage(`kontxt: +${count} new entries from recent changes`)
            } else {
              sidebarProvider.setNotice('info', 'Refresh completed with no new knowledge.')
              vscode.window.setStatusBarMessage('kontxt: No new knowledge in recent changes', 4000)
            }
            sidebarProvider.refresh()
          } catch (err) {
            sidebarProvider.setActivity(null)
            sidebarProvider.setNotice('error', `Refresh failed: ${err instanceof Error ? err.message : String(err)}`)
            vscode.window.showErrorMessage(`kontxt refresh failed: ${err}`)
          }
        }
      )
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.synthesize', async () => {
      const wp = getWorkspacePath()
      if (!wp || !requireApiKey() || !requireCliHealthy()) return
      sidebarProvider.setActivity('synthesize', 'Synthesizing context...')
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'kontxt: Synthesizing...', cancellable: false },
        async () => {
          try {
            await runKontxtCli(['synthesize', '--workspace', wp], wp)
            sidebarProvider.clearNotice()
            sidebarProvider.setActivity(null)
            sidebarProvider.refresh()
            vscode.window.setStatusBarMessage('kontxt: Synthesis complete', 3000)
          } catch (err) {
            sidebarProvider.setActivity(null)
            sidebarProvider.setNotice('error', `Synthesize failed: ${err instanceof Error ? err.message : String(err)}`)
            vscode.window.showErrorMessage(`kontxt synthesize failed: ${err}`)
          }
        }
      )
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.addNote', async () => {
      const wp = getWorkspacePath()
      if (!wp) return
      const typeChoice = await vscode.window.showQuickPick(
        ['fact', 'decision', 'blocker', 'progress', 'focus'],
        { placeHolder: 'Entry type' }
      )
      if (!typeChoice) return
      const text = await vscode.window.showInputBox({
        prompt: `Add ${typeChoice}`,
        placeHolder: typeChoice === 'decision' ? 'What was decided and why?' : 'Be specific...',
        validateInput: v => v.trim().length < 10 ? 'Too short' : null,
      })
      if (!text) return
      try {
        if (!requireCliHealthy()) return
        sidebarProvider.setActivity('note', `Recording ${typeChoice}...`)
        await runKontxtCli(['note', text, '--type', typeChoice, '--workspace', wp], wp)
        sidebarProvider.clearNotice()
        sidebarProvider.setActivity(null)
        vscode.window.setStatusBarMessage(`kontxt: recorded [${typeChoice}]`, 3000)
        sidebarProvider.refresh()
      } catch (err) {
        sidebarProvider.setActivity(null)
        sidebarProvider.setNotice('error', `Add note failed: ${err instanceof Error ? err.message : String(err)}`)
        vscode.window.showErrorMessage(`kontxt: failed — ${err}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.copyContext', async () => {
      const wp = getWorkspacePath()
      if (!wp) return
      const md = readContextMd(wp)
      if (!md) { vscode.window.showWarningMessage('kontxt: No context yet — run init first'); return }
      await vscode.env.clipboard.writeText(md)
      vscode.window.setStatusBarMessage('kontxt: Context copied', 3000)
    })
  )
}

export function deactivate() {
  fileWatcher?.dispose()
  if (pollInterval) clearInterval(pollInterval)
}
