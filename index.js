const { addonBuilder } = require('stremio-addon-sdk')
const crypto = require('crypto')
const cheerio = require('cheerio')
const chromium = require('chrome-aws-lambda')

const manifest = {
    id: 'org.inatbox',
    version: '1.0.0',
    name: 'InatBox',
    description: 'InatBox içeriklerini Stremio\'da izleyin',
    resources: ['stream', 'catalog', 'meta'],
    types: ['movie', 'series', 'tv'],
    catalogs: [
        { type: 'movie', id: 'inatbox-movies' },
        { type: 'series', id: 'inatbox-series' },
        { type: 'tv', id: 'inatbox-tv' }
    ]
}

const AES_KEY = "ywevqtjrurkwtqgz"

class InatAPI {
    constructor() {
        this.domains = [
            "https://dizibox.tv",
            "https://www.dizibox.vip",
            "https://dizibox.cloud",
            "https://www.dizibox.watch",
            "https://dizibox.plus"
        ]
        this.contentUrl = this.domains[0]
        this.browser = null
        console.log('InatAPI initialized with contentUrl:', this.contentUrl)
    }

    async initBrowser() {
        if (!this.browser) {
            console.log('Launching browser...')
            this.browser = await chromium.puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath,
                headless: true,
                ignoreHTTPSErrors: true
            })
            console.log('Browser launched')
        }
        return this.browser
    }

    async findWorkingDomain() {
        const browser = await this.initBrowser()
        const page = await browser.newPage()
        
        for (const domain of this.domains) {
            try {
                console.log('Trying domain:', domain)
                await page.goto(`${domain}/yerli-dizi`, {
                    waitUntil: 'networkidle0',
                    timeout: 30000
                })
                
                // Cloudflare bypass kontrolü
                await page.waitForFunction(() => !document.querySelector('.cf-browser-verification'), { timeout: 30000 })
                
                console.log('Found working domain:', domain)
                this.contentUrl = domain
                await page.close()
                return true
            } catch (error) {
                console.log('Domain failed:', domain, error.message)
                continue
            }
        }
        await page.close()
        return false
    }

    async makeRequest(url) {
        console.log('Making request to:', url)
        
        if (this.isDirectStreamUrl(url)) {
            console.log('Direct stream URL detected:', url)
            return { chUrl: url, chName: 'Direct Stream' }
        }

        const browser = await this.initBrowser()
        const page = await browser.newPage()
        
        try {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000
            })
            
            // Cloudflare bypass kontrolü
            await page.waitForFunction(() => !document.querySelector('.cf-browser-verification'), { timeout: 30000 })
            
            const content = await page.content()
            const items = this.parseHtmlResponse(content)
            
            await page.close()
            return items
        } catch (error) {
            console.error('Request failed:', error)
            await page.close()
            return null
        }
    }

    isDirectStreamUrl(url) {
        return url.includes('.m3u8') || url.includes('.mp4')
    }

    parseHtmlResponse(html) {
        const items = []
        const $ = cheerio.load(html)
        
        // Film/dizi kartlarını bul
        $('.film-item').each((i, elem) => {
            try {
                const $elem = $(elem)
                const name = $elem.find('a').attr('title')
                const url = $elem.find('a').attr('href')
                const img = $elem.find('img').attr('src')
                const detail = $elem.find('.film-description').text()
                
                if (name && url) {
                    items.push({
                        diziName: name,
                        diziUrl: url.startsWith('http') ? url : this.contentUrl + url,
                        diziImg: img || '',
                        diziDetay: detail ? detail.trim() : ''
                    })
                }
            } catch (error) {
                console.error('Error parsing item:', error)
            }
        })
        
        return items
    }

    decryptResponse(encryptedText) {
        try {
            if (!encryptedText.includes(':')) {
                throw new Error('Invalid encrypted text format')
            }

            const parts = encryptedText.split(':')
            const iv = Buffer.from(AES_KEY)
            
            // First decryption
            const decipher1 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(AES_KEY), iv)
            let decrypted1 = decipher1.update(Buffer.from(parts[0], 'base64'))
            decrypted1 = Buffer.concat([decrypted1, decipher1.final()])
            
            // Second decryption
            const innerParts = decrypted1.toString().split(':')
            const decipher2 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(AES_KEY), iv)
            let decrypted2 = decipher2.update(Buffer.from(innerParts[0], 'base64'))
            decrypted2 = Buffer.concat([decrypted2, decipher2.final()])
            
            return JSON.parse(decrypted2.toString())
        } catch (error) {
            console.error('Decryption failed:', error)
            return null
        }
    }

    async getContent(type) {
        // Çalışan domain'i bul
        await this.findWorkingDomain()
        
        let url
        switch(type) {
            case 'movie':
                url = `${this.contentUrl}/film/yerli-filmler`
                break
            case 'series':
                url = `${this.contentUrl}/yerli-dizi`
                break
            case 'tv':
                url = `${this.contentUrl}/tv/ulusal`
                break
            default:
                throw new Error('Invalid content type')
        }

        console.log('Fetching content from:', url)
        const data = await this.makeRequest(url)
        return data
    }

    async getStreamUrls(contentUrl) {
        try {
            const data = await this.makeRequest(contentUrl)
            if (!data) return []

            let streams = []

            const processItem = async (item) => {
                if (!item) return

                // Direkt stream URL'i varsa
                if (item.chUrl && this.isDirectStreamUrl(item.chUrl)) {
                    streams.push({
                        title: item.chName || 'Stream',
                        url: item.chUrl
                    })
                    return
                }

                // Alt kaynak URL'i varsa
                if (item.chUrl) {
                    const subData = await this.makeRequest(item.chUrl)
                    
                    if (Array.isArray(subData)) {
                        for (const subItem of subData) {
                            await processItem(subItem)
                        }
                    } else if (subData) {
                        await processItem(subData)
                    }
                }

                // Dizi bölümleri varsa
                if (item.diziUrl) {
                    const episodeData = await this.makeRequest(item.diziUrl)
                    if (Array.isArray(episodeData)) {
                        for (const episode of episodeData) {
                            await processItem(episode)
                        }
                    }
                }
            }

            if (Array.isArray(data)) {
                for (const item of data) {
                    await processItem(item)
                }
            } else {
                await processItem(data)
            }

            return streams

        } catch (error) {
            console.error('getStreamUrls error:', error)
            return []
        }
    }
}

