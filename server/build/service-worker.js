// Nom du cache et version
const CACHE_NAME = 'clinique-cache-v2';

// Fichiers statiques à mettre en cache
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/favicon.ico',
    '/manifest.json',
    '/static/js/bundle.js',
    '/static/css/main.css',
    '/hopital.png',
    // Ajoutez ici d'autres fichiers statiques nécessaires
];

// Installation du Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Mise en cache des fichiers statiques.');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();  // Force l'activation immédiate du service worker
    console.log('Service Worker installé et ressources mises en cache.');
});

// Activation du Service Worker
self.addEventListener('activate', (event) => {
    console.log('Service Worker activé.');
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('Suppression du cache obsolète :', key);
                        return caches.delete(key);  // Supprime l'ancien cache
                    }
                })
            )
        )
    );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Laissez passer les requêtes vers le backend (API)
    if (url.includes('http://localhost:5001')) {
        console.log('Requête API détectée : non interceptée.');
        return;
    }

    // Gestion des fichiers statiques
    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                console.log('Réponse servie depuis le cache :', event.request.url);
                return response;
            }
            console.log('Ressource non en cache, récupération depuis le réseau :', event.request.url);
            return fetch(event.request).catch(() => {
                console.error('Erreur réseau lors de la récupération de :', event.request.url);
            });
        })
    );
});
