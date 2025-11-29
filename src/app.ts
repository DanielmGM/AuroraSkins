import { Octokit } from '@octokit/rest';
import './styles.css';

// Type definitions
interface SubmissionItem {
    id: number;
    type: 'skin' | 'background' | 'coverflow';
    name: string;
    author: string;
    website?: string;
    files: { file: File, desiredPath: string, maxSize: number }[];
    metadata?: any; 
}

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

// Global State
let octokit: Octokit;
let submissionQueue: SubmissionItem[] = [];
let currentSkinMetadata: any = null;
let currentCoverflowMetadata: any = null;
let nextItemId = 0;

// --- DOM Elements ---
const loginButton = document.getElementById('login-button') as HTMLButtonElement;
const uploadSection = document.getElementById('upload-section') as HTMLDivElement;
const authSection = document.getElementById('auth-section') as HTMLDivElement;
const statusSection = document.getElementById('status-section') as HTMLDivElement;
const statusMessage = document.getElementById('status-message') as HTMLDivElement;

const submissionTypeSelect = document.getElementById('submission-type') as HTMLSelectElement;
const formsContainer = document.getElementById('forms-container') as HTMLDivElement;
const addToQueueButton = document.getElementById('add-to-queue-button') as HTMLButtonElement;
const queueList = document.getElementById('queue-list') as HTMLUListElement;
const queuePlaceholder = document.getElementById('queue-placeholder') as HTMLLIElement;
const createPrButton = document.getElementById('create-pr-button') as HTMLButtonElement;


// Skin Specific DOM Elements (re-added)
const skinFileInput = document.getElementById('skin-file') as HTMLInputElement;
const skinMetadataDisplay = document.getElementById('skin-metadata-display') as HTMLDivElement;
const skinMetadataContentContainer = document.getElementById('skin-metadata-content-container') as HTMLElement;

// Coverflow Specific DOM Elements (re-added)
const coverflowFileInput = document.getElementById('coverflow-file') as HTMLInputElement;
const coverflowMetadataDisplay = document.getElementById('coverflow-metadata-display') as HTMLDivElement;
const coverflowMetadataContentContainer = document.getElementById('coverflow-metadata-content-container') as HTMLElement;


// --- Core Functions ---

let existingContentList: any[] = [];

async function fetchExistingContentList(): Promise<void> {
    try {
        const { data } = await octokit.repos.getContent({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            path: 'repo/list.json',
        });

        if ('content' in data && typeof data.content === 'string') {
            const content = atob(data.content);
            const parsedContent = JSON.parse(content);
            
            // The list.json is now an object with 'backgrounds', 'coverflows', 'skins' keys
            if (parsedContent && typeof parsedContent === 'object' && 
                Array.isArray(parsedContent.backgrounds) &&
                Array.isArray(parsedContent.coverflows) &&
                Array.isArray(parsedContent.skins)) {
                
                existingContentList = [
                    ...parsedContent.backgrounds,
                    ...parsedContent.coverflows,
                    ...parsedContent.skins
                ];
                console.log('Successfully fetched and parsed existing content list.');
            } else {
                console.warn('Parsed list.json is not in the expected object format. Defaulting to empty list.');
                existingContentList = [];
            }
        }
    } catch (error) {
        console.warn('Could not fetch or parse repo/list.json. Assuming it does not exist or is invalid.', error);
        existingContentList = [];
    }
}

async function checkAuth(): Promise<void> {
    const token = localStorage.getItem('github_token');
    if (token) {
        try {
            octokit = new Octokit({ auth: token });
            await octokit.users.getAuthenticated();
            showUploadSection();
        } catch (error) {
            console.error('Invalid GitHub token:', error);
            localStorage.removeItem('github_token');
            window.location.reload();
        }
    }
}

