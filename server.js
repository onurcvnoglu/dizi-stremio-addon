const { addonBuilder } = require('stremio-addon-sdk')
const addonInterface = require('./index.js')

const EXTERNAL_URL = 'https://dizi-stremio-addon.vercel.app'

// Vercel için export
module.exports = async (req, res) => {
    const { getRouter } = require('stremio-addon-sdk')
    const router = getRouter(addonInterface)
    
    return new Promise((resolve, reject) => {
        router.handle(req, res, (err) => {
            if (err) {
                console.error('Router error:', err)
                res.statusCode = 500
                res.end(JSON.stringify({ error: 'Internal server error' }))
                return reject(err)
            }
            resolve()
        })
    })
}