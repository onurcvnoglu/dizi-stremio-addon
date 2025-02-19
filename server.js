const { serveHTTP, publishToCentral } = require('stremio-addon-sdk')
const addonInterface = require('./index.js')

const EXTERNAL_URL = 'https://dizi-stremio-addon.vercel.app' // Sunucunuzun gerçek IP'sini yazın

serveHTTP(addonInterface, { 
    port: 2500, 
    address: '0.0.0.0', // Tüm IP'lerden gelen bağlantılara izin ver
    static: '/public', // Statik dosyalar için klasör
    urlPrefix: EXTERNAL_URL,
    cache: {
        maxAge: 0, // Önbelleği devre dışı bırak
        public: true
    },
    cors: true // CORS'u etkinleştir
})
.then(({ url }) => {
    console.log('Sunucu başlatıldı!')
    console.log('Dinlenen port:', 2500)
    console.log('Dinlenen adres:', '0.0.0.0')
    console.log('Dış URL:', EXTERNAL_URL)
    console.log('Addon aktif! URL:', url)
    console.log('Stremio\'ya eklemek için bu URL\'yi kullanabilirsiniz:', `${EXTERNAL_URL}/manifest.json`)
    
    // Eklentiyi Stremio merkezi kataloğuna kaydet
    publishToCentral(`${EXTERNAL_URL}/manifest.json`)
        .then(response => {
            console.log('Eklenti başarıyla merkezi kataloğa kaydedildi!')
            console.log('Katalog yanıtı:', response)
        })
        .catch(err => {
            console.error('Merkezi kataloğa kayıt sırasında hata:', err)
        })
})
.catch(error => {
    console.error('Sunucu başlatılamadı! Hata:', error)
    console.error('Hata detayları:', {
        message: error.message,
        stack: error.stack
    })
})