const inatAPI = new InatAPI()

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id }) => {
    console.log('Catalog request for type:', type)
    const data = await inatAPI.getContent(type)
    if (!data) return { metas: [] }

    const metas = data.map(item => {
        const id = item.diziUrl || item.chUrl
        const name = item.diziName || item.chName
        const poster = item.diziImg || item.chImg
        
        console.log(`Processing item: ${name} - ${id}`)
        
        return {
            id: id,
            type: type,
            name: name,
            poster: poster,
            description: item.diziDetay || ''
        }
    })

    return { metas }
})

builder.defineMetaHandler(async ({ type, id }) => {
    console.log('Meta request for:', id)
    try {
        const data = await inatAPI.makeRequest(id)
        if (!data) return { meta: null }

        const meta = {
            id: id,
            type: type,
            name: data.diziName || data.chName,
            poster: data.diziImg || data.chImg,
            description: data.diziDetay || ''
        }

        // Diziler için sezon ve bölüm bilgisini ekle
        if (type === 'series' && Array.isArray(data)) {
            meta.videos = data.map((episode, index) => ({
                id: episode.chUrl,
                title: episode.chName,
                season: 1,
                episode: index + 1
            }))
        }

        return { meta }
    } catch (error) {
        console.error('Meta handler error:', error)
        return { meta: null }
    }
})

builder.defineStreamHandler(async ({ type, id }) => {
    console.log('Stream request for:', id)
    try {
        const streams = await inatAPI.getStreamUrls(id)
        console.log('Found streams:', streams)
        
        return {
            streams: streams.map(stream => ({
                title: stream.title,
                url: stream.url,
                behaviorHints: {
                    notWebReady: true
                }
            }))
        }
    } catch (error) {
        console.error('Stream handler error:', error)
        return { streams: [] }
    }
})

module.exports = builder.getInterface()