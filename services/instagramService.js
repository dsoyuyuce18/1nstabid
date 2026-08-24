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

        if (res.ok) {
            const data = await res.json();
            if (data?.data?.user?.username) {
                return {
                    valid: true,
                    username: data.data.user.username,
                    profileImageUrl: data.data.user.profile_pic_url_hd || data.data.user.profile_pic_url
                };
            }
        }

        // Instagram can rate-limit Railway IPs while still serving public profiles.
        const profileRes = await fetch(`https://www.instagram.com/${encodeURIComponent(cleanUsername)}/`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const profileHtml = await profileRes.text();
        const profileExists = profileRes.ok && (
            profileHtml.includes(`profilePage_`) &&
            new RegExp(`"username":"${cleanUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(profileHtml)
        );

        if (!profileExists) {
            return { valid: false, message: `No Instagram account found for @${cleanUsername}. Please check the username and try again.` };
        }

        return { valid: true, username: cleanUsername };
    } catch (err) {
        console.error('Instagram validation error:', err);
        return { valid: false, message: 'Instagram could not be verified right now. Please try again.' };
    }
}

module.exports = { validateInstagramUser };
