module.exports = async (request, response) => {
    // Ensure this is a POST request
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    const { code } = request.body;

    if (!code) {
        return response.status(400).json({ error: 'Authorization code is missing' });
    }

    const client_id = process.env.GITHUB_CLIENT_ID;
    const client_secret = process.env.GITHUB_CLIENT_SECRET;

    if (!client_id || !client_secret) {
        return response.status(500).json({ error: 'Server configuration error: GitHub credentials not set.' });
    }
    
    try {
        const githubResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                client_id,
                client_secret,
                code,
            }),
        });

        if (!githubResponse.ok) {
            const errorText = await githubResponse.text();
            console.error('GitHub API Error:', errorText);
            throw new Error(`Failed to exchange code for token. Status: ${githubResponse.status}`);
        }

        const data = await githubResponse.json();

        if (data.error) {
            throw new Error(data.error_description || data.error);
        }
        
        if (!data.access_token) {
            throw new Error('Access token not found in GitHub response.');
        }
        
        // Success: send the access token back to the frontend
        return response.status(200).json({ access_token: data.access_token });

    } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        return response.status(500).json({ error: errorMessage });
    }
};