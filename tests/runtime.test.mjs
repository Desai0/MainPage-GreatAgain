import assert from 'node:assert/strict'
import test from 'node:test'

import { parseHTML } from 'linkedom'

import { startOldHomeUi } from '../src/runtime.js'

test('SDK activation restores Swiper, styles and subscriptions when unloaded', async t => {
    const previous = Object.getOwnPropertyDescriptors(globalThis)
    const { window, document } = parseHTML(`<!doctype html><html><body>
        <div class="CommonLayout_root__test">
            <div id="animation-parent"><div data-test-id="VIBE_ANIMATION" style="display:block">
                <div class="VibeWidgetAnimation_root__7fpeP"><canvas style="transform:rotate(1deg)"></canvas></div>
            </div></div>
            <main data-test-id="MAIN_PAGE"><div class="WheelDesktop_root__test">
                <div class="WheelDesktop_wrapper__test"><div class="WheelDesktop_slide__test">
                    <div class="WheelItem_root__test"></div>
                </div></div>
            </div></main>
            <div data-test-id="PLAYERBAR_DESKTOP"><button data-test-id="PLAY_BUTTON"></button></div>
        </div>
    </body></html>`)
    globalThis.window = window
    globalThis.document = document
    t.after(() => {
        for (const name of ['window', 'document']) {
            if (previous[name]) Object.defineProperty(globalThis, name, previous[name])
            else delete globalThis[name]
        }
    })
    // Linkedom implements CSS declarations but does not model CSS priorities.
    const stylePrototype = Object.getPrototypeOf(document.createElement('div').style)
    if (!stylePrototype.getPropertyPriority) stylePrototype.getPropertyPriority = () => ''
    const wheel = document.querySelector('[class*="WheelDesktop_root"]')
    const wrapper = document.querySelector('[class*="WheelDesktop_wrapper"]')
    const canvas = document.querySelector('canvas')
    const animation = document.querySelector('[data-test-id="VIBE_ANIMATION"]')
    const animationParent = animation.parentNode
    const swiper = {
        params: { noSwiping: false, preventClicks: true, mousewheel: { enabled: true } },
        slideTo() {}, slideToLoop() {}, slideNext() {}, slidePrev() {},
        mousewheel: {
            enabled: true,
            enable() { this.enabled = true },
            disable() { this.enabled = false },
        },
    }
    wheel.swiper = swiper
    const originalParams = structuredClone(swiper.params)
    const originalMethods = [swiper.slideTo, swiper.slideToLoop, swiper.slideNext, swiper.slidePrev]
    let current = { newHomeUiVariant: '1', canvasScale: 1.7, hideVibeAnimation: true }
    const settingsListeners = new Set()
    const subscriptions = new Set()
    const playerListeners = new Set()
    const timers = new Set()
    const cleanups = []
    let controller
    const onCleanup = cleanup => { cleanups.push(cleanup); return cleanup }
    const subscribe = callback => {
        subscriptions.add(callback)
        return () => subscriptions.delete(callback)
    }
    const schedule = callback => {
        timers.add(callback)
        const cancel = () => timers.delete(callback)
        onCleanup(cancel)
        return cancel
    }
    const api = {
        get signal() { return controller.signal },
        settings: {
            getCurrent: () => current,
            onChange: callback => {
                settingsListeners.add(callback)
                return () => settingsListeners.delete(callback)
            },
        },
        player: {
            getSnapshot: async () => ({ isPlaying: false }),
            onChange(callback) {
                playerListeners.add(callback)
                return () => playerListeners.delete(callback)
            },
        },
        router: { onChange: subscribe },
        logger: { warn() {} },
        onCleanup,
        setTimeout: schedule,
        setInterval: schedule,
        listen(target, type, listener, options) {
            target.addEventListener(type, listener, options)
            return onCleanup(() => target.removeEventListener(type, listener, options))
        },
    }
    for (let activation = 0; activation < 2; activation++) {
        controller = new AbortController()
        startOldHomeUi(api)
        await Promise.resolve()
        await Promise.resolve()
        assert.equal(document.querySelectorAll('#ps-vibe-controls').length, 1)
        const button = document.querySelector('[data-test-id="PS_VIBE_PLAY_BUTTON"]')
        for (const isPlaying of [true, false, true, false]) {
            for (const callback of playerListeners) callback({ isPlaying })
            await Promise.resolve()
            assert.equal(button.querySelector('[data-icon-role="play"]').hasAttribute('hidden'), isPlaying)
            assert.equal(button.querySelector('[data-icon-role="pause"]').hasAttribute('hidden'), !isPlaying)
        }
        assert.equal(wheel.classList.contains('ps-custom-wheel-active'), true)
        assert.equal(swiper.mousewheel.enabled, false)
        assert.notEqual(swiper.slideNext, originalMethods[2])
        assert.equal(animation.parentNode, document.querySelector('main'))
        assert.equal(document.body.classList.contains('ps-hide-vibe-animation'), true)
        for (const hidden of [false, true, false, true]) {
            current = { ...current, hideVibeAnimation: hidden }
            for (const callback of settingsListeners) callback(current)
            assert.equal(document.body.classList.contains('ps-hide-vibe-animation'), hidden)
            assert.equal(animation.style.display, 'block')
        }
        assert.equal(document.body.classList.contains('ps-variant-custom'), true)
        current = { ...current, newHomeUiVariant: 'new', hideVibeAnimation: false }
        for (const callback of settingsListeners) callback(current)
        assert.equal(wheel.classList.contains('ps-custom-wheel-active'), false)
        assert.deepEqual(swiper.params, originalParams)
        assert.equal(swiper.mousewheel.enabled, true)
        current = { ...current, newHomeUiVariant: '1', hideVibeAnimation: true }
        for (const callback of settingsListeners) callback(current)
        assert.equal(wrapper.classList.contains('ps-custom-wheel-active'), true)
        controller.abort()
        for (const cleanup of cleanups.splice(0).reverse()) cleanup()
        assert.equal(document.getElementById('ps-vibe-controls'), null)
        assert.equal(document.body.classList.contains('ps-variant-custom'), false)
        assert.equal(document.body.classList.contains('ps-hide-vibe-animation'), false)
        assert.deepEqual(swiper.params, originalParams)
        assert.deepEqual([swiper.slideTo, swiper.slideToLoop, swiper.slideNext, swiper.slidePrev], originalMethods)
        assert.equal(swiper.mousewheel.enabled, true)
        assert.equal(animation.parentNode, animationParent)
        assert.equal(animation.style.display, 'block')
        assert.equal(canvas.style.transform, 'rotate(1deg)')
        assert.equal(settingsListeners.size, 0)
        assert.equal(subscriptions.size, 0)
        assert.equal(playerListeners.size, 0)
        assert.equal(timers.size, 0)
    }
})
