import { defineAddonSettings, SettingType } from '@pulsesync/addon-sdk'

export const settings = defineAddonSettings({
    enabled: {
        type: SettingType.BOOLEAN,
        name: 'Enable old home block',
        description: 'Показывать старый блок Моей волны на главной странице.',
        default: true,
    },
    hideVibeAnimation: {
        type: SettingType.BOOLEAN,
        name: 'Hide vibe animation',
        description: 'Скрывать анимацию Моей волны.',
        default: false,
    },
    newHomeUiVariant: {
        type: SettingType.SELECT,
        name: 'Колесо волны',
        description: 'Выбор варианта оформления колеса волны.',
        default: 'old',
        options: [
            { label: 'Старый', value: 'old' },
            { label: 'Альтернативный', value: 'customWaveWheel' },
            { label: 'Новый', value: 'new' },
        ],
    },
    canvasBlur: {
        type: SettingType.NUMBER,
        name: 'Размытие',
        description: 'Размытие анимации в пикселях. При использовании ChromaSync отключите кастомный цвет Волны или оставьте фильтры по умолчанию.',
        min: 0, max: 20, step: 1, default: 0,
    },
    canvasSaturate: {
        type: SettingType.NUMBER,
        name: 'Насыщенность',
        min: 0, max: 5, step: 0.1, default: 1,
    },
    canvasContrast: {
        type: SettingType.NUMBER,
        name: 'Контраст',
        min: 0, max: 5, step: 0.1, default: 1,
    },
    canvasBrightness: {
        type: SettingType.NUMBER,
        name: 'Яркость',
        min: 0, max: 3, step: 0.1, default: 1,
    },
    canvasScale: {
        type: SettingType.NUMBER,
        name: 'Размер',
        min: 0.5, max: 2, step: 0.05, default: 1.2,
    },
}, { title: 'Old Home UI' })
