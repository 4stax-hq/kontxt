import fs from 'fs'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

export function ensurePrivateDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true, mode: DIR_MODE })
  try {
    fs.chmodSync(dirPath, DIR_MODE)
  } catch {}
}

export function ensurePrivateFile(filePath: string, contents = '') {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, contents, { encoding: 'utf-8', mode: FILE_MODE })
  }
  try {
    fs.chmodSync(filePath, FILE_MODE)
  } catch {}
}

export function writePrivateFile(filePath: string, contents: string) {
  fs.writeFileSync(filePath, contents, { encoding: 'utf-8', mode: FILE_MODE })
  try {
    fs.chmodSync(filePath, FILE_MODE)
  } catch {}
}
