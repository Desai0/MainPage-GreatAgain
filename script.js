(function () {
    var ROOT_ID = "ps-vibe-controls";

    function getSettings() {
        var api = window.pulsesyncApi;
        var store = api && (api.getSettings("YM Old Home UI") || api.getSettings("YandexMusicOldHomeUI"));
        var current = store ? store.getCurrent() : {};
        var val = function (key, fallback) {
            var entry = current[key];
            if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                return entry.value !== undefined ? entry.value : (entry.default !== undefined ? entry.default : fallback);
            }
            return entry !== undefined ? entry : fallback;
        };
        var normalizeVariant = function (v) {
            if (v === "old" || v === "0" || v === 0) return "old";
            if (v === "customWaveWheel" || v === "1" || v === 1) return "customWaveWheel";
            if (v === "new" || v === "2" || v === 2) return "new";
            return null;
        };
        var rawVariant = val("newHomeUiVariant", undefined);
        var variant = normalizeVariant(rawVariant);
        if (!variant) {
            var legacyCustom = val("customWaveWheel", undefined);
            if (legacyCustom !== undefined) {
                variant = legacyCustom ? "customWaveWheel" : "new";
            } else {
                variant = "old";
            }
        }
        return {
            enabled: val("enabled", true),
            newHomeUiVariant: variant,
            customWaveWheel: variant === "customWaveWheel",
            hideVibeAnimation: val("hideVibeAnimation", false),
            canvasBlur: val("canvasBlur", 0),
            canvasSaturate: val("canvasSaturate", 1),
            canvasContrast: val("canvasContrast", 1),
            canvasBrightness: val("canvasBrightness", 1),
            canvasScale: val("canvasScale", 1.2),
            onChange: store ? store.onChange.bind(store) : function () { }
        };
    }

    function getCurrentContext() {
        var ctx = window.sonataState?.currentContext;
        if (ctx && ctx.observableValue) ctx = ctx.observableValue.value;
        if (ctx && ctx.value) ctx = ctx.value;
        return ctx || null;
    }

    function getVibeStationId() {
        var ctx = getCurrentContext();
        if (!ctx) return "";
        return String(
            ctx.contextData?.meta?.session?.wave?.stationId ||
            ctx.contextData?.meta?.id ||
            ctx.contextData?.seeds?.[0] ||
            ""
        ).toLowerCase();
    }

    function isMyWave() {
        return getVibeStationId() === "user:onyourwave";
    }

    function isPlaying() {
        if (window.pulsesyncApi && typeof window.pulsesyncApi.isPlaying === "function") {
            return !!window.pulsesyncApi.isPlaying();
        }
        return false;
    }

    var isWarningClosed = false;

    function createWarningOverlay() {
        var overlay = document.createElement("div");
        overlay.id = "ps-playerbar-warning";
        overlay.className = "ps-warning-overlay";

        var card = document.createElement("div");
        card.className = "ps-warning-card";

        var icon = document.createElement("div");
        icon.className = "ps-warning-icon";
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

        var title = document.createElement("h2");
        title.className = "ps-warning-title";
        title.textContent = "Настройка интерфейса";

        var desc = document.createElement("p");
        desc.className = "ps-warning-desc";
        desc.innerHTML = 'Для корректной работы аддона включите старую панель плеера:<br><br><strong>Настройки → Панель Плеера → Старая панель в новой Волне</strong>';

        var closeBtn = document.createElement("button");
        closeBtn.className = "ps-warning-btn";
        closeBtn.textContent = "Понятно";
        closeBtn.addEventListener("click", function () {
            isWarningClosed = true;
            overlay.classList.add("ps-warning-fadeout");
            setTimeout(function () {
                overlay.remove();
            }, 300);
        });

        card.appendChild(icon);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(closeBtn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }

    var isPlayerBarVerified = false;

    function checkPlayerBar() {
        if (isWarningClosed || isPlayerBarVerified) return;

        var layout = document.querySelector('.CommonLayout_root__WC_W1') || document.querySelector('[class*="CommonLayout_root__"]');
        if (!layout) return;

        var playerBar = layout.querySelector('[data-test-id="PLAYERBAR_DESKTOP"]');
        var warningEl = document.getElementById("ps-playerbar-warning");

        if (!playerBar) {
            if (!warningEl) {
                createWarningOverlay();
            }
        } else {
            isPlayerBarVerified = true;
            if (warningEl) {
                warningEl.remove();
            }
        }
    }

    function syncAttr(el, name, val) {
        if (el && el.getAttribute(name) !== String(val)) {
            el.setAttribute(name, val);
        }
    }

    function syncDataset(el, name, val) {
        if (el && el.dataset[name] !== String(val)) {
            el.dataset[name] = val;
        }
    }

    function createSvg(className, symbolId) {
        var ns = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", className);
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");
        var use = document.createElementNS(ns, "use");
        use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/icons/sprite.svg#" + symbolId);
        svg.appendChild(use);
        return svg;
    }

    function click(el) {
        if (!el) return;
        if (typeof el.click === "function") {
            el.click();
        } else {
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
    }

    function findMyWaveResetControl() {
        var label = document.querySelector('[data-test-id="RESET_VIBE_CONTEXT_STATIC_TEXT"]');
        if (!label) return null;

        return label.closest("button, [role='button'], a") ||
            label.closest('[class*="VibeResetButton_container"]') ||
            label.closest('[class*="VibeResetButton_root"]');
    }

    function findPlayerToggleButton() {
        return document.querySelector(
            isPlaying()
                ? '[data-test-id="PLAYERBAR_DESKTOP"] [data-test-id="PAUSE_BUTTON"], [data-test-id="VIBE_PLAYERBAR"] [data-test-id="PAUSE_BUTTON"]'
                : '[data-test-id="PLAYERBAR_DESKTOP"] [data-test-id="PLAY_BUTTON"], [data-test-id="VIBE_PLAYERBAR"] [data-test-id="PLAY_BUTTON"]'
        );
    }

    async function waitForMyWave(timeoutMs) {
        var startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (isMyWave()) return true;
            await new Promise(function (resolve) { setTimeout(resolve, 100); });
        }
        return isMyWave();
    }

    async function resetCurrentVibeToMyWave() {
        var context = getCurrentContext();
        var sessionController = context?.sessionController;
        var player = window.pulsesyncApi?.playerInstance;

        if (typeof sessionController?.defaultSessionNew !== "function") return false;

        var session = await sessionController.defaultSessionNew();
        var stationId = String(session?.wave?.stationId || "").toLowerCase();
        if (stationId !== "user:onyourwave") return false;

        if (typeof player?.restartContext === "function") {
            await player.restartContext({ playAfterRestart: true });
        } else if (!isPlaying()) {
            click(findPlayerToggleButton());
        }
        return true;
    }

    async function startMyWave() {
        var nav = document.querySelector('[data-test-id="NAVBAR_NAVIGATION_ITEM_HOME"]');
        click(nav);

        if (!isMyWave()) {
            try {
                if (await resetCurrentVibeToMyWave()) return;
            } catch (error) {
                console.debug("[YM Old Home UI] Native My Wave reset failed:", error);
            }

            var resetControl = findMyWaveResetControl();
            click(resetControl);

            if (!await waitForMyWave(500)) {
                if (typeof window.pulsesyncApi?.playVibe === "function") {
                    window.pulsesyncApi.playVibe({ screen: "landing" });
                }
                await waitForMyWave(500);
            }
        }

        if (!isMyWave()) {
            var trigger = Array.from(document.querySelectorAll("button")).find(function (button) {
                if (button.dataset.testId === "PS_VIBE_PLAY_BUTTON") return false;
                return /(?:включить|запустить)\s+мою\s+волну/i.test(button.getAttribute("aria-label") || "");
            });
            click(trigger);
            await waitForMyWave(800);
        }

        if (isMyWave() && !isPlaying()) {
            click(findPlayerToggleButton());
        }
    }

    async function toggleMyWave() {
        if (isMyWave()) {
            click(findPlayerToggleButton());
            return;
        }

        await startMyWave();
    }

    function openNativeVibeSettings() {
        var target = document.querySelector('[data-test-id="WHEEL_SETTING_ITEM"]') ||
            document.querySelector('[data-swiper-slide-index="1"] [role="button"]') ||
            document.querySelector('[data-swiper-slide-index="1"]');
        if (target) {
            click(target);
            return true;
        }
        return false;
    }

    function closeSettings() {
        settingsOpen = false;
        document.body.classList.remove("ps-settings-open");
        var root = document.getElementById(ROOT_ID);
        if (root) root.classList.remove("ps-settings-open");
        var wheel = document.querySelector(".VibePage_wheel__E_p8_");
        if (wheel) wheel.classList.remove("ps-VibePage_wheel__E_p8_-hidden-right");
    }

    function toggleSettings() {
        settingsOpen = !settingsOpen;
        document.body.classList.toggle("ps-settings-open", settingsOpen);
        var root = document.getElementById(ROOT_ID);
        if (root) root.classList.toggle("ps-settings-open", settingsOpen);
        var wheel = document.querySelector(".VibePage_wheel__E_p8_");
        if (wheel) wheel.classList.toggle("ps-VibePage_wheel__E_p8_-hidden-right", settingsOpen);
    }

    function syncVibeAnimation(shouldHide) {
        var nodes = document.querySelectorAll('[data-test-id="VIBE_ANIMATION"]');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].style.display = shouldHide ? "none" : "";
        }
    }

    function syncCanvasFilter(settings) {
        var canvases = document.querySelectorAll(".VibeWidgetAnimation_root__7fpeP canvas");
        var isDefaultFilter = (
            settings.canvasBlur === 0 &&
            settings.canvasSaturate === 1 &&
            settings.canvasContrast === 1 &&
            settings.canvasBrightness === 1
        );
        var filter = isDefaultFilter
            ? null
            : "blur(" + settings.canvasBlur + "px) saturate(" + settings.canvasSaturate + ") contrast(" + settings.canvasContrast + ") brightness(" + settings.canvasBrightness + ")";
        var transform = "scale(" + settings.canvasScale + ")";
        for (var i = 0; i < canvases.length; i++) {
            if (filter) {
                canvases[i].style.setProperty("filter", filter, "important");
            } else {
                canvases[i].style.removeProperty("filter");
            }
            canvases[i].style.setProperty("transform", transform, "important");
            canvases[i].style.transformOrigin = "center center";
        }
    }

    function throttle(fn, delay) {
        var timer = null;
        var lastCall = 0;
        return function (...args) {
            var now = Date.now();
            var remaining = delay - (now - lastCall);
            clearTimeout(timer);
            if (remaining <= 0) {
                lastCall = now;
                fn.apply(this, args);
            } else {
                timer = setTimeout(() => {
                    lastCall = Date.now();
                    fn.apply(this, args);
                }, remaining);
            }
        };
    }

    class BaseControl {
        constructor(className, testId, label) {
            this.className = className;
            this.testId = testId;
            this.label = label;
            this.element = this.createBaseButton();
        }

        createBaseButton() {
            var btn = document.createElement("button");
            btn.className = this.className;
            btn.type = "button";
            btn.dataset.testId = this.testId;
            btn.setAttribute("aria-label", this.label);
            return btn;
        }
    }

    class PlayButton extends BaseControl {
        constructor(onClick) {
            super(
                "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C PlayButton_root__nYKdN VibeBlock_playButton__6xU55 ps-vibe-play-button",
                "PS_VIBE_PLAY_BUTTON",
                "Моя волна"
            );
            this.onClick = onClick;
            this.init();
        }

        init() {
            var iconWrap = document.createElement("span");
            iconWrap.className = "JjlbHZ4FaP9EAcR_1DxF ps-vibe-icon-wrap";

            var playIcon = createSvg("J9wTKytjOWG73QMoN5WP elJfazUBui03YWZgHCbW PlayButton_icon__t_THQ DzJFnuf7XgdkFh28JAsM ps-vibe-play-glyph", "playVibe_s");
            playIcon.dataset.iconRole = "play";
            iconWrap.appendChild(playIcon);

            var pauseIcon = document.createElement("span");
            pauseIcon.className = "PlayButton_icon__t_THQ DzJFnuf7XgdkFh28JAsM ps-vibe-pause-glyph";
            pauseIcon.dataset.iconRole = "pause";
            pauseIcon.setAttribute("aria-hidden", "true");

            var pauseBarLeft = document.createElement("span");
            pauseBarLeft.className = "ps-vibe-pause-bar";
            var pauseBarRight = document.createElement("span");
            pauseBarRight.className = "ps-vibe-pause-bar";
            pauseIcon.appendChild(pauseBarLeft);
            pauseIcon.appendChild(pauseBarRight);
            iconWrap.appendChild(pauseIcon);
            this.element.appendChild(iconWrap);

            var labelSpan = document.createElement("span");
            labelSpan.className = "ps-vibe-button-label";
            labelSpan.textContent = "Моя волна";
            this.element.appendChild(labelSpan);

            this.element.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.onClick();
            });
        }

        syncState(active, playing) {
            syncDataset(this.element, "state", active ? (playing ? "pause" : "resume") : "start");
            syncAttr(this.element, "aria-label", active ? (playing ? "Пауза Моей волны" : "Продолжить Мою волну") : "Запустить Мою волну");

            var playGlyph = this.element.querySelector('[data-icon-role="play"]');
            var pauseGlyph = this.element.querySelector('[data-icon-role="pause"]');
            var showPause = active && playing;

            if (playGlyph) {
                playGlyph.setAttribute("aria-hidden", showPause ? "true" : "false");
                playGlyph.style.display = showPause ? "none" : "";
            }
            if (pauseGlyph) {
                pauseGlyph.setAttribute("aria-hidden", showPause ? "false" : "true");
                pauseGlyph.style.display = showPause ? "inline-flex" : "none";
            }
        }
    }

    class SettingsButton extends BaseControl {
        constructor(onClick) {
            super(
                "cpeagBA1_PblpJn8Xgtv iJVAJMgccD4vj4E4o068 zIMibMuH7wcqUoW7KH1B IlG7b1K0AD7E7AMx6F5p nHWc2sto1C6Gm0Dpw_l0 C_QGmfTz6UFX93vfPt6Z qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C VibeSettings_toggleSettingsButton__j6fIU ps-vibe-settings-button",
                "PS_VIBE_SETTINGS_BUTTON",
                "Настроить Мою волну"
            );
            this.onClick = onClick;
            this.init();
        }

        init() {
            this.element.setAttribute("aria-haspopup", "dialog");
            this.element.setAttribute("aria-live", "off");
            this.element.setAttribute("aria-busy", "false");

            var content = document.createElement("span");
            content.className = "JjlbHZ4FaP9EAcR_1DxF";
            content.appendChild(createSvg("J9wTKytjOWG73QMoN5WP elJfazUBui03YWZgHCbW l3tE1hAMmBj2aoPPwU08", "filter_xxs"));

            var labelSpan = document.createElement("span");
            labelSpan.className = "ps-vibe-settings-label";
            labelSpan.textContent = "Настроить";
            content.appendChild(labelSpan);
            this.element.appendChild(content);

            this.element.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                var settings = getSettings();
                if (settings.newHomeUiVariant === "old") {
                    openNativeVibeSettings();
                } else {
                    this.onClick();
                }
            });
        }
    }

    class VibeGridManager {
        constructor() {
            this.hasScrollListener = false;
            this.hasClickListener = false;
            this.activeSlides = [];
            this.allSlides = [];
        }

        sync(host, customWaveWheelEnabled) {
            var wrapper = host.querySelector('[class*="WheelDesktop_wrapper"]');
            if (!wrapper) return;

            var root = wrapper.parentElement;
            if (!root) return;

            if (!customWaveWheelEnabled) {
                // Выключаем весь кастомный функционал, восстанавливаем исходное состояние колеса
                root.classList.remove("ps-custom-wheel-active");
                wrapper.classList.remove("ps-custom-wheel-active");

                root.classList.remove("swiper-no-swiping");
                wrapper.classList.remove("swiper-no-swiping");

                var slides = wrapper.querySelectorAll('[class*="WheelDesktop_slide"]');
                for (var i = 0; i < slides.length; i++) {
                    slides[i].classList.remove("swiper-no-swiping");
                }

                var cards = wrapper.querySelectorAll('[class*="WheelItem_root"]');
                for (var j = 0; j < cards.length; j++) {
                    cards[j].classList.remove("swiper-no-swiping");
                }

                var sw = root.swiper || wrapper.swiper;
                if (sw) {
                    try {
                        if (sw.slideTo && sw.slideTo.isOverridden) {
                            sw.slideTo = sw.slideTo.originalMethod;
                        }
                        if (sw.slideToLoop && sw.slideToLoop.isOverridden) {
                            sw.slideToLoop = sw.slideToLoop.originalMethod;
                        }
                        if (sw.slideNext && sw.slideNext.originalMethod) {
                            sw.slideNext = sw.slideNext.originalMethod;
                        }
                        if (sw.slidePrev && sw.slidePrev.originalMethod) {
                            sw.slidePrev = sw.slidePrev.originalMethod;
                        }
                        if (sw.mousewheel && typeof sw.mousewheel.enable === "function") {
                            sw.mousewheel.enable();
                        }
                        if (sw.params) {
                            sw.params.noSwiping = false;
                            sw.params.allowSlideNext = true;
                            sw.params.allowSlidePrev = true;
                        }
                    } catch (e) {
                        // Игнорируем ошибки восстановления
                    }
                }
                return;
            }

            // Включаем кастомный функционал
            root.classList.add("ps-custom-wheel-active");
            wrapper.classList.add("ps-custom-wheel-active");

            // Кешируем список слайдов для избежания повторных querySelector-запросов при каждом скролле и клике
            this.activeSlides = Array.from(wrapper.querySelectorAll('[class*="WheelDesktop_slide"]:not([class*="swiper-slide-duplicate"])'));
            this.allSlides = Array.from(wrapper.querySelectorAll('[class*="WheelDesktop_slide"]'));

            this.configureSwiper(root, wrapper);
            this.attachInterceptors(root, wrapper);
            this.calibrateSwiping(wrapper);
        }

        configureSwiper(root, wrapper) {
            var sw = root.swiper || wrapper.swiper;
            if (!sw) return;

            try {
                if (sw.params) {
                    sw.params.slideToClickedSlide = true;
                    sw.params.preventClicks = false;
                    sw.params.preventClicksPropagation = false;
                    sw.params.noSwiping = true;
                    sw.params.noSwipingClass = "swiper-no-swiping";
                    sw.params.allowSlideNext = false;
                    sw.params.allowSlidePrev = false;
                    if (sw.params.mousewheel) {
                        sw.params.mousewheel.enabled = false;
                    }
                }

                if (sw.slideTo && !sw.slideTo.isOverridden) {
                    var originalSlideTo = sw.slideTo;
                    sw.slideTo = function (index, speed, runCallbacks, internal) {
                        return originalSlideTo.call(sw, index, 0, runCallbacks, internal);
                    };
                    sw.slideTo.isOverridden = true;
                    sw.slideTo.originalMethod = originalSlideTo;
                }

                if (sw.slideToLoop && !sw.slideToLoop.isOverridden) {
                    var originalSlideToLoop = sw.slideToLoop;
                    sw.slideToLoop = function (index, speed, runCallbacks, internal) {
                        return originalSlideToLoop.call(sw, index, 0, runCallbacks, internal);
                    };
                    sw.slideToLoop.isOverridden = true;
                    sw.slideToLoop.originalMethod = originalSlideToLoop;
                }

                if (sw.slideNext && !sw.slideNext.originalMethod) {
                    var originalSlideNext = sw.slideNext;
                    sw.slideNext = function () { };
                    sw.slideNext.originalMethod = originalSlideNext;
                }
                if (sw.slidePrev && !sw.slidePrev.originalMethod) {
                    var originalSlidePrev = sw.slidePrev;
                    sw.slidePrev = function () { };
                    sw.slidePrev.originalMethod = originalSlidePrev;
                }

                if (sw.mousewheel && typeof sw.mousewheel.disable === "function") {
                    sw.mousewheel.disable();
                }
            } catch (e) {
                // Игнорируем ошибки Swiper
            }
        }

        attachInterceptors(root, wrapper) {
            if (!wrapper.hasClickListener) {
                var intercept = (e) => {
                    var sw = root.swiper || wrapper.swiper;
                    if (!sw) return;

                    var card = e.target.closest('[class*="WheelItem_root"]');
                    if (card) {
                        var slide = card.closest('[class*="WheelDesktop_slide"]');
                        if (slide) {
                            var index = this.allSlides.indexOf(slide);
                            if (index !== -1 && sw.activeIndex !== index) {
                                try {
                                    var originalSlideTo = (sw.slideTo && sw.slideTo.originalMethod) || sw.slideTo;
                                    if (typeof originalSlideTo === "function") {
                                        originalSlideTo.call(sw, index, 0, true, true);
                                    }
                                } catch (err) { }
                            }
                        }
                    }
                };

                wrapper.addEventListener('click', intercept, { capture: true });
                wrapper.addEventListener('mousedown', intercept, { capture: true });
                wrapper.addEventListener('touchstart', intercept, { capture: true });
                wrapper.hasClickListener = true;
            }

            if (!root.hasScrollListener) {
                // Дросселируем (throttle) обработку скролла до одного вызова в 60мс (около 16 кадров/сек),
                // чтобы полностью предотвратить лаги и layout thrashing при быстром скролле.
                var handleScroll = throttle(() => {
                    var sw = root.swiper || wrapper.swiper;
                    if (!sw) return;

                    var slides = this.activeSlides;
                    if (!slides || slides.length === 0) return;

                    var containerRect = root.getBoundingClientRect();
                    var containerCenter = containerRect.top + containerRect.height / 2;

                    var closestSlide = null;
                    var minDistance = Infinity;

                    slides.forEach((slide) => {
                        var rect = slide.getBoundingClientRect();
                        var slideCenter = rect.top + rect.height / 2;
                        var distance = Math.abs(slideCenter - containerCenter);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestSlide = slide;
                        }
                    });

                    if (closestSlide) {
                        var swiperIndex = this.allSlides.indexOf(closestSlide);
                        if (swiperIndex !== -1 && sw.activeIndex !== swiperIndex) {
                            try {
                                var originalSlideTo = (sw.slideTo && sw.slideTo.originalMethod) || sw.slideTo;
                                if (typeof originalSlideTo === "function") {
                                    originalSlideTo.call(sw, swiperIndex, 0, true, true);
                                }
                            } catch (err) { }
                        }
                    }
                }, 60);

                root.addEventListener('scroll', handleScroll, { passive: true });
                root.hasScrollListener = true;
            }
        }

        calibrateSwiping(wrapper) {
            var uncalibratedSlides = wrapper.querySelectorAll('[class*="WheelDesktop_slide"]:not(.swiper-no-swiping)');
            for (var i = 0; i < uncalibratedSlides.length; i++) {
                uncalibratedSlides[i].classList.add("swiper-no-swiping");
            }

            var uncalibratedCards = wrapper.querySelectorAll('[class*="WheelItem_root"]:not(.swiper-no-swiping)');
            for (var j = 0; j < uncalibratedCards.length; j++) {
                uncalibratedCards[j].classList.add("swiper-no-swiping");
            }
        }
    }

    function createStatusNode() {
        var node = document.createElement("div");
        node.className = "ps-vibe-status";
        node.dataset.testId = "PS_VIBE_STATUS";
        return node;
    }

    var playBtn = null;
    var settingsBtn = null;
    var settingsOpen = false;
    var gridManager = new VibeGridManager();

    function ensureRoot(host) {
        var root = host.querySelector("#" + ROOT_ID);
        if (root) return root;

        root = document.createElement("div");
        root.id = ROOT_ID;
        root.className = "ps-vibe-controls";

        var header = document.createElement("div");
        header.className = "ps-vibe-header";

        var title = document.createElement("div");
        title.className = "ps-vibe-title";
        title.textContent = "Restore My Wave";

        var subtitle = document.createElement("div");
        subtitle.className = "ps-vibe-subtitle";
        subtitle.textContent = "Запуск через nav-item и VibeWidgetResetButton";

        header.appendChild(title);
        header.appendChild(subtitle);
        root.appendChild(header);

        playBtn = new PlayButton(() => toggleMyWave().catch(console.error));
        settingsBtn = new SettingsButton(() => toggleSettings());

        root.appendChild(playBtn.element);
        root.appendChild(settingsBtn.element);
        root.appendChild(createStatusNode());

        host.appendChild(root);

        // Восстанавливаем состояние настроек после пересоздания элемента
        // (React мог уничтожить его при переходе между страницами)
        if (settingsOpen) {
            root.classList.add("ps-settings-open");
            document.body.classList.add("ps-settings-open");
            var wheel = document.querySelector(".VibePage_wheel__E_p8_");
            if (wheel) wheel.classList.add("ps-VibePage_wheel__E_p8_-hidden-right");
        }

        return root;
    }

    function syncUi(root) {
        if (playBtn) {
            var active = isMyWave();
            var playing = isPlaying();
            playBtn.syncState(active, playing);
        }
    }

    function mount() {
        if (typeof document === "undefined" || typeof window === "undefined") return;

        var store = getSettings();

        var lastState = {
            enabled: null,
            newHomeUiVariant: null,
            customWaveWheel: null,
            hideVibeAnimation: null,
            canvasBlur: null,
            canvasSaturate: null,
            canvasContrast: null,
            canvasBrightness: null,
            canvasScale: null,
            active: null,
            playing: null,
            wrapper: null,
            firstSlide: null,
            slidesCount: 0
        };

        function update() {
            var settings = getSettings();
            checkPlayerBar();

            var host = document.querySelector('[data-test-id="MAIN_PAGE"]');
            if (!host) return;

            var vibe = document.querySelector('[data-test-id="VIBE_ANIMATION"]');
            if (vibe && vibe.parentElement !== host) {
                host.insertBefore(vibe, host.firstChild);
            }

            var wrapper = host.querySelector('[class*="WheelDesktop_wrapper"]');
            var firstSlide = wrapper ? wrapper.querySelector('[class*="WheelDesktop_slide"]') : null;
            var slidesCount = wrapper ? wrapper.querySelectorAll('[class*="WheelDesktop_slide"]').length : 0;

            var active = isMyWave();
            var playing = isPlaying();
            var rootExists = !!host.querySelector("#" + ROOT_ID);

            if (
                rootExists &&
                lastState.enabled === settings.enabled &&
                lastState.newHomeUiVariant === settings.newHomeUiVariant &&
                lastState.customWaveWheel === settings.customWaveWheel &&
                lastState.hideVibeAnimation === settings.hideVibeAnimation &&
                lastState.canvasBlur === settings.canvasBlur &&
                lastState.canvasSaturate === settings.canvasSaturate &&
                lastState.canvasContrast === settings.canvasContrast &&
                lastState.canvasBrightness === settings.canvasBrightness &&
                lastState.canvasScale === settings.canvasScale &&
                lastState.active === active &&
                lastState.playing === playing &&
                lastState.wrapper === wrapper &&
                lastState.firstSlide === firstSlide &&
                lastState.slidesCount === slidesCount
            ) {
                return;
            }

            lastState.enabled = settings.enabled;
            lastState.newHomeUiVariant = settings.newHomeUiVariant;
            lastState.customWaveWheel = settings.customWaveWheel;
            lastState.hideVibeAnimation = settings.hideVibeAnimation;
            lastState.canvasBlur = settings.canvasBlur;
            lastState.canvasSaturate = settings.canvasSaturate;
            lastState.canvasContrast = settings.canvasContrast;
            lastState.canvasBrightness = settings.canvasBrightness;
            lastState.canvasScale = settings.canvasScale;
            lastState.active = active;
            lastState.playing = playing;
            lastState.wrapper = wrapper;
            lastState.firstSlide = firstSlide;
            lastState.slidesCount = slidesCount;

            document.body.classList.toggle("ps-variant-old", settings.newHomeUiVariant === "old");
            document.body.classList.toggle("ps-variant-custom", settings.newHomeUiVariant === "customWaveWheel");
            document.body.classList.toggle("ps-variant-new", settings.newHomeUiVariant === "new");

            if (settings.newHomeUiVariant === "old" && settingsOpen) {
                closeSettings();
            }

            gridManager.sync(host, settings.customWaveWheel);

            syncVibeAnimation(settings.hideVibeAnimation);
            syncCanvasFilter(settings);

            var root = ensureRoot(host);
            root.hidden = !settings.enabled;

            if (settings.enabled) {
                syncUi(root);
            }
        }

        document.addEventListener("play", function () { setTimeout(update, 50); }, true);
        document.addEventListener("pause", function () { setTimeout(update, 50); }, true);

        var patchState = function (type) {
            var orig = history[type];
            return function () {
                var rv = orig.apply(this, arguments);
                setTimeout(update, 100);
                return rv;
            };
        };
        history.pushState = patchState("pushState");
        history.replaceState = patchState("replaceState");
        window.addEventListener("popstate", function () { setTimeout(update, 100); });

        update();
        store.onChange(update);
        setInterval(update, 250);
    }

    mount();
})();
