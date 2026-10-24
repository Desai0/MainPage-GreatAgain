const addonConfig = {
    id: '53a5ab330f89df3ced0497c8',
    directoryName: '53a5ab330f89df3ced0497c8',
    name: 'YM Old Home UI',
    description: 'Реализует старый интерфейс Моей волны на главной странице Яндекс Музыки. Позволяет настроить Vibe анимацию',
    version: '1.5.1',
    author: ['desaichk', 'thekingoftime'],
    image: 'orig.png',
    banner: '1.png',
    libraryLogo: 'orig.png',
    tags: ['Old UI', 'Themed', 'No new Vibe'],
    dependencies: [],
    allowedUrls: [],
    supportedVersions: ['>=5.90.0'],
    cssScope: 'global',
    requirements: {
        minHostApi: 1,
        capabilities: ['lifecycle-v1', 'async-start-v1', 'net-per-addon-v1'],
    },
}

export default addonConfig
