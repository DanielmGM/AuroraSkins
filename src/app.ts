import { Octokit } from '@octokit/rest';
import './styles.css';

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
if (!GITHUB_CLIENT_ID) {
    throw new Error("GITHUB_CLIENT_ID is not set. Please create a .env file and set the GITHUB_CLIENT_ID value.");
}
const GITHUB_TARGET_BRANCH = process.env.GITHUB_TARGET_BRANCH || 'main';
const GITHUB_REDIRECT_URI = window.location.origin + window.location.pathname;
const GITHUB_SCOPE = 'repo';
const GITHUB_REPO_OWNER = 'DanielmGM';
const GITHUB_REPO_NAME = 'AuroraSkins';

// DOM Elements
const loginButton = document.getElementById('login-button') as HTMLButtonElement;
const uploadSection = document.getElementById('upload-section') as HTMLDivElement;
const authSection = document.getElementById('auth-section') as HTMLDivElement;
const statusSection = document.getElementById('status-section') as HTMLDivElement;
const statusMessage = document.getElementById('status-message') as HTMLDivElement;
const createPrButton = document.getElementById('create-pr-button') as HTMLButtonElement;
const tabButtons = document.querySelectorAll('.tab-button') as NodeListOf<HTMLButtonElement>;
const tabPanes = document.querySelectorAll('.tab-pane') as NodeListOf<HTMLDivElement>;

// Initialize Octokit
let octokit: Octokit;

// Check if user is already authenticated
async function checkAuth(): Promise<void> {
    const token = localStorage.getItem('github_token');
    if (token) {
        try {
            // Initialize Octokit with the token
            octokit = new Octokit({
                auth: token
            });

            // Test the token by making a simple API call
            await octokit.users.getAuthenticated();
            
            // If we get here, the token is valid
            showUploadSection();
        } catch (error) {
            // Token is invalid or expired
            console.error('Invalid GitHub token:', error);
            localStorage.removeItem('github_token');
            window.location.reload();
        }
    }
}

