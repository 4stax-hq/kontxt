import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { extractMemoriesFromTranscript } from '../../extractor.js'
import { storeExtractedMemories } from '../../capture-store.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

export async function captureCommand(options: { file?: string; project?: string; limit?: number | string }) {
  let transcript = ''

  if (options.file) {
    if (!fs.existsSync(options.file)) {
      console.log(chalk.red('file not found: ' + options.file))
      return
    }
    transcript = fs.readFileSync(options.file, 'utf-8')
  } else {
    transcript = fs.readFileSync('/dev/stdin', 'utf-8')
  }

  if (!transcript.trim()) {
    console.log(chalk.red('no transcript provided'))
    console.log(chalk.gray('  cat conversation.txt | kontxt capture'))
    console.log(chalk.gray('  kontxt capture --file conversation.txt'))
    return
  }

  const spinner = ora('auto-capturing durable memories...').start()
  try {
    const config = getConfig()
    const extracted = await extractMemoriesFromTranscript(transcript, config.openai_api_key)

    if (!extracted.length) {
      spinner.stop()
      console.log(chalk.yellow('no durable memories found'))
      return
    }

    spinner.text = 'storing memories...'

    const maxItems = typeof options.limit === 'string' ? Number(options.limit) : (options.limit ?? 50)
    const { stored, updated, skipped } = await storeExtractedMemories(extracted, {
      project: options.project,
      source: 'auto-captured',
      importanceScore: 0.65,
      limit: maxItems,
    })

    spinner.stop()
    console.log(
      chalk.cyan(
        `done: stored=${stored}, updated=${updated}, skipped=${skipped} (from ${Math.min(extracted.length, maxItems)} extracted items)`
      )
    )
  } catch (err: any) {
    spinner.fail(chalk.red('capture failed: ' + err.message))
  }
}
