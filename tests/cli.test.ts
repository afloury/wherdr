import http from 'node:http'
import type net from 'node:net'
import { describe, expect, it } from 'vitest'
import { parseArgs, portTaken, serverEnv } from '../bin/wherdr.mjs'

describe('wherdr command options', () => {
  it('reads both --name value and --name=value', () => {
    expect(parseArgs(['--port', '7690', '--host=0.0.0.0', '--data-dir', '/srv/w', '--session=test']))
      .toEqual({ port: '7690', host: '0.0.0.0', dataDir: '/srv/w', session: 'test' })
    expect(parseArgs(['-h'])).toEqual({ help: true })
    expect(parseArgs(['--version'])).toEqual({ version: true })
  })

  it('rejects unknown options, missing values and bad ports', () => {
    expect(() => parseArgs(['--prot', '1'])).toThrow('unknown option: --prot')
    expect(() => parseArgs(['--port'])).toThrow('--port needs a value')
    expect(() => parseArgs(['--session', '--port', '1'])).toThrow('--session needs a value')
    expect(() => parseArgs(['--port', '80a'])).toThrow('must be a number')
    expect(() => parseArgs(['--port=70000'])).toThrow('between 1 and 65535')
  })
})

describe('wherdr server environment', () => {
  const home = '/home/test'

  it('defaults to loopback, port 7683 and ~/wherdr/data', () => {
    const env = serverEnv({}, {}, home)
    expect(env).toMatchObject({ PORT: '7683', HOST: '127.0.0.1', DATA_DIR: '/home/test/wherdr/data', WHERDR_INSTALL: 'npm', NODE_ENV: 'production' })
    expect(env.HERDR_WEB_SESSION).toBeUndefined()
  })

  it('lets options win over the environment, and the environment over the defaults', () => {
    const fromEnv = serverEnv({}, { PORT: '7691', HOST: '::1', DATA_DIR: '~/elsewhere', HERDR_WEB_SESSION: 's1' }, home)
    expect(fromEnv).toMatchObject({ PORT: '7691', HOST: '::1', DATA_DIR: '/home/test/elsewhere', HERDR_WEB_SESSION: 's1' })
    const fromOpts = serverEnv({ port: '7692', host: '127.0.0.2', dataDir: '/srv/w', session: 's2' }, { PORT: '7691', HERDR_WEB_SESSION: 's1' }, home)
    expect(fromOpts).toMatchObject({ PORT: '7692', HOST: '127.0.0.2', DATA_DIR: '/srv/w', HERDR_WEB_SESSION: 's2' })
  })

  it('drops NITRO_PORT / NITRO_HOST, which Nitro would read before PORT / HOST', () => {
    const env = serverEnv({ port: '7693' }, { NITRO_PORT: '3000', NITRO_HOST: '0.0.0.0' }, home)
    expect(env.NITRO_PORT).toBeUndefined()
    expect(env.NITRO_HOST).toBeUndefined()
    expect(env.PORT).toBe('7693')
  })
})

describe('port check', () => {
  it('tells a free port from one another program holds', async () => {
    const srv = http.createServer((_req, res) => { res.statusCode = 404; res.end() })
    const listening = Promise.withResolvers<void>()
    srv.listen(0, '127.0.0.1', () => listening.resolve())
    await listening.promise
    const port = (srv.address() as net.AddressInfo).port
    try {
      expect(await portTaken(port, '127.0.0.1')).toBe('other')
    } finally {
      const closed = Promise.withResolvers<void>()
      srv.close(() => closed.resolve())
      srv.closeAllConnections()
      await closed.promise
    }
    expect(await portTaken(port, '127.0.0.1')).toBeNull()
  })
})
