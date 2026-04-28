/* Прошу не использовать данные наработки в своих аддонах, если хотите новую функцию или добавить поддержку к вашей теме - свяжитесь со мной на ветке в дискорде */


(function() {
    var addonConfig = {
        name: "YM Old Home UI",
        fallbackNames: ["YandexMusicOldHomeUI"]
    };

    var ROOT_ID = "ps-vibe-controls";
    var MAIN_PAGE_TEST_ID = "MAIN_PAGE";
    var NAV_VIBE_TEST_ID = "NAVBAR_NAVIGATION_ITEM_HOME";
    var PLAYERBAR_TEST_ID = "PLAYERBAR_DESKTOP";
    var CUSTOM_PLAYER_ATTR = "data-ps-custom-player";
    var PLAYER_PLAY_TEST_ID = "PLAY_BUTTON";
    var PLAYER_PAUSE_TEST_ID = "PAUSE_BUTTON";
    var VIBE_ANIMATION_TEST_ID = "VIBE_ANIMATION";
    var SWIPER_HIDDEN_CLASS = "ps-swiper-hidden-right";
    var SWIPER_LAYOUT_SHIFT_CLASS = "ps-swiper-layout-shifted";
    var SHIFTED_LAYOUT_OFFSET_PX = 0;
    var LAYOUT_RESYNC_DELAY_MS = 180;
    var VIBE_TRIGGER_ARIA_RE = /включить мою волну/i;
    var LOG_PREFIX = "[test_addon]";
    var pendingLayoutResyncTimer = 0;
    var pendingPlayerStateSyncTimers = [];
    var pendingTimecodeSyncTimer = 0;
    var vibeMenuState = {
        menu: null,
        trigger: null,
        itemsByIcon: {},
        observer: null
    };

    function unwrapSetting(entry, fallback) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            if (typeof entry.value !== "undefined") return entry.value;
            if (typeof entry.default !== "undefined") return entry.default;
        }
        return typeof entry !== "undefined" ? entry : fallback;
    }

    function getAddonSettingNames() {
        var names = [addonConfig.name];
        for (var i = 0; i < addonConfig.fallbackNames.length; i += 1) {
            var fallbackName = addonConfig.fallbackNames[i];
            if (names.indexOf(fallbackName) === -1) {
                names.push(fallbackName);
            }
        }
        return names;
    }

    function getAddonSettingsStore() {
        var api = getPulseSyncApi();
        if (!api || typeof api.getSettings !== "function") {
            return {
                getCurrent: function() {
                    return {};
                },
                onChange: function() {
                    return function() {};
                }
            };
        }

        var names = getAddonSettingNames();
        var fallbackStore = null;

        for (var i = 0; i < names.length; i += 1) {
            try {
                var store = api.getSettings(names[i]);
                if (!store || typeof store.getCurrent !== "function") continue;
                if (!fallbackStore) fallbackStore = store;

                var current = store.getCurrent();
                if (current && typeof current === "object" && Object.keys(current).length) {
                    return store;
                }
            } catch (error) {
                logError("Failed to get settings store for " + names[i], error);
            }
        }

        return fallbackStore || {
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

    function readNumberSetting(settings, key, fallback) {
        var value = Number(unwrapSetting(settings[key], fallback));
        return Number.isFinite(value) ? value : fallback;
    }

    function getPulseSyncApi() {
        return window.pulsesyncApi || null;
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

    function callPlayerApi(methodName, arg) {
        return safeRun(function() {
            var api = getPulseSyncApi();
            var method = api && api[methodName];
            if (typeof method !== "function") return false;
            if (typeof arg === "undefined") {
                method.call(api);
            } else {
                method.call(api, arg);
            }
            return true;
        }, false, "Failed to call player api: " + methodName);
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
            var api = getPulseSyncApi();
            if (typeof api?.isPlaying === "function") {
                return !!api.isPlaying();
            }

            var customPlayer = findCustomPlayerBar();
            var buttons = document.querySelectorAll('[data-test-id="' + PLAYER_PAUSE_TEST_ID + '"]');
            for (var i = 0; i < buttons.length; i += 1) {
                var button = buttons[i];
                if (!(button instanceof HTMLElement)) continue;
                if (customPlayer && customPlayer.contains(button)) continue;
                return true;
            }

            return false;
        }, false, "Failed to read playing state");
    }

    function setAttributeIfChanged(element, name, value) {
        if (!(element instanceof Element)) return;
        var nextValue = String(value);
        if (element.getAttribute(name) !== nextValue) {
            element.setAttribute(name, nextValue);
        }
    }

    function setDatasetIfChanged(element, key, value) {
        if (!(element instanceof HTMLElement)) return;
        var nextValue = String(value);
        if (element.dataset[key] !== nextValue) {
            element.dataset[key] = nextValue;
        }
    }

    function setTextIfChanged(element, value) {
        if (!(element instanceof Node)) return;
        var nextValue = String(value);
        if (element.textContent !== nextValue) {
            element.textContent = nextValue;
        }
    }

    function setStylePropertyIfChanged(element, name, value) {
        if (!(element instanceof HTMLElement)) return;
        var nextValue = String(value);
        if (element.style.getPropertyValue(name) !== nextValue) {
            element.style.setProperty(name, nextValue);
        }
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
            var shifted = !isSwiperHidden();
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

            root.style.removeProperty("--ps-root-shift");

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
            var mirroredCenter = hostRect.width - targetCenter;
            var horizontalPadding = 24;
            var rootWidth = Math.min(328, Math.max(0, hostRect.width - horizontalPadding));
            var minCenter = rootWidth / 2 + 12;
            var maxCenter = hostRect.width - rootWidth / 2 - 12;
            var nextCenter = shifted ? targetCenter : mirroredCenter;
            var clampedCenter = Math.max(minCenter, Math.min(maxCenter, nextCenter));

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

    function findNativePlayerBarRoot() {
        return safeRun(function() {
            var playerBars = document.querySelectorAll('[data-test-id="' + PLAYERBAR_TEST_ID + '"]');
            for (var i = 0; i < playerBars.length; i += 1) {
                var playerBar = playerBars[i];
                if (!(playerBar instanceof HTMLElement)) continue;
                if (playerBar.getAttribute(CUSTOM_PLAYER_ATTR) === "true") continue;
                return playerBar;
            }
            return null;
        }, null, "Failed to find native player bar");
    }

    function findNativeArtistLink(href, text) {
        return safeRun(function() {
            var normalizedHref = String(href || "").trim();
            var normalizedText = String(text || "").trim();
            var customPlayer = findCustomPlayerBar();
            var links = document.querySelectorAll('a[href], [data-test-id="SEPARATED_ARTIST_TITLE"]');

            for (var i = 0; i < links.length; i += 1) {
                var link = links[i];
                if (!(link instanceof HTMLAnchorElement)) continue;
                if (customPlayer && customPlayer.contains(link)) continue;
                if (link.closest('[data-test-id="FULLSCREEN_PLAYER_MODAL"]')) continue;
                if (link.closest('[data-test-id="PLAY_QUEUE"]')) continue;

                var linkHref = (link.getAttribute("href") || "").trim();
                var linkText = (link.textContent || "").trim();

                if (normalizedHref && normalizedHref !== "#" && linkHref === normalizedHref) {
                    return link;
                }
                if (normalizedText && linkText === normalizedText) {
                    return link;
                }
            }

            var vibeArtistCoverLink = document.querySelector('a[class*="VibeArtistCover_root__"]');
            if (vibeArtistCoverLink instanceof HTMLAnchorElement) {
                if ((!customPlayer || !customPlayer.contains(vibeArtistCoverLink)) &&
                    (!normalizedHref || normalizedHref === "#" || vibeArtistCoverLink.getAttribute("href") === normalizedHref)) {
                    return vibeArtistCoverLink;
                }
            }

            return null;
        }, null, "Failed to find native artist link");
    }

    function bindArtistLink(anchor, artist) {
        safeRun(function() {
            if (!(anchor instanceof HTMLAnchorElement)) return;
            anchor.addEventListener("click", function(event) {
                var nativeLink = findNativeArtistLink(artist && artist.href, artist && artist.text);
                if (nativeLink) {
                    event.preventDefault();
                    event.stopPropagation();
                    dispatchClick(nativeLink);
                }
            });
        }, null, "Failed to bind artist link");
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

    function isCustomPlayerElement(element) {
        if (!(element instanceof HTMLElement)) return false;
        var player = findCustomPlayerBar();
        return !!(player && player.contains(element));
    }

    function findNativeVibeMenuTrigger() {
        return safeRun(function() {
            var triggers = document.querySelectorAll('button[aria-label="Контекстное меню"][aria-haspopup="dialog"]');
            for (var i = 0; i < triggers.length; i += 1) {
                var trigger = triggers[i];
                if (!(trigger instanceof HTMLButtonElement)) continue;
                if (isCustomPlayerElement(trigger)) continue;
                return trigger;
            }
            return null;
        }, null, "Failed to find native vibe menu trigger");
    }

    function findNativeFullscreenTrigger() {
        return safeRun(function() {
            var candidates = document.querySelectorAll('.VibePlayerBar_center__yug8i[role="button"][aria-label="Плеер на весь экран"], [class*="VibePlayerBar_center__"][role="button"][aria-label="Плеер на весь экран"]');
            for (var i = 0; i < candidates.length; i += 1) {
                var candidate = candidates[i];
                if (!(candidate instanceof HTMLElement)) continue;
                if (isCustomPlayerElement(candidate)) continue;
                return candidate;
            }
            return null;
        }, null, "Failed to find native fullscreen trigger");
    }

    function openNativeFullscreen(event) {
        return safeRun(function() {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            var trigger = findNativeFullscreenTrigger();
            return trigger ? dispatchClick(trigger) : false;
        }, false, "Failed to open native fullscreen");
    }

    function getIconIdFromElement(element) {
        if (!(element instanceof HTMLElement)) return "";
        var use = element.querySelector("use");
        var href = use ? (use.getAttribute("xlink:href") || use.getAttribute("href") || "") : "";
        var hashIndex = href.indexOf("#");
        return hashIndex >= 0 ? href.slice(hashIndex + 1) : "";
    }

    function cacheVibeMenuButtons(menu) {
        return safeRun(function() {
            vibeMenuState.itemsByIcon = {};
            if (!(menu instanceof HTMLElement)) return vibeMenuState.itemsByIcon;

            var buttons = menu.querySelectorAll(".VibeContextMenu_menuItem__RK1Sg");
            for (var i = 0; i < buttons.length; i += 1) {
                var button = buttons[i];
                if (!(button instanceof HTMLElement)) continue;
                var iconId = getIconIdFromElement(button);
                if (!iconId) continue;
                vibeMenuState.itemsByIcon[iconId] = button;
            }

            return vibeMenuState.itemsByIcon;
        }, {}, "Failed to cache vibe menu buttons");
    }

    function detachVibeMenuObserver() {
        safeRun(function() {
            if (vibeMenuState.observer) {
                vibeMenuState.observer.disconnect();
                vibeMenuState.observer = null;
            }
        }, null, "Failed to detach vibe menu observer");
    }

    function attachVibeMenuObserver(menu) {
        safeRun(function() {
            detachVibeMenuObserver();
            if (!(menu instanceof HTMLElement)) return;

            vibeMenuState.observer = new MutationObserver(function() {
                if (!vibeMenuState.menu || !vibeMenuState.menu.isConnected) {
                    vibeMenuState.menu = null;
                    vibeMenuState.itemsByIcon = {};
                    return;
                }

                cacheVibeMenuButtons(vibeMenuState.menu);
            });

            vibeMenuState.observer.observe(menu, {
                childList: true,
                subtree: true
            });
        }, null, "Failed to attach vibe menu observer");
    }

    function ensureVibeMenuBackend() {
        return safeRun(function() {
            if (!(vibeMenuState.menu instanceof HTMLElement) || !vibeMenuState.menu.isConnected) {
                vibeMenuState.menu = null;
            }

            if (!vibeMenuState.menu) {
                var trigger = findNativeVibeMenuTrigger();
                vibeMenuState.trigger = trigger instanceof HTMLElement ? trigger : null;

                if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
                    dispatchClick(trigger);
                }

                var menu = document.querySelector(".VibeContextMenu_root__872YP");
                if (!(menu instanceof HTMLElement)) return false;

                vibeMenuState.menu = menu;
                attachVibeMenuObserver(menu);
            }

            cacheVibeMenuButtons(vibeMenuState.menu);
            return true;
        }, false, "Failed to ensure vibe menu backend");
    }

    async function ensureVibeMenuBackendAsync() {
        try {
            if (ensureVibeMenuBackend()) return true;

            var trigger = findNativeVibeMenuTrigger();
            vibeMenuState.trigger = trigger instanceof HTMLElement ? trigger : null;
            if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
                dispatchClick(trigger);
            }

            var menu = await waitFor(function() {
                var nextMenu = document.querySelector(".VibeContextMenu_root__872YP");
                return nextMenu instanceof HTMLElement ? nextMenu : null;
            }, 1500, 60);

            if (!(menu instanceof HTMLElement)) return false;

            vibeMenuState.menu = menu;
            attachVibeMenuObserver(menu);
            cacheVibeMenuButtons(menu);
            return true;
        } catch (error) {
            logError("Failed to ensure vibe menu backend async", error);
            return false;
        }
    }

    function findNativeMenuAction(iconId) {
        return safeRun(function() {
            if (!iconId) return null;

            var cached = vibeMenuState.itemsByIcon[iconId];
            if (cached instanceof HTMLElement && cached.isConnected) return cached;

            if (!ensureVibeMenuBackend()) return null;

            cached = vibeMenuState.itemsByIcon[iconId];
            return cached instanceof HTMLElement ? cached : null;
        }, null, "Failed to find native menu action: " + iconId);
    }

    async function waitForNativeMenuAction(iconId) {
        if (!iconId) return null;

        var cached = findNativeMenuAction(iconId);
        if (cached) return cached;

        var menuReady = await ensureVibeMenuBackendAsync();
        if (!menuReady) return null;

        return await waitFor(function() {
            return findNativeMenuAction(iconId);
        }, 1200, 60);
    }

    async function clickNativeMenuAction(iconId) {
        try {
            var button = await waitForNativeMenuAction(iconId);
            return button ? dispatchClick(button) : false;
        } catch (error) {
            logError("Failed to click native menu action: " + iconId, error);
            return false;
        }
    }

    function findNativeRepeatAction() {
        return safeRun(function() {
            var repeatButton = findNativeMenuAction("repeat_xs") || findNativeMenuAction("repeat_one_xs");
            if (repeatButton) return repeatButton;

            var menu = vibeMenuState.menu instanceof HTMLElement ? vibeMenuState.menu : document.querySelector(".VibeContextMenu_root__872YP");
            if (!(menu instanceof HTMLElement)) return null;

            var buttons = menu.querySelectorAll(".VibeContextMenu_menuItem__RK1Sg");
            for (var i = 0; i < buttons.length; i += 1) {
                var button = buttons[i];
                if (!(button instanceof HTMLElement)) continue;
                var text = (button.textContent || "").trim();
                if (/^повтор/i.test(text)) return button;
            }

            return null;
        }, null, "Failed to find native repeat action");
    }

    async function clickNativeRepeatAction() {
        try {
            var button = findNativeRepeatAction();
            if (!button) {
                var menuReady = await ensureVibeMenuBackendAsync();
                if (menuReady) {
                    button = await waitFor(function() {
                        return findNativeRepeatAction();
                    }, 1200, 60);
                }
            }

            var clicked = button ? dispatchClick(button) : false;
            if (clicked) {
                schedulePlayerStateSync();
            }
            return clicked;
        } catch (error) {
            logError("Failed to click native repeat action", error);
            return false;
        }
    }

    function getNativeRepeatState() {
        return safeRun(function() {
            var button = findNativeRepeatAction();
            if (!(button instanceof HTMLElement)) return "off";

            var iconId = getIconIdFromElement(button);
            var isActive = /important_active/i.test(button.className || "");

            if (iconId === "repeat_one_xs") return "one";
            if (iconId === "repeat_xs" && isActive) return "all";
            return "off";
        }, "off", "Failed to read native repeat state");
    }

    function isTrackLiked() {
        return safeRun(function() {
            var api = getPulseSyncApi();
            return typeof api?.isTrackLiked === "function" ? !!api.isTrackLiked() : false;
        }, false, "Failed to read like state");
    }

    function isTrackDisliked() {
        return safeRun(function() {
            var api = getPulseSyncApi();
            return typeof api?.isTrackDisliked === "function" ? !!api.isTrackDisliked() : false;
        }, false, "Failed to read dislike state");
    }

    function getTrackDerivedColors() {
        return safeRun(function() {
            var api = getPulseSyncApi();
            if (!api || typeof api.getCurrentTrack !== "function") return null;
            var track = api.getCurrentTrack();
            if (!track || typeof track !== "object") return null;
            return track.derivedColors && typeof track.derivedColors === "object" ? track.derivedColors : null;
        }, null, "Failed to read track derived colors");
    }

    function toggleLike() {
        callPlayerApi(isTrackLiked() ? "unlikeTrack" : "likeTrack");
        schedulePlayerStateSync();
    }

    function toggleDislike() {
        callPlayerApi(isTrackDisliked() ? "undislikeTrack" : "dislikeTrack");
        schedulePlayerStateSync();
    }

    function normalizeArtistList(artists) {
        var normalized = [];
        if (!Array.isArray(artists)) return normalized;

        for (var i = 0; i < artists.length; i += 1) {
            var artist = artists[i];
            var text = String(artist?.text || "").trim();
            if (!text) continue;
            normalized.push({
                text: text,
                href: artist && artist.href ? artist.href : "#"
            });
        }

        return normalized;
    }

    function areArtistListsEqual(left, right) {
        if (left.length !== right.length) return false;

        for (var i = 0; i < left.length; i += 1) {
            if (left[i].text !== right[i].text) return false;
            if ((left[i].href || "#") !== (right[i].href || "#")) return false;
        }

        return true;
    }

    function readRenderedArtists(container) {
        var artists = [];
        if (!(container instanceof HTMLElement)) return artists;

        var links = container.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]');
        for (var i = 0; i < links.length; i += 1) {
            var link = links[i];
            if (!(link instanceof HTMLAnchorElement)) continue;
            var text = link.textContent.trim();
            if (!text) continue;
            artists.push({
                text: text,
                href: link.getAttribute("href") || "#"
            });
        }

        return artists;
    }

    function setUseHref(element, symbolId) {
        safeRun(function() {
            if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
            var use = element.querySelector("use");
            if (!use || !symbolId) return;
            var nextHref = "/icons/sprite.svg#" + symbolId;
            var currentHref = use.getAttribute("xlink:href") || use.getAttribute("href") || "";
            if (currentHref === nextHref) return;
            use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", nextHref);
        }, null, "Failed to set use href");
    }

    function setPressedState(button, pressed, stateName) {
        safeRun(function() {
            if (!(button instanceof HTMLElement)) return;
            setAttributeIfChanged(button, "aria-pressed", pressed ? "true" : "false");
            if (stateName) {
                setDatasetIfChanged(button, "state", stateName);
            }
        }, null, "Failed to set pressed state");
    }

    function findCustomPlayerBar() {
        return safeRun(function() {
            var host = findMainPage();
            if (!(host instanceof HTMLElement)) return null;
            var player = host.querySelector("[" + CUSTOM_PLAYER_ATTR + '="true"]');
            return player instanceof HTMLElement ? player : null;
        }, null, "Failed to find custom player bar");
    }

    function syncCustomPlayerState() {
        safeRun(function() {
            var player = findCustomPlayerBar();
            if (player) {
                syncPlayerData(player);
            }

            var root = document.getElementById(ROOT_ID);
            if (root instanceof HTMLElement) {
                syncUi(root);
            }
        }, null, "Failed to sync custom player state");
    }

    function schedulePlayerStateSync(delays) {
        safeRun(function() {
            while (pendingPlayerStateSyncTimers.length) {
                clearTimeout(pendingPlayerStateSyncTimers.pop());
            }

            var queue = Array.isArray(delays) && delays.length ? delays : [0, 120, 280, 600];
            for (var i = 0; i < queue.length; i += 1) {
                pendingPlayerStateSyncTimers.push(setTimeout(function() {
                    syncCustomPlayerState();
                }, queue[i]));
            }
        }, null, "Failed to schedule player state sync");
    }

    function getPlayerProgress() {
        return safeRun(function() {
            return unwrapObservable(window.sonataState?.playerState?.progress) || null;
        }, null, "Failed to read player progress");
    }

    function clampNumber(value, min, max) {
        var number = Number(value);
        if (!Number.isFinite(number)) return min;
        return Math.max(min, Math.min(max, number));
    }

    function formatTimecode(seconds) {
        var totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
        var minutes = Math.floor(totalSeconds / 60);
        var restSeconds = totalSeconds % 60;
        return minutes + ":" + String(restSeconds).padStart(2, "0");
    }

    function syncTimecode(playerEl) {
        safeRun(function() {
            if (!(playerEl instanceof HTMLElement)) return;
            var progress = getPlayerProgress();
            if (!progress) return;

            var duration = Number(progress.duration) || 0;
            var position = clampNumber(progress.position, 0, duration || Number.MAX_SAFE_INTEGER);
            var loaded = clampNumber(progress.loaded, position, duration || Number.MAX_SAFE_INTEGER);
            var progressPercent = duration > 0 ? (position / duration) * 100 : 0;
            var bufferedPercent = duration > 0 ? (loaded / duration) * 100 : progressPercent;
            var progressValue = progressPercent.toFixed(3) + "%";
            var bufferedValue = bufferedPercent.toFixed(3) + "%";

            var wrapper = playerEl.querySelector('[data-test-id="TIMECODE_WRAPPER"]');
            if (!(wrapper instanceof HTMLElement)) return;

            setStylePropertyIfChanged(wrapper, "--track-progress", progressValue);
            setStylePropertyIfChanged(wrapper, "--thumb-position", progressValue);
            setStylePropertyIfChanged(wrapper, "--buffered-width", bufferedValue);

            var currentTime = playerEl.querySelector('[data-test-id="TIMECODE_TIME_START"]');
            if (currentTime instanceof HTMLElement) {
                var currentText = formatTimecode(position);
                setAttributeIfChanged(currentTime, "aria-label", currentText);
                setStylePropertyIfChanged(currentTime, "--timecode-position", progressValue);
                setTextIfChanged(currentTime.querySelector("span"), currentText);
            }

            var endTime = playerEl.querySelector('[data-test-id="TIMECODE_TIME_END"]');
            if (endTime instanceof HTMLElement) {
                var endText = formatTimecode(duration);
                setAttributeIfChanged(endTime, "aria-label", endText);
                setTextIfChanged(endTime.querySelector("span"), endText);
            }

            var slider = playerEl.querySelector('[data-test-id="TIMECODE_SLIDER"]');
            if (slider instanceof HTMLInputElement) {
                var maxValue = String(Math.max(0, Math.floor(duration)));
                var currentValue = String(Math.max(0, Math.floor(position)));
                if (slider.max !== maxValue) slider.max = maxValue;
                if (slider.value !== currentValue) slider.value = currentValue;
                setAttributeIfChanged(slider, "aria-valuetext", formatTimecode(position));
                slider.style.backgroundSize = progressValue + " 100%";
                setStylePropertyIfChanged(slider, "--seek-before-width", progressValue);
                setStylePropertyIfChanged(slider, "--buffered-width", bufferedValue);
            }
        }, null, "Failed to sync timecode");
    }

    function scheduleTimecodeSync() {
        safeRun(function() {
            if (pendingTimecodeSyncTimer) return;
            pendingTimecodeSyncTimer = setTimeout(function() {
                pendingTimecodeSyncTimer = 0;
                var player = findCustomPlayerBar();
                if (!player) return;
                syncTimecode(player);
                if (isPlaying()) {
                    scheduleTimecodeSync();
                }
            }, 500);
        }, null, "Failed to schedule timecode sync");
    }

    function getTrackDataFromDom() {
        return safeRun(function() {
            var ourPlayer = findCustomPlayerBar();
            var vibeMetaRoot = document.querySelector('.VibePage_meta__kWwRE');
            var vibeArtistCoverLink = document.querySelector('a[class*="VibeArtistCover_root__"]');
            var vibeArtistCoverHref = (
                vibeArtistCoverLink instanceof HTMLAnchorElement &&
                (!ourPlayer || !ourPlayer.contains(vibeArtistCoverLink))
            )
                ? (vibeArtistCoverLink.getAttribute("href") || "#")
                : "#";

            // Cover from VibePage AlbumCover
            var vibeCover = document.querySelector('[class*="AlbumCover_cover__"]');
            var coverSrc = vibeCover ? vibeCover.src : "";
            var coverSrcset = vibeCover ? vibeCover.srcset : "";

            // Track title from VibePlayerBar_trackNameText (on Vibe page)
            var vibeTrackName = document.querySelector('[class*="VibePlayerBar_trackNameText"]');
            var title = "";
            var titleHref = "#";
            var artistsFromTitle = [];
            
            if (vibeTrackName) {
                // On Vibe page, format is "ARTIST — TITLE"
                var fullText = vibeTrackName.textContent.trim();
                // Split by em dash (—) or regular dash (-)
                var parts = fullText.split(/\s*[—-]\s*/);
                if (parts.length >= 2) {
                    // First part is artist, rest is title
                    var artistName = parts[0].trim();
                    title = parts.slice(1).join(" — ");
                    
                    // Try to find artist link
                    var artistLink = document.querySelector('[data-test-id="SEPARATED_ARTIST_TITLE"]');
                    if (artistLink && !ourPlayer.contains(artistLink)) {
                        artistsFromTitle.push({
                            text: artistLink.textContent.trim(),
                            href: artistLink.getAttribute("href") || vibeArtistCoverHref || "#"
                        });
                    } else {
                        // No link found, use text from title
                        artistsFromTitle.push({
                            text: artistName,
                            href: vibeArtistCoverHref || "#"
                        });
                    }
                } else {
                    title = fullText;
                }
            } else {
                // Fallback: try TRACK_TITLE (on other pages)
                var allTitles = document.querySelectorAll('[data-test-id="TRACK_TITLE"]');
                for (var j = 0; j < allTitles.length; j++) {
                    if (!ourPlayer || !ourPlayer.contains(allTitles[j])) {
                        title = allTitles[j].textContent.trim();
                        titleHref = allTitles[j].getAttribute("href") || "#";
                        break;
                    }
                }
            }

            var finalArtists = artistsFromTitle;

            if (vibeMetaRoot instanceof HTMLElement) {
                var vibeArtistRoot = vibeMetaRoot.querySelector('[class*="SeparatedArtists_root"]');
                if (vibeArtistRoot instanceof HTMLElement) {
                    var vibeArtists = vibeArtistRoot.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]');
                    var collectedVibeArtists = [];

                    for (var k = 0; k < vibeArtists.length; k += 1) {
                        var vibeArtist = vibeArtists[k];
                        if (!(vibeArtist instanceof HTMLElement)) continue;
                        var vibeArtistText = vibeArtist.textContent.trim();
                        if (!vibeArtistText) continue;
                        var vibeArtistHref = vibeArtist.getAttribute("href") || vibeArtistCoverHref || "#";
                        collectedVibeArtists.push({
                            text: vibeArtistText,
                            href: vibeArtistHref
                        });
                    }

                    if (collectedVibeArtists.length) {
                        finalArtists = collectedVibeArtists;
                    }
                }
            } else {
                // Fallback outside Vibe page: skip elements inside our player and fullscreen/queue overlays
                var allArtists = document.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]');
                var artistLinks = [];
                for (var m = 0; m < allArtists.length; m += 1) {
                    var artistNode = allArtists[m];
                    if (!(artistNode instanceof HTMLElement)) continue;
                    if (ourPlayer && ourPlayer.contains(artistNode)) continue;
                    if (artistNode.closest('[data-test-id="FULLSCREEN_PLAYER_MODAL"]')) continue;
                    if (artistNode.closest('[data-test-id="PLAY_QUEUE"]')) continue;
                    artistLinks.push({
                        text: artistNode.textContent.trim(),
                        href: artistNode.getAttribute("href") || "#"
                    });
                }

                if (artistLinks.length > 0) {
                    finalArtists = artistLinks;
                }
            }

            if (!coverSrc && !title) return null;
            return {
                coverSrc: coverSrc,
                coverSrcset: coverSrcset,
                title: title || "Моя волна",
                titleHref: titleHref,
                artists: finalArtists
            };
        }, null, "Failed to get track data from DOM");
    }

    function syncPlayerData(playerEl) {
        safeRun(function() {
            var data = getTrackDataFromDom();
            if (!data) return;
            var normalizedArtists = normalizeArtistList(data.artists);
            var nativePlayerBar = findNativePlayerBarRoot();
            var derivedColors = getTrackDerivedColors();

            var cover = playerEl.querySelector('[data-test-id="ENTITY_COVER_IMAGE"]');
            if (cover) {
                if (cover.src !== data.coverSrc) {
                    cover.src = data.coverSrc;
                }
                if ((cover.srcset || "") !== (data.coverSrcset || "")) {
                    cover.srcset = data.coverSrcset;
                }
            }

            var titleLink = playerEl.querySelector('[data-test-id="TRACK_TITLE"]');
            if (titleLink) {
                var nextTitleAria = "Трек " + data.title;
                if (titleLink.getAttribute("aria-label") !== nextTitleAria) {
                    titleLink.setAttribute("aria-label", nextTitleAria);
                }
                if ((titleLink.getAttribute("href") || "#") !== (data.titleHref || "#")) {
                    titleLink.href = data.titleHref || "#";
                }
                var titleSpan = titleLink.querySelector(".Meta_title__GGBnH");
                if (titleSpan && titleSpan.textContent !== data.title) {
                    titleSpan.textContent = data.title;
                }
            }

            var artistsDiv = playerEl.querySelector(".Meta_artists__VnR52");
            if (artistsDiv && normalizedArtists.length) {
                var renderedArtists = readRenderedArtists(artistsDiv);
                if (!areArtistListsEqual(renderedArtists, normalizedArtists)) {
                artistsDiv.innerHTML = "";
                normalizedArtists.forEach(function(artist, i) {
                    var a = document.createElement("a");
                    a.className = "buOTZq_TKQOVyjMLrXvB Meta_text__Y5uYH Meta_link__IFDBA";
                    a.setAttribute("aria-label", "Артист " + artist.text);
                    a.dataset.testId = "SEPARATED_ARTIST_TITLE";
                    a.href = artist.href || "#";
                    bindArtistLink(a, artist);
                    var span = document.createElement("span");
                    span.className = "_MWOVuZRvUQdXKTMcOPx Z_WIr2W8JU4MPQek3hgR _3_Mxw7Si7j2g4kWjlpR Meta_text__Y5uYH Meta_artistCaption__JESZi";
                    span.textContent = artist.text;
                    a.appendChild(span);
                    artistsDiv.appendChild(a);
                    if (i < normalizedArtists.length - 1) {
                        artistsDiv.appendChild(document.createTextNode(", "));
                    }
                });
                }
            }

            if (playerEl instanceof HTMLElement) {
                var playerAccentColor = "";
                if (derivedColors) {
                    playerAccentColor = String(
                        derivedColors.average ||
                        derivedColors.miniPlayer ||
                        derivedColors.accent ||
                        ""
                    ).trim();
                }
                if (nativePlayerBar instanceof HTMLElement && typeof window.getComputedStyle === "function") {
                    var nativePlayerStyles = window.getComputedStyle(nativePlayerBar);
                    if (!playerAccentColor) {
                        playerAccentColor = (nativePlayerStyles.getPropertyValue("--player-average-color-background") || "").trim();
                    }
                    if (!playerAccentColor) {
                        playerAccentColor = nativePlayerStyles.backgroundColor || "";
                    }
                }
                if (!playerAccentColor && typeof window.getComputedStyle === "function") {
                    playerAccentColor = (window.getComputedStyle(document.documentElement).getPropertyValue("--ym-background-color-primary-enabled-player") || "").trim();
                }
                if (playerAccentColor) {
                    setStylePropertyIfChanged(playerEl, "--player-average-color-background", playerAccentColor);
                }
            }

            var playing = isPlaying();
            var playPauseBtn = playerEl.querySelector('[data-test-id="PLAY_BUTTON"], [data-test-id="PAUSE_BUTTON"]');
            var likeBtn = playerEl.querySelector('[data-test-id="LIKE_BUTTON"]');
            var dislikeBtn = playerEl.querySelector('[data-test-id="DISLIKE_BUTTON"]');
            var repeatBtn = playerEl.querySelector('[data-test-id^="REPEAT_BUTTON"]');

            if (playPauseBtn) {
                setDatasetIfChanged(playPauseBtn, "testId", playing ? "PAUSE_BUTTON" : "PLAY_BUTTON");
                setAttributeIfChanged(playPauseBtn, "aria-label", playing ? "Пауза" : "Воспроизведение");
                setDatasetIfChanged(playPauseBtn, "state", playing ? "pause" : "play");
                setUseHref(playPauseBtn, playing ? "pause_filled_l" : "play_filled_l");
            }

            if (likeBtn) {
                var liked = isTrackLiked();
                setPressedState(likeBtn, liked, liked ? "liked" : "idle");
                setAttributeIfChanged(likeBtn, "aria-label", liked ? "Убрать лайк" : "Нравится");
                setUseHref(likeBtn, liked ? "liked_xs" : "like_xs");
            }

            if (dislikeBtn) {
                var disliked = isTrackDisliked();
                setPressedState(dislikeBtn, disliked, disliked ? "disliked" : "idle");
                setAttributeIfChanged(dislikeBtn, "aria-label", disliked ? "Убрать дизлайк" : "Не нравится");
                setUseHref(dislikeBtn, disliked ? "disliked_xs" : "dislike_xs");
            }

            if (repeatBtn) {
                var repeatState = getNativeRepeatState();
                setDatasetIfChanged(repeatBtn, "state", repeatState);
                setAttributeIfChanged(repeatBtn, "aria-pressed", repeatState === "off" ? "false" : "true");
                if (repeatState === "one") {
                    setDatasetIfChanged(repeatBtn, "testId", "REPEAT_BUTTON_REPEAT_ONE");
                    setAttributeIfChanged(repeatBtn, "aria-label", "Повтор трека");
                    setUseHref(repeatBtn, "repeat_one_xs");
                } else if (repeatState === "all") {
                    setDatasetIfChanged(repeatBtn, "testId", "REPEAT_BUTTON_REPEAT");
                    setAttributeIfChanged(repeatBtn, "aria-label", "Повтор плейлиста");
                    setUseHref(repeatBtn, "repeat_xs");
                } else {
                    setDatasetIfChanged(repeatBtn, "testId", "REPEAT_BUTTON_NO_REPEAT");
                    setAttributeIfChanged(repeatBtn, "aria-label", "Повтор");
                    setUseHref(repeatBtn, "repeat_xs");
                }
            }

            syncTimecode(playerEl);
            if (playing) {
                scheduleTimecodeSync();
            }
        }, null, "Failed to sync player data");
    }

    function syncVibeAnimation(shouldHide, topPercent) {
        safeRun(function() {
            var nodes = document.querySelectorAll('[data-test-id="' + VIBE_ANIMATION_TEST_ID + '"]');
            for (var i = 0; i < nodes.length; i += 1) {
                var node = nodes[i];
                if (!(node instanceof HTMLElement)) continue;
                node.classList.toggle("ps-vibe-animation-hidden", Boolean(shouldHide));
                node.style.top = String(topPercent) + "%";
                node.style.display = shouldHide ? "none" : "";
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
                if (playButton) {
                    var resumed = dispatchClick(playButton);
                    schedulePlayerStateSync();
                    return resumed;
                }
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
        schedulePlayerStateSync();
        return isMyWaveContext();
    }

    async function pauseMyWave() {
        if (!isMyWaveContext()) return false;
        if (!isPlaying()) return true;
        var pauseButton = findPlayerPauseButton();
        var paused = pauseButton ? dispatchClick(pauseButton) : false;
        if (paused) {
            schedulePlayerStateSync();
        }
        return paused;
    }

    async function toggleMyWave() {
        if (isMyWaveContext()) {
            if (isPlaying()) return pauseMyWave();

            var playButton = findPlayerPlayButton();
            var resumed = playButton ? dispatchClick(playButton) : false;
            if (resumed) {
                schedulePlayerStateSync();
            }
            return resumed;
        }

        var started = await startMyWave();
        if (started) {
            schedulePlayerStateSync();
        }
        return started;
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

    function createHomePlayer() {
        var section = document.createElement("section");
        section.className = "PlayerBarDesktopWithBackgroundProgressBar_root__bpmwN PlayerBarDesktopWithBackgroundProgressBar_important__HzXrK CommonLayout_playerBar__zXRxq PlayerBar_root__cXUnU";
        section.dataset.testId = "PLAYERBAR_DESKTOP";
        section.setAttribute(CUSTOM_PLAYER_ATTR, "true");
        section.setAttribute("aria-labelledby", "player-region");
        section.style.setProperty("--player-average-color-background", "var(--ym-background-color-primary-enabled-player)");
        
        var playerBarDiv = document.createElement("div");
        playerBarDiv.className = "PlayerBarDesktopWithBackgroundProgressBar_playerBar__mp0p9";
        section.appendChild(playerBarDiv);
        
        var timecodeWrapper = createTimecodeWrapper();
        playerBarDiv.appendChild(timecodeWrapper);
        
        var playerDiv = createPlayerDiv();
        playerBarDiv.appendChild(playerDiv);
        
        return section;
    }

    function createPlayerDiv() {
        var div = document.createElement("div");
        div.className = "PlayerBarDesktopWithBackgroundProgressBar_player__ASKKs";
        
        var triggerModal = document.createElement("div");
        triggerModal.className = "PlayerBarDesktopWithBackgroundProgressBar_triggerModal__EVv5d";
        div.appendChild(triggerModal);
        
        var h3 = document.createElement("h3");
        h3.className = "_MWOVuZRvUQdXKTMcOPx _sd8Q9d_Ttn0Ufe4ISWS nSU6fV9y80WrZEfafvww eaYyesBmJL_NbkgoYR1c";
        h3.id = "player-region";
        h3.textContent = "Плеер";
        div.appendChild(h3);
        
        var infoDiv = createPlayerInfo();
        div.appendChild(infoDiv);
        
        var sonataDiv = createSonataControls();
        div.appendChild(sonataDiv);
        
        var metaDiv = createPlayerMeta();
        div.appendChild(metaDiv);
        
        return div;
    }

    function createPlayerInfo() {
        var div = document.createElement("div");
        div.className = "PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_";
        
        var infoCard = document.createElement("div");
        infoCard.className = "PlayerBarDesktopWithBackgroundProgressBar_infoCard__i0cbW";
        div.appendChild(infoCard);
        
        var coverContainer = createCoverContainer();
        infoCard.appendChild(coverContainer);
        
        var description = createTrackDescription();
        infoCard.appendChild(description);
        
        return div;
    }

    function createCoverContainer() {
        var div = document.createElement("div");
        div.className = "qaIScXjx1qyXuaIHXQIo _7gw1qGE6BeUAdSMbhRx ZcpulvHgF_wsgzB8Hye9 PlayerBarDesktopWithBackgroundProgressBar_coverContainer__dkNCG";
        div.dataset.testId = "PLAYERBAR_DESKTOP_COVER_CONTAINER";
        
        var img = document.createElement("img");
        img.className = "qQ7GQU14EkggPBC6jdeS fosYvyLDok3Kjj9OWmxG PlayerBarDesktopWithBackgroundProgressBar_cover__MKmEt";
        img.alt = "";
        img.loading = "eager";
        img.dataset.testId = "ENTITY_COVER_IMAGE";
        img.src = "https://avatars.yandex.net/get-music-content/4796762/7669fe96.a.15647955-1/100x100";
        img.srcset = "https://avatars.yandex.net/get-music-content/4796762/7669fe96.a.15647955-1/100x100, https://avatars.yandex.net/get-music-content/4796762/7669fe96.a.15647955-1/200x200 2x";
        img.setAttribute("role", "button");
        img.setAttribute("tabindex", "0");
        img.setAttribute("aria-label", "Плеер на весь экран");
        div.appendChild(img);

        img.addEventListener("click", openNativeFullscreen);
        img.addEventListener("keydown", function(event) {
            if (event.key === "Enter" || event.key === " ") {
                openNativeFullscreen(event);
            }
        });
        
        var fullscreenBtn = createFullscreenButton();
        div.appendChild(fullscreenBtn);
        
        return div;
    }

    function createFullscreenButton() {
        var root = document.createElement("div");
        root.className = "FullscreenPlayerDesktopButton_root__qGgoC";
        
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv iJVAJMgccD4vj4E4o068 uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p nHWc2sto1C6Gm0Dpw_l0 WtFdWDF44egSVM_YiMUX qU2apWBO1yyEK0lZ3lPO undefined FullscreenPlayerDesktopButton_button__7NEl6";
        button.type = "button";
        button.setAttribute("aria-label", "Плеер на весь экран");
        button.dataset.testId = "FULLSCREEN_PLAYER_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk", "fullscreen_xs"));
        button.appendChild(span);

        button.addEventListener("click", openNativeFullscreen);

        root.appendChild(button);
        
        return root;
    }

    function createTrackDescription() {
        var div = document.createElement("div");
        div.className = "PlayerBarDesktopWithBackgroundProgressBar_description__5jHke";
        
        var metaRoot = document.createElement("div");
        metaRoot.className = "Meta_root__R8n1h Meta_root_withSecondaryColor___uENY";
        
        var metaContainer = document.createElement("div");
        metaContainer.className = "Meta_metaContainer__7i2dp";
        metaRoot.appendChild(metaContainer);
        div.appendChild(metaRoot);
        
        var titleContainer = createTitleContainer();
        metaContainer.appendChild(titleContainer);
        
        var artistsDiv = createArtistsDiv();
        metaContainer.appendChild(artistsDiv);
        
        return div;
    }

    function createTitleContainer() {
        var div = document.createElement("div");
        div.className = "Meta_titleContainer__gDuXr";
        
        var textDiv = document.createElement("div");
        textDiv.className = "_MWOVuZRvUQdXKTMcOPx LezmJlldtbHWqU7l1950 oyQL2RSmoNbNQf3Vc6YI Z_WIr2W8JU4MPQek3hgR _3_Mxw7Si7j2g4kWjlpR Meta_text__Y5uYH";
        textDiv.style.webkitLineClamp = "1";
        
        var link = document.createElement("a");
        link.className = "buOTZq_TKQOVyjMLrXvB Meta_albumLink__gASh6";
        link.setAttribute("aria-label", "Трек Моя волна");
        link.dataset.testId = "TRACK_TITLE";
        link.href = "#";
        
        var span = document.createElement("span");
        span.className = "_MWOVuZRvUQdXKTMcOPx Z_WIr2W8JU4MPQek3hgR _3_Mxw7Si7j2g4kWjlpR Meta_text__Y5uYH Meta_title__GGBnH";
        span.textContent = "Моя волна";
        link.appendChild(span);
        textDiv.appendChild(link);
        div.appendChild(textDiv);
        
        return div;
    }

    function createArtistsDiv() {
        var div = document.createElement("div");
        div.className = "SeparatedArtists_root_variant_breakAll__34YbW SeparatedArtists_root_clamp__SyvjM Meta_text__Y5uYH Meta_artists__VnR52";
        div.style.webkitLineClamp = "1";
        
        var link = document.createElement("a");
        link.className = "buOTZq_TKQOVyjMLrXvB Meta_text__Y5uYH Meta_link__IFDBA";
        link.setAttribute("aria-label", "Артист Яндекс Музыка");
        link.dataset.testId = "SEPARATED_ARTIST_TITLE";
        link.href = "#";
        bindArtistLink(link, {
            text: "Яндекс Музыка",
            href: "#"
        });
        
        var span = document.createElement("span");
        span.className = "_MWOVuZRvUQdXKTMcOPx Z_WIr2W8JU4MPQek3hgR _3_Mxw7Si7j2g4kWjlpR Meta_text__Y5uYH Meta_artistCaption__JESZi";
        span.textContent = "Яндекс Музыка";
        link.appendChild(span);
        div.appendChild(link);
        
        return div;
    }

    function createSonataControls() {
        var div = document.createElement("div");
        div.className = "PlayerBarDesktopWithBackgroundProgressBar_sonata__mGFb_";
        
        var likeBtn = createLikeButton();
        div.appendChild(likeBtn);
        
        var controls = createBaseSonataControls();
        div.appendChild(controls);
        
        var dislikeBtn = createDislikeButton();
        div.appendChild(dislikeBtn);
        
        return div;
    }

    function createLikeButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O zIMibMuH7wcqUoW7KH1B IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr WtFdWDF44egSVM_YiMUX qU2apWBO1yyEK0lZ3lPO undefined";
        button.type = "button";
        button.setAttribute("aria-label", "Нравится");
        button.setAttribute("aria-pressed", "false");
        button.dataset.testId = "LIKE_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk", "like_xs"));
        button.appendChild(span);

        button.addEventListener("click", function() {
            toggleLike();
        });
        
        return button;
    }

    function createDislikeButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr WtFdWDF44egSVM_YiMUX qU2apWBO1yyEK0lZ3lPO undefined";
        button.type = "button";
        button.setAttribute("aria-label", "Не нравится");
        button.setAttribute("aria-pressed", "false");
        button.dataset.testId = "DISLIKE_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk", "dislike_xs"));
        button.appendChild(span);

        button.addEventListener("click", function() {
            toggleDislike();
        });
        
        return button;
    }

    function createBaseSonataControls() {
        var div = document.createElement("div");
        div.className = "BaseSonataControlsDesktop_root__E6wjA PlayerBarDesktopWithBackgroundProgressBar_sonataControls__rSmXQ PlayerBarDesktopWithBackgroundProgressBar_important__HzXrK";
        
        var shuffleContainer = createShuffleContainer();
        div.appendChild(shuffleContainer);
        
        var buttonsDiv = createSonataButtons();
        div.appendChild(buttonsDiv);
        
        var repeatContainer = createRepeatContainer();
        div.appendChild(repeatContainer);
        
        return div;
    }

    function createShuffleContainer() {
        var div = document.createElement("div");
        div.className = "BaseSonataControlsDesktop_buttonContainer__EB404";
        
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO undefined BaseSonataControlsDesktop_sonataButton__GbwFt";
        button.type = "button";
        button.setAttribute("aria-label", "В случайном порядке");
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-hidden", "true");
        button.dataset.testId = "SHUFFLE_BUTTON";
        button.disabled = true;
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP ShuffleButton_shuffleIcon_disabled__fQsOo UwnL5AJBMMAp6NwMDdZk", "shuffle_xs"));
        button.appendChild(span);
        div.appendChild(button);
        
        return div;
    }

    function createRepeatContainer() {
        var div = document.createElement("div");
        div.className = "BaseSonataControlsDesktop_buttonContainer__EB404";
        
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO undefined BaseSonataControlsDesktop_sonataButton__GbwFt";
        button.type = "button";
        button.setAttribute("aria-hidden", "false");
        button.setAttribute("aria-label", "Повтор");
        button.setAttribute("aria-pressed", "false");
        button.dataset.testId = "REPEAT_BUTTON_NO_REPEAT";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP RepeatButton_repeatIcon_none__2nb1J UwnL5AJBMMAp6NwMDdZk", "repeat_xs"));
        button.appendChild(span);
        div.appendChild(button);
        
        button.addEventListener("click", function() {
            clickNativeRepeatAction();
        });
        
        return div;
    }

    function ensureVibeMenuOpen() {
        safeRun(function() {
            ensureVibeMenuBackend();
        }, null, "Failed to ensure vibe menu open");
    }

    function findOriginalMenuButton(iconId, callback) {
        return safeRun(function() {
            var button = findNativeMenuAction(iconId);
            if (button && callback) callback(button);
            return button;
        }, null, "Failed to find original menu button");
    }

    function clickMenuButton(menu, iconId) {
        if (!menu) return null;
        
        var buttons = menu.querySelectorAll('.VibeContextMenu_menuItem__RK1Sg');
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            var use = button.querySelector('use');
            if (use && use.getAttribute('xlink:href') === '/icons/sprite.svg#' + iconId) {
                return button;
            }
        }
        return null;
    }

    function createSonataButtons() {
        var div = document.createElement("div");
        div.className = "BaseSonataControlsDesktop_sonataButtons__7vLtw";
        
        var prevBtn = createPreviousButton();
        div.appendChild(prevBtn);
        
        var playPauseBtn = createPlayPauseButton();
        div.appendChild(playPauseBtn);
        
        var nextBtn = createNextButton();
        div.appendChild(nextBtn);
        
        return div;
    }

    function createPreviousButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr Y2uqxoU7xa_AZ8FUCVOW qU2apWBO1yyEK0lZ3lPO undefined BaseSonataControlsDesktop_sonataButton__GbwFt";
        button.type = "button";
        button.setAttribute("aria-hidden", "false");
        button.setAttribute("aria-label", "Предыдущая песня");
        button.dataset.testId = "PREVIOUS_TRACK_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP l3tE1hAMmBj2aoPPwU08", "previous_xxs"));
        button.appendChild(span);

        button.addEventListener("click", function() {
            callPlayerApi("previous");
            schedulePlayerStateSync([0, 180, 420, 800]);
        });
        
        return button;
    }

    function createNextButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr Y2uqxoU7xa_AZ8FUCVOW qU2apWBO1yyEK0lZ3lPO undefined BaseSonataControlsDesktop_sonataButton__GbwFt";
        button.type = "button";
        button.setAttribute("aria-hidden", "false");
        button.setAttribute("aria-label", "Следующая песня");
        button.dataset.testId = "NEXT_TRACK_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP l3tE1hAMmBj2aoPPwU08", "next_xxs"));
        button.appendChild(span);

        button.addEventListener("click", function() {
            callPlayerApi("next");
            schedulePlayerStateSync([0, 180, 420, 800]);
        });
        
        return button;
    }

    function createPlayPauseButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr undefined qU2apWBO1yyEK0lZ3lPO WsKeF73pWotx9W1tWdYY BaseSonataControlsDesktop_sonataButton__GbwFt";
        button.type = "button";
        button.setAttribute("aria-label", "Воспроизведение");
        button.dataset.testId = "PLAY_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP BaseSonataControlsDesktop_playButtonIcon__TlFqv YjRa1ZjM_lXFlrfS7jcu", "play_filled_l"));
        button.appendChild(span);
        
        button.addEventListener("click", function() {
            if (!callPlayerApi("togglePlayPause")) {
                toggleMyWave().catch(function(error) {
                    logError("Failed to toggle playback", error);
                });
                return;
            }
            schedulePlayerStateSync();
        });
        
        return button;
    }

    function createPlayerMeta() {
        var div = document.createElement("div");
        div.className = "PlayerBarDesktopWithBackgroundProgressBar_meta__FhKTC";
        
        var lyricsBtn = createLyricsButton();
        div.appendChild(lyricsBtn);
        
        var queueBtn = createQueueButton();
        div.appendChild(queueBtn);
        
        var settingsBtn = createSettingsButton2();
        div.appendChild(settingsBtn);
        
        var volumeControl = createVolumeControl();
        div.appendChild(volumeControl);
        
        return div;
    }

    function createLyricsButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO undefined";
        button.type = "button";
        button.setAttribute("aria-hidden", "false");
        button.setAttribute("aria-label", "Включить текстомузыку Может нарушить доступность");
        button.dataset.testId = "PLAYERBAR_DESKTOP_SYNC_LYRICS_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk", "syncLyrics_xs"));
        button.appendChild(span);
        
        button.addEventListener("click", function() {
            clickNativeMenuAction("syncLyrics_xs");
        });
        
        return button;
    }

    function createQueueButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO undefined";
        button.type = "button";
        button.setAttribute("aria-label", "Очередь воспроизведения");
        button.dataset.testId = "PLAYERBAR_DESKTOP_PLAY_QUEUE_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk", "playQueue_xs"));
        button.appendChild(span);
        
        button.addEventListener("click", function() {
            clickNativeMenuAction("playQueue_xs");
        });
        
        return button;
    }

    function createSettingsButton2() {
        var wrapper = document.createElement("div");
        wrapper.className = "cpeagBA1_PblpJn8Xgtv HbaqudSqu7Q3mv3zMPGr";
        
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO undefined PlayerBarDesktopWithBackgroundProgressBar_settingsButton__HnCgK";
        button.type = "button";
        button.setAttribute("aria-label", "Настройки звука");
        button.dataset.testId = "SOUND_QUALITY_BUTTON";
        button.setAttribute("aria-live", "off");
        button.setAttribute("aria-busy", "false");
        
        var span = document.createElement("span");
        span.className = "JjlbHZ4FaP9EAcR_1DxF";
        span.appendChild(createSvg("J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk", "settings_xs"));
        button.appendChild(span);
        wrapper.appendChild(button);
        
        button.addEventListener("click", function() {
            clickNativeMenuAction("settings_xs");
        });
        
        return wrapper;
    }

    function createVolumeControl() {
        var originalVolume = document.querySelector('.ChangeVolume_root__HDxtA.VibePlayerBar_changeVolume__x7FHC');
        if (originalVolume) {
            var clone = originalVolume.cloneNode(true);
            if (clone instanceof HTMLElement) {
                clone.removeAttribute("id");
                return clone;
            }
        }
        
        var div = document.createElement("div");
        div.className = "ChangeVolume_root__HDxtA";
        div.textContent = "Volume control not found";
        return div;
    }

    function createTimecodeWrapper() {
        var wrapper = document.createElement("div");
        wrapper.className = "ChangeTimecodeBackground_root__B89FS ChangeTimecodeBackground_root_isPlayingTrack__2naHL";
        wrapper.dataset.testId = "TIMECODE_WRAPPER";
        wrapper.style.setProperty("--size-thumb", "12px");
        wrapper.style.setProperty("--track-progress", "0%");
        wrapper.style.setProperty("--thumb-position", "0px");
        
        var timecodeEnd = createTimecode("02:14", "TIMECODE_TIME_END", "end");
        var timecodeCurrent = createTimecode("00:00", "TIMECODE_TIME_START", "start");
        
        wrapper.appendChild(timecodeEnd);
        wrapper.appendChild(timecodeCurrent);
        
        var progressBar = document.createElement("div");
        progressBar.className = "ChangeTimecodeBackground_progressbar__M93Ie PlayerBarDesktopWithBackgroundProgressBar_progressBar___Q6eK";
        wrapper.appendChild(progressBar);
        
        var thumb = document.createElement("div");
        thumb.className = "ChangeTimecodeBackground_thumb__vx6J0";
        wrapper.appendChild(thumb);
        
        var slider = createTimecodeSlider();
        wrapper.appendChild(slider);
        
        return wrapper;
    }

    function createTimecode(time, testId, type) {
        var span = document.createElement("span");
        span.className = "_MWOVuZRvUQdXKTMcOPx mxSPe5xpZnie9gpIqacd _3_Mxw7Si7j2g4kWjlpR Timecode_root__TLT75";
        span.className += type === "end" ? " Timecode_root_end__LLQsh TimecodeGroup_timecode__IJXpy ChangeTimecodeBackground_timecodeGroup__2VQ1N TimecodeGroup_timecode_end__kzP5g" : " Timecode_root_start__pHG5N TimecodeGroup_timecode__IJXpy TimecodeGroup_timecode_current__wv9pb ChangeTimecodeBackground_timecodeGroup__2VQ1N ChangeTimecodeBackground_timecodeGroupCurrent__aGlrB ChangeTimecodeBackground_important__OSzLR TimecodeGroup_timecode_current_animation__kZUW_";
        span.tabIndex = 0;
        span.dataset.testId = testId;
        span.setAttribute("role", "text");
        span.setAttribute("aria-label", time);
        
        var innerSpan = document.createElement("span");
        innerSpan.setAttribute("aria-hidden", "true");
        innerSpan.textContent = time;
        span.appendChild(innerSpan);
        
        return span;
    }

    function createTimecodeSlider() {
        var input = document.createElement("input");
        input.className = "JkKcxRVvjK7lcakkEliC qpvIbN4_hF6CqK0bjCq7 SHvrm0VRiLVwGqJJjNO8 undefined ChangeTimecodeBackground_slider__Jdu3l ChangeTimecodeBackground_important__OSzLR PlayerBarDesktopWithBackgroundProgressBar_slider__SezFn";
        input.type = "range";
        input.max = "134";
        input.value = "0";
        input.dataset.testId = "TIMECODE_SLIDER";
        input.setAttribute("aria-label", "Управление таймкодом");
        input.setAttribute("aria-valuetext", "0 секунд");
        input.style.backgroundSize = "0% 100%";
        input.style.setProperty("--seek-before-width", "0%");
        input.style.setProperty("--buffered-width", "0%");
        
        var bgProgressBar = document.createElement("div");
        bgProgressBar.className = "ChangeTimecodeBackground_backgroundProgressbar__hT_QP";
        input.appendChild(bgProgressBar);
        
        return input;
    }

    function createTimecodeWrapper() {
        var wrapper = document.createElement("div");
        wrapper.className = "ChangeTimecodeBackground_root__B89FS ChangeTimecodeBackground_root_isPlayingTrack__2naHL";
        wrapper.dataset.testId = "TIMECODE_WRAPPER";
        wrapper.style.setProperty("--size-thumb", "12px");
        wrapper.style.setProperty("--track-progress", "0%");
        wrapper.style.setProperty("--thumb-position", "0px");
        
        var endTime = document.createElement("span");
        endTime.className = "_MWOVuZRvUQdXKTMcOPx mxSPe5xpZnie9gpIqacd _3_Mxw7Si7j2g4kWjlpR Timecode_root__TLT75 Timecode_root_end__LLQsh TimecodeGroup_timecode__IJXpy ChangeTimecodeBackground_timecodeGroup__2VQ1N TimecodeGroup_timecode_end__kzP5g";
        endTime.setAttribute("tabindex", "0");
        endTime.dataset.testId = "TIMECODE_TIME_END";
        endTime.setAttribute("role", "text");
        endTime.setAttribute("aria-label", "0 секунд");
        var endSpan = document.createElement("span");
        endSpan.setAttribute("aria-hidden", "true");
        endSpan.textContent = "00:00";
        endTime.appendChild(endSpan);
        wrapper.appendChild(endTime);
        
        var startTime = document.createElement("span");
        startTime.className = "_MWOVuZRvUQdXKTMcOPx mxSPe5xpZnie9gpIqacd _3_Mxw7Si7j2g4kWjlpR Timecode_root__TLT75 Timecode_root_start__pHG5N TimecodeGroup_timecode__IJXpy TimecodeGroup_timecode_current__wv9pb ChangeTimecodeBackground_timecodeGroup__2VQ1N ChangeTimecodeBackground_timecodeGroupCurrent__aGlrB ChangeTimecodeBackground_important__OSzLR TimecodeGroup_timecode_current_animation__kZUW_";
        startTime.setAttribute("tabindex", "0");
        startTime.dataset.testId = "TIMECODE_TIME_START";
        startTime.setAttribute("role", "text");
        startTime.setAttribute("aria-label", "0 секунд");
        startTime.style.setProperty("--timecode-position", "0px");
        var startSpan = document.createElement("span");
        startSpan.setAttribute("aria-hidden", "true");
        startSpan.textContent = "00:00";
        startTime.appendChild(startSpan);
        wrapper.appendChild(startTime);
        
        var progressBar = document.createElement("div");
        progressBar.className = "ChangeTimecodeBackground_progressbar__M93Ie PlayerBarDesktopWithBackgroundProgressBar_progressBar___Q6eK";
        wrapper.appendChild(progressBar);
        
        var thumb = document.createElement("div");
        thumb.className = "ChangeTimecodeBackground_thumb__vx6J0";
        wrapper.appendChild(thumb);
        
        var slider = document.createElement("input");
        slider.className = "JkKcxRVvjK7lcakkEliC qpvIbN4_hF6CqK0bjCq7 SHvrm0VRiLVwGqJJjNO8 undefined ChangeTimecodeBackground_slider__Jdu3l ChangeTimecodeBackground_important__OSzLR PlayerBarDesktopWithBackgroundProgressBar_slider__SezFn";
        slider.type = "range";
        slider.max = "100";
        slider.value = "0";
        slider.setAttribute("aria-valuetext", "0 секунд");
        slider.setAttribute("aria-label", "Управление таймкодом");
        slider.dataset.testId = "TIMECODE_SLIDER";
        slider.style.backgroundSize = "0% 100%";
        slider.style.setProperty("--seek-before-width", "0%");
        slider.style.setProperty("--buffered-width", "0%");
        wrapper.appendChild(slider);
        
        var bgProgressBar = document.createElement("div");
        bgProgressBar.className = "ChangeTimecodeBackground_backgroundProgressbar__hT_QP";
        wrapper.appendChild(bgProgressBar);
        
        return wrapper;
    }

    function createCoverContainer() {
        var container = document.createElement("div");
        container.className = "qaIScXjx1qyXuaIHXQIo _7gw1qGE6BeUAdSMbhRx ZcpulvHgF_wsgzB8Hye9 PlayerBarDesktopWithBackgroundProgressBar_coverContainer__dkNCG";
        container.dataset.testId = "PLAYERBAR_DESKTOP_COVER_CONTAINER";
        
        var img = document.createElement("img");
        img.className = "qQ7GQU14EkggPBC6jdeS fosYvyLDok3Kjj9OWmxG PlayerBarDesktopWithBackgroundProgressBar_cover__MKmEt";
        img.alt = "";
        img.loading = "eager";
        img.dataset.testId = "ENTITY_COVER_IMAGE";
        img.src = "https://avatars.yandex.net/get-music-content/4796762/7669fe96.a.15647955-1/100x100";
        img.setAttribute("role", "button");
        img.setAttribute("tabindex", "0");
        img.setAttribute("aria-label", "Плеер на весь экран");
        img.addEventListener("click", openNativeFullscreen);
        img.addEventListener("keydown", function(event) {
            if (event.key === "Enter" || event.key === " ") {
                openNativeFullscreen(event);
            }
        });
        container.appendChild(img);
        
        return container;
    }

    function createInfoDiv() {
        var infoDiv = document.createElement("div");
        infoDiv.className = "PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_";
        
        var infoCard = document.createElement("div");
        infoCard.className = "PlayerBarDesktopWithBackgroundProgressBar_infoCard__i0cbW";
        infoDiv.appendChild(infoCard);
        
        var coverContainer = createCoverContainer();
        infoCard.appendChild(coverContainer);
        
        var description = createTrackDescription();
        infoCard.appendChild(description);
        
        return infoDiv;
    }

    function createHomePlayer() {
        var section = document.createElement("section");
        section.className = "PlayerBarDesktopWithBackgroundProgressBar_root__bpmwN PlayerBarDesktopWithBackgroundProgressBar_important__HzXrK CommonLayout_playerBar__zXRxq PlayerBar_root__cXUnU";
        section.dataset.testId = "PLAYERBAR_DESKTOP";
        section.setAttribute(CUSTOM_PLAYER_ATTR, "true");
        section.setAttribute("aria-labelledby", "player-region");
        section.style.setProperty("--player-average-color-background", "var(--ym-background-color-primary-enabled-player)");
        
        var playerBarDiv = document.createElement("div");
        playerBarDiv.className = "PlayerBarDesktopWithBackgroundProgressBar_playerBar__mp0p9";
        section.appendChild(playerBarDiv);
        
        var timecodeWrapper = createTimecodeWrapper();
        playerBarDiv.appendChild(timecodeWrapper);
        
        var playerDiv = createPlayerDiv();
        playerBarDiv.appendChild(playerDiv);
        
        return section;
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
                setDatasetIfChanged(playButton, "state", inMyWave ? (playing ? "pause" : "resume") : "start");
                setAttributeIfChanged(
                    playButton,
                    "aria-label",
                    inMyWave
                        ? (playing ? "Пауза Моей волны" : "Продолжить Мою волну")
                        : "Запустить Мою волну"
                );
                var nextTitle = inMyWave
                    ? (playing ? "Пауза текущей Моей волны" : "Продолжить текущую Мою волну")
                    : "Открыть волну и запустить её";
                if (playButton.title !== nextTitle) {
                    playButton.title = nextTitle;
                }
                var nextDisabled = !inMyWave && !findMyWaveNavButton() && !triggerExists;
                if (playButton.disabled !== nextDisabled) {
                    playButton.disabled = nextDisabled;
                }

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
                var nextStatus = "";
                if (inMyWave) {
                    nextStatus = playing ? "Контекст: Моя волна, сейчас играет" : "Контекст: Моя волна, сейчас на паузе";
                } else if (triggerExists) {
                    nextStatus = "Контекст: не волна, trigger найден";
                } else if (findMyWaveNavButton()) {
                    nextStatus = "Контекст: не волна, trigger ещё не появился";
                } else {
                    nextStatus = "Контекст: не волна, элементы управления не найдены";
                }
                setTextIfChanged(statusNode, nextStatus);
            }
        }, null, "Failed to sync UI");
    }

    function render(options) {
        safeRun(function() {
            cleanupVibeMeta();
            syncVibeAnimation(options.hideVibeAnimation, options.vibeAnimationTop);

            var host = findMainPage();
            if (!host) return;

            var root = ensureRoot(host);
            scheduleLayoutResync(root);
            root.hidden = !options.visible;
            
            ensurePlayerBar(host, options.visible);
            
            if (!options.visible) return;

            syncUi(root);
            ensureVibeMenuOpen();
        }, null, "Render failed");
    }

    function ensurePlayerBar(host, shouldShow) {
        safeRun(function() {
            var existingPlayer = findCustomPlayerBar();
            var canShowInHost = host instanceof HTMLElement;
            
            if (shouldShow && canShowInHost && !existingPlayer) {
                var player = createHomePlayer();
                host.appendChild(player);
                syncPlayerData(player);
            } else if (existingPlayer && shouldShow && canShowInHost) {
                if (existingPlayer.parentElement !== host) {
                    host.appendChild(existingPlayer);
                }
                syncPlayerData(existingPlayer);
            } else if (existingPlayer && (!shouldShow || !canShowInHost)) {
                existingPlayer.remove();
            }
        }, null, "Failed to ensure player bar");
    }

    function mount() {
        if (typeof document === "undefined" || typeof window === "undefined") return;

        var settingsStore = getAddonSettingsStore();
        var settings = settingsStore.getCurrent();
        var updateScheduled = false;
        var bodyObserver = null;
        var pageObserver = null;
        var observedPage = null;

        function scheduleUpdate() {
            if (updateScheduled) return;
            updateScheduled = true;
            requestAnimationFrame(function() {
                updateScheduled = false;
                update();
            });
        }

        function disconnectPageObserver() {
            if (pageObserver) {
                pageObserver.disconnect();
                pageObserver = null;
            }
            observedPage = null;
        }

        function isOwnedNode(node) {
            if (!(node instanceof Element)) return false;
            if (node.id === ROOT_ID || node.closest("#" + ROOT_ID)) return true;
            var player = findCustomPlayerBar();
            return !!(player && (node === player || player.contains(node)));
        }

        function isOwnedMutation(record) {
            if (isOwnedNode(record.target)) return true;

            var nodes = [];
            for (var i = 0; i < record.addedNodes.length; i += 1) {
                nodes.push(record.addedNodes[i]);
            }
            for (var j = 0; j < record.removedNodes.length; j += 1) {
                nodes.push(record.removedNodes[j]);
            }

            if (!nodes.length) return false;
            for (var k = 0; k < nodes.length; k += 1) {
                if (!isOwnedNode(nodes[k])) return false;
            }
            return true;
        }

        function ensurePageObserver() {
            safeRun(function() {
                var page = findMainPage();
                if (!(page instanceof HTMLElement)) {
                    disconnectPageObserver();
                    return false;
                }

                if (observedPage === page && pageObserver) {
                    return true;
                }

                disconnectPageObserver();
                observedPage = page;
                pageObserver = new MutationObserver(function(records) {
                    for (var i = 0; i < records.length; i += 1) {
                        if (!isOwnedMutation(records[i])) {
                            scheduleUpdate();
                            return;
                        }
                    }
                });
                pageObserver.observe(page, {
                    attributes: true,
                    attributeFilter: ["aria-label", "aria-pressed", "class", "data-test-id", "src", "srcset"],
                    childList: true,
                    subtree: true
                });
                return true;
            }, false, "Failed to ensure page observer");
        }

        function ensureBodyObserver() {
            safeRun(function() {
                if (bodyObserver || !document.body) return;
                bodyObserver = new MutationObserver(function() {
                    var previousPage = observedPage;
                    var hasPageObserver = ensurePageObserver();
                    if (hasPageObserver && observedPage !== previousPage) {
                        scheduleUpdate();
                    }
                });
                bodyObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }, null, "Failed to ensure body observer");
        }

        function update() {
            safeRun(function() {
                ensurePageObserver();
                render({
                    visible: readBooleanSetting(settings, "enabled", true),
                    hideVibeAnimation: readBooleanSetting(settings, "hideVibeAnimation", false),
                    vibeAnimationTop: readNumberSetting(settings, "vibeAnimationTop", -70)
                });
            }, null, "Update failed");
        }

        function start() {
            safeRun(function() {
                ensureBodyObserver();
                ensurePageObserver();
                update();
            }, null, "Start failed");
        }

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", start, { once: true });
        } else {
            start();
        }

        safeRun(function() {
            settingsStore.onChange(function(nextSettings) {
                settings = nextSettings || {};
                update();
            });
        }, null, "Failed to subscribe to settings");

    }

    mount();
})();
