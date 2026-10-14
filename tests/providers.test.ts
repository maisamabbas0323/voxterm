import { describe, expect, it } from 'vitest'
import { parseSessions as parseTmux } from '../src/main/external/providers/tmux'
import { parseSessions as parseScreen } from '../src/main/external/providers/screen'

describe('tmux session parsing', () => {
  it('parses a well-formed line', () => {
    const sessions = parseTmux('work|3|1700000000|1|/home/user/project\n')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      name: 'work',
      windows: 3,
      created: 1700000000,
      attached: 1,
      path: '/home/user/project'
    })
  })

  it('keeps pipes inside the working directory', () => {
    const sessions = parseTmux('odd|1|2|0|/home/weird|dir\n')
    expect(sessions[0].path).toBe('/home/weird|dir')
  })

  it('skips blank lines and tolerates missing numeric fields', () => {
    const sessions = parseTmux('\nbroken|||\nvalid|2|5|0|/tmp\n')
    expect(sessions.map((session) => session.name)).toEqual(['broken', 'valid'])
    expect(sessions[0].windows).toBe(0)
  })
})

describe('screen session parsing', () => {
  it('parses real screen -ls lines', () => {
    const output = [
      'There are screens on:',
      '\t12345.pts-0.host\t(Detached)',
      '\t67890.mysession\t(Attached)',
      '2 Sockets in /run/screen/S-user.'
    ].join('\n')
    const sessions = parseScreen(output)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ spec: '12345.pts-0.host', pid: 12345, attached: false })
    expect(sessions[1]).toMatchObject({ name: 'mysession', attached: true })
  })

  it('ignores non-session lines', () => {
    expect(parseScreen('No Sockets found in /run/screen/S-user.\n')).toEqual([])
  })
})