function initiateGitHubLogin(): void {
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=${GITHUB_SCOPE}`;
    window.location.href = authUrl;
}

async function handleCallback(): Promise<void> {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
        try {
            showStatus('Exchanging code for token...', 'info');
            const response = await fetch('/api/github-callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to exchange code for token');
            }

            const data = await response.json();
            if (data.error) throw new Error(data.error_description || data.error);

            localStorage.setItem('github_token', data.access_token);
            octokit = new Octokit({ auth: data.access_token });

            window.history.replaceState({}, document.title, window.location.pathname);
            showUploadSection();
            showStatus('Successfully authenticated with GitHub!', 'success');
        } catch (error) {
            showStatus('Error during authentication: ' + (error as Error).message, 'error');
        }
    }
}

async function showUploadSection(): Promise<void> {
    authSection.classList.add('hidden');
    uploadSection.classList.remove('hidden');
    await fetchExistingContentList();
}

// --- Feature Functions ---

async function parseXzpMetadata(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            const text = event.target?.result as string;
            
            const startIndex = text.indexOf('{"metaver"');
            if (startIndex === -1) {
                return reject(new Error('Could not find metadata block in skin file.'));
            }

            let openBraces = 0;
            let endIndex = -1;
            for (let i = startIndex; i < text.length; i++) {
                if (text[i] === '{') {
                    openBraces++;
                } else if (text[i] === '}') {
                    openBraces--;
                }
                if (openBraces === 0) {
                    endIndex = i;
                    break;
                }
            }

            if (endIndex === -1) {
                return reject(new Error('Could not find the end of the metadata block.'));
            }

            const jsonString = text.substring(startIndex, endIndex + 1);

            try {
                const metadata = JSON.parse(jsonString);
                resolve(metadata);
            } catch (e) {
                reject(new Error('Failed to parse extracted JSON metadata.'));
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read skin file.'));
        }

        reader.readAsText(file, 'ISO-8859-1');
    });
}

async function parseCoverflowMetadata(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            const text = event.target?.result as string;
            try {
                const metadata = JSON.parse(text);
                if (metadata && typeof metadata === 'object' && 'info' in metadata && metadata.info && typeof metadata.info === 'object' && 'name' in metadata.info && 'author' in metadata.info && 'version' in metadata.info) {
                    resolve(metadata.info);
                } else {
                    reject(new Error('Coverflow file must be a valid JSON with "info" object containing "name", "author", and "version".'));
                }
            } catch (e) {
                reject(new Error('Failed to parse coverflow JSON metadata.'));
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read coverflow file.'));
        }

        reader.readAsText(file); // Default to UTF-8
    });
}


function updateQueueDisplay() {
    queueList.innerHTML = ''; // Clear existing list
    if (submissionQueue.length === 0) {
        queueList.appendChild(queuePlaceholder);
        queuePlaceholder.style.display = 'flex';
        createPrButton.classList.add('hidden');
        return;
    }

    queuePlaceholder.style.display = 'none';

    submissionQueue.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span><strong>${item.name}</strong> by ${item.author} (${item.type})</span>
            <button class="remove-button" data-id="${item.id}">Remove</button>
        `;
        queueList.appendChild(li);
    });

    createPrButton.classList.remove('hidden');
}

