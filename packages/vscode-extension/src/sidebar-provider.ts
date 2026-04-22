import * as vscode from 'vscode'
import {
  parseContextMd, readContextMd, isDaemonRunning, getEntryCount,
  hasApiKey, isAutoRefreshEnabled, setAutoRefresh, getLastAutoRefresh,
  getFullConfig, setConfigValue, runKontxtCli,
} from './kontxt-client'

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
          vscode.commands.executeCommand('kontxt.init').then(() => {
            setTimeout(() => this.refresh(), 2000)
          })
          break
        case 'runRefresh':
          vscode.commands.executeCommand('kontxt.refresh').then(() => {
            this.refresh()
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
        case 'setConfig':
          if (msg.key !== undefined) {
            setConfigValue(msg.key, msg.value)
            this.refresh()
          }
          break
        case 'synthesize':
          vscode.commands.executeCommand('kontxt.synthesize')
          break
        case 'startDaemon':
          vscode.commands.executeCommand('kontxt.startDaemon')
          setTimeout(() => this.refresh(), 1500)
          break
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'kontxt')
          break
        case 'copyContext':
          vscode.commands.executeCommand('kontxt.copyContext')
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
      const entryCount = this._workspacePath ? getEntryCount(this._workspacePath) : 0
      const autoRefresh = isAutoRefreshEnabled()
      const lastAutoRefresh = this._workspacePath ? getLastAutoRefresh(this._workspacePath) : 0
      const config = getFullConfig()

      if (!md) {
        this._view.webview.postMessage({
          type: 'empty', daemon, workspacePath: this._workspacePath, autoRefresh, config,
        })
        return
      }

      const ctx = parseContextMd(md)
      this._view.webview.postMessage({
        type: 'context', ctx, daemon, entryCount, autoRefresh, lastAutoRefresh, config,
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
    .stats {
      display: flex; flex-wrap: wrap; gap: 8px; padding: 5px 12px;
      border-bottom: 1px solid var(--vscode-widget-border); align-items: center;
    }
    .stat { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .stat b { color: var(--vscode-foreground); font-weight: 500; }
    .stat.ml { margin-left: auto; }
    .info-bar {
      padding: 5px 12px; font-size: 11px;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .info-bar.warn    { background: rgba(248,113,113,0.08); border-left: 2px solid #f87171; color: #f87171; }
    .info-bar.caution { background: rgba(251,191,36,0.08);  border-left: 2px solid #fbbf24; color: #fbbf24; }
    .info-bar-btn {
      background: none; border: 1px solid currentColor; color: inherit;
      border-radius: 3px; padding: 2px 8px; font-size: 10px; cursor: pointer;
      font-family: inherit; white-space: nowrap; flex-shrink: 0;
    }
    .info-bar-btn:hover { background: rgba(255,255,255,0.1); }
    .actions {
      display: flex; gap: 4px; padding: 7px 12px;
      border-bottom: 1px solid var(--vscode-widget-border); flex-wrap: wrap;
    }
    .abtn {
      flex: 1; min-width: 60px; padding: 5px 6px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 3px;
      font-size: 11px; font-family: inherit; cursor: pointer;
      white-space: nowrap; text-align: center;
      transition: background 0.1s, opacity 0.1s;
    }
    .abtn:hover    { background: var(--vscode-button-secondaryHoverBackground); }
    .abtn:disabled { opacity: 0.4; cursor: not-allowed; }
    .abtn.primary  { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .abtn.primary:hover { background: var(--vscode-button-hoverBackground); }
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

  function toggle(id) {
    const b = el('b-' + id), c = el('c-' + id)
    if (!b || !c) return
    const col = b.classList.toggle('col')
    c.classList.toggle('col', col)
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
      <div class="sec-hdr" onclick="toggle('\${id}')">
        <span class="sec-label">\${label}\${empty ? '' : ' (' + items.length + ')'}</span>
        <span class="sec-chev" id="c-\${id}">&#x203A;</span>
      </div>
      <div class="sec-body" id="b-\${id}">\${rows}</div>
    </div>\`
  }

  function mkHeader(projectName, daemon, arOn) {
    return \`<div class="header">
      <div class="header-left">
        <div class="status-dot \${daemon ? 'on' : 'off'}" title="\${daemon ? 'Daemon running' : 'Daemon stopped'}"></div>
        <span class="project-name">\${esc(projectName)}</span>
      </div>
      <div class="header-right">
        <div class="toggle-wrap" title="\${arOn ? 'Disable' : 'Enable'} auto-refresh">
          <label class="toggle-sw">
            <input type="checkbox" \${arOn ? 'checked' : ''} onchange="vscode.postMessage({type:'toggleAutoRefresh'})">
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label \${arOn ? 'on' : ''}">\${arOn ? 'auto' : 'manual'}</span>
        </div>
        <button class="txt-btn" onclick="vscode.postMessage({type:'copyContext'})" title="Copy context">copy</button>
        <button class="txt-btn" onclick="vscode.postMessage({type:'refresh'})" title="Reload">reload</button>
      </div>
    </div>\`
  }

  function settingsPanel(cfg) {
    if (!cfg) return ''
    const ar = cfg.autoRefresh !== false
    const qm = cfg.autoRefreshQuietMinutes    != null ? cfg.autoRefreshQuietMinutes    : 5
    const cd = cfg.autoRefreshCooldownMinutes != null ? cfg.autoRefreshCooldownMinutes : 30
    const ms = cfg.autoRefreshMinScore        != null ? cfg.autoRefreshMinScore        : 4
    const mt = cfg.maxContextTokens           != null ? cfg.maxContextTokens           : 800
    return \`<div class="section">
      <div class="sec-hdr" onclick="toggle('cfg')">
        <span class="sec-label">Settings</span>
        <span class="sec-chev col" id="c-cfg">&#x203A;</span>
      </div>
      <div class="sec-body col" id="b-cfg">
        <div class="cfg-div">Auto-refresh</div>
        <div class="cfg-row">
          <div class="cfg-lbl">
            <div class="cfg-name">Auto-refresh</div>
            <div class="cfg-hint">Update context on code changes</div>
          </div>
          <label class="toggle-sw">
            <input type="checkbox" \${ar ? 'checked' : ''} onchange="vscode.postMessage({type:'toggleAutoRefresh'})">
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

  function renderContext(ctx, daemon, entryCount, autoRefresh, lastAutoRefresh, config) {
    const arOn    = autoRefresh !== false
    const lastStr = lastAutoRefresh ? relTime(lastAutoRefresh) : 'never'
    const stale   = ctx.updatedAt && ageMs(ctx.updatedAt) > 3 * 86400000

    const staleBar = stale ? \`<div class="info-bar warn">
      <span>Context is \${relTime(ctx.updatedAt)} old</span>
      <button class="info-bar-btn" onclick="runReeval()">Re-evaluate</button>
    </div>\` : ''

    const daemonBar = !daemon ? \`<div class="info-bar caution">
      <span>Daemon offline</span>
      <button class="info-bar-btn" onclick="vscode.postMessage({type:'startDaemon'})">Start</button>
    </div>\` : ''

    const statsRow = \`<div class="stats">
      <div class="stat"><b>\${ctx.facts.length}</b> facts</div>
      <div class="stat"><b>\${ctx.decisions.length}</b> decisions</div>
      <div class="stat"><b>\${ctx.blockers.length}</b> blockers</div>
      \${ctx.updatedAt ? \`<div class="stat">upd <b>\${relTime(ctx.updatedAt)}</b></div>\` : ''}
      <div class="stat ml">auto <b>\${lastStr}</b></div>
    </div>\`

    const actions = \`<div class="actions">
      <button class="abtn primary" id="btn-refresh" onclick="runRefresh()" title="Scan recently changed files">Refresh</button>
      <button class="abtn" id="btn-reeval" onclick="runReeval()" title="Full repo scan">Re-evaluate</button>
      <button class="abtn" onclick="runSynthesize()" title="Rebuild narrative from stored entries">Synthesize</button>
    </div>\`

    const focusSection = \`<div class="section">
      <div class="sec-hdr" onclick="toggle('focus')">
        <span class="sec-label">Current Focus</span>
        <span class="sec-chev" id="c-focus">&#x203A;</span>
      </div>
      <div class="sec-body" id="b-focus">
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
      <button class="rec-btn" id="rec-btn" onclick="submitNote()">Record <span style="opacity:0.4;font-size:10px">Cmd+Enter</span></button>
    </div>\`

    el('root').innerHTML = mkHeader(ctx.project, daemon, arOn)
      + statsRow + staleBar + daemonBar + actions + focusSection
      + section('blk', 'Active Blockers', ctx.blockers, 'blocker')
      + section('dec', 'Decisions',       ctx.decisions, 'decision')
      + section('fct', 'Key Facts',       ctx.facts,     'fact')
      + addNote + settingsPanel(config)

    const ta = el('ntxt')
    if (ta) ta.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote()
    })
  }

  function renderEmpty(daemon, workspacePath, autoRefresh, config) {
    const has  = !!workspacePath
    const arOn = autoRefresh !== false

    const body = has ? \`<div class="empty-state">
      <div class="empty-title">No context yet</div>
      <div class="empty-desc">Initialize to capture your stack, decisions, and current focus.</div>
      <button class="abtn primary full-btn" id="btn-init" onclick="runInit()">Initialize project</button>
      <button class="abtn full-btn" id="btn-ref-e" onclick="runRefresh()">Refresh from recent changes</button>
      <div class="empty-hint">Init: full repo scan &nbsp;·&nbsp; Refresh: only what changed recently</div>
    </div>\` : \`<div class="empty-state">
      <div class="empty-title">No context yet</div>
      <div class="empty-desc">Open a workspace folder to get started.</div>
    </div>\`

    el('root').innerHTML = mkHeader('kontxt', daemon, arOn) + body + settingsPanel(config)
  }

  function renderSetup() {
    el('root').innerHTML = \`<div class="setup-wrap">
      <div class="setup-title">Set up kontxt</div>
      <div class="setup-desc">Add your Anthropic API key to start capturing context automatically.</div>
      <div class="setup-code">VS Code Settings &rsaquo; search "kontxt" &rsaquo; paste key</div>
      <button class="abtn primary" onclick="vscode.postMessage({type:'openSettings'})" style="width:100%;margin-bottom:10px">Open Settings</button>
      <div class="setup-desc" style="font-size:11px">Get a key at console.anthropic.com &mdash; Haiku is &lt;$1/month for typical use.</div>
    </div>\`
  }

  function runInit() {
    const b = el('btn-init')
    if (b) { b.disabled = true; b.textContent = 'Analyzing...' }
    vscode.postMessage({ type: 'init' })
  }

  function runRefresh() {
    const b = el('btn-refresh') || el('btn-ref-e')
    if (b) { b.disabled = true; b.textContent = 'Scanning...' }
    vscode.postMessage({ type: 'runRefresh' })
  }

  function runReeval() {
    const b = el('btn-reeval')
    if (b) { b.disabled = true; b.textContent = 'Analyzing...' }
    vscode.postMessage({ type: 'runReeval' })
  }

  function runSynthesize() {
    vscode.postMessage({ type: 'synthesize' })
  }

  function submitNote() {
    const ta   = el('ntxt')
    const text = ta ? ta.value.trim() : ''
    const type = el('ntype') ? el('ntype').value : 'fact'
    if (!text) return
    const b = el('rec-btn')
    if (b) b.disabled = true
    vscode.postMessage({ type: 'addNote', text: text, entryType: type })
    if (ta) ta.value = ''
    if (b) setTimeout(function() { b.disabled = false }, 1200)
  }

  window.addEventListener('message', function(e) {
    const msg = e.data
    if (msg.type === 'context') {
      renderContext(msg.ctx, msg.daemon, msg.entryCount, msg.autoRefresh, msg.lastAutoRefresh, msg.config)
    } else if (msg.type === 'empty') {
      renderEmpty(msg.daemon, msg.workspacePath, msg.autoRefresh, msg.config)
    } else if (msg.type === 'setup') {
      renderSetup()
    } else if (msg.type === 'err') {
      el('root').innerHTML = \`<div class="err-box"><b>kontxt error</b><br>\${esc(msg.message)}<br><br><button onclick="vscode.postMessage({type:'refresh'})" style="cursor:pointer;padding:3px 10px">Retry</button></div>\`
    }
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
