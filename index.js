const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const manifest = {
    id: 'com.stremio.animecix',
    version: '1.0.0',
    name: 'AnimeciX',
    description: 'AnimeciX Anime İzleme Eklentisi',
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'movie',
            id: 'animecix_movies',
            name: 'AnimeciX Filmler'
        },
        {
            type: 'series',
            id: 'animecix_series',
            name: 'AnimeciX Seriler'
        }
    ],
    resources: ['catalog', 'stream', 'meta'],
    idPrefixes: ['animecix_']
};

const builder = new addonBuilder(manifest);

const MAIN_URL = 'https://animecix.net';
const API_HEADERS = {
    'x-e-h': '7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk'
};

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const page = extra.skip ? Math.floor(extra.skip / 16) + 1 : 1;
    const contentType = type === 'movie' ? 'movie' : 'series';
    
    try {
        const response = await fetch(
            `${MAIN_URL}/secure/titles?type=${contentType}&onlyStreamable=true&page=${page}&perPage=16`,
            { headers: API_HEADERS }
        );
        const data = await response.json();

        const metas = data.pagination.data.map(item => ({
            id: `animecix_${item.id}`,
            type: type,
            name: item.title,
            poster: item.poster,
        }));

        return { metas };
    } catch (error) {
        console.error('Katalog yüklenirken hata:', error);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ type, id }) => {
    const titleId = id.replace('animecix_', '');
    
    try {
        const response = await fetch(
            `${MAIN_URL}/secure/titles/${titleId}?titleId=${titleId}`,
            { headers: API_HEADERS }
        );
        const data = await response.json();
        const title = data.title;

        return {
            meta: {
                id: `animecix_${title.id}`,
                type: title.title_type === 'anime' ? 'series' : 'movie',
                name: title.title,
                poster: title.poster,
                background: title.poster,
                description: title.description,
                year: title.year,
                releaseInfo: title.year?.toString(),
                imdbRating: title.rating,
                genres: title.tags?.map(tag => tag.name) || [],
                videos: title.videos || [],
                seasons: title.seasons || []
            }
        };
    } catch (error) {
        console.error('Meta yüklenirken hata:', error);
        return { meta: {} };
    }
});

builder.defineStreamHandler(async ({ type, id }) => {
    const titleId = id.replace('animecix_', '');
    
    try {
        const response = await fetch(
            `${MAIN_URL}/secure/titles/${titleId}?titleId=${titleId}`,
            { headers: API_HEADERS }
        );
        const data = await response.json();
        
        const streams = [];
        
        if (data.title.videos && data.title.videos.length > 0) {
            for (const video of data.title.videos) {
                const videoUrl = video.url;
                if (videoUrl) {
                    streams.push({
                        title: `AnimeciX - ${video.season_num ? `S${video.season_num}E${video.episode_num}` : 'Film'}`,
                        url: videoUrl,
                        behaviorHints: {
                            notWebReady: true
                        }
                    });
                }
            }
        }

        return { streams };
    } catch (error) {
        console.error('Stream yüklenirken hata:', error);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();

module.exports = addonInterface;
