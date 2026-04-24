(function() {
    var addonConfig = {
        name: "YandexMusicOldHomeUI"
    };

    var ROOT_ID = "ps-vibe-controls";
    var MAIN_PAGE_TEST_ID = "MAIN_PAGE";
    var NAV_VIBE_TEST_ID = "NAVBAR_NAVIGATION_ITEM_HOME";
    var PLAYERBAR_TEST_ID = "PLAYERBAR_DESKTOP";
    var PLAYER_PLAY_TEST_ID = "PLAY_BUTTON";
    var PLAYER_PAUSE_TEST_ID = "PAUSE_BUTTON";
    var VIBE_ANIMATION_TEST_ID = "VIBE_ANIMATION";
    var SWIPER_HIDDEN_CLASS = "ps-swiper-hidden-right";
    var SWIPER_LAYOUT_SHIFT_CLASS = "ps-swiper-layout-shifted";
    var SHIFTED_LAYOUT_OFFSET_PX = 0;
    var LAYOUT_RESYNC_DELAY_MS = 180;
    var UI_REFRESH_INTERVAL_MS = 250;
    var VIBE_TRIGGER_ARIA_RE = /включить мою волну/i;
    var LOG_PREFIX = "[test_addon]";
    var pendingLayoutResyncTimer = 0;

    function unwrapSetting(entry, fallback) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            if (typeof entry.value !== "undefined") return entry.value;
            if (typeof entry.default !== "undefined") return entry.default;
        }
        return typeof entry !== "undefined" ? entry : fallback;
    }

    function getAddonSettings(addonName) {
        return window.pulsesyncApi?.getSettings(addonName) ?? {
            getCurrent: function() {
                return {};
            },
            onChange: function() {
                return function() {};
            }
        };
    }

    function readBooleanSetting(settings, key, fallback) {
        return Boolean(unwrapSetting(settings[key], fallback));
    }

    function logError(message, error) {
        try {
            console.error(LOG_PREFIX + " " + message, error?.message || error || "");
        } catch {}
    }

    function safeRun(fn, fallback, label) {
        try {
            return fn();
        } catch (error) {
            if (label) logError(label, error);
            return fallback;
        }
    }

    function unwrapObservable(value) {
        if (value && typeof value === "object" && value.observableValue) {
            return value.observableValue.value;
        }
        if (value && typeof value === "object" && "value" in value) {
            return value.value;
        }
        return value;
    }

    function getCurrentContext() {
        try {
            return unwrapObservable(window.sonataState?.currentContext);
        } catch {
            return null;
        }
    }

    function isMyWaveContext() {
        var ctx = getCurrentContext();
        if (!ctx) return false;
        if (String(ctx.type || "").toLowerCase() === "vibe") return true;
        if (String(ctx.contextData?.type || "").toLowerCase() === "vibe") return true;
        if (ctx.isVibeStarted === true) return true;
        if (ctx.rotorResource != null) return true;
        return false;
    }

    function isPlaying() {
        return safeRun(function() {
            return !!document.querySelector('[data-test-id="' + PLAYER_PAUSE_TEST_ID + '"]');
        }, false, "Failed to read playing state");
    }

    function createSvg(className, symbolId) {
        var ns = "http://www.w3.org/2000/svg";
        var xlinkNs = "http://www.w3.org/1999/xlink";
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", className);
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");
        var use = document.createElementNS(ns, "use");
        use.setAttributeNS(xlinkNs, "xlink:href", "/icons/sprite.svg#" + symbolId);
        svg.appendChild(use);
        return svg;
    }

    function dispatchClick(element) {
        if (!element) return false;
        return safeRun(function() {
            if (typeof element.click === "function") {
                element.click();
                return true;
            }
            if (typeof PointerEvent === "function") {
                element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
            }
            element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            if (typeof PointerEvent === "function") {
                element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
            }
            element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
            element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return true;
        }, false, "Failed to dispatch click");
    }

    function sleep(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    function waitFor(getter, timeoutMs, stepMs) {
        return new Promise(function(resolve) {
            var startedAt = Date.now();

            function tick() {
                var value = safeRun(getter, null, "waitFor getter failed");
                if (value) {
                    resolve(value);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(null);
                    return;
                }
                setTimeout(tick, stepMs);
            }

            tick();
        });
    }

    function findMainPage() {
        return safeRun(function() {
            var page = document.querySelector('[data-test-id="' + MAIN_PAGE_TEST_ID + '"]');
            return page instanceof HTMLElement ? page : null;
        }, null, "Failed to find main page");
    }

    function findSwiperBlock() {
        return safeRun(function() {
            var swiper = document.querySelector(".swiper");
            return swiper instanceof HTMLElement ? swiper : null;
        }, null, "Failed to find swiper block");
    }

    function isSwiperHidden() {
        return safeRun(function() {
            var swiper = findSwiperBlock();
            return !!(swiper && swiper.classList.contains(SWIPER_HIDDEN_CLASS));
        }, false, "Failed to read swiper state");
    }

    function syncSwiperLayoutState(root) {
        safeRun(function() {
            var shifted = isSwiperHidden();
            var mainPage = findMainPage();
            var nodes = document.querySelectorAll('[data-test-id="' + VIBE_ANIMATION_TEST_ID + '"]');

            if (mainPage) {
                mainPage.classList.toggle(SWIPER_LAYOUT_SHIFT_CLASS, shifted);
            }
            if (root instanceof HTMLElement) {
                root.classList.toggle(SWIPER_LAYOUT_SHIFT_CLASS, shifted);
            }

            for (var i = 0; i < nodes.length; i += 1) {
                var node = nodes[i];
                if (!(node instanceof HTMLElement)) continue;
                node.classList.toggle(SWIPER_LAYOUT_SHIFT_CLASS, shifted);
            }

            syncPinnedOffsets(root, mainPage, shifted, nodes);
        }, null, "Failed to sync swiper layout state");
    }

    function syncPinnedOffsets(root, host, shifted, vibeNodes) {
        safeRun(function() {
            if (!(root instanceof HTMLElement) || !(host instanceof HTMLElement)) return;

            root.style.removeProperty("--ps-root-left");
            root.style.removeProperty("--ps-root-shift");

            if (!shifted) return;

            var hostRect = host.getBoundingClientRect();
            var targetNode = null;

            for (var i = 0; i < vibeNodes.length; i += 1) {
                var node = vibeNodes[i];
                if (!(node instanceof HTMLElement)) continue;
                var rect = node.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    targetNode = node;
                    break;
                }
            }

            if (!targetNode) {
                root.style.setProperty("--ps-root-left", "50%");
                root.style.setProperty("--ps-root-shift", SHIFTED_LAYOUT_OFFSET_PX + "px");
                return;
            }

            var vibeRect = targetNode.getBoundingClientRect();
            var targetCenter = vibeRect.left - hostRect.left + (vibeRect.width / 2) + SHIFTED_LAYOUT_OFFSET_PX;
            var horizontalPadding = 24;
            var rootWidth = Math.min(328, Math.max(0, hostRect.width - horizontalPadding));
            var minCenter = rootWidth / 2 + 12;
            var maxCenter = hostRect.width - rootWidth / 2 - 12;
            var clampedCenter = Math.max(minCenter, Math.min(maxCenter, targetCenter));

            root.style.setProperty("--ps-root-left", clampedCenter + "px");
            root.style.setProperty("--ps-root-shift", "0px");
        }, null, "Failed to sync pinned offsets");
    }

    function toggleSwiperBlock() {
        return safeRun(function() {
            var swiper = findSwiperBlock();
            if (!swiper) return false;
            swiper.classList.toggle(SWIPER_HIDDEN_CLASS);
            scheduleLayoutResync(document.getElementById(ROOT_ID));
            return true;
        }, false, "Failed to toggle swiper block");
    }

    function scheduleLayoutResync(root) {
        safeRun(function() {
            var currentRoot = root instanceof HTMLElement ? root : document.getElementById(ROOT_ID);
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(function() {
                    syncSwiperLayoutState(currentRoot);
                    window.requestAnimationFrame(function() {
                        syncSwiperLayoutState(currentRoot);
                    });
                });
            } else {
                syncSwiperLayoutState(currentRoot);
            }

            if (pendingLayoutResyncTimer) {
                clearTimeout(pendingLayoutResyncTimer);
            }
            pendingLayoutResyncTimer = setTimeout(function() {
                syncSwiperLayoutState(currentRoot);
                pendingLayoutResyncTimer = 0;
            }, LAYOUT_RESYNC_DELAY_MS);
        }, null, "Failed to schedule layout resync");
    }

    function findMyWaveNavButton() {
        return safeRun(function() {
            var nav = document.querySelector('[data-test-id="' + NAV_VIBE_TEST_ID + '"]');
            return nav instanceof HTMLElement ? nav : null;
        }, null, "Failed to find My Wave nav button");
    }

    function findMyWaveTrigger() {
        return safeRun(function() {
            var buttons = document.querySelectorAll("button");
            for (var i = 0; i < buttons.length; i += 1) {
                var button = buttons[i];
                if (!(button instanceof HTMLButtonElement)) continue;
                var aria = button.getAttribute("aria-label") || "";
                if (VIBE_TRIGGER_ARIA_RE.test(aria)) return button;
            }
            return null;
        }, null, "Failed to find My Wave trigger");
    }

    function findPlayerBarRoot() {
        return safeRun(function() {
            var playerBar = document.querySelector('[data-test-id="' + PLAYERBAR_TEST_ID + '"]');
            return playerBar instanceof HTMLElement ? playerBar : null;
        }, null, "Failed to find player bar");
    }

    function findPlayerPlayButton(root) {
        return safeRun(function() {
            var selector = '[data-test-id="' + PLAYER_PLAY_TEST_ID + '"]';
            var playerBar = findPlayerBarRoot();
            var playerBarScoped = playerBar ? playerBar.querySelector(selector) : null;
            if (playerBarScoped instanceof HTMLButtonElement) return playerBarScoped;

            var scoped = root ? root.querySelector(selector) : null;
            if (scoped instanceof HTMLButtonElement) return scoped;

            var buttons = document.querySelectorAll(selector);
            for (var i = 0; i < buttons.length; i += 1) {
                var button = buttons[i];
                if (!(button instanceof HTMLButtonElement)) continue;
                if (root && root.contains(button)) continue;
                return button;
            }
            return null;
        }, null, "Failed to find play button");
    }

    function findPlayerPauseButton(root) {
        return safeRun(function() {
            var selector = '[data-test-id="' + PLAYER_PAUSE_TEST_ID + '"]';
            var playerBar = findPlayerBarRoot();
            var playerBarScoped = playerBar ? playerBar.querySelector(selector) : null;
            if (playerBarScoped instanceof HTMLButtonElement) return playerBarScoped;

            var scoped = root ? root.querySelector(selector) : null;
            if (scoped instanceof HTMLButtonElement) return scoped;

            var buttons = document.querySelectorAll(selector);
            for (var i = 0; i < buttons.length; i += 1) {
                var button = buttons[i];
                if (!(button instanceof HTMLButtonElement)) continue;
                if (root && root.contains(button)) continue;
                return button;
            }
            return null;
        }, null, "Failed to find pause button");
    }

    function cleanupVibeMeta() {
        return;
    }

    function syncVibeAnimation(shouldHide) {
        safeRun(function() {
            var nodes = document.querySelectorAll('[data-test-id="' + VIBE_ANIMATION_TEST_ID + '"]');
            for (var i = 0; i < nodes.length; i += 1) {
                var node = nodes[i];
                if (!(node instanceof HTMLElement)) continue;
                node.classList.toggle("ps-vibe-animation-hidden", Boolean(shouldHide));
                node.style.removeProperty("display");
            }
        }, null, "Failed to sync vibe animation");
    }

    async function ensureMyWaveScreen() {
        var nav = findMyWaveNavButton();
        if (!nav) return false;
        dispatchClick(nav);
        await sleep(500);
        return true;
    }

    async function startMyWave() {
        if (isMyWaveContext()) {
            if (!isPlaying()) {
                var playButton = findPlayerPlayButton();
                if (playButton) return dispatchClick(playButton);
            }
            return true;
        }

        await ensureMyWaveScreen();

        var trigger = findMyWaveTrigger();
        if (!trigger) {
            trigger = await waitFor(findMyWaveTrigger, 5000, 120);
        }
        if (!trigger) return false;

        dispatchClick(trigger);
        await sleep(800);
        return isMyWaveContext();
    }

    async function pauseMyWave() {
        if (!isMyWaveContext()) return false;
        if (!isPlaying()) return true;
        var pauseButton = findPlayerPauseButton();
        return pauseButton ? dispatchClick(pauseButton) : false;
    }

    async function toggleMyWave() {
        if (isMyWaveContext()) {
            if (isPlaying()) return pauseMyWave();

            var playButton = findPlayerPlayButton();
            return playButton ? dispatchClick(playButton) : false;
        }

        return startMyWave();
    }

    function createPlayButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C PlayButton_root__nYKdN VibeBlock_playButton__6xU55 ps-vibe-play-button";
        button.type = "button";
        button.dataset.testId = "PS_VIBE_PLAY_BUTTON";
        button.setAttribute("aria-label", "Моя волна");
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");

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

        var label = document.createElement("span");
        label.className = "ps-vibe-button-label";
        label.textContent = "Моя волна";

        button.appendChild(iconWrap);
        button.appendChild(label);

        button.addEventListener("click", function(event) {
            event.preventDefault();
            event.stopPropagation();
            toggleMyWave().catch(function(error) {
                logError("Failed to toggle My Wave", error);
            });
        });

        return button;
    }

    function createSettingsButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv iJVAJMgccD4vj4E4o068 zIMibMuH7wcqUoW7KH1B IlG7b1K0AD7E7AMx6F5p nHWc2sto1C6Gm0Dpw_l0 C_QGmfTz6UFX93vfPt6Z qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C VibeSettings_toggleSettingsButton__j6fIU ps-vibe-settings-button";
        button.type = "button";
        button.dataset.testId = "PS_VIBE_SETTINGS_BUTTON";
        button.setAttribute("aria-label", "Настроить Мою волну");
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");

        var content = document.createElement("span");
        content.className = "JjlbHZ4FaP9EAcR_1DxF";
        content.appendChild(createSvg("J9wTKytjOWG73QMoN5WP elJfazUBui03YWZgHCbW l3tE1hAMmBj2aoPPwU08", "filter_xxs"));

        var label = document.createElement("span");
        label.className = "ps-vibe-settings-label";
        label.textContent = "Настроить";
        content.appendChild(label);

        button.appendChild(content);
        button.addEventListener("click", function(event) {
            event.preventDefault();
            event.stopPropagation();
            toggleSwiperBlock();
        });

        return button;
    }

    function createStatusNode() {
        var node = document.createElement("div");
        node.className = "ps-vibe-status";
        node.dataset.testId = "PS_VIBE_STATUS";
        return node;
    }

    function ensureRoot(host) {
        var existing = host.querySelector("#" + ROOT_ID);
        if (existing instanceof HTMLDivElement) return existing;

        if (!host.style.position) {
            host.style.position = "relative";
        }

        var root = document.createElement("div");
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
        root.appendChild(createPlayButton());
        root.appendChild(createSettingsButton());
        root.appendChild(createStatusNode());

        host.appendChild(root);
        return root;
    }

    function syncUi(root) {
        safeRun(function() {
            var playButton = root.querySelector(".ps-vibe-play-button");
            var statusNode = root.querySelector(".ps-vibe-status");
            var inMyWave = isMyWaveContext();
            var playing = isPlaying();
            var triggerExists = !!findMyWaveTrigger();

            if (playButton instanceof HTMLButtonElement) {
                playButton.dataset.state = inMyWave ? (playing ? "pause" : "resume") : "start";
                playButton.setAttribute(
                    "aria-label",
                    inMyWave
                        ? (playing ? "Пауза Моей волны" : "Продолжить Мою волну")
                        : "Запустить Мою волну"
                );
                playButton.title = inMyWave
                    ? (playing ? "Пауза текущей Моей волны" : "Продолжить текущую Мою волну")
                    : "Открыть волну и запустить её";
                playButton.disabled = !inMyWave && !findMyWaveNavButton() && !triggerExists;

                var playGlyph = playButton.querySelector('[data-icon-role="play"]');
                var pauseGlyph = playButton.querySelector('[data-icon-role="pause"]');
                var showPauseGlyph = inMyWave && playing;

                if (playGlyph instanceof SVGElement || playGlyph instanceof HTMLElement) {
                    playGlyph.setAttribute("aria-hidden", showPauseGlyph ? "true" : "false");
                    if (playGlyph instanceof SVGElement || playGlyph instanceof HTMLElement) {
                        playGlyph.style.display = showPauseGlyph ? "none" : "";
                    }
                }
                if (pauseGlyph instanceof HTMLElement) {
                    pauseGlyph.setAttribute("aria-hidden", showPauseGlyph ? "false" : "true");
                    pauseGlyph.style.display = showPauseGlyph ? "inline-flex" : "none";
                }
            }

            if (statusNode instanceof HTMLElement) {
                if (inMyWave) {
                    statusNode.textContent = playing ? "Контекст: Моя волна, сейчас играет" : "Контекст: Моя волна, сейчас на паузе";
                } else if (triggerExists) {
                    statusNode.textContent = "Контекст: не волна, trigger найден";
                } else if (findMyWaveNavButton()) {
                    statusNode.textContent = "Контекст: не волна, trigger ещё не появился";
                } else {
                    statusNode.textContent = "Контекст: не волна, элементы управления не найдены";
                }
            }
        }, null, "Failed to sync UI");
    }

    function render(options) {
        safeRun(function() {
            cleanupVibeMeta();
            syncVibeAnimation(options.hideVibeAnimation);

            var host = findMainPage();
            if (!host) return;

            var root = ensureRoot(host);
            scheduleLayoutResync(root);
            root.hidden = !options.visible;
            if (!options.visible) return;

            syncUi(root);
        }, null, "Render failed");
    }

    function mount() {
        if (typeof document === "undefined" || typeof window === "undefined") return;

        var settingsStore = getAddonSettings(addonConfig.name);
        var settings = settingsStore.getCurrent();
        var updateScheduled = false;
        var observer = new MutationObserver(function() {
            if (updateScheduled) return;
            updateScheduled = true;
            requestAnimationFrame(function() {
                updateScheduled = false;
                update();
            });
        });

        function update() {
            safeRun(function() {
                render({
                    visible: readBooleanSetting(settings, "enabled", true),
                    hideVibeAnimation: readBooleanSetting(settings, "hideVibeAnimation", true)
                });
            }, null, "Update failed");
        }

        function start() {
            safeRun(function() {
                update();
                if (document.body) {
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                }
                setInterval(update, UI_REFRESH_INTERVAL_MS);
            }, null, "Start failed");
        }

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", start, { once: true });
        } else {
            start();
        }

        safeRun(function() {
            settingsStore.onChange(function(nextSettings) {
                settings = nextSettings;
                update();
            });
        }, null, "Failed to subscribe to settings");
    }

    mount();
})();
