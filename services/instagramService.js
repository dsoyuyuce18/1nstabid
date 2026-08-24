const fetch = require('node-fetch');

async function validateInstagramUser(username) {
    const cleanUsername = username.replace('@', '').trim();
    const usernameRegex = /^[a-zA-Z0-9._]{1,30}$/;

    if (!usernameRegex.test(cleanUsername)) {
        return { valid: false, message: 'Invalid Instagram username. Only letters, numbers, dots and underscores are allowed (max 30 chars).' };
    }

    try {
        const res = await fetch(`https://unavatar.io/instagram/${cleanUsername}?fallback=false`, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (res.status === 404) {
            return { valid: false, message: `No Instagram account found for @${cleanUsername}. Please check the username and try again.` };
        }

        return { valid: true, username: cleanUsername };
    } catch (err) {
        console.error('Instagram validation error:', err);
        return { valid: true, username: cleanUsername };
    }
}

module.exports = { validateInstagramUser };
