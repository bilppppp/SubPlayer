import os
import subprocess
import re
import json
from flask import Flask, render_template, send_from_directory, jsonify, request
from flask_socketio import SocketIO
from werkzeug.utils import secure_filename

app = Flask(__name__)
# In a real app, you'd want a more robust secret key management
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

DOWNLOAD_FOLDER = 'downloads'
app.config['DOWNLOAD_FOLDER'] = os.path.join(os.getcwd(), 'yt_dlp_webui', DOWNLOAD_FOLDER)


if not os.path.exists(app.config['DOWNLOAD_FOLDER']):
    os.makedirs(app.config['DOWNLOAD_FOLDER'])

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/downloads/<path:filename>')
def download_file(filename):
    return send_from_directory(app.config['DOWNLOAD_FOLDER'], filename, as_attachment=True)

@app.route('/api/files')
def list_files():
    files = os.listdir(app.config['DOWNLOAD_FOLDER'])
    return jsonify(files=files)

@app.route('/api/batch_delete_files', methods=['POST'])
def batch_delete_files_endpoint():
    data = request.get_json()
    filenames = data.get('filenames')

    if not filenames or not isinstance(filenames, list):
        return jsonify(error="A list of filenames is required"), 400

    deleted_count = 0
    errors = []
    
    for filename in filenames:
        secure_name = secure_filename(filename)
        if secure_name != filename:
            errors.append(f"Invalid filename skipped: {filename}")
            continue

        try:
            file_path = os.path.join(app.config['DOWNLOAD_FOLDER'], secure_name)
            if os.path.exists(file_path):
                os.remove(file_path)
                deleted_count += 1
        except Exception as e:
            errors.append(f"Could not delete {secure_name}: {str(e)}")

    return jsonify(
        success=True,
        message=f"Successfully deleted {deleted_count} file(s).",
        errors=errors
    )

@app.route('/api/formats')
def get_formats():
    url = request.args.get('url')
    browser = request.args.get('browser')
    impersonate = request.args.get('impersonate') == 'true'

    if not url:
        return jsonify(error="URL is required"), 400

    command = ['yt-dlp', '-j'] # Use -j for JSON output
    if browser:
        command.extend(['--cookies-from-browser', browser])
    if impersonate:
        command.extend(['--extractor-args', 'generic:impersonate'])
    command.append(url)
    
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, universal_newlines=True)
        
        all_formats = []
        errors = []
        
        # Process stdout for JSON data
        for line in process.stdout:
            try:
                video_info = json.loads(line)
                video_title = video_info.get('title', 'N/A')
                for format_entry in video_info.get('formats', []):
                    # Augment the format entry with the video title
                    format_entry['video_title'] = video_title
                    all_formats.append(format_entry)
            except json.JSONDecodeError:
                # Ignore lines that are not valid JSON
                continue
        
        # Process stderr for warnings or errors
        stderr_output = process.stderr.read()
        if stderr_output:
            # We can log this or decide if it constitutes a failure
            # For now, we'll let it proceed but could return errors if needed
            pass

        process.wait()

        if process.returncode != 0 and not all_formats:
             return jsonify(error=stderr_output), 500

        return jsonify(formats=all_formats)

    except Exception as e:
        return jsonify(error=str(e)), 500


@socketio.on('download')
def handle_download(data):
    url = data['url']
    browser = data.get('browser')
    format_code = data.get('format_code')
    impersonate = data.get('impersonate', False)
    convert_to_mp3 = data.get('convert_to_mp3', False)
    format_type = data.get('format_type')
    merge_audio = data.get('merge_audio', False)
    prefer_mp4 = data.get('prefer_mp4', False)

    command = [
        'yt-dlp',
        '-o',
        os.path.join(app.config['DOWNLOAD_FOLDER'], '%(title)s.%(ext)s'),
    ]

    if browser:
        command.extend(['--cookies-from-browser', browser])
    
    if impersonate:
        command.extend(['--extractor-args', 'generic:impersonate'])
    
    # If a specific format is chosen, it implies downloading a single video, not the whole playlist.
    if format_code:
        command.append('--no-playlist')

    # Format selection logic
    if convert_to_mp3:
        # User selected an audio format and wants it as MP3
        command.extend(['-f', format_code])
        command.extend(['-x', '--audio-format', 'mp3'])
    elif format_type == 'video' and format_code:
        if merge_audio:
            # User selected a video format and wants to merge audio
            command.extend(['-f', f'{format_code}+bestaudio/b'])
            if prefer_mp4:
                command.extend(['--merge-output-format', 'mp4'])
        else:
            # User selected a video format but does NOT want to merge audio
            command.extend(['-f', format_code])
    elif format_code:
        # User selected a format (likely audio without MP3 conversion), download it as is
        command.extend(['-f', format_code])

    command.append(url)
    
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, universal_newlines=True)

    for line in process.stdout:
        socketio.emit('progress', {'data': line})
    
    process.wait()

    files = os.listdir(app.config['DOWNLOAD_FOLDER'])
    socketio.emit('new_file', {'files': files})


if __name__ == '__main__':
    socketio.run(app, debug=True)
