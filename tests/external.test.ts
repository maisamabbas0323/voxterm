import { describe, expect, it } from 'vitest'
import { parseScreenSessions, parseTmuxSessions } from '../src/main/external/discover'

/**
 * Parser-only tests. Every fixture below was captured from (or shaped exactly
 * like) real tool output on Linux: tmux 3.7b `list-sessions -F` prints
 * tab-separated fields, and `screen -ls` prints CRLF-terminated lines with
 * tab-indented "pid.name" entries.
 */
describe('parseTmuxSessions', () => {
  it('parses the real tab-separated format, including names with spaces, dots and dashes', () => {
    // `tmux list-sessions -F` now ends every line with the stable `$N`
    // session id (#{session_id}), which is the only -t target tmux resolves
    // unconditionally.
    const stdout =
      'probe\t2\t0\t1700000000\t$1\n' +
      'work space\t1\t1\t1690000000\t$2\n' +
      'name.with-dashes\t3\t2\t1680000000\t$3\n'

    const sessions = parseTmuxSessions(stdout)

    expect(sessions).toHaveLength(3)
    expect(sessions[0]).toEqual({
      id: 'tmux:probe',
      kind: 'tmux',
      name: 'probe',
      target: '$1',
      windows: 2,
      attachedClients: 0,
      busy: false,
      createdAt: 1700000000000,
      attachable: true
    })
    expect(sessions[1]).toEqual({
      id: 'tmux:work space',
      kind: 'tmux',
      name: 'work space',
      target: '$2',
      windows: 1,
      attachedClients: 1,
      busy: true,
      createdAt: 1690000000000,
      attachable: true
    })
    // A dot is a tmux target separator, so the session is attachable via its
    // stable session id and the caveat must be surfaced.
    expect(sessions[2]).toEqual({
      id: 'tmux:name.with-dashes',
      kind: 'tmux',
      name: 'name.with-dashes',
      target: '$3',
      windows: 3,
      attachedClients: 2,
      busy: true,
      createdAt: 1680000000000,
      attachable: true,
      reason: expect.any(String)
    })
    expect(sessions[2]?.reason?.length ?? 0).toBeGreaterThan(0)
  })

  it('converts session_created seconds to epoch milliseconds', () => {
    const [session] = parseTmuxSessions('s\t1\t0\t1700000000\t$1')
    expect(session?.createdAt).toBe(1700000000 * 1000)
    expect(session?.target).toBe('$1')
  })

  it('returns an empty list for empty output', () => {
    expect(parseTmuxSessions('')).toEqual([])
  })

  it('returns an empty list for the "no server running" banner', () => {
    expect(parseTmuxSessions('no server running on /tmp/tmux-1000/default\n')).toEqual([])
  })

  it('skips malformed and garbage lines without throwing', () => {
    const stdout =
      'total 3\n' + // not tab-separated
      'garbage\n' +
      '\t1\t0\t1700000000\t$9\n' + // empty name
      'notanumber\tfoo\t0\t1700000000\n' + // windows not numeric
      'ok\t1\t0\t1700000000\t$7\n'

    const sessions = parseTmuxSessions(stdout)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.name).toBe('ok')
    expect(sessions[0]?.target).toBe('$7')
    expect(sessions[0]?.attachable).toBe(true)
  })

  it('falls back to null when the attached/created fields are not numeric', () => {
    // The trailing id column is also validated: anything but tmux's `$N`
    // rendering is malformed output and yields a null target.
    const [session] = parseTmuxSessions('odd\t1\tx\tzz\tnot-a-tmux-id\n')
    expect(session).toMatchObject({
      name: 'odd',
      windows: 1,
      attachedClients: null,
      target: null,
      createdAt: null,
      attachable: true
    })
  })

  it('keeps colon-containing names attachable but flags the target caveat', () => {
    // tmux parses "session:window.pane" in -t, so "a:b" cannot be targeted by
    // name — only via its $N session id — but it is not impossible.
    const [session] = parseTmuxSessions('a:b\t1\t0\t1700000000\t$4\n')
    expect(session?.name).toBe('a:b')
    expect(session?.target).toBe('$4')
    expect(session?.attachable).toBe(true)
    expect(session?.reason).toBeTruthy()
  })
})

describe('parseScreenSessions', () => {
  it('parses the real screen -ls format with CRLF line endings', () => {
    const stdout =
      'There are screens on:\r\n' +
      '\t83220.other.session\t(10/17/2026 07:20:23 AM)\t(Detached)\r\n' +
      '\t83175.probe\t(10/17/2026 07:20:23 AM)\t(Attached)\r\n' +
      '\t83221.multi\t(10/17/2026 07:20:24 AM)\t(Multi, attached)\r\n' +
      '2 Sockets in /tmp/voxtest-screen.\r\n'

    const sessions = parseScreenSessions(stdout)

    expect(sessions).toHaveLength(3)
    // Only the leading pid dot separates socket from name; the name's own dot
    // is preserved.
    expect(sessions[0]).toEqual({
      id: 'screen:other.session',
      kind: 'screen',
      name: 'other.session',
      target: '83220.other.session',
      windows: null,
      attachedClients: null,
      busy: false,
      createdAt: null,
      attachable: true
    })
    // "(Attached)" is a caveat for `screen -r`, but the client count is not
    // reported, so attachedClients stays null.
    expect(sessions[1]).toMatchObject({
      name: 'probe',
      attachedClients: null,
      attachable: true
    })
    expect(sessions[1]?.reason).toBeTruthy()
    // "(Multi, attached)" implies at least two clients.
    expect(sessions[2]).toMatchObject({
      name: 'multi',
      attachedClients: 2,
      attachable: true
    })
  })

  it('marks Dead, Removed and "Remote or dead" sessions unattachable with a reason', () => {
    const stdout =
      'There is a screen on:\n' +
      '\t84756.deadtest\t(???)\t(Remote or dead)\n' +
      '\t1234.ancient\t(10/17/2026 07:20:23 AM)\t(Dead ???)\n' +
      '\t1235.gone\t(10/17/2026 07:20:23 AM)\t(Removed)\n' +
      '3 Sockets in /tmp/voxtest-screen.\n'

    const sessions = parseScreenSessions(stdout)

    expect(sessions).toHaveLength(3)
    expect(sessions.map((session) => session.name)).toEqual(['deadtest', 'ancient', 'gone'])
    for (const session of sessions) {
      expect(session.attachable).toBe(false)
      expect(session.reason).toBeTruthy()
    }
  })

  it('returns an empty list for "No Sockets found" and empty output', () => {
    expect(parseScreenSessions('No Sockets found in /tmp/voxtest-empty.\n')).toEqual([])
    expect(parseScreenSessions('')).toEqual([])
  })

  it('handles the "several screens" header variant and lines without a date column', () => {
    const stdout =
      'There are several screens on:\n' +
      '\t12345.name\t(Detached)\n' +
      '1 Socket in /tmp/screens.\n'

    const sessions = parseScreenSessions(stdout)

    expect(sessions).toEqual([
      {
        id: 'screen:name',
        kind: 'screen',
        name: 'name',
        target: '12345.name',
        windows: null,
        attachedClients: null,
        busy: false,
        createdAt: null,
        attachable: true
      }
    ])
  })

  it('ignores garbage lines', () => {
    expect(parseScreenSessions('garbage\nnot a session line\n\t\tnope\n')).toEqual([])
  })
})
