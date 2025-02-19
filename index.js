const { addonBuilder } = require('stremio-addon-sdk')
const crypto = require('crypto')
const fetch = require('node-fetch')

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
        this.contentUrl = "https://dizibox.rest"
        console.log('InatAPI initialized with contentUrl:', this.contentUrl)
    }

    isDirectStreamUrl(url) {
        return url.includes('.m3u8') || url.includes('.mp4')
    }

    async makeRequest(url) {
        console.log('Making request to:', url)
        
        // Eğer direkt stream URL'i ise, decrypt etmeye çalışma
        if (this.isDirectStreamUrl(url)) {
            console.log('Direct stream URL detected:', url)
            return { chUrl: url, chName: 'Direct Stream' }
        }

        const hostname = new URL(url).hostname
        const headers = {
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Host': hostname,
            'Referer': 'https://speedrestapi.com/',
            'X-Requested-With': 'com.bp.box',
            'User-Agent': 'speedrestapi'
        }

        const body = `1=${AES_KEY}&0=${AES_KEY}`

        try {
            console.log('Sending POST request with headers:', headers)
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body
            })

            if (!response.ok) {
                console.error('HTTP error:', response.status, response.statusText)
                throw new Error(`HTTP error! status: ${response.status}`)
            }
            
            const text = await response.text()
            console.log('Response received, length:', text.length)
            
            // Yanıt zaten JSON formatında mı kontrol et
            try {
                const jsonData = JSON.parse(text)
                console.log('Response is valid JSON')
                return jsonData
            } catch {
                console.log('Response is encrypted, attempting to decrypt')
                return this.decryptResponse(text)
            }
        } catch (error) {
            console.error('Request failed:', error)
            return null
        }
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
        let url
        switch(type) {
            case 'movie':
                url = `${this.contentUrl}/film/yerli-filmler.php`
                break
            case 'series':
                url = `${this.contentUrl}/yerli-dizi/index.php`
                break
            case 'tv':
                url = `${this.contentUrl}/tv/ulusal.php`
                break
            default:
                throw new Error('Invalid content type')
        }

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