#!/usr/bin/env node
// `obsrv install-skill` — copy the packaged Claude Code skill into the user's
// skills directory, so an agent picks up the snap → look → diff → fix loop
// without being told about it. Plain Node: no Electron, no build needed.
'use strict'

const { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')

const SKILL_NAME = 'obsrv-screens'
const source = join(__dirname, '..', 'skills', SKILL_NAME)

function usage() {
  return `obsrv install-skill — install the ${SKILL_NAME} skill for Claude Code

Usage:
  obsrv install-skill [flags]

Flags:
  --dest <dir>   Skills directory to install into (default ~/.claude/skills).
  --force        Overwrite an existing, different copy.
  --print        Write SKILL.md to stdout instead of installing.
  --help         Show this message.

Installs to <dest>/${SKILL_NAME}/. New Claude Code sessions pick the skill up;
sessions already running need a restart.`
}

/** Copies a directory tree. Shallow enough for a skill (SKILL.md + optional references). */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const src = join(from, entry)
    const dst = join(to, entry)
    if (statSync(src).isDirectory()) copyTree(src, dst)
    else copyFileSync(src, dst)
  }
}

/** True when every file in `from` exists in `to` with identical bytes. */
function sameTree(from, to) {
  for (const entry of readdirSync(from)) {
    const src = join(from, entry)
    const dst = join(to, entry)
    if (!existsSync(dst)) return false
    if (statSync(src).isDirectory()) {
      if (!statSync(dst).isDirectory() || !sameTree(src, dst)) return false
    } else if (!readFileSync(src).equals(readFileSync(dst))) return false
  }
  return true
}

function main(argv) {
  let dest = join(homedir(), '.claude', 'skills')
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') {
      console.log(usage())
      return 0
    }
    if (flag === '--print') {
      process.stdout.write(readFileSync(join(source, 'SKILL.md'), 'utf8'))
      return 0
    }
    if (flag === '--force') {
      force = true
      continue
    }
    if (flag === '--dest') {
      const value = argv[++i]
      if (!value) {
        console.error('obsrv install-skill: --dest needs a directory')
        return 2
      }
      dest = resolve(value)
      continue
    }
    console.error(`obsrv install-skill: unknown flag: ${flag}\n\n${usage()}`)
    return 2
  }

  if (!existsSync(source)) {
    console.error(`obsrv install-skill: the packaged skill is missing (looked in ${source})`)
    return 1
  }

  const target = join(dest, SKILL_NAME)
  if (existsSync(target)) {
    if (sameTree(source, target)) {
      console.error(`obsrv install-skill: already up to date at ${target}`)
      return 0
    }
    if (!force) {
      console.error(
        `obsrv install-skill: ${target} exists and differs — pass --force to overwrite it, ` +
          'or --dest to install elsewhere',
      )
      return 1
    }
  }

  copyTree(source, target)
  console.error(
    `obsrv install-skill: installed to ${target}\n` +
      'New Claude Code sessions will pick it up; restart any session already running.',
  )
  return 0
}

process.exit(main(process.argv.slice(2)))