async function handleAddToQueue() {
    const type = submissionTypeSelect.value as SubmissionItem['type'];
    if (!type) {
        showStatus('Please select a content type.', 'error');
        return;
    }

    let item: Omit<SubmissionItem, 'id'> | null = null;
    let itemId: string = '';
    
    // Logic for each submission type
    if (type === 'background') {
        const nameInput = document.getElementById('background-name') as HTMLInputElement;
        const authorInput = document.getElementById('background-author') as HTMLInputElement;
        const imageInput = document.getElementById('background-image') as HTMLInputElement;

        const name = nameInput.value;
        const author = authorInput.value;
        const imageFile = imageInput.files?.[0];
        
        if (!name || !author || !imageFile) {
            showStatus('Please fill all fields for the background.', 'error');
            return;
        }
        
        const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sanitizedAuthor = author.toLowerCase().replace(/[^a-z0-9]/g, '');
        itemId = `bg.${sanitizedAuthor}.${sanitizedName}`;

        if (existingContentList.some(existing => existing.id === itemId)) {
            showStatus(`Error: An item with ID '${itemId}' already exists.`, 'error');
            return;
        }

        item = {
            type, name, author,
            files: [{ 
                file: imageFile, 
                desiredPath: `repo/backgrounds/bg.${sanitizedAuthor}.${sanitizedName}.jpg`,
                maxSize: parseInt(imageInput.dataset.maxSize || '0')
            }]
        };

    } else if (type === 'skin') {
        const skinInput = document.getElementById('skin-file') as HTMLInputElement;
        const screenshotInput = document.getElementById('skin-screenshot') as HTMLInputElement;
        const websiteInput = document.getElementById('skin-website') as HTMLInputElement;

        const skinFile = skinInput.files?.[0];
        const screenshotFile = screenshotInput.files?.[0];
        const website = websiteInput.value;

        if (!skinFile || !screenshotFile || !website || !currentSkinMetadata) {
            throw new Error('Please provide a valid skin file, a screenshot, a website, and ensure metadata is parsed.');
        }

        const { skinname, author } = currentSkinMetadata;
        const sanitizedName = skinname.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sanitizedAuthor = author.toLowerCase().replace(/[^a-z0-9]/g, '');
        itemId = `skin.${sanitizedAuthor}.${sanitizedName}`;

        if (existingContentList.some(existing => existing.id === itemId)) {
            showStatus(`Error: An item with ID '${itemId}' already exists.`, 'error');
            return;
        }

        item = {
            type, name: skinname, author, website,
            metadata: currentSkinMetadata,
            files: [
                { file: skinFile, desiredPath: `repo/skins/skin.${sanitizedAuthor}.${sanitizedName}.xzp`, maxSize: parseInt(skinInput.dataset.maxSize || '0') },
                { file: screenshotFile, desiredPath: `repo/skins/skin.${sanitizedAuthor}.${sanitizedName}.jpg`, maxSize: parseInt(screenshotInput.dataset.maxSize || '0') }
            ]
        };

    } else if (type === 'coverflow') {
        const coverflowInput = document.getElementById('coverflow-file') as HTMLInputElement;
        const screenshotInput = document.getElementById('coverflow-screenshot') as HTMLInputElement;
        const websiteInput = document.getElementById('coverflow-website') as HTMLInputElement;

        const coverflowFile = coverflowInput.files?.[0];
        const screenshotFile = screenshotInput.files?.[0];
        const website = websiteInput.value;

        if (!coverflowFile || !screenshotFile || !currentCoverflowMetadata) {
            showStatus('Please provide a valid coverflow file and a screenshot.', 'error');
            return;
        }

        const { name, author } = currentCoverflowMetadata; // Get name and author from parsed metadata
        const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sanitizedAuthor = author.toLowerCase().replace(/[^a-z0-9]/g, '');
        itemId = `cf.${sanitizedAuthor}.${sanitizedName}`;

        if (existingContentList.some(existing => existing.id === itemId)) {
            showStatus(`Error: An item with ID '${itemId}' already exists.`, 'error');
            return;
        }
        
        item = {
            type, name, author, website,
            metadata: currentCoverflowMetadata,
            files: [
                { file: coverflowFile, desiredPath: `repo/coverflows/cf.${sanitizedAuthor}.${sanitizedName}.cfljson`, maxSize: parseInt(coverflowInput.dataset.maxSize || '0') },
                { file: screenshotFile, desiredPath: `repo/coverflows/cf.${sanitizedAuthor}.${sanitizedName}.jpg`, maxSize: parseInt(screenshotInput.dataset.maxSize || '0') }
            ]
        };
    }

    if (item) {
        submissionQueue.push({ ...item, id: nextItemId++ });
        updateQueueDisplay();
        resetForms();
        showStatus(`Added "${item.name}" to the queue.`, 'success');
    }
}