// GitHub OAuth flow
function initiateGitHubLogin(): void {
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=${GITHUB_SCOPE}`;
    window.location.href = authUrl;
}

// Handle OAuth callback
async function handleCallback(): Promise<void> {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
        try {
            showStatus('Exchanging code for token...', 'info');
            
            // Exchange code for token using GitHub's OAuth endpoint
            const response = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: GITHUB_CLIENT_ID,
                    code: code,
                    redirect_uri: GITHUB_REDIRECT_URI
                })
            });

            if (!response.ok) {
                throw new Error('Failed to exchange code for token');
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error_description || data.error);
            }

            // Store the token
            localStorage.setItem('github_token', data.access_token);
            
            // Initialize Octokit with the token
            octokit = new Octokit({
                auth: data.access_token
            });

            // Remove the code from URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            showUploadSection();
            showStatus('Successfully authenticated with GitHub!', 'success');
        } catch (error) {
            showStatus('Error during authentication: ' + (error as Error).message, 'error');
        }
    }
}

// Show upload section after authentication
function showUploadSection(): void {
    authSection.classList.add('hidden');
    uploadSection.classList.remove('hidden');
}

// Handle tab switching
function switchTab(event: MouseEvent): void {
    const target = event.target as HTMLButtonElement;
    const tabId = target.dataset.tab;
    
    if (!tabId) return;
    
    // Update tab buttons
    tabButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabId);
    });
    
    // Update tab panes
    tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === tabId);
    });
}

// Validate file size
function validateFileSize(file: File, maxSize: number): boolean {
    if (file.size > maxSize) {
        showStatus(`File size exceeds the maximum limit of ${formatFileSize(maxSize)}`, 'error');
        return false;
    }
    return true;
}

// Format file size
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Create Pull Request
async function createPullRequest(): Promise<void> {
    const activeTab = document.querySelector('.tab-pane.active') as HTMLDivElement;
    const files = activeTab.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
    const activeTabId = activeTab.id;

    // Get the name and author inputs based on the active tab
    let nameInput: HTMLInputElement | null = null;
    let authorInput: HTMLInputElement | null = null;
    
    if (activeTabId === 'background') {
        nameInput = document.getElementById('background-name') as HTMLInputElement;
        authorInput = document.getElementById('background-author') as HTMLInputElement;
    } else if (activeTabId === 'coverflow') {
        nameInput = document.getElementById('coverflow-name') as HTMLInputElement;
        authorInput = document.getElementById('coverflow-author') as HTMLInputElement;
    } else if (activeTabId === 'skin') {
        nameInput = document.getElementById('skin-name') as HTMLInputElement;
        authorInput = document.getElementById('skin-author') as HTMLInputElement;
    }

    if (!nameInput?.value || !authorInput?.value) {
        showStatus('Please fill in all required fields', 'error');
        return;
    }

    // Sanitize name and author for file paths
    const sanitizedName = nameInput.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sanitizedAuthor = authorInput.value.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Auto-generate branch name
    const branchName = `add/${activeTabId}/${sanitizedName}`;

    // Auto-generate PR title and description
    const prTitle = `Add new ${activeTabId}: ${nameInput.value}`;
    const prDescription = `This PR adds a new ${activeTabId} to the repository.\n\n` +
        `Name: ${nameInput.value}\n` +
        `Author: ${authorInput.value}\n` +
        `Type: ${activeTabId}\n` +
        `Branch: ${branchName}`;

    // Validate file sizes and prepare file paths
    const fileUploads: { file: File; path: string }[] = [];
    
    for (const fileInput of files) {
        const file = fileInput.files?.[0];
        if (file) {
            const maxSize = parseInt(fileInput.dataset.maxSize || '0');
            if (!validateFileSize(file, maxSize)) {
                return;
            }

            // Determine file path based on type and input
            let filePath: string;
            if (activeTabId === 'background') {
                filePath = `repo/backgrounds/bg.${sanitizedAuthor}.${sanitizedName}.jpg`;
            } else if (activeTabId === 'coverflow') {
                if (fileInput.id === 'coverflow-screenshot') {
                    filePath = `repo/coverflows/cf.${sanitizedAuthor}.${sanitizedName}.jpg`;
                } else {
                    filePath = `repo/coverflows/cf.${sanitizedAuthor}.${sanitizedName}.cfljson`;
                }
            } else if (activeTabId === 'skin') {
                if (fileInput.id === 'skin-screenshot') {
                    filePath = `repo/skins/skin.${sanitizedAuthor}.${sanitizedName}.jpg`;
                } else {
                    filePath = `repo/skins/skin.${sanitizedAuthor}.${sanitizedName}.xzp`;
                }
            } else {
                continue;
            }

            fileUploads.push({ file, path: filePath });
        }
    }

    try {
        showStatus('Creating Pull Request...', 'info');

        // 1. Fork the repository
        const forkResponse = await octokit.repos.createFork({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME
        });

        // 2. Create a new branch from main
        await octokit.git.createRef({
            owner: forkResponse.data.owner.login,
            repo: forkResponse.data.name,
            ref: `refs/heads/${branchName}`,
            sha: forkResponse.data.default_branch
        });

        // 3. Upload files with mapped paths
        for (const { file, path } of fileUploads) {
            const fileContent = await readFileAsBase64(file);
            await octokit.repos.createOrUpdateFileContents({
                owner: forkResponse.data.owner.login,
                repo: forkResponse.data.name,
                path: path,
                message: `Add ${path}`,
                content: fileContent,
                branch: branchName
            });
        }

        // 4. Create the pull request
        await octokit.pulls.create({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            title: prTitle,
            body: prDescription,
            head: `${forkResponse.data.owner.login}:${branchName}`,
            base: GITHUB_TARGET_BRANCH
        });

        showStatus('Pull Request created successfully!', 'success');
    } catch (error) {
        showStatus('Error creating Pull Request: ' + (error as Error).message, 'error');
    }
}

// Helper function to read file as base64
function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Show status message
function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    statusSection.classList.remove('hidden');
    statusMessage.textContent = message;
    statusMessage.className = type;
}

// Initialize the application
async function initialize(): Promise<void> {
    await checkAuth();
    handleCallback();
}

// Event Listeners
loginButton.addEventListener('click', initiateGitHubLogin);
createPrButton.addEventListener('click', createPullRequest);
tabButtons.forEach(button => {
    button.addEventListener('click', switchTab);
});

// Initialize
initialize(); 