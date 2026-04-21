import * as vscode from 'vscode'
import * as path from 'path'
import { KontxtSidebarProvider } from './sidebar-provider'
import {
  isDaemonRunning,
  startDaemonDetached,
  syncApiKeys,
  hasApiKey,
  hasProjectContext,
  runKontxtCli,
  readContextMd,
  parseContextMd,
  ensureGitignore,
} from './kontxt-client'

let sidebarProvider: KontxtSidebarProvider
let fileWatcher: vscode.FileSystemWatcher | undefined
let refreshInterval: ReturnType<typeof setInterval> | undefined

export function activate(context: vscode.ExtensionContext) {
  sidebarProvider = new KontxtSidebarProvider(context.extensionUri)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KontxtSidebarProvider.viewId, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )

  registerCommands(context)
  setupWorkspace(context)

  // Re-run setup when workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => setupWorkspace(context))
  )

  // Sync keys when VS Code settings change
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

  // Always sync keys from VS Code settings first
  syncKeysFromSettings()

  if (workspacePath) {
    sidebarProvider.setWorkspacePath(workspacePath)
    ensureGitignore(workspacePath)
  }

  // Start daemon if configured
  const cfg = vscode.workspace.getConfiguration('kontxt')
  if (cfg.get<boolean>('autoStartDaemon', true) && !isDaemonRunning()) {
    if (workspacePath) {
      startDaemonDetached(workspacePath)
      // Give it a moment then refresh
      setTimeout(() => sidebarProvider.refresh(), 1500)
    }
  }

  if (!hasApiKey()) {
    // Show setup prompt once per install
    const shown = context.globalState.get<boolean>('setupPromptShown')
    if (!shown) {
      context.globalState.update('setupPromptShown', true)
      const choice = await vscode.window.showInformationMessage(
        'kontxt needs an Anthropic API key to start capturing AI context.',
        'Open Settings',
        'Later'
      )
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'kontxt.anthropicKey')
      }
    }
    return
  }

  if (!workspacePath) {
    sidebarProvider.refresh()
    return
  }

  // Auto-init if no context exists yet
  const autoInit = cfg.get<boolean>('autoInit', true)
  if (autoInit && !hasProjectContext(workspacePath)) {
    const name = path.basename(workspacePath)
    const choice = await vscode.window.showInformationMessage(
      `kontxt: No context found for "${name}". Initialize it now?`,
      'Initialize',
      'Not now'
    )
    if (choice === 'Initialize') {
      vscode.commands.executeCommand('kontxt.init')
      return
    }
  }

  sidebarProvider.refresh()
  setupFileWatcher(workspacePath)
  setupRefreshInterval()
}

function setupFileWatcher(workspacePath: string) {
  fileWatcher?.dispose()
  const pattern = new vscode.RelativePattern(workspacePath, '.kontxt/CONTEXT.md')
  fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)
  fileWatcher.onDidChange(() => sidebarProvider.refresh())
  fileWatcher.onDidCreate(() => sidebarProvider.refresh())
}

function setupRefreshInterval() {
  if (refreshInterval) clearInterval(refreshInterval)
  // Poll every 30s to catch daemon writes
  refreshInterval = setInterval(() => sidebarProvider.refresh(), 30000)
}

function syncKeysFromSettings() {
  const cfg = vscode.workspace.getConfiguration('kontxt')
  const anthropicKey = cfg.get<string>('anthropicKey', '')
  const openaiKey = cfg.get<string>('openaiKey', '')
  if (anthropicKey || openaiKey) {
    syncApiKeys(anthropicKey, openaiKey)
  }
}

function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.refresh', () => {
      sidebarProvider.refresh()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.startDaemon', () => {
      const workspacePath = getWorkspacePath()
      if (!workspacePath) {
        vscode.window.showErrorMessage('kontxt: No workspace open')
        return
      }
      if (isDaemonRunning()) {
        vscode.window.showInformationMessage('kontxt: Daemon is already running')
        return
      }
      startDaemonDetached(workspacePath)
      vscode.window.setStatusBarMessage('kontxt: Daemon started', 3000)
      setTimeout(() => sidebarProvider.refresh(), 1500)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.init', async () => {
      const workspacePath = getWorkspacePath()
      if (!workspacePath) {
        vscode.window.showErrorMessage('kontxt: No workspace open')
        return
      }
      if (!hasApiKey()) {
        vscode.window.showErrorMessage('kontxt: Set an Anthropic API key first in VS Code Settings → kontxt')
        return
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'kontxt: Analyzing repository...',
          cancellable: false,
        },
        async () => {
          try {
            const output = await runKontxtCli(['init', '--workspace', workspacePath], workspacePath)
            ensureGitignore(workspacePath)
            const lines = output.split('\n').filter(l => l.startsWith('  ['))
            vscode.window.showInformationMessage(
              `kontxt: Initialized with ${lines.length} entries`
            )
            sidebarProvider.refresh()
            setupFileWatcher(workspacePath)
          } catch (err) {
            vscode.window.showErrorMessage(`kontxt init failed: ${err}`)
          }
        }
      )
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.addNote', async () => {
      const workspacePath = getWorkspacePath()
      if (!workspacePath) return

      const typeChoice = await vscode.window.showQuickPick(
        ['fact', 'decision', 'blocker', 'progress', 'focus'],
        { placeHolder: 'Entry type' }
      )
      if (!typeChoice) return

      const text = await vscode.window.showInputBox({
        prompt: `Add ${typeChoice}`,
        placeHolder: typeChoice === 'decision'
          ? 'What was decided and why?'
          : typeChoice === 'blocker'
          ? 'What is blocked and why?'
          : 'Be specific...',
        validateInput: v => v.trim().length < 10 ? 'Too short — be specific' : null,
      })
      if (!text) return

      try {
        await runKontxtCli(['note', text, '--type', typeChoice, '--workspace', workspacePath], workspacePath)
        vscode.window.setStatusBarMessage(`kontxt: recorded [${typeChoice}]`, 3000)
        sidebarProvider.refresh()
      } catch (err) {
        vscode.window.showErrorMessage(`kontxt: failed — ${err}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kontxt.copyContext', async () => {
      const workspacePath = getWorkspacePath()
      if (!workspacePath) return
      const md = readContextMd(workspacePath)
      if (!md) {
        vscode.window.showWarningMessage('kontxt: No context found — run kontxt init first')
        return
      }
      await vscode.env.clipboard.writeText(md)
      vscode.window.setStatusBarMessage('kontxt: Context copied to clipboard', 3000)
    })
  )
}

export function deactivate() {
  fileWatcher?.dispose()
  if (refreshInterval) clearInterval(refreshInterval)
}
