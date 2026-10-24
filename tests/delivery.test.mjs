import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { deliverAddon } from '../scripts/addon-delivery.mjs'

test('delivery preserves project sources and settings, including on repeated sync', async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ym-old-home-delivery-'))
    const oldRoot = process.env.PULSESYNC_ADDONS_DIR
    const oldUrl = process.env.PULSESYNC_CLIENT_URL
    process.env.PULSESYNC_ADDONS_DIR = temp
    process.env.PULSESYNC_CLIENT_URL = 'http://127.0.0.1:1'
    t.after(async () => {
        if (oldRoot === undefined) delete process.env.PULSESYNC_ADDONS_DIR
        else process.env.PULSESYNC_ADDONS_DIR = oldRoot
        if (oldUrl === undefined) delete process.env.PULSESYNC_CLIENT_URL
        else process.env.PULSESYNC_CLIENT_URL = oldUrl
        await fs.rm(temp, { recursive: true, force: true })
    })
    const config = { id: 'test-addon', directoryName: 'test-addon' }
    const project = path.join(temp, config.directoryName)
    const build = path.join(project, 'dist', config.directoryName)
    const settings = { enabled: false, newHomeUiVariant: '1', canvasScale: 1.65 }
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, 'src'))
    await fs.mkdir(build, { recursive: true })
    const source = new Uint8Array([1, 2, 3, 4])
    await fs.writeFile(path.join(project, 'src', 'source.bin'), source)
    await fs.writeFile(path.join(project, 'pulsesync.settings.json'), JSON.stringify(settings))
    await fs.writeFile(path.join(project, 'metadata.json'), JSON.stringify({ ...config, installSource: 'local', storeAddonId: 'store-id' }))
    await fs.writeFile(path.join(build, 'metadata.json'), JSON.stringify({
        id: config.id, name: 'Test', type: 'web-addon', script: 'script.js', css: 'script.css',
    }))
    for (const revision of [1, 2]) {
        const script = new Uint8Array([revision, 20, 30])
        const css = new Uint8Array([revision, 40, 50])
        await fs.writeFile(path.join(build, 'script.js'), script)
        await fs.writeFile(path.join(build, 'script.css'), css)
        const result = await deliverAddon(build, config, project)
        assert.equal(result.settingsPreserved, true)
        assert.deepEqual(await fs.readFile(path.join(project, 'script.js')), Buffer.from(script))
        assert.deepEqual(await fs.readFile(path.join(project, 'script.css')), Buffer.from(css))
        assert.deepEqual(await fs.readFile(path.join(project, 'src', 'source.bin')), Buffer.from(source))
        assert.equal((await fs.stat(path.join(project, '.git'))).isDirectory(), true)
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, 'pulsesync.settings.json'), 'utf8')), settings)
        assert.equal(JSON.parse(await fs.readFile(path.join(project, 'metadata.json'), 'utf8')).storeAddonId, 'store-id')
    }
    const external = path.join(temp, 'external-project')
    await fs.mkdir(external)
    await deliverAddon(build, { ...config, directoryName: 'other-addon' }, external)
    assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'other-addon', 'metadata.json'), 'utf8')).id, config.id)
    await assert.rejects(deliverAddon(build, config, path.join(project, 'src')), /containing the source project/)
    await fs.writeFile(path.join(project, 'metadata.json'), JSON.stringify({ id: config.id, installSource: 'store' }))
    await assert.rejects(deliverAddon(build, config, project), /store-managed addon/)
})
