const { addonBuilder } = require('stremio-addon-sdk')
const fetch = require('node-fetch')

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
        this.headers = {
            'x-e-h': '7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk'
        }
    }

    async makeRequest(url) {
        try {
            const response = await fetch(url, { headers: this.headers })
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
            return await response.json()
        } catch (error) {
            console.error('Request failed:', error)
            return null
        }
    }

    async getContent(type, page = 1) {
        const url = `${this.baseUrl}/secure/titles?type=${type}&onlyStreamable=true&page=${page}&perPage=16`
        const data = await this.makeRequest(url)
        if (!data?.pagination?.data) return []

        return data.pagination.data.map(anime => ({
            id: `${anime.id}`,
            type: 'anime',
            name: anime.title,
            poster: anime.poster
        }))
    }

    async search(query) {
        const url = `${this.baseUrl}/secure/search/${encodeURIComponent(query)}?limit=20`
        const data = await this.makeRequest(url)
        if (!data?.results) return []

        return data.results.map(anime => ({
            id: `${anime.id}`,
            type: 'anime',
            name: anime.title,
            poster: anime.poster
        }))
    }

    async getAnimeDetails(id) {
        const url = `${this.baseUrl}/secure/titles/${id}?titleId=${id}`
        const data = await this.makeRequest(url)
        if (!data?.title) return null

        const episodes = []
        if (data.title.title_type === 'anime') {
            for (const season of data.title.seasons) {
                const seasonData = await this.makeRequest(
                    `${this.baseUrl}/secure/related-videos?episode=1&season=${season.number}&videoId=0&titleId=${id}`
                )
                if (seasonData?.videos) {
                    for (const video of seasonData.videos) {
                        episodes.push({
                            id: video.url,
                            title: `${video.season_num}. Sezon ${video.episode_num}. Bölüm`,
                            season: video.season_num,
                            episode: video.episode_num
                        })
                    }
                }
            }
        } else if (data.title.videos?.length > 0) {
            episodes.push({
                id: data.title.videos[0].url,
                title: 'Filmi İzle',
                season: 1,
                episode: 1
            })
        }

        return {
            id: `${data.title.id}`,
            type: 'anime',
            name: data.title.title,
            poster: data.title.poster,
            description: data.title.description,
            year: data.title.year,
            genres: data.title.tags?.filter(Boolean).map(tag => tag.name) || [],
            cast: data.title.actors?.filter(Boolean).map(actor => actor.name) || [],
            videos: episodes
        }
    }

    async getStreamUrl(url) {
        try {
            const response = await fetch(`${this.baseUrl}/${url}`, {
                headers: {
                    'Referer': this.baseUrl + '/'
                }
            })
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
            return response.url
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
    const page = extra.skip ? Math.floor(extra.skip / 16) + 1 : 1
    
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
            genres: data.genres,
            cast: data.cast,
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