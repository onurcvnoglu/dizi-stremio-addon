const { addonBuilder } = require('stremio-addon-sdk')
const fetch = require('node-fetch')
const cheerio = require('cheerio')

const manifest = {
    id: 'org.animecix',
    version: '1.0.0',
    name: 'AnimeciX',
    description: 'AnimeciX içeriklerini Stremio\'da izleyin',
    resources: ['stream', 'catalog', 'meta'],
    types: ['anime'],
    catalogs: [
        { type: 'anime', id: 'animecix-series' },
        { type: 'anime', id: 'animecix-movies' }
    ]
}

class AnimeciXAPI {
    constructor() {
        this.baseUrl = 'https://animecix.net'
        this.defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    }

    async makeRequest(url) {
        try {
            console.log('Making request to:', url)
            const response = await fetch(url, { 
                headers: this.defaultHeaders
            })
            
            if (!response.ok) {
                console.error('Response status:', response.status)
                throw new Error(`HTTP error! status: ${response.status}`)
            }
            
            return await response.text()
        } catch (error) {
            console.error('Request failed:', error)
            return null
        }
    }

    async getContent(type, page = 1) {
        const url = `${this.baseUrl}/browse?onlyStreamable=true&page=${page}${type === 'movie' ? '&type=movie' : ''}`
            
        const html = await this.makeRequest(url)
        if (!html) return []

        const $ = cheerio.load(html)
        const items = []

        $('.browse-item').each((i, elem) => {
            const $item = $(elem)
            const title = $item.find('.browse-title').text().trim()
            const href = $item.find('a').attr('href')
            const id = href ? href.split('/').filter(Boolean).pop() : null
            const poster = $item.find('img').attr('src')
            const description = $item.find('.browse-description').text().trim()

            if (title && id) {
                items.push({
                    id,
                    type: 'anime',
                    name: title,
                    poster,
                    description
                })
            }
        })

        return items
    }

    async getAnimeDetails(id) {
        const url = `${this.baseUrl}/titles/${id}`
        const html = await this.makeRequest(url)
        if (!html) return null

        const $ = cheerio.load(html)
        const title = $('.title-name').text().trim()
        const poster = $('.title-poster img').attr('src')
        const description = $('.title-description').text().trim()
        const year = $('.title-year').text().trim()
        
        const episodes = []
        $('.episode-box').each((i, elem) => {
            const $episode = $(elem)
            const epTitle = $episode.find('.episode-title').text().trim()
            const epUrl = $episode.find('a').attr('href')
            const epNum = $episode.find('.episode-number').text().trim()
            const seasonNum = $episode.find('.season-number').text().trim() || '1'

            if (epUrl) {
                episodes.push({
                    id: epUrl,
                    title: epTitle || `Bölüm ${epNum}`,
                    season: parseInt(seasonNum),
                    episode: parseInt(epNum)
                })
            }
        })

        return {
            id,
            type: 'anime',
            name: title,
            poster,
            description,
            year: parseInt(year),
            videos: episodes
        }
    }

    async getStreamUrl(url) {
        try {
            const html = await this.makeRequest(url)
            if (!html) return null

            const $ = cheerio.load(html)
            const videoUrl = $('video source').attr('src') || 
                           $('.video-player iframe').attr('src') ||
                           $('#video-player').attr('data-url')
            
            return videoUrl || null
        } catch (error) {
            console.error('Stream URL request failed:', error)
            return null
        }
    }
}

const api = new AnimeciXAPI()

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log('Catalog request:', type, id, extra)
    const page = extra.skip ? Math.floor(extra.skip / 20) + 1 : 1
    
    let metas = []
    if (id === 'animecix-series') {
        metas = await api.getContent('series', page)
    } else if (id === 'animecix-movies') {
        metas = await api.getContent('movie', page)
    }

    return { metas }
})

builder.defineMetaHandler(async ({ type, id }) => {
    console.log('Meta request for:', type, id)
    const data = await api.getAnimeDetails(id)
    if (!data) return { meta: null }

    return {
        meta: {
            id: data.id,
            type: data.type,
            name: data.name,
            poster: data.poster,
            background: data.poster,
            description: data.description,
            year: data.year,
            videos: data.videos
        }
    }
})

builder.defineStreamHandler(async ({ type, id }) => {
    console.log('Stream request for:', id)
    const streamUrl = await api.getStreamUrl(id)
    if (!streamUrl) return { streams: [] }

    return {
        streams: [{
            title: 'AnimeciX',
            url: streamUrl,
            behaviorHints: {
                notWebReady: true
            }
        }]
    }
})

module.exports = builder.getInterface()