function resetForms() {
    (document.querySelectorAll('input[type="text"], input[type="file"], input[class="text-input"]') as NodeListOf<HTMLInputElement>).forEach(input => {
        input.value = '';
    });
    
    // Hide metadata displays
    skinMetadataDisplay.classList.add('hidden');
    coverflowMetadataDisplay.classList.add('hidden');

    currentSkinMetadata = null;
    currentCoverflowMetadata = null;

    
    formsContainer.childNodes.forEach(node => {
        if (node instanceof HTMLDivElement) node.classList.add('hidden');
    });
}

async function createPullRequest(): Promise<void> {
    if (submissionQueue.length === 0) {
        showStatus('Submission queue is empty. Please add files first.', 'error');
        return;
    }

    const allFiles = submissionQueue.flatMap(item => item.files);

    // Validate file sizes before proceeding
    for (const { file, maxSize } of allFiles) {
        if (!validateFileSize(file, maxSize)) {
            return; 
        }
    }

    // Generate PR content
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
    const branchName = `add/submission-batch-${timestamp}`;
    const prTitle = `Batch Submission: ${submissionQueue.map(i => i.name).join(', ')}`;
    const prDescription = "This PR includes the following submissions:\n\n" +
        submissionQueue.map(item =>
            `*   **${item.name}** by ${item.author} (${item.type})`
        ).join('\n');

    try {
        showStatus('Creating Pull Request...', 'info');

        const forkResponse = await octokit.repos.createFork({ owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME });
        const forkOwner = forkResponse.data.owner.login;

        const { data: repoData } = await octokit.repos.get({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME
        });
        const defaultBranch = repoData.default_branch;

        const mainBranchSha = (await octokit.git.getRef({ owner: forkOwner, repo: GITHUB_REPO_NAME, ref: `heads/${defaultBranch}` })).data.object.sha;

        await octokit.git.createRef({
            owner: forkOwner,
            repo: GITHUB_REPO_NAME,
            ref: `refs/heads/${branchName}`,
            sha: mainBranchSha,
        });

        for (const { file, desiredPath } of allFiles) {
            const content = await readFileAsBase64(file);
            await octokit.repos.createOrUpdateFileContents({
                owner: forkOwner,
                repo: GITHUB_REPO_NAME,
                path: desiredPath,
                message: `Add ${file.name}`,
                content,
                branch: branchName,
            });
        }

        await octokit.pulls.create({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            title: prTitle,
            body: prDescription,
            head: `${forkOwner}:${branchName}`,
            base: GITHUB_TARGET_BRANCH,
        });

        showStatus('Pull Request created successfully!', 'success');
        submissionQueue = [];
        updateQueueDisplay();
        resetForms();

    } catch (error) {
        showStatus('Error creating Pull Request: ' + (error as Error).message, 'error');
    }
}


// --- Helper Functions ---

function validateFileSize(file: File, maxSize: number): boolean {
    if (file.size > maxSize) {
        showStatus(`File size for ${file.name} exceeds the maximum limit of ${formatFileSize(maxSize)}.`, 'error');
        return false;
    }
    return true;
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    statusSection.classList.remove('hidden');
    statusMessage.textContent = message;
    statusMessage.className = type;
}


// --- Initialization ---

