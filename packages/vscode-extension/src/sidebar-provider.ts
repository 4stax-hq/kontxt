import * as vscode from 'vscode'
import pkg = require('../package.json')
import {
  parseContextMd, readContextMd, isDaemonRunning, getEntryCount,
  hasApiKey, isAutoRefreshEnabled, isCapturePaused, setAutoRefresh, getLastAutoRefresh,
  getCliDiagnostics, getFullConfig, getRefreshStatus, setConfigValue, runKontxtCli,
} from './kontxt-client'

export class KontxtSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'kontxt.sidebar'
  private _view?: vscode.WebviewView
  private _workspacePath = ''
  private _notice: { level: 'error' | 'warn' | 'info'; message: string } | null = null
  private _activity: { action: 'update' | 'refresh' | 'init' | 'synthesize' | 'note' | 'daemon' | null; message: string } = { action: null, message: '' }

  constructor(private readonly _extensionUri: vscode.Uri) {}

  setWorkspacePath(p: string) {
    this._workspacePath = p
  }

  setNotice(level: 'error' | 'warn' | 'info', message: string) {
    this._notice = { level, message }
    this.refresh()
  }

  clearNotice() {
    if (!this._notice) return
    this._notice = null
    this.refresh()
  }

  setActivity(action: 'update' | 'refresh' | 'init' | 'synthesize' | 'note' | 'daemon' | null, message = '') {
    this._activity = { action, message }
    this.refresh()
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    }

    webviewView.webview.html = this._getHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage(async (msg: {
      type: string; text?: string; entryType?: string; key?: string; value?: unknown
    }) => {
      switch (msg.type) {
        case 'webviewReady':
          this.refresh()
          break
        case 'addNote':
          await this._addNote(msg.text ?? '', msg.entryType ?? 'fact')
          break
        case 'refresh':
          this.refresh()
          break
        case 'init':
        case 'runReeval':
          vscode.commands.executeCommand('kontxt.init')
            .then(() => {
              setTimeout(() => this.refresh(), 2000)
            })
            .catch(err => {
              this.setActivity(null)
              this.setNotice('error', `Init command failed: ${err instanceof Error ? err.message : String(err)}`)
            })
          break
        case 'runRefresh':
          vscode.commands.executeCommand('kontxt.refresh')
            .then(() => {
              this.refresh()
            })
            .catch(err => {
              this.setActivity(null)
              this.setNotice('error', `Refresh command failed: ${err instanceof Error ? err.message : String(err)}`)
            })
          break
        case 'runUpdate':
          vscode.commands.executeCommand('kontxt.update')
            .then(() => {
              this.refresh()
            })
            .catch(err => {
              this.setActivity(null)
              this.setNotice('error', `Update command failed: ${err instanceof Error ? err.message : String(err)}`)
            })
          break
        case 'toggleAutoRefresh': {
          const current = isAutoRefreshEnabled()
          setAutoRefresh(!current)
          this.refresh()
          vscode.window.setStatusBarMessage(
            `kontxt: auto-refresh ${!current ? 'enabled' : 'disabled'}`, 3000
          )
          break
        }
        case 'toggleCapturePause':
          vscode.commands.executeCommand('kontxt.toggleCapturePause').catch(err => {
            this.setActivity(null)
            this.setNotice('error', `Pause/resume failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
        case 'pauseCapture':
          vscode.commands.executeCommand('kontxt.pauseCapture').catch(err => {
            this.setActivity(null)
            this.setNotice('error', `Pause failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
        case 'resumeCapture':
          vscode.commands.executeCommand('kontxt.resumeCapture').catch(err => {
            this.setActivity(null)
            this.setNotice('error', `Resume failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
        case 'resumeCaptureCatchUp':
          vscode.commands.executeCommand('kontxt.resumeCaptureCatchUp').catch(err => {
            this.setActivity(null)
            this.setNotice('error', `Resume catch-up failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
        case 'setConfig':
          if (msg.key !== undefined) {
            setConfigValue(msg.key, msg.value)
            this.refresh()
          }
          break
        case 'synthesize':
          vscode.commands.executeCommand('kontxt.synthesize').catch(err => {
            this.setActivity(null)
            this.setNotice('error', `Synthesize command failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
        case 'startDaemon':
          vscode.commands.executeCommand('kontxt.startDaemon').catch(err => {
            this.setActivity(null)
            this.setNotice('error', `Start daemon failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          setTimeout(() => this.refresh(), 1500)
          break
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'kontxt').catch(err => {
            this.setNotice('error', `Open settings failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
        case 'copyContext':
          vscode.commands.executeCommand('kontxt.copyContext').catch(err => {
            this.setNotice('error', `Copy failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          break
      }
    })
  }

  refresh() {
    if (!this._view) return
    try {
      if (!this._workspacePath) {
        this._workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      }

      if (!hasApiKey()) {
        this._view.webview.postMessage({ type: 'setup' })
        return
      }

      const md = this._workspacePath ? readContextMd(this._workspacePath) : null
      const daemon = isDaemonRunning()
      const capturePaused = isCapturePaused()
      const entryCount = this._workspacePath ? getEntryCount(this._workspacePath) : 0
      const autoRefresh = isAutoRefreshEnabled()
      const lastAutoRefresh = this._workspacePath ? getLastAutoRefresh(this._workspacePath) : 0
      const refreshStatus = this._workspacePath ? getRefreshStatus(this._workspacePath) : null
      const diagnostics = getCliDiagnostics(pkg.version)
      const config = getFullConfig()

      if (!md) {
        this._view.webview.postMessage({
          type: 'empty', daemon, capturePaused, workspacePath: this._workspacePath, autoRefresh, config, notice: this._notice, activity: this._activity, diagnostics,
        })
        return
      }

      const ctx = parseContextMd(md)
      this._view.webview.postMessage({
        type: 'context', ctx, daemon, capturePaused, entryCount, autoRefresh, lastAutoRefresh, refreshStatus, config, workspacePath: this._workspacePath, notice: this._notice, activity: this._activity,
        diagnostics,
      })
    } catch (err) {
      this._view.webview.postMessage({ type: 'err', message: String(err) })
    }
  }

  private async _addNote(text: string, entryType: string) {
    if (!text.trim() || !this._workspacePath) return
    try {
      await runKontxtCli(
        ['note', text, '--type', entryType, '--workspace', this._workspacePath],
        this._workspacePath
      )
      this.refresh()
      vscode.window.setStatusBarMessage(`kontxt: recorded [${entryType}]`, 3000)
    } catch (err) {
      vscode.window.showErrorMessage(`kontxt: failed to add note — ${err}`)
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce()
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>kontxt</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      overflow-x: hidden;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .header-left { display: flex; align-items: center; gap: 7px; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.on  { background: #4ade80; }
    .status-dot.off { background: var(--vscode-descriptionForeground); opacity: 0.35; }
    .project-name {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--vscode-sideBarTitle-foreground); opacity: 0.75;
    }
    .header-right { display: flex; gap: 5px; align-items: center; }
    .toggle-wrap { display: flex; align-items: center; gap: 5px; }
    .toggle-sw { position: relative; display: inline-block; width: 26px; height: 14px; }
    .toggle-sw input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle-slider {
      position: absolute; cursor: pointer; inset: 0;
      background: var(--vscode-input-border, #555); border-radius: 14px;
      transition: background 0.18s;
    }
    .toggle-slider::before {
      content: ''; position: absolute;
      width: 10px; height: 10px; left: 2px; bottom: 2px;
      background: white; border-radius: 50%; transition: transform 0.18s;
    }
    .toggle-sw input:checked + .toggle-slider { background: #4ade80; }
    .toggle-sw input:checked + .toggle-slider::before { transform: translateX(12px); }
    .toggle-label {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground); font-weight: 500;
    }
    .toggle-label.on { color: #4ade80; }
    .txt-btn {
      background: none; border: none; cursor: pointer;
      color: var(--vscode-icon-foreground); opacity: 0.55;
      padding: 2px 5px; border-radius: 3px;
      font-size: 10px; font-family: inherit; transition: opacity 0.1s;
    }
    .txt-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    .split-wrap { position: relative; display: inline-flex; align-items: center; }
    .split-main {
      border-top-right-radius: 0; border-bottom-right-radius: 0;
      margin-right: 0; border-right: 1px solid var(--vscode-widget-border);
    }
    .split-toggle {
      min-width: 18px; padding-left: 4px; padding-right: 4px;
      border-top-left-radius: 0; border-bottom-left-radius: 0;
    }
    .split-menu {
      position: absolute; top: calc(100% + 4px); right: 0;
      display: none; min-width: 170px; z-index: 20;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      padding: 4px;
    }
    .split-menu.open { display: block; }
    .split-item {
      width: 100%; text-align: left; background: none; border: none; cursor: pointer;
      color: var(--vscode-foreground); font: inherit; font-size: 11px;
      padding: 7px 8px; border-radius: 4px;
    }
    .split-item:hover { background: var(--vscode-toolbar-hoverBackground); }
    .stats {
      display: flex; flex-wrap: wrap; gap: 8px; padding: 5px 12px;
      border-bottom: 1px solid var(--vscode-widget-border); align-items: center;
    }
    .stat { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .stat b { color: var(--vscode-foreground); font-weight: 500; }
    .stat.ml { margin-left: auto; }
    .info-bar {
      padding: 6px 12px; font-size: 11px;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .info-bar.warn    { background: rgba(248,113,113,0.08); border-left: 2px solid #f87171; color: #f87171; }
    .info-bar.caution { background: rgba(251,191,36,0.08);  border-left: 2px solid #fbbf24; color: #fbbf24; }
    .info-bar.info    { background: rgba(96,165,250,0.08);  border-left: 2px solid #60a5fa; color: #60a5fa; }
    .info-bar-btn {
      background: none; border: 1px solid currentColor; color: inherit;
      border-radius: 3px; padding: 2px 8px; font-size: 10px; cursor: pointer;
      font-family: inherit; white-space: nowrap; flex-shrink: 0;
    }
    .info-bar-btn:hover { background: rgba(255,255,255,0.1); }
    .runtime {
      padding: 9px 12px 10px;
      border-bottom: 1px solid var(--vscode-widget-border);
      background: linear-gradient(180deg, rgba(128,128,128,0.04), rgba(128,128,128,0.01));
    }
    .runtime-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 9px; gap: 8px;
    }
    .runtime-title {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--vscode-descriptionForeground);
    }
    .runtime-state {
      font-size: 11px; font-weight: 600;
    }
    .runtime-state.ok { color: #4ade80; }
    .runtime-state.warn { color: #fbbf24; }
    .runtime-state.off { color: #f87171; }
    .runtime-list {
      display: grid; gap: 4px;
    }
    .runtime-row {
      display: grid;
      grid-template-columns: 84px 1fr;
      gap: 8px;
      align-items: start;
      padding: 2px 0;
      min-width: 0;
    }
    .runtime-k {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground); opacity: 0.8;
    }
    .runtime-v {
      font-size: 11px; color: var(--vscode-foreground); line-height: 1.35;
      word-break: break-word;
    }
    .runtime-v.dim { color: var(--vscode-descriptionForeground); }
    .runtime-v.err { color: #f87171; }
    .runtime-v.warn { color: #fbbf24; }
    .runtime-v.ok { color: #4ade80; }
    .actions {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px; padding: 7px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .abtn {
      min-width: 0; padding: 6px 6px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 3px;
      font-size: 11px; font-family: inherit; cursor: pointer;
      white-space: normal; text-align: center; line-height: 1.2;
      overflow-wrap: anywhere;
      transition: background 0.1s, opacity 0.1s;
    }
    .abtn:hover    { background: var(--vscode-button-secondaryHoverBackground); }
    .abtn:disabled { opacity: 0.4; cursor: not-allowed; }
    .abtn.busy {
      position: relative;
      opacity: 0.9;
      cursor: wait;
      padding-left: 18px;
    }
    .abtn.busy::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 50%;
      width: 7px;
      height: 7px;
      margin-top: -4px;
      border-radius: 50%;
      border: 1.5px solid currentColor;
      border-right-color: transparent;
      animation: spin 0.7s linear infinite;
    }
    .abtn.primary  { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .abtn.primary:hover { background: var(--vscode-button-hoverBackground); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .section { border-bottom: 1px solid var(--vscode-widget-border); }
    .sec-hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 12px 5px; cursor: pointer; user-select: none;
    }
    .sec-hdr:hover { background: var(--vscode-list-hoverBackground); }
    .sec-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--vscode-descriptionForeground);
    }
    .sec-chev { font-size: 10px; color: var(--vscode-descriptionForeground); transition: transform 0.15s; }
    .sec-chev.col { transform: rotate(-90deg); }
    .sec-body { padding: 0 12px 9px; }
    .sec-body.col { display: none; }
    .focus-val { font-size: 12px; line-height: 1.5; color: var(--vscode-foreground); padding: 2px 0; }
    .focus-nil { font-size: 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .item { display: flex; align-items: flex-start; gap: 6px; padding: 3px 0; font-size: 12px; line-height: 1.4; }
    .item-dot { flex-shrink: 0; margin-top: 5px; width: 4px; height: 4px; border-radius: 50%; background: var(--vscode-descriptionForeground); opacity: 0.4; }
    .item-warn .item-dot { background: #f87171; opacity: 0.9; width: 5px; height: 5px; margin-top: 4px; }
    .item-txt { color: var(--vscode-foreground); }
    .none-lbl { font-size: 12px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 2px 0; }
    .add-note { padding: 10px 12px 12px; }
    .add-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin-bottom: 7px;
    }
    select {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 3px 6px; font-size: 11px; font-family: inherit; cursor: pointer;
    }
    select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    textarea {
      width: 100%; background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 5px 7px; font-size: 12px; font-family: inherit;
      resize: vertical; min-height: 50px; line-height: 1.4;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: transparent; }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .rec-btn {
      display: block; width: 100%; margin-top: 6px; padding: 5px 12px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 2px; font-size: 12px; font-family: inherit;
      cursor: pointer; transition: background 0.1s;
    }
    .rec-btn:hover { background: var(--vscode-button-hoverBackground); }
    .rec-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .cfg-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 0; gap: 10px;
      border-bottom: 1px solid rgba(128,128,128,0.1);
    }
    .cfg-row:last-child { border-bottom: none; }
    .cfg-lbl { flex: 1; }
    .cfg-name { font-size: 11px; color: var(--vscode-foreground); }
    .cfg-hint { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 1px; }
    .cfg-div {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground); opacity: 0.6; padding: 8px 0 3px;
    }
    .num-inp {
      width: 58px; padding: 2px 5px; font-size: 11px; font-family: inherit; text-align: right;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
    }
    .num-inp:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .empty-state { padding: 28px 16px; text-align: center; }
    .empty-title { font-size: 13px; font-weight: 500; margin-bottom: 8px; }
    .empty-desc  { font-size: 12px; line-height: 1.5; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .empty-hint  { font-size: 10px; color: var(--vscode-descriptionForeground); opacity: 0.55; margin-top: 10px; }
    .full-btn    { width: 100%; margin-bottom: 6px; }
    .setup-wrap  { padding: 22px 14px; }
    .setup-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
    .setup-desc  { font-size: 12px; line-height: 1.5; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .setup-code  {
      font-size: 11px; line-height: 1.6;
      background: var(--vscode-textBlockQuote-background);
      border-left: 2px solid var(--vscode-textBlockQuote-border);
      padding: 6px 10px; border-radius: 0 2px 2px 0; margin-bottom: 12px;
    }
    .err-box { padding: 14px; font-size: 11px; color: #f87171; line-height: 1.5; }
  </style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  const initialState = vscode.getState() || { collapsed: {}, pendingAction: null }
  let uiState = {
    collapsed: initialState.collapsed || {},
    pendingAction: initialState.pendingAction || null,
  }
  let lastRender = null

  function el(id) { return document.getElementById(id) }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function relTime(ts) {
    if (!ts) return ''
    const d = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime())
    if (d < 0) return 'just now'
    const m = Math.floor(d / 60000)
    if (m < 2)  return 'just now'
    if (m < 60) return m + 'm ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  function ageMs(ts) {
    if (!ts) return 0
    return Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime())
  }

  function fmtFuture(ts) {
    if (!ts) return 'now'
    const d = ts - Date.now()
    if (d <= 0) return 'now'
    const m = Math.ceil(d / 60000)
    if (m < 60) return 'in ' + m + 'm'
    const h = Math.floor(m / 60)
    const rm = m % 60
    return rm ? ('in ' + h + 'h ' + rm + 'm') : ('in ' + h + 'h')
  }

  function runtimePanel(opts) {
    const daemon = !!opts.daemon
    const capturePaused = opts.capturePaused === true
    const autoRefresh = opts.autoRefresh !== false
    const cfg = opts.config || {}
    const refreshStatus = opts.refreshStatus || null
    const quiet = cfg.autoRefreshQuietMinutes != null ? cfg.autoRefreshQuietMinutes : 5
    const cooldown = cfg.autoRefreshCooldownMinutes != null ? cfg.autoRefreshCooldownMinutes : 30
    const threshold = cfg.autoRefreshMinScore != null ? cfg.autoRefreshMinScore : 3
    const lastAuto = opts.lastAutoRefresh || 0
    const workspace = opts.workspacePath || ''
    const nextEligibleAt = lastAuto ? lastAuto + (cooldown * 60000) : 0
    let state = { label: 'offline', cls: 'off' }
    if (!daemon) {
      state = { label: 'daemon offline', cls: 'off' }
    } else if (capturePaused) {
      state = { label: 'capture paused', cls: 'warn' }
    } else if (!autoRefresh) {
      state = { label: 'manual mode', cls: 'warn' }
    } else if (lastAuto && nextEligibleAt > Date.now()) {
      state = { label: 'cooldown active', cls: 'warn' }
    } else {
      state = { label: 'watching for changes', cls: 'ok' }
    }

    return \`<div class="runtime">
      <div class="runtime-head">
        <div class="runtime-title">Runtime Status</div>
        <div class="runtime-state \${state.cls}">\${state.label}</div>
      </div>
      <div class="runtime-list">
        <div class="runtime-row"><div class="runtime-k">Daemon</div><div class="runtime-v">\${daemon ? 'running' : 'stopped'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Capture</div><div class="runtime-v">\${capturePaused ? 'paused' : 'live'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Mode</div><div class="runtime-v">\${autoRefresh ? 'auto' : 'manual'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Last Auto</div><div class="runtime-v \${lastAuto ? '' : 'dim'}">\${lastAuto ? relTime(lastAuto) : 'never'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Last Attempt</div><div class="runtime-v \${refreshStatus && refreshStatus.lastAttempt ? '' : 'dim'}">\${refreshStatus && refreshStatus.lastAttempt ? relTime(refreshStatus.lastAttempt) : 'never'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Next Eligible</div><div class="runtime-v">\${autoRefresh && daemon && !capturePaused ? fmtFuture(nextEligibleAt) : 'blocked'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Last Outcome</div><div class="runtime-v \${refreshStatus && refreshStatus.lastOutcome === 'error' ? 'err' : refreshStatus && refreshStatus.lastOutcome === 'skipped' ? 'warn' : ''}">\${refreshStatus && refreshStatus.lastOutcome ? esc(refreshStatus.lastOutcome.replace('_', ' ')) : 'none'}</div></div>
        <div class="runtime-row"><div class="runtime-k">Trigger Window</div><div class="runtime-v">\${quiet}m quiet / \${cooldown}m cooldown</div></div>
        <div class="runtime-row"><div class="runtime-k">Threshold</div><div class="runtime-v">score >= \${threshold}</div></div>
        \${refreshStatus && refreshStatus.lastError ? \`<div class="runtime-row"><div class="runtime-k">Last Error</div><div class="runtime-v err">\${esc(refreshStatus.lastError)}</div></div>\` : ''}
        \${workspace ? \`<div class="runtime-row"><div class="runtime-k">Workspace</div><div class="runtime-v dim">\${esc(workspace)}</div></div>\` : ''}
      </div>
    </div>\`
  }

  function diagnosticsPanel(diagnostics) {
    if (!diagnostics) return ''
    const nativeCls = diagnostics.nativeStatus === 'error' ? 'err' : diagnostics.nativeStatus === 'ok' ? 'ok' : 'dim'
    return \`<div class="section">
      <div class="sec-hdr" data-toggle-id="diag">
        <span class="sec-label">Diagnostics</span>
        <span class="sec-chev col" id="c-diag">&#x203A;</span>
      </div>
      <div class="sec-body col" id="b-diag">
        <div class="runtime-list">
          <div class="runtime-row"><div class="runtime-k">Extension</div><div class="runtime-v">\${esc(diagnostics.extensionVersion || '')}</div></div>
          <div class="runtime-row"><div class="runtime-k">CLI Bin</div><div class="runtime-v dim">\${esc(diagnostics.cliBin || '')}</div></div>
          <div class="runtime-row"><div class="runtime-k">Node Bin</div><div class="runtime-v dim">\${esc(diagnostics.nodeBin || '')}</div></div>
          <div class="runtime-row"><div class="runtime-k">Node</div><div class="runtime-v">\${esc(diagnostics.nodeVersion || 'unknown')}</div></div>
          <div class="runtime-row"><div class="runtime-k">ABI</div><div class="runtime-v">\${esc(diagnostics.nodeModulesVersion || 'unknown')}</div></div>
          <div class="runtime-row"><div class="runtime-k">Native</div><div class="runtime-v \${nativeCls}">\${esc(diagnostics.nativeStatus || 'unknown')}</div></div>
          <div class="runtime-row"><div class="runtime-k">Native Msg</div><div class="runtime-v \${nativeCls}">\${esc(diagnostics.nativeMessage || 'n/a')}</div></div>
          <div class="runtime-row"><div class="runtime-k">CLI Root</div><div class="runtime-v dim">\${esc(diagnostics.cliPackageRoot || '')}</div></div>
        </div>
      </div>
    </div>\`
  }

  function noticeBar(notice) {
    if (!notice || !notice.message) return ''
    const cls = notice.level === 'error' ? 'warn' : notice.level === 'warn' ? 'caution' : 'info'
    return \`<div class="info-bar \${cls}">
      <span>\${esc(notice.message)}</span>
      <button class="info-bar-btn" onclick="vscode.postMessage({type:'refresh'})">Reload</button>
    </div>\`
  }

  function activityBar(activity) {
    if (!activity || !activity.action || !activity.message) return ''
    return \`<div class="info-bar info"><span>\${esc(activity.message)}</span></div>\`
  }

  function toggle(id) {
    const b = el('b-' + id), c = el('c-' + id)
    if (!b || !c) return
    const col = b.classList.toggle('col')
    c.classList.toggle('col', col)
    uiState.collapsed[id] = col
    vscode.setState(uiState)
  }

  function cfgNum(key, val) {
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) vscode.postMessage({ type: 'setConfig', key: key, value: n })
  }

  function section(id, label, items, type) {
    const empty = !items || items.length === 0
    const rows = empty
      ? '<div class="none-lbl">none</div>'
      : items.map(function(t) {
          return \`<div class="item\${type === 'blocker' ? ' item-warn' : ''}"><div class="item-dot"></div><span class="item-txt">\${esc(t)}</span></div>\`
        }).join('')
    return \`<div class="section">
      <div class="sec-hdr" data-toggle-id="\${id}">
        <span class="sec-label">\${label}\${empty ? '' : ' (' + items.length + ')'}</span>
        <span class="sec-chev \${uiState.collapsed[id] ? 'col' : ''}" id="c-\${id}">&#x203A;</span>
      </div>
      <div class="sec-body \${uiState.collapsed[id] ? 'col' : ''}" id="b-\${id}">\${rows}</div>
    </div>\`
  }

  function mkHeader(projectName, daemon, arOn, capturePaused) {
    const captureControl = capturePaused
      ? \`<div class="split-wrap">
          <button class="txt-btn split-main" data-action="resume-capture" title="Resume from the current state">resume</button>
          <button class="txt-btn split-toggle" data-action="toggle-resume-menu" title="More resume options">&#x25BE;</button>
          <div class="split-menu" id="resume-menu">
            <button class="split-item" data-action="resume-capture-catchup">Resume and catch up missed changes</button>
          </div>
        </div>\`
      : \`<button class="txt-btn" data-action="pause-capture" title="Pause background capture">pause</button>\`
    return \`<div class="header">
      <div class="header-left">
        <div class="status-dot \${daemon ? 'on' : 'off'}" title="\${daemon ? 'Daemon running' : 'Daemon stopped'}"></div>
        <span class="project-name">\${esc(projectName)}</span>
      </div>
      <div class="header-right">
        <div class="toggle-wrap" title="\${arOn ? 'Disable' : 'Enable'} auto-refresh">
          <label class="toggle-sw">
            <input type="checkbox" \${arOn ? 'checked' : ''} data-action="toggle-auto">
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label \${arOn ? 'on' : ''}">\${arOn ? 'auto' : 'manual'}</span>
        </div>
        \${captureControl}
        <button class="txt-btn" data-action="copy" title="Copy context">copy</button>
        <button class="txt-btn" data-action="reload" title="Reload">reload</button>
      </div>
    </div>\`
  }

  function settingsPanel(cfg) {
    if (!cfg) return ''
    const ar = cfg.autoRefresh !== false
    const qm = cfg.autoRefreshQuietMinutes    != null ? cfg.autoRefreshQuietMinutes    : 5
    const cd = cfg.autoRefreshCooldownMinutes != null ? cfg.autoRefreshCooldownMinutes : 30
    const ms = cfg.autoRefreshMinScore        != null ? cfg.autoRefreshMinScore        : 3
    const mt = cfg.maxContextTokens           != null ? cfg.maxContextTokens           : 800
    return \`<div class="section">
      <div class="sec-hdr" data-toggle-id="cfg">
        <span class="sec-label">Settings</span>
        <span class="sec-chev \${uiState.collapsed.cfg !== false ? 'col' : ''}" id="c-cfg">&#x203A;</span>
      </div>
      <div class="sec-body \${uiState.collapsed.cfg !== false ? 'col' : ''}" id="b-cfg">
        <div class="cfg-div">Auto-refresh</div>
        <div class="cfg-row">
          <div class="cfg-lbl">
            <div class="cfg-name">Auto-refresh</div>
            <div class="cfg-hint">Update context on code changes</div>
          </div>
          <label class="toggle-sw">
            <input type="checkbox" \${ar ? 'checked' : ''} data-action="toggle-auto">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="cfg-row">
          <div class="cfg-lbl">
            <div class="cfg-name">Quiet period</div>
            <div class="cfg-hint">Minutes after last save before triggering</div>
          </div>
          <input type="number" class="num-inp" value="\${qm}" min="1" max="60"
            onblur="cfgNum('autoRefreshQuietMinutes',this.value)"
            onkeydown="if(event.key==='Enter')cfgNum('autoRefreshQuietMinutes',this.value)">
        </div>
        <div class="cfg-row">
          <div class="cfg-lbl">
            <div class="cfg-name">Cooldown</div>
            <div class="cfg-hint">Min minutes between auto-refreshes</div>
          </div>
          <input type="number" class="num-inp" value="\${cd}" min="5" max="1440"
            onblur="cfgNum('autoRefreshCooldownMinutes',this.value)"
            onkeydown="if(event.key==='Enter')cfgNum('autoRefreshCooldownMinutes',this.value)">
        </div>
        <div class="cfg-row">
          <div class="cfg-lbl">
            <div class="cfg-name">Significance threshold</div>
            <div class="cfg-hint">Min file change score to trigger</div>
          </div>
          <input type="number" class="num-inp" value="\${ms}" min="1" max="20"
            onblur="cfgNum('autoRefreshMinScore',this.value)"
            onkeydown="if(event.key==='Enter')cfgNum('autoRefreshMinScore',this.value)">
        </div>
        <div class="cfg-div">Storage</div>
        <div class="cfg-row">
          <div class="cfg-lbl">
            <div class="cfg-name">Max context tokens</div>
            <div class="cfg-hint">Token budget per context file</div>
          </div>
          <input type="number" class="num-inp" value="\${mt}" min="200" max="8000"
            onblur="cfgNum('maxContextTokens',this.value)"
            onkeydown="if(event.key==='Enter')cfgNum('maxContextTokens',this.value)">
        </div>
      </div>
    </div>\`
  }

  function renderContext(ctx, daemon, capturePaused, entryCount, autoRefresh, lastAutoRefresh, refreshStatus, config, workspacePath, notice, activity, diagnostics) {
    const arOn    = autoRefresh !== false
    const lastStr = lastAutoRefresh ? relTime(lastAutoRefresh) : 'never'
    const stale   = ctx.updatedAt && ageMs(ctx.updatedAt) > 3 * 86400000

    const staleBar = stale ? \`<div class="info-bar warn">
      <span>Context is \${relTime(ctx.updatedAt)} old</span>
      <button class="info-bar-btn" onclick="runReeval()">Full Scan</button>
    </div>\` : ''

    const daemonBar = !daemon ? \`<div class="info-bar caution">
      <span>Daemon offline</span>
      <button class="info-bar-btn" onclick="vscode.postMessage({type:'startDaemon'})">Start</button>
    </div>\` : capturePaused ? \`<div class="info-bar caution">
      <span>Background capture paused</span>
      <button class="info-bar-btn" onclick="vscode.postMessage({type:'toggleCapturePause'})">Resume</button>
    </div>\` : ''

    const statsRow = \`<div class="stats">
      <div class="stat"><b>\${ctx.facts.length}</b> facts</div>
      <div class="stat"><b>\${ctx.decisions.length}</b> decisions</div>
      <div class="stat"><b>\${ctx.blockers.length}</b> blockers</div>
      \${ctx.updatedAt ? \`<div class="stat">upd <b>\${relTime(ctx.updatedAt)}</b></div>\` : ''}
      <div class="stat ml">auto <b>\${lastStr}</b></div>
    </div>\`

    const busy = uiState.pendingAction || (activity && activity.action ? activity.action : '')
    const actions = \`<div class="actions">
      <button class="abtn primary \${busy === 'update' ? 'busy' : ''}" id="btn-update" data-action="run-update" title="Cheap incremental update from a few changes" \${busy ? 'disabled' : ''}>\${busy === 'update' ? 'Updating...' : 'Update'}</button>
      <button class="abtn \${busy === 'refresh' ? 'busy' : ''}" id="btn-refresh" data-action="run-refresh" title="Broader recent-change refresh" \${busy ? 'disabled' : ''}>\${busy === 'refresh' ? 'Refreshing...' : 'Refresh'}</button>
      <button class="abtn \${busy === 'init' ? 'busy' : ''}" id="btn-reeval" data-action="run-reeval" title="Full repo scan" \${busy ? 'disabled' : ''}>\${busy === 'init' ? 'Scanning...' : 'Full Scan'}</button>
      <button class="abtn \${busy === 'synthesize' ? 'busy' : ''}" id="btn-synth" data-action="run-synthesize" title="Rebuild narrative from stored entries" \${busy ? 'disabled' : ''}>\${busy === 'synthesize' ? 'Synthesizing...' : 'Synthesize'}</button>
    </div>\`

    const focusSection = \`<div class="section">
      <div class="sec-hdr" data-toggle-id="focus">
        <span class="sec-label">Current Focus</span>
        <span class="sec-chev \${uiState.collapsed.focus ? 'col' : ''}" id="c-focus">&#x203A;</span>
      </div>
      <div class="sec-body \${uiState.collapsed.focus ? 'col' : ''}" id="b-focus">
        \${ctx.focus ? \`<div class="focus-val">\${esc(ctx.focus)}</div>\` : '<div class="focus-nil">not set</div>'}
      </div>
    </div>\`

    const addNote = \`<div class="add-note section">
      <div class="add-label">Add note</div>
      <select id="ntype" style="width:100%;margin-bottom:6px">
        <option value="fact">fact</option>
        <option value="decision">decision</option>
        <option value="blocker">blocker</option>
        <option value="progress">progress</option>
        <option value="focus">focus</option>
      </select>
      <textarea id="ntxt" placeholder="Be specific — rationale for decisions, exact names for facts..." rows="3"></textarea>
      <button class="rec-btn" id="rec-btn" data-action="submit-note">Record <span style="opacity:0.4;font-size:10px">Cmd+Enter</span></button>
    </div>\`

    el('root').innerHTML = mkHeader(ctx.project, daemon, arOn, capturePaused)
      + statsRow + noticeBar(notice) + activityBar(activity)
      + runtimePanel({ daemon, capturePaused, autoRefresh, lastAutoRefresh, refreshStatus, config, workspacePath })
      + staleBar + daemonBar + actions + focusSection
      + section('blk', 'Active Blockers', ctx.blockers, 'blocker')
      + section('dec', 'Decisions',       ctx.decisions, 'decision')
      + section('fct', 'Key Facts',       ctx.facts,     'fact')
      + addNote + settingsPanel(config) + diagnosticsPanel(diagnostics)

    const ta = el('ntxt')
    if (ta) ta.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote()
    })
    bindSectionToggles()
  }

  function renderEmpty(daemon, capturePaused, workspacePath, autoRefresh, config, notice, activity, diagnostics) {
    const has  = !!workspacePath
    const arOn = autoRefresh !== false

    const body = has ? \`<div class="empty-state">
      <div class="empty-title">No context yet</div>
      <div class="empty-desc">Initialize to capture your stack, decisions, and current focus.</div>
      <button class="abtn primary full-btn" id="btn-init" data-action="run-init">Initialize project</button>
      <button class="abtn full-btn" id="btn-upd-e" data-action="run-update">Update from a few changes</button>
      <button class="abtn full-btn" id="btn-ref-e" data-action="run-refresh">Refresh from recent changes</button>
      <div class="empty-hint">Update: cheap incremental delta &nbsp;·&nbsp; Refresh: broader recent-change scan &nbsp;·&nbsp; Init: full repo scan</div>
    </div>\` : \`<div class="empty-state">
      <div class="empty-title">No context yet</div>
      <div class="empty-desc">Open a workspace folder to get started.</div>
    </div>\`
    el('root').innerHTML = mkHeader('kontxt', daemon, arOn, capturePaused)
      + noticeBar(notice) + activityBar(activity)
      + runtimePanel({ daemon, capturePaused, autoRefresh, lastAutoRefresh: 0, refreshStatus: null, config, workspacePath })
      + body + settingsPanel(config) + diagnosticsPanel(diagnostics)
    bindSectionToggles()
  }

  function renderSetup() {
    el('root').innerHTML = \`<div class="setup-wrap">
      <div class="setup-title">Set up kontxt</div>
      <div class="setup-desc">Add your Anthropic API key to start capturing context automatically.</div>
      <div class="setup-code">VS Code Settings &rsaquo; search "kontxt" &rsaquo; paste key</div>
      <button class="abtn primary" data-action="open-settings" style="width:100%;margin-bottom:10px">Open Settings</button>
      <div class="setup-desc" style="font-size:11px">Get a key at console.anthropic.com &mdash; Haiku is &lt;$1/month for typical use.</div>
    </div>\`
    bindActionButtons()
  }

  function runInit() {
    uiState.pendingAction = 'init'
    vscode.setState(uiState)
    vscode.postMessage({ type: 'init' })
  }

  function runRefresh() {
    uiState.pendingAction = 'refresh'
    vscode.setState(uiState)
    vscode.postMessage({ type: 'runRefresh' })
  }

  function runUpdate() {
    uiState.pendingAction = 'update'
    vscode.setState(uiState)
    vscode.postMessage({ type: 'runUpdate' })
  }

  function toggleResumeMenu() {
    const menu = el('resume-menu')
    if (!menu) return
    menu.classList.toggle('open')
  }

  function closeResumeMenu() {
    const menu = el('resume-menu')
    if (!menu) return
    menu.classList.remove('open')
  }

  function runReeval() {
    uiState.pendingAction = 'init'
    vscode.setState(uiState)
    vscode.postMessage({ type: 'runReeval' })
  }

  function runSynthesize() {
    uiState.pendingAction = 'synthesize'
    vscode.setState(uiState)
    vscode.postMessage({ type: 'synthesize' })
  }

  function bindSectionToggles() {
    document.querySelectorAll('.sec-hdr[data-toggle-id]').forEach(function(node) {
      if (!(node instanceof HTMLElement)) return
      if (node.dataset.bound === '1') return
      node.dataset.bound = '1'
      node.addEventListener('click', function() {
        const id = node.dataset.toggleId
        if (id) toggle(id)
      })
    })
  }

  function bindActionButtons() {
    document.querySelectorAll('[data-action]').forEach(function(node) {
      if (!(node instanceof HTMLElement)) return
      if (node.dataset.boundAction === '1') return
      node.dataset.boundAction = '1'
      node.addEventListener('click', function() {
        const action = node.dataset.action
        if (action === 'copy') vscode.postMessage({ type: 'copyContext' })
        else if (action === 'reload') vscode.postMessage({ type: 'refresh' })
        else if (action === 'toggle-auto') vscode.postMessage({ type: 'toggleAutoRefresh' })
        else if (action === 'pause-capture') vscode.postMessage({ type: 'pauseCapture' })
        else if (action === 'resume-capture') { closeResumeMenu(); vscode.postMessage({ type: 'resumeCapture' }) }
        else if (action === 'resume-capture-catchup') { closeResumeMenu(); vscode.postMessage({ type: 'resumeCaptureCatchUp' }) }
        else if (action === 'toggle-resume-menu') toggleResumeMenu()
        else if (action === 'run-update') runUpdate()
        else if (action === 'run-refresh') runRefresh()
        else if (action === 'run-reeval') runReeval()
        else if (action === 'run-synthesize') runSynthesize()
        else if (action === 'run-init') runInit()
        else if (action === 'submit-note') submitNote()
        else if (action === 'open-settings') vscode.postMessage({ type: 'openSettings' })
      })
    })
  }

  function rerender() {
    if (!lastRender) return
    if (lastRender.type === 'context') {
      renderContext(
        lastRender.ctx,
        lastRender.daemon,
        lastRender.capturePaused,
        lastRender.entryCount,
        lastRender.autoRefresh,
        lastRender.lastAutoRefresh,
        lastRender.refreshStatus,
        lastRender.config,
        lastRender.workspacePath,
        lastRender.notice,
        lastRender.activity,
        lastRender.diagnostics,
      )
    } else if (lastRender.type === 'empty') {
      renderEmpty(
        lastRender.daemon,
        lastRender.capturePaused,
        lastRender.workspacePath,
        lastRender.autoRefresh,
        lastRender.config,
        lastRender.notice,
        lastRender.activity,
        lastRender.diagnostics,
      )
    } else if (lastRender.type === 'setup') {
      renderSetup()
    }
  }

  function submitNote() {
    const ta   = el('ntxt')
    const text = ta ? ta.value.trim() : ''
    const type = el('ntype') ? el('ntype').value : 'fact'
    if (!text) return
    const b = el('rec-btn')
    if (b) b.disabled = true
    uiState.pendingAction = 'note'
    vscode.setState(uiState)
    rerender()
    vscode.postMessage({ type: 'addNote', text: text, entryType: type })
    if (ta) ta.value = ''
    if (b) setTimeout(function() { b.disabled = false }, 1200)
  }

  window.addEventListener('message', function(e) {
    const msg = e.data
    uiState.pendingAction = msg.activity && msg.activity.action ? msg.activity.action : null
    vscode.setState(uiState)
    if (msg.type === 'context') {
      lastRender = msg
      renderContext(msg.ctx, msg.daemon, msg.capturePaused, msg.entryCount, msg.autoRefresh, msg.lastAutoRefresh, msg.refreshStatus, msg.config, msg.workspacePath, msg.notice, msg.activity, msg.diagnostics)
      bindActionButtons()
    } else if (msg.type === 'empty') {
      lastRender = msg
      renderEmpty(msg.daemon, msg.capturePaused, msg.workspacePath, msg.autoRefresh, msg.config, msg.notice, msg.activity, msg.diagnostics)
      bindActionButtons()
    } else if (msg.type === 'setup') {
      lastRender = { type: 'setup' }
      renderSetup()
    } else if (msg.type === 'err') {
      uiState.pendingAction = null
      vscode.setState(uiState)
      lastRender = null
      el('root').innerHTML = \`<div class="err-box"><b>kontxt error</b><br>\${esc(msg.message)}<br><br><button onclick="vscode.postMessage({type:'refresh'})" style="cursor:pointer;padding:3px 10px">Retry</button></div>\`
    }
  })

  document.addEventListener('click', function(e) {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('.split-wrap')) return
    closeResumeMenu()
  })

  vscode.postMessage({ type: 'webviewReady' })
</script>
</body>
</html>`
  }
}

function getNonce(): string {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length))
  return text
}
