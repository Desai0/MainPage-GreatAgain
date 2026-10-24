import { defineAddon } from '@pulsesync/addon-sdk'

import addonConfig from '../addon.config.mjs'
import { startOldHomeUi } from './runtime.js'
import { settings } from './settings'
import './styles.css'

export default defineAddon({
    id: addonConfig.id,
    name: addonConfig.name,
    settings,
    start: startOldHomeUi,
})
