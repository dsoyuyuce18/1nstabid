const fetch = require('node-fetch');

async function validateInstagramUser(username) {
    const cleanUsername = username.replace('@', '').trim();
    const usernameRegex = /^[a-zA-Z0-9._]{1,30}$/;

    if (!usernameRegex.test(cleanUsername)) {
        return { valid: false, message: 'Invalid Instagram username. Only letters, numbers, dots and underscores are allowed (max 30 chars).' };
    }

    try {
        const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanUsername)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'x-ig-app-id': '936619743392459'
            }
        });

        if (!res.ok) {
            return { valid: false, message: `No Instagram account found for @${cleanUsername}. Please check the username and try again.` };
        }

        const data = await res.json();
        if (!data?.data?.user?.username) {
            return { valid: false, message: `No Instagram account found for @${cleanUsername}. Please check the username and try again.` };
        }

        return { valid: true, username: data.data.user.username };
    } catch (err) {
        console.error('Instagram validation error:', err);
        return { valid: false, message: 'Instagram could not be verified right now. Please try again.' };
    }
}

module.exports = { validateInstagramUser };
