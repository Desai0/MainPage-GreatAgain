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
        return {
            enabled: val("enabled", true),
            hideVibeAnimation: val("hideVibeAnimation", false),
            canvasBlur: val("canvasBlur", 0),
            canvasSaturate: val("canvasSaturate", 1),
            canvasContrast: val("canvasContrast", 1),
            canvasBrightness: val("canvasBrightness", 1),
            canvasScale: val("canvasScale", 1),
            onChange: store ? store.onChange.bind(store) : function () { }
        };
    }

    function isMyWave() {
        var ctx = window.sonataState?.currentContext;
        if (ctx && ctx.observableValue) ctx = ctx.observableValue.value;
        if (ctx && ctx.value) ctx = ctx.value;
        if (!ctx) return false;
        return ctx.type === "vibe" || ctx.contextData?.type === "vibe" || ctx.isVibeStarted || ctx.rotorResource != null;
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

    async function toggleMyWave() {
        if (isMyWave()) {
            var btn = document.querySelector(isPlaying() ? '[data-test-id="PAUSE_BUTTON"]' : '[data-test-id="PLAY_BUTTON"]');
            click(btn);
            return;
        }

        var nav = document.querySelector('[data-test-id="NAVBAR_NAVIGATION_ITEM_HOME"]');
        click(nav);

        for (var i = 0; i < 20; i++) {
            var trigger = Array.from(document.querySelectorAll("button")).find(function (b) {
                return /включить мою волну/i.test(b.getAttribute("aria-label") || "");
            });
            if (trigger) {
                click(trigger);
                break;
            }
            await new Promise(function (resolve) { setTimeout(resolve, 100); });
        }
    }

    function toggleSettings() {
        var root = document.getElementById(ROOT_ID);
        if (root) {
            root.classList.toggle("ps-settings-open");
        }
        document.body.classList.toggle("ps-settings-open");
        var VibePage_wheel__E_p8_ = document.querySelector(".VibePage_wheel__E_p8_");
        if (VibePage_wheel__E_p8_) {
            VibePage_wheel__E_p8_.classList.toggle("ps-VibePage_wheel__E_p8_-hidden-right");
        }
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

    function createPlayButton() {
        var button = document.createElement("button");
        button.className = "cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C PlayButton_root__nYKdN VibeBlock_playButton__6xU55 ps-vibe-play-button";
        button.type = "button";
        button.dataset.testId = "PS_VIBE_PLAY_BUTTON";
        button.setAttribute("aria-label", "Моя волна");

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
        button.appendChild(iconWrap);

        var label = document.createElement("span");
        label.className = "ps-vibe-button-label";
        label.textContent = "Моя волна";
        button.appendChild(label);

        button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            toggleMyWave().catch(console.error);
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

        button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            toggleSettings();
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
        root.appendChild(createPlayButton());
        root.appendChild(createSettingsButton());
        root.appendChild(createStatusNode());

        host.appendChild(root);
        return root;
    }

    function syncUi(root) {
        var playButton = root.querySelector(".ps-vibe-play-button");
        if (!playButton) return;

        var active = isMyWave();
        var playing = isPlaying();

        syncDataset(playButton, "state", active ? (playing ? "pause" : "resume") : "start");
        syncAttr(playButton, "aria-label", active ? (playing ? "Пауза Моей волны" : "Продолжить Мою волну") : "Запустить Мою волну");

        var playGlyph = playButton.querySelector('[data-icon-role="play"]');
        var pauseGlyph = playButton.querySelector('[data-icon-role="pause"]');
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

    function mount() {
        if (typeof document === "undefined" || typeof window === "undefined") return;

        var store = getSettings();

        var lastState = {
            enabled: null,
            hideVibeAnimation: null,
            canvasBlur: null,
            canvasSaturate: null,
            canvasContrast: null,
            canvasBrightness: null,
            canvasScale: null,
            active: null,
            playing: null
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

            var active = isMyWave();
            var playing = isPlaying();
            var rootExists = !!host.querySelector("#" + ROOT_ID);

            if (
                rootExists &&
                lastState.enabled === settings.enabled &&
                lastState.hideVibeAnimation === settings.hideVibeAnimation &&
                lastState.canvasBlur === settings.canvasBlur &&
                lastState.canvasSaturate === settings.canvasSaturate &&
                lastState.canvasContrast === settings.canvasContrast &&
                lastState.canvasBrightness === settings.canvasBrightness &&
                lastState.canvasScale === settings.canvasScale &&
                lastState.active === active &&
                lastState.playing === playing
            ) {
                return;
            }

            lastState.enabled = settings.enabled;
            lastState.hideVibeAnimation = settings.hideVibeAnimation;
            lastState.canvasBlur = settings.canvasBlur;
            lastState.canvasSaturate = settings.canvasSaturate;
            lastState.canvasContrast = settings.canvasContrast;
            lastState.canvasBrightness = settings.canvasBrightness;
            lastState.canvasScale = settings.canvasScale;
            lastState.active = active;
            lastState.playing = playing;

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
        document.addEventListener("click", function () { setTimeout(update, 50); }, true);

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
