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

    function getTrackDataFromDom() {
        return safeRun(function() {
            var ourPlayer = document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"]');

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
                            href: artistLink.getAttribute("href") || "#"
                        });
                    } else {
                        // No link found, use text from title
                        artistsFromTitle.push({
                            text: artistName,
                            href: "#"
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

            // Artists — skip elements inside our player
            var allArtists = document.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]');
            var artistLinks = [];
            for (var k = 0; k < allArtists.length; k++) {
                if (!ourPlayer || !ourPlayer.contains(allArtists[k])) {
                    artistLinks.push(allArtists[k]);
                }
            }

            // Use artists from title if no artists found outside player
            var finalArtists = artistLinks.length > 0 
                ? artistLinks.map(function(a) { return { text: a.textContent.trim(), href: a.getAttribute("href") }; })
                : artistsFromTitle;

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

            var cover = playerEl.querySelector('[data-test-id="ENTITY_COVER_IMAGE"]');
            if (cover) {
                cover.src = data.coverSrc;
                cover.srcset = data.coverSrcset;
            }

            var titleLink = playerEl.querySelector('[data-test-id="TRACK_TITLE"]');
            if (titleLink) {
                titleLink.setAttribute("aria-label", "Трек " + data.title);
                titleLink.href = data.titleHref || "#";
                var titleSpan = titleLink.querySelector(".Meta_title__GGBnH");
                if (titleSpan) titleSpan.textContent = data.title;
            }

            var artistsDiv = playerEl.querySelector(".Meta_artists__VnR52");
            if (artistsDiv && data.artists.length) {
                artistsDiv.innerHTML = "";
                data.artists.forEach(function(artist, i) {
                    var a = document.createElement("a");
                    a.className = "buOTZq_TKQOVyjMLrXvB Meta_text__Y5uYH Meta_link__IFDBA";
                    a.setAttribute("aria-label", "Артист " + artist.text);
                    a.dataset.testId = "SEPARATED_ARTIST_TITLE";
                    a.href = artist.href || "#";
                    var span = document.createElement("span");
                    span.className = "_MWOVuZRvUQdXKTMcOPx Z_WIr2W8JU4MPQek3hgR _3_Mxw7Si7j2g4kWjlpR Meta_text__Y5uYH Meta_artistCaption__JESZi";
                    span.textContent = artist.text;
                    a.appendChild(span);
                    artistsDiv.appendChild(a);
                    if (i < data.artists.length - 1) {
                        artistsDiv.appendChild(document.createTextNode(", "));
                    }
                });
            }

            var playing = isPlaying();
            var playBtn = playerEl.querySelector('[data-test-id="PLAY_BUTTON"]');
            var pauseBtn = playerEl.querySelector('[data-test-id="PAUSE_BUTTON"]');
            if (playing) {
                if (playBtn) {
                    playBtn.dataset.testId = "PAUSE_BUTTON";
                    playBtn.setAttribute("aria-label", "Пауза");
                    var svg = playBtn.querySelector("use");
                    if (svg) svg.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/icons/sprite.svg#pause_filled_l");
                }
            } else {
                if (pauseBtn) {
                    pauseBtn.dataset.testId = "PLAY_BUTTON";
                    pauseBtn.setAttribute("aria-label", "Воспроизведение");
                    var svg2 = pauseBtn.querySelector("use");
                    if (svg2) svg2.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/icons/sprite.svg#play_filled_l");
                }
            }
        }, null, "Failed to sync player data");
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

    function createHomePlayer() {
        var section = document.createElement("section");
        section.className = "PlayerBarDesktopWithBackgroundProgressBar_root__bpmwN PlayerBarDesktopWithBackgroundProgressBar_important__HzXrK CommonLayout_playerBar__zXRxq PlayerBar_root__cXUnU";
        section.dataset.testId = "PLAYERBAR_DESKTOP";
        section.setAttribute("aria-labelledby", "player-region");
        section.style.setProperty("--player-average-color-background", "hsl(240, 60%, 20%)");
        
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
        div.appendChild(img);
        
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
            findOriginalMenuButton("repeat_xs", function(originalButton) {
                if (originalButton) {
                    dispatchClick(originalButton);
                }
            });
        });
        
        return div;
    }

    function ensureVibeMenuOpen() {
        safeRun(function() {
            var menu = document.querySelector('.VibeContextMenu_root__872YP');
            if (!menu) {
                var menuTrigger = document.querySelector('button[aria-label="Контекстное меню"][aria-haspopup="dialog"]');
                if (menuTrigger && menuTrigger.getAttribute('aria-expanded') !== 'true') {
                    dispatchClick(menuTrigger);
                }
            }
        }, null, "Failed to ensure vibe menu open");
    }

    function findOriginalMenuButton(iconId, callback) {
        return safeRun(function() {
            var menu = document.querySelector('.VibeContextMenu_root__872YP');
            var button = menu ? clickMenuButton(menu, iconId) : null;
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
            toggleMyWave().catch(function(error) {
                logError("Failed to toggle playback", error);
            });
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
            findOriginalMenuButton("syncLyrics_xs", function(originalButton) {
                if (originalButton) {
                    dispatchClick(originalButton);
                }
            });
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
            findOriginalMenuButton("playQueue_xs", function(originalButton) {
                if (originalButton) {
                    dispatchClick(originalButton);
                }
            });
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
            findOriginalMenuButton("settings_xs", function(originalButton) {
                if (originalButton) {
                    dispatchClick(originalButton);
                }
            });
        });
        
        return wrapper;
    }

    function createVolumeControl() {
        var originalVolume = document.querySelector('.ChangeVolume_root__HDxtA.VibePlayerBar_changeVolume__x7FHC');
        if (originalVolume) {
            originalVolume.classList.remove('VibePlayerBar_changeVolume__x7FHC');
            return originalVolume;
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
        section.setAttribute("aria-labelledby", "player-region");
        section.style.setProperty("--player-average-color-background", "hsl(240, 60%, 20%)");
        
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
            
            ensurePlayerBar(host, options.visible);
            
            if (!options.visible) return;

            syncUi(root);
            ensureVibeMenuOpen();
        }, null, "Render failed");
    }

    function ensurePlayerBar(host, shouldShow) {
        safeRun(function() {
            var existingPlayer = document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"]');
            var inVibeContext = isMyWaveContext();
            var canShowInHost = host instanceof HTMLElement;
            
            if (inVibeContext && shouldShow && canShowInHost && !existingPlayer) {
                var player = createHomePlayer();
                host.appendChild(player);
                syncPlayerData(player);
            } else if (existingPlayer && inVibeContext && shouldShow && canShowInHost) {
                if (existingPlayer.parentElement !== host) {
                    host.appendChild(existingPlayer);
                }
                syncPlayerData(existingPlayer);
            } else if (existingPlayer && (!inVibeContext || !shouldShow || !canShowInHost)) {
                existingPlayer.remove();
            }
        }, null, "Failed to ensure player bar");
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
