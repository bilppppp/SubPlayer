document.addEventListener('DOMContentLoaded', (event) => {
    const socket = io.connect(location.protocol + '//' + document.domain + ':' + location.port);

    const videoUrl = document.getElementById('video-url');
    const cookieBrowser = document.getElementById('cookie-browser');
    const impersonateCheckbox = document.getElementById('impersonate-checkbox');
    const mp3ConvertCheckbox = document.getElementById('mp3-convert-checkbox');
    const mergeAudioCheckbox = document.getElementById('merge-audio-checkbox');
    const preferMp4Checkbox = document.getElementById('prefer-mp4-checkbox');
    const getFormatsBtn = document.getElementById('get-formats-btn');
    const playlistContainer = document.getElementById('playlist-container');
    const playlistVideos = document.getElementById('playlist-videos');
    const formatsContainer = document.getElementById('formats-container');
    const videoFormatsTable = document.getElementById('video-formats-table');
    const audioFormatsTable = document.getElementById('audio-formats-table');
    const downloadBtn = document.getElementById('download-btn');
    const progress = document.getElementById('progress');
    const fileList = document.getElementById('file-list');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const batchDeleteBtn = document.getElementById('batch-delete-btn');

    let currentFilter = 'all';
    const videoExtensions = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv'];
    const audioExtensions = ['mp3', 'm4a', 'wav', 'flac', 'opus', 'aac'];

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });

    getFormatsBtn.addEventListener('click', () => fetchUrlInfo(videoUrl.value));

    async function fetchUrlInfo(url) {
        if (!url) {
            alert('Please enter a video URL.');
            return;
        }
        
        // Show loading state
        playlistContainer.classList.add('hidden');
        formatsContainer.classList.add('hidden');
        progress.textContent = 'Fetching URL info...';

        const browser = cookieBrowser.value;
        const impersonate = impersonateCheckbox.checked;

        try {
            let apiUrl = `/api/formats?url=${encodeURIComponent(url)}`;
            if (browser) apiUrl += `&browser=${encodeURIComponent(browser)}`;
            if (impersonate) apiUrl += `&impersonate=true`;

            const response = await fetch(apiUrl);
            progress.textContent = ''; // Clear loading message
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch URL info.');
            }
            const data = await response.json();

            if (data.is_playlist) {
                renderPlaylist(data.videos);
            } else {
                renderFormats(data.formats);
            }
        } catch (error) {
            progress.textContent = `Error: ${error.message}`;
        }
    }

    function renderPlaylist(videos) {
        formatsContainer.classList.add('hidden');
        playlistContainer.classList.remove('hidden');
        playlistVideos.innerHTML = '';

        videos.forEach(video => {
            const li = document.createElement('li');
            
            const titleSpan = document.createElement('span');
            titleSpan.textContent = video.title;
            
            const videoGetFormatsBtn = document.createElement('button');
            videoGetFormatsBtn.textContent = 'Get Formats';
            videoGetFormatsBtn.addEventListener('click', () => {
                videoUrl.value = video.url; // Update main URL bar for clarity
                fetchUrlInfo(video.url);
            });
            
            li.appendChild(titleSpan);
            li.appendChild(videoGetFormatsBtn);
            playlistVideos.appendChild(li);
        });
    }

    function renderFormats(formats) {
        playlistContainer.classList.add('hidden');
        formatsContainer.classList.remove('hidden');
        if (!formats || formats.length === 0) {
            videoFormatsTable.innerHTML = '<i>No formats found.</i>';
            audioFormatsTable.innerHTML = '';
            return;
        }

        // More reliable filtering based on JSON data
        const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.acodec === 'none');
        const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        const muxedFormats = formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');

        // Add muxed (video+audio) formats to the video list
        const allVideoFormats = [...muxedFormats, ...videoFormats].sort((a, b) => (b.height || 0) - (a.height || 0));

        videoFormatsTable.innerHTML = createFormatTable(allVideoFormats, 'video');
        audioFormatsTable.innerHTML = createFormatTable(audioFormats, 'audio');

        // Ensure only one radio button can be selected across both tables
        const radioButtons = document.querySelectorAll('input[name="format"]');
        radioButtons.forEach(radio => {
            radio.addEventListener('change', () => {
                radioButtons.forEach(otherRadio => {
                    if (otherRadio !== radio) {
                        otherRadio.checked = false;
                    }
                });
            });
        });
    }

    function createFormatTable(formats, type) {
         if (formats.length === 0) return `<i>No ${type} formats available.</i>`;
        let tableHtml = `
            <table>
                <thead>
                    <tr>
                        <th>Select</th>
                        <th>Title</th>
                        <th>ID</th>
                        <th>Ext</th>
                        <th>Resolution</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
        `;
        formats.forEach(format => {
            const filesize = format.filesize || format.filesize_approx;
            const details = `${format.format_note || ''} | ${filesize ? (filesize / 1024 / 1024).toFixed(2) + 'MiB' : 'N/A'}`;
            
            tableHtml += `
                <tr>
                    <td><input type="radio" name="format" value="${format.format_id}" data-type="${type}"></td>
                    <td class="video-title">${format.video_title}</td>
                    <td>${format.format_id}</td>
                    <td>${format.ext}</td>
                    <td>${format.resolution}</td>
                    <td>${details}</td>
                </tr>
            `;
        });
        tableHtml += '</tbody></table>';
        return tableHtml;
    }

    downloadBtn.addEventListener('click', () => {
        const url = videoUrl.value;
        const browser = cookieBrowser.value;
        const impersonate = impersonateCheckbox.checked;
        const convertToMp3 = mp3ConvertCheckbox.checked;
        const mergeAudio = mergeAudioCheckbox.checked;
        const preferMp4 = preferMp4Checkbox.checked;
        const selectedFormat = document.querySelector('input[name="format"]:checked');

        if (!url) {
            alert('Please enter a video URL.');
            return;
        }
        if (!selectedFormat) {
            alert('Please select a format to download.');
            return;
        }
        
        const formatCode = selectedFormat.value;
        const formatType = selectedFormat.getAttribute('data-type');
        const videoId = selectedFormat.getAttribute('data-video-id');
        
        // The URL for download might be a playlist, but we need to download a specific video from it.
        // If a videoId is present, we use that. Otherwise, we fall back to the main URL.
        const downloadUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;

        progress.textContent = 'Starting download...';
        socket.emit('download', {
            url: downloadUrl,
            browser: browser,
            format_code: formatCode,
            impersonate: impersonate,
            format_type: formatType,
            convert_to_mp3: formatType === 'audio' && convertToMp3,
            merge_audio: mergeAudio,
            prefer_mp4: preferMp4
        });
    });

    socket.on('progress', (data) => {
        progress.textContent += data.data;
    });

    socket.on('file_list', (data) => {
        updateFileList(data.files);
    });

    // --- Event Listeners ---
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            currentFilter = button.getAttribute('data-filter');
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            applyFilter();
        });
    });

    selectAllCheckbox.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('#file-list li:not(.hidden) .file-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
    });

    batchDeleteBtn.addEventListener('click', batchDeleteFiles);

    // --- File List Management ---
    function updateFileList(files) {
        fileList.innerHTML = '';
        files.forEach(file => {
            const li = document.createElement('li');
            li.setAttribute('data-filename', file);
            const extension = file.split('.').pop().toLowerCase();
            if (videoExtensions.includes(extension)) {
                li.setAttribute('data-type', 'video');
            } else if (audioExtensions.includes(extension)) {
                li.setAttribute('data-type', 'audio');
            } else {
                li.setAttribute('data-type', 'other');
            }
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'file-checkbox';
            checkbox.value = file;

            const a = document.createElement('a');
            a.href = '/downloads/' + encodeURIComponent(file);
            a.textContent = file;
            a.target = '_blank';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'delete-btn';
            deleteBtn.addEventListener('click', () => deleteFile(file));

            const leftDiv = document.createElement('div');
            leftDiv.className = 'file-item-left';
            leftDiv.appendChild(checkbox);
            leftDiv.appendChild(a);

            li.appendChild(leftDiv);
            li.appendChild(deleteBtn);
            fileList.appendChild(li);
        });
        applyFilter();
    }

    function applyFilter() {
        const items = document.querySelectorAll('#file-list li');
        items.forEach(item => {
            const type = item.getAttribute('data-type');
            if (currentFilter === 'all' || currentFilter === type) {
                item.classList.remove('hidden');
            } else {
                item.classList.add('hidden');
            }
        });
        selectAllCheckbox.checked = false;
    }

    async function deleteFile(filename) {
        if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
            return;
        }

        try {
            const response = await fetch('/api/delete_file', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filename: filename }),
            });

            const result = await response.json();
            if (response.ok) {
                // Refresh the file list
                const listResponse = await fetch('/api/files');
                const data = await listResponse.json();
                updateFileList(data.files);
            } else {
                alert(`Error: ${result.error}`);
            }
        } catch (error) {
            alert(`An error occurred: ${error}`);
        }
    }

    async function batchDeleteFiles() {
        const selectedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
        const filenames = Array.from(selectedCheckboxes).map(cb => cb.value);

        if (filenames.length === 0) {
            alert('Please select files to delete.');
            return;
        }

        if (!confirm(`Are you sure you want to delete ${filenames.length} selected file(s)?`)) {
            return;
        }

        try {
            const response = await fetch('/api/batch_delete_files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: filenames }),
            });

            const result = await response.json();
            if (response.ok) {
                const listResponse = await fetch('/api/files');
                const data = await listResponse.json();
                updateFileList(data.files);
            } else {
                alert(`Error: ${result.error}`);
            }
        } catch (error) {
            alert(`An error occurred: ${error}`);
        }
    }

    // --- Initial Load ---
    fetch('/api/files').then(response => response.json()).then(data => {
        updateFileList(data.files);
    });
    
    socket.on('new_file', (data) => {
        updateFileList(data.files);
    });
});
