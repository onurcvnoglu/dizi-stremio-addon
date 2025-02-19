const { getRouter } = require('stremio-addon-sdk')
const addonInterface = require('./index.js')

const EXTERNAL_URL = 'https://dizi-stremio-addon.vercel.app'

const router = getRouter(addonInterface)

// Vercel için export
module.exports = async (req, res) => {
    await router.handle(req, res)
}