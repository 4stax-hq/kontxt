import * as vscode from 'vscode'
import { parseContextMd, readContextMd, isDaemonRunning, getEntryCount } from './kontxt-client'

export class KontxtSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'kontxt.sidebar'
  private _view?: vscode.WebviewView
  private _workspacePath = ''

  constructor(private readonly _extensionUri: vscode.Uri) {}

  setWorkspacePath(p: string) {
    this._workspacePath = p
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
    this.refresh()

    webviewView.webview.onDidReceiveMessage(async (msg: { type: string; text?: string; entryType?: string }) => {
      if (msg.type === 'addNote') {
        await this._addNote(msg.text ?? '', msg.entryType ?? 'fact')
      } else if (msg.type === 'refresh') {
        this.refresh()
      } else if (msg.type === 'init') {
        await vscode.commands.executeCommand('kontxt.init')
      } else if (msg.type === 'openSettings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'kontxt')
      } else if (msg.type === 'copyContext') {
        await vscode.commands.executeCommand('kontxt.copyContext')
      }
    })
  }

  refresh() {
    if (!this._view) return

    const md = this._workspacePath ? readContextMd(this._workspacePath) : null
    const daemon = isDaemonRunning()
    const entryCount = this._workspacePath ? getEntryCount(this._workspacePath) : 0

    if (!md) {
      this._view.webview.postMessage({ type: 'empty', daemon, workspacePath: this._workspacePath })
      return
    }

    const ctx = parseContextMd(md)
    this._view.webview.postMessage({ type: 'context', ctx, daemon, entryCount })
  }

  private async _addNote(text: string, entryType: string) {
    if (!text.trim() || !this._workspacePath) return
    try {
      const { runKontxtCli } = await import('./kontxt-client')
      await runKontxtCli(['note', text, '--type', entryType, '--workspace', this._workspacePath], this._workspacePath)
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
      padding: 0;
      overflow-x: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px 8px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border));
    }
    .header-left { display: flex; align-items: center; gap: 8px; }
    .project-name {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-sideBarTitle-foreground);
      opacity: 0.7;
    }
    .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.running  { background: #4ade80; }
    .status-dot.stopped  { background: var(--vscode-descriptionForeground); opacity: 0.4; }

    .header-actions { display: flex; gap: 4px; }
    .icon-btn {
      background: none; border: none; cursor: pointer;
      color: var(--vscode-icon-foreground);
      opacity: 0.6; padding: 2px 4px; border-radius: 3px;
      font-size: 13px; line-height: 1;
      transition: opacity 0.1s;
    }
    .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

    .stats-bar {
      display: flex; gap: 12px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
      opacity: 0.6;
    }
    .stat { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .stat span { color: var(--vscode-foreground); font-weight: 500; }

    .sections { overflow-y: auto; }

    .section { border-bottom: 1px solid var(--vscode-widget-border); }
    .section-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px 6px;
      cursor: pointer; user-select: none;
    }
    .section-header:hover { background: var(--vscode-list-hoverBackground); }
    .section-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--vscode-descriptionForeground);
    }
    .section-chevron {
      font-size: 10px; color: var(--vscode-descriptionForeground);
      transition: transform 0.15s;
    }
    .section-chevron.collapsed { transform: rotate(-90deg); }
    .section-body { padding: 0 12px 10px; }
    .section-body.collapsed { display: none; }

    .focus-text {
      font-size: 12px; line-height: 1.5;
      color: var(--vscode-foreground);
      padding: 2px 0;
    }
    .focus-none { font-size: 12px; color: var(--vscode-descriptionForeground); font-style: italic; }

    .item {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 3px 0; font-size: 12px; line-height: 1.4;
    }
    .item-bullet { flex-shrink: 0; margin-top: 2px; font-size: 10px; opacity: 0.5; }
    .item-blocker .item-bullet { color: #f87171; opacity: 0.9; }
    .item-text { color: var(--vscode-foreground); }
    .empty-list { font-size: 12px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 2px 0; }

    .add-note {
      padding: 10px 12px 12px;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .add-note-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .add-note-row { display: flex; gap: 6px; margin-bottom: 6px; }

    select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 3px 6px;
      font-size: 11px; font-family: inherit; cursor: pointer;
      flex-shrink: 0;
    }
    select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

    textarea {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 5px 7px;
      font-size: 12px; font-family: inherit;
      resize: vertical; min-height: 52px;
      line-height: 1.4;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: transparent; }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

    .btn {
      display: block; width: 100%;
      padding: 5px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 2px;
      font-size: 12px; font-family: inherit;
      cursor: pointer; text-align: center;
      transition: background 0.1s;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .empty-state {
      padding: 24px 16px; text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .empty-title { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--vscode-foreground); }
    .empty-desc { font-size: 12px; line-height: 1.5; margin-bottom: 14px; }
    .empty-hint { font-size: 11px; opacity: 0.6; margin-top: 10px; }

    .setup-state {
      padding: 20px 14px;
      color: var(--vscode-descriptionForeground);
    }
    .setup-title { font-size: 13px; font-weight: 600; color: var(--vscode-foreground); margin-bottom: 8px; }
    .setup-desc { font-size: 12px; line-height: 1.5; margin-bottom: 14px; }
    .setup-step {
      font-size: 11px; line-height: 1.6;
      background: var(--vscode-textBlockQuote-background);
      border-left: 2px solid var(--vscode-textBlockQuote-border);
      padding: 6px 10px; border-radius: 0 2px 2px 0;
      margin-bottom: 12px;
    }

    .timestamp { font-size: 10px; color: var(--vscode-descriptionForeground); opacity: 0.5; padding: 6px 12px 4px; }
  </style>
</head>
<body>

<div id="root"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  let currentCtx = null
  let isDaemon = false

  function el(id) { return document.getElementById(id) }
  function $(sel) { return document.querySelector(sel) }

  function toggleSection(id) {
    const body = document.getElementById('body-' + id)
    const chev = document.getElementById('chev-' + id)
    if (!body || !chev) return
    const collapsed = body.classList.toggle('collapsed')
    chev.classList.toggle('collapsed', collapsed)
  }

  function makeSection(id, label, items, type) {
    const isEmpty = !items || items.length === 0
    const itemsHtml = isEmpty
      ? \`<div class="empty-list">none</div>\`
      : items.map(t => \`
          <div class="item \${type === 'blocker' ? 'item-blocker' : ''}">
            <span class="item-bullet">\${type === 'blocker' ? '⚠' : '•'}</span>
            <span class="item-text">\${esc(t)}</span>
          </div>\`).join('')

    return \`
      <div class="section">
        <div class="section-header" onclick="toggleSection('\${id}')">
          <span class="section-label">\${label}\${!isEmpty ? \` (\${items.length})\` : ''}</span>
          <span class="section-chevron" id="chev-\${id}">›</span>
        </div>
        <div class="section-body" id="body-\${id}">\${itemsHtml}</div>
      </div>\`
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function renderContext(ctx, daemon, entryCount) {
    const focusHtml = ctx.focus
      ? \`<div class="focus-text">\${esc(ctx.focus)}</div>\`
      : \`<div class="focus-none">not set</div>\`

    const updatedRelative = ctx.updatedAt ? relativeTime(ctx.updatedAt) : ''

    const html = \`
      <div class="header">
        <div class="header-left">
          <div class="status-dot \${daemon ? 'running' : 'stopped'}" title="\${daemon ? 'Daemon running' : 'Daemon stopped'}"></div>
          <span class="project-name">\${esc(ctx.project)}</span>
        </div>
        <div class="header-actions">
          <button class="icon-btn" onclick="vscode.postMessage({type:'copyContext'})" title="Copy context to clipboard">⎘</button>
          <button class="icon-btn" onclick="vscode.postMessage({type:'refresh'})" title="Refresh">↻</button>
        </div>
      </div>

      <div class="stats-bar">
        <div class="stat"><span>\${entryCount}</span> entries</div>
        \${updatedRelative ? \`<div class="stat">updated <span>\${updatedRelative}</span></div>\` : ''}
        <div class="stat" style="margin-left:auto;">\${daemon ? '● live' : '○ offline'}</div>
      </div>

      <div class="sections">
        <div class="section">
          <div class="section-header" onclick="toggleSection('focus')">
            <span class="section-label">Focus</span>
            <span class="section-chevron" id="chev-focus">›</span>
          </div>
          <div class="section-body" id="body-focus">\${focusHtml}</div>
        </div>
        \${makeSection('blockers',  'Active Blockers',  ctx.blockers,   'blocker')}
        \${makeSection('decisions', 'Recent Decisions', ctx.decisions,  'decision')}
        \${makeSection('facts',     'Key Facts',        ctx.facts,      'fact')}
      </div>

      <div class="add-note">
        <div class="add-note-label">Add note</div>
        <div class="add-note-row">
          <select id="note-type">
            <option value="fact">fact</option>
            <option value="decision">decision</option>
            <option value="blocker">blocker</option>
            <option value="progress">progress</option>
            <option value="focus">focus</option>
          </select>
        </div>
        <textarea id="note-text" placeholder="Be specific — include rationale for decisions, exact names for facts..." rows="3"></textarea>
        <br>
        <button class="btn" id="record-btn" onclick="submitNote()" style="margin-top:6px">Record</button>
      </div>

      \${updatedRelative ? \`<div class="timestamp">CONTEXT.md last written \${updatedRelative}</div>\` : ''}
    \`

    el('root').innerHTML = html

    // Enter key in textarea = submit
    const ta = el('note-text')
    if (ta) {
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote()
      })
    }
  }

  function renderEmpty(daemon, workspacePath) {
    const hasPath = !!workspacePath
    el('root').innerHTML = \`
      <div class="header">
        <div class="header-left">
          <div class="status-dot \${daemon ? 'running' : 'stopped'}"></div>
          <span class="project-name">kontxt</span>
        </div>
      </div>
      <div class="empty-state">
        <div class="empty-title">No context yet</div>
        <div class="empty-desc">
          \${hasPath
            ? 'This project has no kontxt memory. Initialize it to capture your stack, recent decisions, and current focus.'
            : 'Open a folder to get started.'
          }
        </div>
        \${hasPath ? \`<button class="btn" onclick="vscode.postMessage({type:'init'})">Initialize project</button>
        <div class="empty-hint">~1 API call · analyzes package.json, git log, README</div>\` : ''}
      </div>
    \`
  }

  function renderSetup() {
    el('root').innerHTML = \`
      <div class="setup-state">
        <div class="setup-title">Set up kontxt</div>
        <div class="setup-desc">Add your Anthropic API key to start capturing context automatically.</div>
        <div class="setup-step">
          VS Code Settings → search "kontxt" → paste your Anthropic API key
        </div>
        <button class="btn" onclick="vscode.postMessage({type:'openSettings'})">Open Settings</button>
        <br>
        <div class="setup-desc" style="margin-top:12px;font-size:11px;">Get a key at console.anthropic.com — Haiku tier is &lt;$1/month for typical usage.</div>
      </div>
    \`
  }

  function submitNote() {
    const text = el('note-text')?.value?.trim()
    const type = el('note-type')?.value ?? 'fact'
    if (!text) return
    const btn = el('record-btn')
    if (btn) btn.disabled = true
    vscode.postMessage({ type: 'addNote', text, entryType: type })
    if (el('note-text')) el('note-text').value = ''
    if (btn) setTimeout(() => { btn.disabled = false }, 1000)
  }

  function relativeTime(isoStr) {
    try {
      const diff = Date.now() - new Date(isoStr).getTime()
      const mins = Math.floor(diff / 60000)
      if (mins < 2) return 'just now'
      if (mins < 60) return \`\${mins}m ago\`
      const hrs = Math.floor(mins / 60)
      if (hrs < 24) return \`\${hrs}h ago\`
      return \`\${Math.floor(hrs / 24)}d ago\`
    } catch { return '' }
  }

  window.addEventListener('message', e => {
    const msg = e.data
    if (msg.type === 'context') {
      currentCtx = msg.ctx
      isDaemon = msg.daemon
      renderContext(msg.ctx, msg.daemon, msg.entryCount)
    } else if (msg.type === 'empty') {
      isDaemon = msg.daemon
      renderEmpty(msg.daemon, msg.workspacePath)
    } else if (msg.type === 'setup') {
      renderSetup()
    }
  })
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
