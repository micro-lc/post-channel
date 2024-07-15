import { exec as childProcessExec } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { resolve as pathResolve } from 'path'

import { Command } from 'commander'
import logger from 'node-color-log'

logger.setDate(() => '')

type Context = {
  version: string
}

const colorMap = {
  error: 'red',
  stderr: 'yellow',
  stdout: 'green',
}

class PromiseQueue {
  private queue: Promise<void>

  constructor() {
    this.queue = Promise.resolve()
  }

  get() { return this.queue }

  add(step: string, operation: () => Promise<void>) {
    this.queue = this.queue
      .then(operation)
      .then(() => {
        logger.bgColor('green').log(`[${step}]`)
          .joint()
          .color('white')
          .log(` ▶ OK\n`)
      }).catch((err) => {
        logger.bgColor('magenta').log(`[${step}]`)
          .joint()
          .color('white')
          .log(` ▶ Failed\n`)
        throw err
      })
    return this.queue
  }
}

const exec = async (step: string, command: string): Promise<void> => {
  let innerResolve: (value: void) => void
  let innerReject: (reason?: unknown) => void

  const promise = new Promise<void>((resolve, reject) => {
    innerResolve = resolve
    innerReject = reject
  })

  const proc = childProcessExec(command, (error, stdout, stderr) => {
    let color: string
    let message: string

    if (error) {
      color = colorMap.error
      message = `${error.message}\n\n${error.stack}`
    } else if (stderr) {
      color = colorMap.stderr
      message = stderr
    } else {
      color = colorMap.stdout
      message = stdout
    }

    // @ts-expect-error node-color-log does not expose types
    return logger.bgColor(color).log(`[${step}]`)
      .joint()
      .color('white')
      .log(` ▶ ${message}`)
  })

  proc.on('exit', (code) => {
    code === 0
      ? innerResolve()
      : innerReject()
  })

  return promise
}

function getArgs(): Context {
  const program = new Command()
  const ctx: Partial<Context> = {}

  program
    .name('bump')
    .description('Command line to handle subpackages version bumps')
    .argument('<version>', `The version to reach. Can be either 'major', 'minor', or 'patch'. Alternatively a specific version can be issued, like '2.1.3-rc2'`)
    .action((version: string) => {
      ctx.version = version
    })
    .parse()

  return ctx as Context
}

const semverRegex = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/

async function queryVersion(workingDir: string) {
  return readFile(`${workingDir}/package.json`, { encoding: 'utf-8' })
    .then((content) => JSON.parse(content) as { version: string })
    .then(({ version }) => version)
    .catch(() => { throw new TypeError(`No package.json file found at ${workingDir}`) })
}

async function querySemVer(workingDir: string) {
  return readFile(`${workingDir}/package.json`, { encoding: 'utf-8' })
    .then((content) => JSON.parse(content) as { version: string })
    .then(({ version }) => (version.match(semverRegex) ? version : undefined))
    .catch(() => { throw new TypeError(`No package.json file found at ${workingDir}`) })
}

async function updateChangelog(workingDir: string, version: string) {
  return readFile(pathResolve(workingDir, 'CHANGELOG.md'))
    .then((content) => {
      const lines = content.toString().split(/(?:\r\n|\r|\n)/g)
      const unreleasedLine = lines
        .findIndex((line) =>
          line
            .trim()
            .replace(/\s/g, '')
            .toLowerCase()
            .match(/^##unreleased/)
        )

      const date = new Date().toISOString()
      const tIndex = date.indexOf('T')

      const output = lines
        .slice(0, unreleasedLine + 1)
        .concat('')
        .concat(`## [${version}] - ${date.slice(0, tIndex)}`)
        .concat('')
        .concat(lines.slice(unreleasedLine + 2))
      return writeFile(pathResolve(workingDir, 'CHANGELOG.md'), output.join('\n'))
    })
    .catch((err) => {
      logger.error((err as {message: string}).message)
      return undefined
    })
}

async function main() {
  const ctx = getArgs()

  const queue = new PromiseQueue()

  const workingDir = pathResolve(process.cwd())
  const tagScope = '@micro-lc/post-channel'
  const tagPrefix = 'v'

  await queue.add('version', () => exec('version', `(cd ${workingDir} ; yarn version ${ctx.version})`))

  const newSemVersion = await querySemVer(workingDir)
  if (newSemVersion !== undefined) {
    queue
      .add('update-changelog', () => updateChangelog(workingDir, newSemVersion))
      .catch(() => { /* no-op */ })
  }

  queue
    .add('reset-stage', () => exec('reset-stage', 'git reset'))
    .catch(() => { /* no-op */ })

  queue
    .add('add-to-stage', () => exec('add-to-stage', `git add ${pathResolve(workingDir, 'package.json')} ${pathResolve(workingDir, 'CHANGELOG.md')} ${pathResolve(process.cwd(), '.yarn', 'versions')}`))
    .catch(() => { /* no-op */ })

  const newVersion = await queryVersion(workingDir)
  queue
    .add('commit', () => exec('commit', `git commit -nm "${tagScope} tagged at version: ${newVersion}"`))
    .catch(() => { /* no-op */ })

  const tag = `${tagPrefix}${newVersion}`
  queue
    .add('commit', () => exec('tag', `git tag -a "${tag}" -m "${tagScope} tagged at version: ${newVersion}"`))
    .catch(() => { /* no-op */ })

  return queue.get().then(() => tag)
}

main()
  .then((tag) => {
    logger.color('green').log('\n\tpush both branch and tag:')
    logger.color('magenta').log(`\n\tgit push && git push origin ${tag}`)
  })
  .catch((err) => {
    console.error(`[error boundary]: ${err}`)
  })
