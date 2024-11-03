// Import necessary modules
const express = require('express');
const session = require('express-session');
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config()

// Initialize Express app
const app = express();

// Set session middleware
app.use(session({
    // name: 'spotify_cookie', // (Optional) Uncomment to use a custom cookie name
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false, // Use true if serving over HTTPS
        httpOnly: true,
        maxAge: 60 * 60 * 1000 // 1 hour
    }
}));


// Set the key for token info in the session
const TOKEN_INFO = 'token_info';

// Spotify API configuration
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: 'http://localhost:8888/redirect'
});

// Route to handle logging in
app.get('/', (req, res) => {
    const authorizeURL = spotifyApi.createAuthorizeURL(['user-library-read', 'playlist-modify-public', 'playlist-modify-private', 'playlist-read-private',
    ]);
    res.redirect(authorizeURL);
});

// Route to handle the redirect URI after authorization
app.get('/redirect', async (req, res) => {
    try {
        const { code } = req.query;
        const data = await spotifyApi.authorizationCodeGrant(code);

        // Set the access token and refresh token
        req.session[TOKEN_INFO] = {
            access_token: data.body['access_token'],
            refresh_token: data.body['refresh_token'],
            expires_in: Date.now() + data.body['expires_in'] * 1000
        };

        // Redirect to saveDiscoverWeekly route
        res.redirect('/saveDiscoverWeekly');
    } catch (error) {
        console.error('Error getting tokens:', error);
        res.redirect('/');
    }
});

// Route to save Discover Weekly songs to a playlist
app.get('/saveDiscoverWeekly', async (req, res) => {
    try {
        // Get token info from session
        let tokenInfo = req.session[TOKEN_INFO];
        if (!tokenInfo) {
            return res.redirect('/');
        }

        // Check if token has expired, refresh if necessary
        if (Date.now() > tokenInfo.expires_in) {
            const data = await spotifyApi.refreshAccessToken();
            tokenInfo.access_token = data.body['access_token'];
            tokenInfo.expires_in = Date.now() + data.body['expires_in'] * 1000;
            req.session[TOKEN_INFO] = tokenInfo;
        }

        // Set the access token on the API object
        spotifyApi.setAccessToken(tokenInfo.access_token);

        // Get the user's playlists
        const playlists = await spotifyApi.getUserPlaylists({ limit: 10 });

        let discoverWeeklyId = null;
        let savedWeeklyId = null;

        playlists.body.items.forEach(playlist => {
            if (playlist.name === 'Discover Weekly') {
                discoverWeeklyId = playlist.id
            } else if (playlist.name === 'Saved Weekly') {
                savedWeeklyId = playlist.id;
            }
        });

        if (!discoverWeeklyId) {
            return res.send('Discover Weekly not found.');
        }

        // Check if the Saved Weekly playlist exists, if not create it
        if (!savedWeeklyId) {
            const createPlaylistResponse = await spotifyApi.createPlaylist('Saved Weekly', {
                'public': false, // Set to true if you want it to be public
                'description': 'A playlist to save Discover Weekly songs'
            });
            savedWeeklyId = createPlaylistResponse.body.id; // Save the ID of the new playlist
        }

        // Get the tracks from Discover Weekly playlist
        const discoverWeeklyTracks = await spotifyApi.getPlaylistTracks(discoverWeeklyId);
        const songUris = discoverWeeklyTracks.body.items.map(item => item.track.uri);

        // Add the tracks to the Saved Weekly playlist
        await spotifyApi.addTracksToPlaylist(savedWeeklyId, songUris);

        res.send('Discover Weekly songs added successfully');
    } catch (error) {
        console.error('Error saving Discover Weekly:', error);
        res.redirect('/');
    }
});


// Start the server
app.listen(8888, () => {
    console.log('Server running on http://localhost:8888');
});