async function initialize(): Promise<void> {
    await checkAuth();
    handleCallback();
    updateQueueDisplay(); // Initial call to set up the queue view

    // Event Listeners for new UI
    submissionTypeSelect.addEventListener('change', () => {
        formsContainer.childNodes.forEach(node => {
            if (node instanceof HTMLDivElement) node.classList.add('hidden');
        });
        addToQueueButton.classList.add('hidden'); // Initially hide
        resetForms(); // Call reset to hide all verification steps & clear inputs

        const selectedType = submissionTypeSelect.value;
        if (selectedType) {
            const selectedForm = document.getElementById(`form-${selectedType}`);
            if (selectedForm) {
                selectedForm.classList.remove('hidden');
                addToQueueButton.classList.remove('hidden'); // Show for all types now
            }
        }
    });
    
    skinFileInput.addEventListener('change', async () => {
        const file = skinFileInput.files?.[0];
        // Reset skin-specific UI
        skinMetadataDisplay.classList.add('hidden');
        addToQueueButton.classList.add('hidden'); // Hide until parsed and valid
        currentSkinMetadata = null;

        if (!file) return;

        try {
            showStatus('Analyzing skin file...', 'info');
            const metadata = await parseXzpMetadata(file);
            currentSkinMetadata = metadata;
            
            skinMetadataContentContainer.innerHTML = ''; 
            
            const createMetadataItem = (label: string, value: string) => {
                const item = document.createElement('div');
                item.className = 'metadata-item';
                item.innerHTML = `<span class="metadata-label">${label}:</span> <span class="metadata-value">${value}</span>`;
                return item;
            };

            skinMetadataContentContainer.appendChild(createMetadataItem('Skin Name', metadata.skinname || 'N/A'));
            skinMetadataContentContainer.appendChild(createMetadataItem('Author', metadata.author || 'N/A'));
            skinMetadataContentContainer.appendChild(createMetadataItem('Skin Version', metadata.revision || 'N/A'));
            skinMetadataContentContainer.appendChild(createMetadataItem('Aurora Version', metadata.auroraver || 'N/A'));
            skinMetadataContentContainer.appendChild(createMetadataItem('Description', metadata.description || 'N/A'));
            
            skinMetadataDisplay.classList.remove('hidden');
            addToQueueButton.classList.remove('hidden'); // Enable button on successful parse
            showStatus('Metadata extracted successfully! Fill remaining fields and add to queue.', 'success');
        } catch (error) {
            showStatus((error as Error).message, 'error');
            skinMetadataDisplay.classList.add('hidden');
            currentSkinMetadata = null;
        }
    });

    coverflowFileInput.addEventListener('change', async () => {
        const file = coverflowFileInput.files?.[0];
        // Reset coverflow-specific UI
        coverflowMetadataDisplay.classList.add('hidden');
        addToQueueButton.classList.add('hidden'); // Hide until parsed and valid
        currentCoverflowMetadata = null;

        if (!file) return;

        try {
            showStatus('Analyzing coverflow file...', 'info');
            const metadata = await parseCoverflowMetadata(file);
            currentCoverflowMetadata = metadata;
            
            coverflowMetadataContentContainer.innerHTML = ''; 
            
            const createMetadataItem = (label: string, value: string) => {
                const item = document.createElement('div');
                item.className = 'metadata-item';
                item.innerHTML = `<span class="metadata-label">${label}:</span> <span class="metadata-value">${value}</span>`;
                return item;
            };

            coverflowMetadataContentContainer.appendChild(createMetadataItem('Name', metadata.name || 'N/A'));
            coverflowMetadataContentContainer.appendChild(createMetadataItem('Author', metadata.author || 'N/A'));
            coverflowMetadataContentContainer.appendChild(createMetadataItem('Version', metadata.version || 'N/A'));
            
            coverflowMetadataDisplay.classList.remove('hidden');
            addToQueueButton.classList.remove('hidden'); // Enable button on successful parse
            showStatus('Metadata extracted successfully! Fill remaining fields and add to queue.', 'success');
        } catch (error) {
            showStatus((error as Error).message, 'error');
            coverflowMetadataDisplay.classList.add('hidden');
            currentCoverflowMetadata = null;
        }
    });
    
    addToQueueButton.addEventListener('click', handleAddToQueue);

    queueList.addEventListener('click', (event) => {
        const target = event.target as HTMLButtonElement;
        if (target.classList.contains('remove-button')) {
            const idToRemove = parseInt(target.dataset.id || '-1');
            submissionQueue = submissionQueue.filter(item => item.id !== idToRemove);
            updateQueueDisplay();
        }
    });

    createPrButton.addEventListener('click', createPullRequest);
    loginButton.addEventListener('click', initiateGitHubLogin);
}

initialize();