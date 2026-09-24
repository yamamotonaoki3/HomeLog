import { spawn } from 'node:child_process'

const run = (command, args) => new Promise((resolve) => {
  const child = spawn(command, args, { shell: true, stdio: 'inherit' })

  child.on('error', (error) => {
    console.error(`コマンドの起動に失敗しました: ${command}`, error)
    resolve(1)
  })
  child.on('exit', (code) => resolve(code ?? 1))
})

const preCleanupExitCode = await run('node', ['scripts/cleanup.mjs'])

if (preCleanupExitCode !== 0) {
  process.exit(preCleanupExitCode)
}

const playwrightExitCode = await run('playwright', ['test', ...process.argv.slice(2)])
const postCleanupExitCode = await run('node', ['scripts/cleanup.mjs'])

process.exit(playwrightExitCode !== 0 ? playwrightExitCode : postCleanupExitCode)
