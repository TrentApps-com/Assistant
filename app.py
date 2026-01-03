"""
Solo Voice Assistant - Flask Backend
Integrates with local Ollama for text generation and Kokoro TTS for voice output
Supports function calling via Claude Code execution with supervisor approval
"""

import os
import json
import base64
import subprocess
import threading
import time
import uuid
from datetime import datetime
from functools import wraps
import requests
from flask import Flask, render_template, request, jsonify, Response, session
from flask_cors import CORS

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key-change-in-production')
CORS(app, supports_credentials=True)

# Configuration
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
# Use llama3.1:8b for better instruction following, or qwen2.5 for best function calling
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.1:8b')
KOKORO_URL = os.environ.get('KOKORO_URL', 'http://localhost:8880')
KOKORO_VOICE = os.environ.get('KOKORO_VOICE', 'af_heart')

# Authentication - simple password for single user
AUTH_PASSWORD = os.environ.get('ASSISTANT_PASSWORD', 'yellowbravo#6!')

# WebAuthn/Passkey configuration
# NOTE: Passkeys require a valid domain (not IP addresses). For local use:
# 1. Add "127.0.0.1 assistant.local" to /etc/hosts (Linux/Mac) or C:\Windows\System32\drivers\etc\hosts (Windows)
# 2. Access the app via https://assistant.local:5566
# OR set these environment variables to match your domain
PASSKEY_RP_NAME = os.environ.get('PASSKEY_RP_NAME', 'Voice Assistant')

def get_passkey_rp_id():
    """Get RP ID from environment or request host"""
    env_rp_id = os.environ.get('PASSKEY_RP_ID')
    if env_rp_id:
        return env_rp_id
    # Try to get from request
    try:
        host = request.host.split(':')[0]  # Remove port
        return host
    except:
        return 'localhost'

def get_passkey_origin():
    """Get origin from environment or request"""
    env_origin = os.environ.get('PASSKEY_ORIGIN')
    if env_origin:
        return env_origin
    try:
        return request.url_root.rstrip('/')
    except:
        return 'https://localhost:5566'

# Passkey storage (persisted to file)
PASSKEYS_FILE = os.path.join(os.path.dirname(__file__), 'passkeys.json')
passkeys = {}
passkeys_lock = threading.Lock()
# Store challenges temporarily for verification
auth_challenges = {}

# Claude Code configuration
CLAUDE_WORKING_DIR = os.environ.get('CLAUDE_WORKING_DIR', '/mnt/code')
# Allow all commonly used tools including web and Playwright
CLAUDE_ALLOWED_TOOLS = os.environ.get('CLAUDE_ALLOWED_TOOLS',
    'Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch,' +
    'mcp__playwright__playwright_navigate,mcp__playwright__playwright_click,' +
    'mcp__playwright__playwright_fill,mcp__playwright__playwright_screenshot,' +
    'mcp__playwright__playwright_get_visible_text,mcp__playwright__playwright_get_visible_html,' +
    'mcp__playwright__playwright_console_logs,mcp__playwright__playwright_evaluate,' +
    'mcp__playwright__playwright_hover,mcp__playwright__playwright_select,' +
    'mcp__playwright__playwright_close,mcp__playwright__playwright_go_back'
)

# Supervisor MCP URL (for approval workflow)
SUPERVISOR_URL = os.environ.get('SUPERVISOR_URL', 'http://localhost:3100')

# Notifications storage (in-memory, persisted to file)
NOTIFICATIONS_FILE = os.path.join(os.path.dirname(__file__), 'notifications.json')
notifications = []
notifications_lock = threading.Lock()

# Active Claude jobs
active_jobs = {}
jobs_lock = threading.Lock()

# Projects configuration
PROJECTS_FILE = os.path.join(os.path.dirname(__file__), 'projects.json')
projects_config = {}


def load_projects_config():
    """Load projects configuration from file"""
    global projects_config
    try:
        if os.path.exists(PROJECTS_FILE):
            with open(PROJECTS_FILE, 'r') as f:
                projects_config = json.load(f)
                print(f"Loaded {len(projects_config.get('projects', {}))} project configurations")
        else:
            projects_config = {'projects': {}, 'default_project': CLAUDE_WORKING_DIR}
    except Exception as e:
        print(f'Failed to load projects config: {e}')
        projects_config = {'projects': {}, 'default_project': CLAUDE_WORKING_DIR}


def resolve_project_path(project_input):
    """
    Resolve a project name/alias to its actual path.

    Args:
        project_input: Could be a path, project name, or alias

    Returns:
        Resolved path string
    """
    if not project_input:
        return projects_config.get('default_project', CLAUDE_WORKING_DIR)

    # If it's already a valid path, use it
    if os.path.isdir(project_input):
        return project_input

    # Normalize input for matching
    normalized = project_input.lower().strip()

    # Check each project's name and aliases
    for project_id, project_data in projects_config.get('projects', {}).items():
        # Check project ID
        if normalized == project_id.lower():
            return project_data['path']

        # Check aliases
        for alias in project_data.get('aliases', []):
            if normalized == alias.lower():
                return project_data['path']

    # If no match found, try to construct a path
    potential_path = os.path.join(CLAUDE_WORKING_DIR, project_input)
    if os.path.isdir(potential_path):
        return potential_path

    # Default to working directory
    return projects_config.get('default_project', CLAUDE_WORKING_DIR)


def get_projects_summary():
    """Get a summary of available projects for the AI system prompt"""
    projects = projects_config.get('projects', {})
    if not projects:
        return ""

    lines = ["Available projects:"]
    for project_id, data in projects.items():
        aliases = ', '.join(data.get('aliases', [])[:3])  # Show first 3 aliases
        desc = data.get('description', '')
        lines.append(f"  - {project_id}: {desc} (aliases: {aliases})")

    return '\n'.join(lines)


def load_notifications():
    """Load notifications from file"""
    global notifications
    try:
        if os.path.exists(NOTIFICATIONS_FILE):
            with open(NOTIFICATIONS_FILE, 'r') as f:
                notifications = json.load(f)
    except Exception as e:
        print(f'Failed to load notifications: {e}')
        notifications = []


def save_notifications():
    """Save notifications to file"""
    try:
        with open(NOTIFICATIONS_FILE, 'w') as f:
            json.dump(notifications, f, indent=2, default=str)
    except Exception as e:
        print(f'Failed to save notifications: {e}')


def add_notification(title, message, notification_type='info', job_id=None):
    """Add a notification"""
    global notifications
    with notifications_lock:
        notification = {
            'id': str(uuid.uuid4()),
            'title': title,
            'message': message,
            'type': notification_type,  # 'info', 'success', 'error', 'warning'
            'job_id': job_id,
            'read': False,
            'created_at': datetime.now().isoformat()
        }
        notifications.insert(0, notification)
        # Keep only last 100 notifications
        if len(notifications) > 100:
            notifications = notifications[:100]
        save_notifications()
        return notification


def require_auth(f):
    """Decorator to require authentication for endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('authenticated'):
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function


# Load notifications and projects on startup
load_notifications()
load_projects_config()


def load_passkeys():
    """Load passkeys from file"""
    global passkeys
    try:
        if os.path.exists(PASSKEYS_FILE):
            with open(PASSKEYS_FILE, 'r') as f:
                passkeys = json.load(f)
    except Exception as e:
        print(f'Failed to load passkeys: {e}')
        passkeys = {}


def save_passkeys():
    """Save passkeys to file"""
    try:
        with open(PASSKEYS_FILE, 'w') as f:
            json.dump(passkeys, f, indent=2)
    except Exception as e:
        print(f'Failed to save passkeys: {e}')


# Load passkeys on startup
load_passkeys()


# System prompt for the assistant with function calling
def get_system_prompt():
    """Generate system prompt with current project information"""
    projects_info = get_projects_summary()

    return f"""You are a helpful voice assistant. Keep responses short (1-2 sentences) since they're spoken aloud.

IMPORTANT: You have a special ability to execute coding tasks using Claude Code on the server.

{projects_info}

When a user mentions a project by name (like "YourStory", "FormFlow", "the voice assistant", etc.), include the project name in the "project" field of your JSON response. The system will resolve it to the correct path.

You have TWO execution modes:

1. QUICK MODE (mode: "quick") - Default for simple tasks
   - Runs in background
   - User gets a notification when complete
   - Use for: quick fixes, simple commands, tests, deployments

2. STREAM MODE (mode: "stream") - For complex tasks or when user wants to watch
   - Opens a terminal window showing real-time output
   - User can see progress and approve actions
   - Use when: user says "show me", "let me watch", "stream it", or for complex multi-step tasks

When a user asks you to do ANY coding task, respond in this format:

1. Brief acknowledgment (spoken aloud)
2. JSON function call on a new line with mode and project specified

Examples:

User: "Fix the typo in the README"
Response: I'll fix that typo for you.
{{"function": "claude_execute", "prompt": "Fix typos in README.md", "mode": "quick"}}

User: "Update the login page in FormFlow"
Response: I'll update the login page in FormFlow.
{{"function": "claude_execute", "prompt": "Update the login page styling", "project": "formflow", "mode": "quick"}}

User: "Run the tests in YourStory and show me"
Response: Let me show you the test results in the terminal.
{{"function": "claude_execute", "prompt": "Run the test suite", "project": "yourstory", "mode": "stream"}}

User: "Refactor the authentication in the voice assistant"
Response: That's a complex task. Let me show you the progress.
{{"function": "claude_execute", "prompt": "Refactor the authentication system", "project": "assistant", "mode": "stream"}}

CRITICAL: The JSON must be on its own line. Include "project" when the user mentions a specific project. Use "stream" for complex tasks or when user wants visibility. Use "quick" for simple, fast tasks.

For normal conversation (weather, jokes, questions), respond naturally in 1-2 sentences without any JSON."""


@app.route('/')
def index():
    """Serve the main voice assistant page"""
    return render_template('index.html')


@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat request - send to Ollama and return response"""
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        conversation_history = data.get('history', [])

        if not user_message:
            return jsonify({'error': 'No message provided'}), 400

        # Build messages for Ollama
        messages = [{'role': 'system', 'content': get_system_prompt()}]
        messages.extend(conversation_history)
        messages.append({'role': 'user', 'content': user_message})

        # Call Ollama API
        response = requests.post(
            f'{OLLAMA_URL}/api/chat',
            json={
                'model': OLLAMA_MODEL,
                'messages': messages,
                'stream': False
            },
            timeout=60
        )

        if response.status_code != 200:
            return jsonify({'error': 'Ollama request failed'}), 500

        result = response.json()
        assistant_message = result.get('message', {}).get('content', '')

        return jsonify({
            'success': True,
            'response': assistant_message
        })

    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timed out'}), 504
    except Exception as e:
        print(f'Chat error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    """Handle streaming chat request - send to Ollama and stream response"""
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        conversation_history = data.get('history', [])

        if not user_message:
            return jsonify({'error': 'No message provided'}), 400

        # Build messages for Ollama
        messages = [{'role': 'system', 'content': get_system_prompt()}]
        messages.extend(conversation_history)
        messages.append({'role': 'user', 'content': user_message})

        def generate():
            try:
                response = requests.post(
                    f'{OLLAMA_URL}/api/chat',
                    json={
                        'model': OLLAMA_MODEL,
                        'messages': messages,
                        'stream': True
                    },
                    stream=True,
                    timeout=120
                )

                full_response = ''
                for line in response.iter_lines():
                    if line:
                        try:
                            chunk = json.loads(line)
                            content = chunk.get('message', {}).get('content', '')
                            if content:
                                full_response += content
                                yield f"data: {json.dumps({'content': content})}\n\n"
                            if chunk.get('done'):
                                yield f"data: {json.dumps({'done': True, 'full_response': full_response})}\n\n"
                        except json.JSONDecodeError:
                            continue
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(generate(), mimetype='text/event-stream')

    except Exception as e:
        print(f'Stream error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/tts', methods=['POST'])
def text_to_speech():
    """Convert text to speech using Kokoro TTS"""
    try:
        data = request.get_json()
        text = data.get('text', '')
        voice = data.get('voice', KOKORO_VOICE)
        speed = data.get('speed', 1.0)

        if not text:
            return jsonify({'error': 'No text provided'}), 400

        # Call Kokoro TTS API (OpenAI compatible)
        response = requests.post(
            f'{KOKORO_URL}/v1/audio/speech',
            json={
                'input': text,
                'voice': voice,
                'model': 'kokoro',
                'response_format': 'mp3',
                'speed': speed
            },
            timeout=30
        )

        if response.status_code != 200:
            return jsonify({'error': 'TTS request failed'}), 500

        # Return audio as base64
        audio_base64 = base64.b64encode(response.content).decode('utf-8')

        return jsonify({
            'success': True,
            'audio_data': audio_base64,
            'format': 'mp3'
        })

    except requests.exceptions.Timeout:
        return jsonify({'error': 'TTS request timed out'}), 504
    except Exception as e:
        print(f'TTS error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/voices', methods=['GET'])
def list_voices():
    """List available Kokoro TTS voices"""
    try:
        response = requests.get(f'{KOKORO_URL}/v1/audio/voices', timeout=10)

        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch voices'}), 500

        return jsonify(response.json())

    except Exception as e:
        print(f'Voices error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/models', methods=['GET'])
def list_models():
    """List available Ollama models"""
    try:
        response = requests.get(f'{OLLAMA_URL}/api/tags', timeout=10)

        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch models'}), 500

        return jsonify(response.json())

    except Exception as e:
        print(f'Models error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """Check health of all services"""
    status = {
        'app': 'healthy',
        'ollama': 'unknown',
        'kokoro': 'unknown'
    }

    # Check Ollama
    try:
        response = requests.get(f'{OLLAMA_URL}/api/tags', timeout=5)
        status['ollama'] = 'healthy' if response.status_code == 200 else 'unhealthy'
    except:
        status['ollama'] = 'unreachable'

    # Check Kokoro
    try:
        response = requests.get(f'{KOKORO_URL}/health', timeout=5)
        status['kokoro'] = 'healthy' if response.status_code == 200 else 'unhealthy'
    except:
        status['kokoro'] = 'unreachable'

    overall = 'healthy' if all(v == 'healthy' for v in status.values()) else 'degraded'

    return jsonify({
        'status': overall,
        'services': status
    })


# ============ Authentication Endpoints ============

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Authenticate user with password"""
    try:
        data = request.get_json()
        password = data.get('password', '')

        if password == AUTH_PASSWORD:
            session['authenticated'] = True
            session['login_time'] = datetime.now().isoformat()
            return jsonify({'success': True, 'message': 'Logged in successfully'})
        else:
            return jsonify({'error': 'Invalid password'}), 401

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Log out user"""
    session.clear()
    return jsonify({'success': True, 'message': 'Logged out successfully'})


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    """Check authentication status"""
    with passkeys_lock:
        has_passkeys = len(passkeys) > 0
    return jsonify({
        'authenticated': session.get('authenticated', False),
        'login_time': session.get('login_time'),
        'has_passkeys': has_passkeys
    })


# ============ Passkey/WebAuthn Endpoints ============

@app.route('/api/auth/passkey/register-options', methods=['POST'])
@require_auth
def passkey_register_options():
    """Generate options for passkey registration (must be logged in first)"""
    try:
        import secrets
        import hashlib

        # Generate a random challenge
        challenge = secrets.token_bytes(32)
        challenge_b64 = base64.urlsafe_b64encode(challenge).decode('utf-8').rstrip('=')

        # Store challenge for verification
        challenge_id = secrets.token_hex(16)
        auth_challenges[challenge_id] = {
            'challenge': challenge_b64,
            'type': 'register',
            'created_at': datetime.now().isoformat()
        }

        # Get existing credential IDs to exclude
        exclude_credentials = []
        with passkeys_lock:
            for cred_id in passkeys.keys():
                exclude_credentials.append({
                    'type': 'public-key',
                    'id': cred_id
                })

        # Create user ID (hash of a constant since single user)
        user_id = base64.urlsafe_b64encode(
            hashlib.sha256(b'voice-assistant-user').digest()
        ).decode('utf-8').rstrip('=')

        options = {
            'challenge': challenge_b64,
            'challenge_id': challenge_id,
            'rp': {
                'name': PASSKEY_RP_NAME,
                'id': get_passkey_rp_id()
            },
            'user': {
                'id': user_id,
                'name': 'assistant-user',
                'displayName': 'Voice Assistant User'
            },
            'pubKeyCredParams': [
                {'type': 'public-key', 'alg': -7},   # ES256
                {'type': 'public-key', 'alg': -257}  # RS256
            ],
            'timeout': 60000,
            'attestation': 'none',
            'authenticatorSelection': {
                'authenticatorAttachment': 'platform',
                'residentKey': 'preferred',
                'userVerification': 'preferred'
            },
            'excludeCredentials': exclude_credentials
        }

        return jsonify(options)

    except Exception as e:
        print(f'Passkey register options error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/passkey/register', methods=['POST'])
@require_auth
def passkey_register():
    """Complete passkey registration"""
    try:
        data = request.get_json()
        challenge_id = data.get('challenge_id')
        credential = data.get('credential')

        if not challenge_id or not credential:
            return jsonify({'error': 'Missing challenge_id or credential'}), 400

        # Verify challenge exists
        if challenge_id not in auth_challenges:
            return jsonify({'error': 'Invalid or expired challenge'}), 400

        challenge_data = auth_challenges.pop(challenge_id)
        if challenge_data['type'] != 'register':
            return jsonify({'error': 'Wrong challenge type'}), 400

        # Extract credential data
        cred_id = credential.get('id')
        public_key = credential.get('response', {}).get('publicKey')

        if not cred_id:
            return jsonify({'error': 'Missing credential ID'}), 400

        # Store the passkey
        with passkeys_lock:
            passkeys[cred_id] = {
                'public_key': public_key,
                'created_at': datetime.now().isoformat(),
                'name': credential.get('name', 'Passkey')
            }
            save_passkeys()

        return jsonify({
            'success': True,
            'message': 'Passkey registered successfully'
        })

    except Exception as e:
        print(f'Passkey register error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/passkey/auth-options', methods=['POST'])
def passkey_auth_options():
    """Generate options for passkey authentication"""
    try:
        import secrets

        with passkeys_lock:
            if not passkeys:
                return jsonify({'error': 'No passkeys registered'}), 400

            # Generate a random challenge
            challenge = secrets.token_bytes(32)
            challenge_b64 = base64.urlsafe_b64encode(challenge).decode('utf-8').rstrip('=')

            # Store challenge for verification
            challenge_id = secrets.token_hex(16)
            auth_challenges[challenge_id] = {
                'challenge': challenge_b64,
                'type': 'auth',
                'created_at': datetime.now().isoformat()
            }

            # Get allowed credentials
            allow_credentials = []
            for cred_id in passkeys.keys():
                allow_credentials.append({
                    'type': 'public-key',
                    'id': cred_id
                })

        options = {
            'challenge': challenge_b64,
            'challenge_id': challenge_id,
            'rpId': get_passkey_rp_id(),
            'timeout': 60000,
            'userVerification': 'preferred',
            'allowCredentials': allow_credentials
        }

        return jsonify(options)

    except Exception as e:
        print(f'Passkey auth options error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/passkey/auth', methods=['POST'])
def passkey_auth():
    """Complete passkey authentication"""
    try:
        data = request.get_json()
        challenge_id = data.get('challenge_id')
        credential = data.get('credential')

        if not challenge_id or not credential:
            return jsonify({'error': 'Missing challenge_id or credential'}), 400

        # Verify challenge exists
        if challenge_id not in auth_challenges:
            return jsonify({'error': 'Invalid or expired challenge'}), 400

        challenge_data = auth_challenges.pop(challenge_id)
        if challenge_data['type'] != 'auth':
            return jsonify({'error': 'Wrong challenge type'}), 400

        # Verify credential exists
        cred_id = credential.get('id')
        with passkeys_lock:
            if cred_id not in passkeys:
                return jsonify({'error': 'Unknown credential'}), 401

        # In a full implementation, we'd verify the signature here
        # For simplicity, we trust the browser's WebAuthn verification

        # Set session as authenticated
        session['authenticated'] = True
        session['login_time'] = datetime.now().isoformat()
        session['auth_method'] = 'passkey'

        return jsonify({
            'success': True,
            'message': 'Authenticated with passkey'
        })

    except Exception as e:
        print(f'Passkey auth error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/passkey/list', methods=['GET'])
@require_auth
def passkey_list():
    """List registered passkeys"""
    with passkeys_lock:
        passkey_list = []
        for cred_id, data in passkeys.items():
            passkey_list.append({
                'id': cred_id[:16] + '...',  # Truncate for display
                'name': data.get('name', 'Passkey'),
                'created_at': data.get('created_at')
            })
    return jsonify({'passkeys': passkey_list})


@app.route('/api/auth/passkey/delete', methods=['POST'])
@require_auth
def passkey_delete():
    """Delete a passkey"""
    try:
        data = request.get_json()
        cred_id_prefix = data.get('id', '').replace('...', '')

        with passkeys_lock:
            # Find the full credential ID
            to_delete = None
            for cred_id in passkeys.keys():
                if cred_id.startswith(cred_id_prefix):
                    to_delete = cred_id
                    break

            if to_delete:
                del passkeys[to_delete]
                save_passkeys()
                return jsonify({'success': True})
            else:
                return jsonify({'error': 'Passkey not found'}), 404

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ Notification Endpoints ============

@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    """Get all notifications"""
    with notifications_lock:
        unread_count = sum(1 for n in notifications if not n.get('read'))
        return jsonify({
            'notifications': notifications,
            'unread_count': unread_count
        })


@app.route('/api/notifications/mark-read', methods=['POST'])
def mark_notifications_read():
    """Mark notifications as read"""
    try:
        data = request.get_json()
        notification_ids = data.get('ids', [])
        mark_all = data.get('all', False)

        with notifications_lock:
            for notification in notifications:
                if mark_all or notification['id'] in notification_ids:
                    notification['read'] = True
            save_notifications()

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/notifications/clear', methods=['POST'])
def clear_notifications():
    """Clear all notifications"""
    global notifications
    with notifications_lock:
        notifications = []
        save_notifications()
    return jsonify({'success': True})


# ============ Claude Code Execution ============

def run_claude_code(job_id, prompt, project_path):
    """Execute Claude Code in background thread"""
    try:
        with jobs_lock:
            active_jobs[job_id]['status'] = 'running'
            active_jobs[job_id]['started_at'] = datetime.now().isoformat()

        # Build command
        cmd = [
            'claude',
            '-p', prompt,
            '--dangerously-skip-permissions',
            '--allowedTools', CLAUDE_ALLOWED_TOOLS,
            '--output-format', 'json',
            '--max-turns', '10'
        ]

        # Run Claude Code from the project directory
        working_dir = project_path if project_path and os.path.isdir(project_path) else CLAUDE_WORKING_DIR

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout
            cwd=working_dir,
            env={**os.environ, 'TERM': 'dumb'}  # Ensure no TTY issues
        )

        output = result.stdout
        error = result.stderr

        # Try to parse JSON output
        claude_response = None
        try:
            claude_response = json.loads(output)
        except json.JSONDecodeError:
            claude_response = {'result': output}

        # Check for git commits in the output
        commits = []
        if 'commit' in output.lower():
            # Try to extract commit info
            import re
            commit_matches = re.findall(r'[a-f0-9]{7,40}', output)
            commits = list(set(commit_matches))[:5]  # Limit to 5 unique

        # Update job status
        with jobs_lock:
            active_jobs[job_id]['status'] = 'completed'
            active_jobs[job_id]['completed_at'] = datetime.now().isoformat()
            active_jobs[job_id]['result'] = claude_response.get('result', output)
            active_jobs[job_id]['commits'] = commits
            if error:
                active_jobs[job_id]['error'] = error

        # Create success notification
        summary = claude_response.get('result', output)[:200]
        if len(summary) < len(claude_response.get('result', output)):
            summary += '...'

        add_notification(
            title='Claude Code Complete',
            message=f"Task completed: {prompt[:50]}{'...' if len(prompt) > 50 else ''}\n\nSummary: {summary}",
            notification_type='success',
            job_id=job_id
        )

    except subprocess.TimeoutExpired:
        with jobs_lock:
            active_jobs[job_id]['status'] = 'timeout'
            active_jobs[job_id]['error'] = 'Execution timed out after 10 minutes'

        add_notification(
            title='Claude Code Timeout',
            message=f"Task timed out: {prompt[:50]}{'...' if len(prompt) > 50 else ''}",
            notification_type='error',
            job_id=job_id
        )

    except Exception as e:
        with jobs_lock:
            active_jobs[job_id]['status'] = 'error'
            active_jobs[job_id]['error'] = str(e)

        add_notification(
            title='Claude Code Error',
            message=f"Task failed: {prompt[:50]}{'...' if len(prompt) > 50 else ''}\n\nError: {str(e)}",
            notification_type='error',
            job_id=job_id
        )


@app.route('/api/claude/execute', methods=['POST'])
@require_auth
def execute_claude():
    """Execute a Claude Code task with supervisor approval"""
    try:
        data = request.get_json()
        prompt = data.get('prompt', '')
        project_input = data.get('project', '')

        # Resolve project name/alias to actual path
        project_path = resolve_project_path(project_input)

        if not prompt:
            return jsonify({'error': 'No prompt provided'}), 400

        # Create job ID
        job_id = str(uuid.uuid4())

        # Check with supervisor for approval (if available)
        approval_required = False
        try:
            # Evaluate action with supervisor
            eval_response = requests.post(
                f'{SUPERVISOR_URL}/evaluate_action',
                json={
                    'action': {
                        'name': 'claude_execute',
                        'category': 'code_execution',
                        'description': f'Execute Claude Code: {prompt[:100]}',
                        'parameters': {
                            'prompt': prompt,
                            'project': project_path
                        }
                    },
                    'context': {
                        'environment': 'production',
                        'agentId': 'voice-assistant',
                        'sessionId': session.get('login_time', 'unknown')
                    }
                },
                timeout=5
            )

            if eval_response.ok:
                eval_result = eval_response.json()
                if eval_result.get('status') == 'denied':
                    # Create a task for the declined action
                    try:
                        requests.post(
                            f'{SUPERVISOR_URL}/create_task',
                            json={
                                'title': f'Review: {prompt[:50]}',
                                'description': f'This action was requested via voice assistant but declined.\n\nPrompt: {prompt}\n\nReason: {eval_result.get("violations", [])}',
                                'priority': 'medium',
                                'labels': ['needs-approval', 'voice-assistant']
                            },
                            timeout=5
                        )
                    except:
                        pass

                    return jsonify({
                        'error': 'Action declined by supervisor',
                        'reason': eval_result.get('violations', []),
                        'task_created': True
                    }), 403

                if eval_result.get('requiresHumanApproval'):
                    approval_required = True

        except requests.exceptions.RequestException:
            # Supervisor not available, continue without approval
            pass

        if approval_required:
            # Create job in pending state
            with jobs_lock:
                active_jobs[job_id] = {
                    'id': job_id,
                    'prompt': prompt,
                    'project': project_path,
                    'status': 'pending_approval',
                    'created_at': datetime.now().isoformat()
                }

            add_notification(
                title='Approval Required',
                message=f"Task requires approval: {prompt[:100]}",
                notification_type='warning',
                job_id=job_id
            )

            return jsonify({
                'job_id': job_id,
                'status': 'pending_approval',
                'message': 'This action requires human approval'
            })

        # Create job
        with jobs_lock:
            active_jobs[job_id] = {
                'id': job_id,
                'prompt': prompt,
                'project': project_path,
                'status': 'queued',
                'created_at': datetime.now().isoformat()
            }

        # Start background thread
        thread = threading.Thread(
            target=run_claude_code,
            args=(job_id, prompt, project_path)
        )
        thread.daemon = True
        thread.start()

        add_notification(
            title='Claude Code Started',
            message=f"Task started: {prompt[:100]}{'...' if len(prompt) > 100 else ''}",
            notification_type='info',
            job_id=job_id
        )

        return jsonify({
            'job_id': job_id,
            'status': 'queued',
            'message': 'Task started in background'
        })

    except Exception as e:
        print(f'Claude execution error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/claude/jobs', methods=['GET'])
@require_auth
def list_jobs():
    """List all Claude Code jobs"""
    with jobs_lock:
        jobs_list = list(active_jobs.values())
    return jsonify({'jobs': jobs_list})


@app.route('/api/claude/jobs/<job_id>', methods=['GET'])
@require_auth
def get_job(job_id):
    """Get a specific job status"""
    with jobs_lock:
        job = active_jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)


@app.route('/api/claude/jobs/<job_id>/approve', methods=['POST'])
@require_auth
def approve_job(job_id):
    """Approve a pending job"""
    with jobs_lock:
        job = active_jobs.get(job_id)
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        if job['status'] != 'pending_approval':
            return jsonify({'error': 'Job is not pending approval'}), 400

        job['status'] = 'queued'
        job['approved_at'] = datetime.now().isoformat()

    # Start execution
    thread = threading.Thread(
        target=run_claude_code,
        args=(job_id, job['prompt'], job['project'])
    )
    thread.daemon = True
    thread.start()

    return jsonify({'success': True, 'message': 'Job approved and started'})


# ============ Streaming Claude Code Execution ============

# Store streaming session state for approvals
streaming_sessions = {}
streaming_sessions_lock = threading.Lock()


def generate_progress_summary(events):
    """Generate periodic summary for AI consumption - conversational style"""
    tools_used = []
    files_modified = []
    files_read = []
    errors = []
    bash_commands = []

    for event in events:
        event_type = event.get('type', '')

        if event_type == 'assistant':
            message = event.get('message', event)
            for content in message.get('content', []):
                content_type = content.get('type', '')
                if content_type == 'tool_use':
                    tool_name = content.get('name', 'unknown')
                    tools_used.append(tool_name)
                    tool_input = content.get('input', {})
                    if tool_name in ['Write', 'Edit']:
                        file_path = tool_input.get('file_path', '')
                        if file_path:
                            # Get just the filename for readability
                            filename = file_path.split('/')[-1]
                            files_modified.append(filename)
                    elif tool_name == 'Read':
                        file_path = tool_input.get('file_path', '')
                        if file_path:
                            filename = file_path.split('/')[-1]
                            files_read.append(filename)
                    elif tool_name == 'Bash':
                        cmd = tool_input.get('command', '')[:50]
                        if cmd:
                            bash_commands.append(cmd)

        elif event_type == 'system':
            subtype = event.get('subtype', '')
            if 'error' in subtype.lower():
                errors.append(event.get('data', {}).get('message', 'Unknown error'))

    # Generate conversational summary
    unique_modified = list(set(files_modified))
    unique_read = list(set(files_read))

    parts = []
    if unique_modified:
        if len(unique_modified) == 1:
            parts.append(f"updated {unique_modified[0]}")
        elif len(unique_modified) <= 3:
            parts.append(f"updated {', '.join(unique_modified)}")
        else:
            parts.append(f"updated {len(unique_modified)} files")

    if unique_read and not unique_modified:
        if len(unique_read) <= 2:
            parts.append(f"reading {', '.join(unique_read)}")
        else:
            parts.append(f"reviewing {len(unique_read)} files")

    if bash_commands:
        parts.append("running commands")

    if errors:
        parts.append(f"encountered {len(errors)} error{'s' if len(errors) > 1 else ''}")

    conversational = "Claude is still working"
    if parts:
        conversational = f"Claude has {' and '.join(parts)}"

    return {
        'tools_used': list(set(tools_used)),
        'files_modified': unique_modified[:10],
        'files_read': unique_read[:10],
        'error_count': len(errors),
        'event_count': len(events),
        'conversational': conversational
    }


def generate_completion_summary(all_events):
    """Generate a conversational summary of what was accomplished"""
    files_modified = set()
    files_created = set()
    files_read = set()
    bash_commands = []
    errors = []
    final_result = None

    for event in all_events:
        event_type = event.get('type', '')

        if event_type == 'assistant':
            message = event.get('message', event)
            for content in message.get('content', []):
                if isinstance(content, dict) and content.get('type') == 'tool_use':
                    tool_name = content.get('name', '')
                    tool_input = content.get('input', {})

                    if tool_name == 'Write':
                        file_path = tool_input.get('file_path', '')
                        if file_path:
                            files_created.add(file_path.split('/')[-1])
                    elif tool_name == 'Edit':
                        file_path = tool_input.get('file_path', '')
                        if file_path:
                            files_modified.add(file_path.split('/')[-1])
                    elif tool_name == 'Read':
                        file_path = tool_input.get('file_path', '')
                        if file_path:
                            files_read.add(file_path.split('/')[-1])
                    elif tool_name == 'Bash':
                        cmd = tool_input.get('command', '')
                        if cmd:
                            bash_commands.append(cmd.split()[0] if cmd else '')

        elif event_type == 'result':
            result = event.get('result', '')
            if isinstance(result, dict):
                final_result = result.get('text', str(result))
            else:
                final_result = str(result) if result else None

    # Build conversational summary
    parts = []

    if files_modified or files_created:
        all_files = list(files_modified | files_created)
        if len(all_files) == 1:
            parts.append(f"updated {all_files[0]}")
        elif len(all_files) <= 3:
            parts.append(f"updated {', '.join(all_files)}")
        else:
            parts.append(f"updated {len(all_files)} files")

    unique_cmds = list(set(bash_commands))
    if unique_cmds:
        if 'git' in unique_cmds:
            parts.append("made git changes")
        if 'npm' in unique_cmds or 'yarn' in unique_cmds:
            parts.append("ran package commands")
        if 'python' in unique_cmds or 'pytest' in unique_cmds:
            parts.append("ran Python scripts")

    if not parts:
        if files_read:
            parts.append(f"reviewed {len(files_read)} files")
        else:
            parts.append("completed the task")

    summary = f"Claude has {' and '.join(parts)}."

    # Add final result snippet if available and not too long/code-like
    if final_result and len(final_result) < 200:
        # Avoid code-like content
        if not any(c in final_result for c in ['{', '}', 'def ', 'function ', 'import ', 'const ']):
            summary += f" {final_result[:150]}"

    return {
        'text': summary,
        'files_modified': list(files_modified | files_created),
        'files_read': list(files_read),
        'commands_run': len(bash_commands)
    }


def is_permission_request(event):
    """Detect if event is requesting user permission/approval"""
    event_type = event.get('type', '')
    subtype = event.get('subtype', '')

    # Check for permission-related events
    if event_type == 'system':
        if 'permission' in subtype.lower() or 'approval' in subtype.lower():
            return True
        if subtype == 'input_request':
            return True

    # Check for tool use that might need approval
    if event_type == 'assistant':
        for content in event.get('content', []):
            if content.get('type') == 'tool_use':
                tool_name = content.get('name', '')
                # These tools often need approval in non-skip-permissions mode
                if tool_name in ['Bash', 'Write', 'Edit']:
                    tool_input = content.get('input', {})
                    # Check for potentially dangerous operations
                    if tool_name == 'Bash':
                        cmd = tool_input.get('command', '')
                        if any(danger in cmd for danger in ['rm ', 'sudo', 'chmod', 'chown']):
                            return True

    return False


@app.route('/api/claude/stream', methods=['GET'])
@require_auth
def stream_claude():
    """Stream Claude Code execution output via SSE

    Uses GET with query params because EventSource only supports GET.
    Query params: prompt, project, resume (optional Claude session ID to resume)
    """
    prompt = request.args.get('prompt', '')
    project_input = request.args.get('project', '')
    resume_session = request.args.get('resume', '')  # Claude session ID to resume

    # Resolve project name/alias to actual path
    project_path = resolve_project_path(project_input)

    if not prompt and not resume_session:
        return jsonify({'error': 'No prompt or resume session provided'}), 400

    session_id = str(uuid.uuid4())

    def generate():
        # Initialize session state
        with streaming_sessions_lock:
            streaming_sessions[session_id] = {
                'status': 'running',
                'approval_pending': False,
                'approval_response': None,
                'process': None
            }

        # Build command - use stream-json for real-time output
        cmd = ['claude']

        if resume_session:
            # Resume an existing Claude session
            cmd.extend(['--resume', resume_session])
            if prompt:
                cmd.extend(['-p', prompt])
        else:
            # New session
            cmd.extend(['-p', prompt])

        cmd.extend([
            '--output-format', 'stream-json',
            '--verbose',  # Required for stream-json with -p
            '--allowedTools', CLAUDE_ALLOWED_TOOLS,
            '--max-turns', '20'
        ])

        # Determine working directory
        working_dir = project_path if project_path and os.path.isdir(project_path) else CLAUDE_WORKING_DIR

        try:
            # Send session start event
            yield f"data: {json.dumps({'type': 'session_start', 'session_id': session_id})}\n\n"

            # Start process with Popen for streaming
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=working_dir,
                bufsize=1,  # Line buffered
                env={**os.environ, 'TERM': 'dumb'}
            )

            with streaming_sessions_lock:
                streaming_sessions[session_id]['process'] = process

            # Track for summaries
            output_buffer = []  # For periodic summaries (cleared each time)
            all_events = []  # For final completion summary (never cleared)
            last_summary_time = time.time()
            line_count = 0
            claude_session_id = None  # Claude's internal session ID for resume

            # Read output line by line
            for line in iter(process.stdout.readline, ''):
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                line_count += 1

                # Try to parse as JSON
                try:
                    event = json.loads(line)
                    event_type = event.get('type', 'unknown')

                    # Determine line type for styling
                    line_type = 'assistant'
                    content = ''

                    if event_type == 'system':
                        line_type = 'system'
                        content = event.get('message', str(event.get('data', '')))
                        # Try to capture Claude's session ID for resume capability
                        if 'session_id' in str(event):
                            sid = event.get('session_id') or event.get('data', {}).get('session_id')
                            if sid:
                                claude_session_id = sid

                    elif event_type == 'assistant':
                        # Assistant message with content blocks
                        message = event.get('message', event)
                        content_blocks = message.get('content', [])
                        for block in content_blocks:
                            if isinstance(block, dict):
                                if block.get('type') == 'text':
                                    content += block.get('text', '')
                                elif block.get('type') == 'tool_use':
                                    line_type = 'tool'
                                    tool_name = block.get('name', 'unknown')
                                    tool_input = block.get('input', {})
                                    # Format tool call nicely
                                    if tool_name == 'Bash':
                                        cmd = tool_input.get('command', '')[:80]
                                        content = f"$ {cmd}"
                                    elif tool_name in ['Read', 'Write', 'Edit', 'Glob', 'Grep']:
                                        file_path = tool_input.get('file_path', tool_input.get('path', tool_input.get('pattern', '')))
                                        content = f"[{tool_name}] {file_path}"
                                    else:
                                        content = f"[{tool_name}]"
                                elif block.get('type') == 'thinking':
                                    line_type = 'thinking'
                                    content = block.get('thinking', '')[:200]

                    elif event_type == 'user':
                        # User message - typically contains tool_result
                        message = event.get('message', {})
                        content_blocks = message.get('content', [])
                        for block in content_blocks:
                            if isinstance(block, dict):
                                if block.get('type') == 'tool_result':
                                    line_type = 'tool-result'
                                    result_content = block.get('content', '')
                                    # Handle content that could be string or list
                                    if isinstance(result_content, list):
                                        # Extract text from content blocks
                                        texts = []
                                        for item in result_content:
                                            if isinstance(item, dict) and item.get('type') == 'text':
                                                texts.append(item.get('text', ''))
                                        result_content = '\n'.join(texts)
                                    # Truncate long results but show useful portion
                                    if len(result_content) > 300:
                                        content = result_content[:300] + '...'
                                    else:
                                        content = result_content
                                elif block.get('type') == 'text':
                                    content += block.get('text', '')

                    elif event_type == 'tool_result':
                        line_type = 'tool-result'
                        content = str(event.get('content', ''))[:300]

                    elif event_type == 'result':
                        subtype = event.get('subtype', '')
                        if subtype == 'success':
                            line_type = 'success'
                            result = event.get('result', '')
                            if isinstance(result, dict):
                                content = result.get('text', str(result))[:500]
                            else:
                                content = str(result)[:500]
                        else:
                            line_type = 'error'
                            content = event.get('error', event.get('result', ''))[:300]

                    else:
                        # Unknown type - show abbreviated JSON
                        content = json.dumps(event)[:200]

                    # Only send if we have content
                    if content:
                        yield f"data: {json.dumps({'type': 'output', 'content': content, 'line_type': line_type})}\n\n"

                    # Track for summaries
                    output_buffer.append(event)
                    all_events.append(event)  # Keep all events for final summary

                    # Check for permission/approval requests
                    if is_permission_request(event):
                        with streaming_sessions_lock:
                            streaming_sessions[session_id]['approval_pending'] = True

                        # Build approval message
                        approval_msg = 'Claude needs permission to continue.'
                        if event_type == 'assistant':
                            for block in event.get('content', []):
                                if isinstance(block, dict) and block.get('type') == 'tool_use':
                                    tool_input = block.get('input', {})
                                    if 'command' in tool_input:
                                        approval_msg = f"Run: {tool_input['command'][:100]}"
                                    elif 'file_path' in tool_input:
                                        approval_msg = f"Access: {tool_input['file_path']}"

                        yield f"data: {json.dumps({'type': 'approval_needed', 'message': approval_msg, 'session_id': session_id})}\n\n"

                        # Wait for approval (poll every 500ms, timeout after 5 minutes)
                        approval_timeout = 300  # 5 minutes
                        start_wait = time.time()
                        while time.time() - start_wait < approval_timeout:
                            with streaming_sessions_lock:
                                session_state = streaming_sessions.get(session_id, {})
                                if session_state.get('approval_response') is not None:
                                    approved = session_state['approval_response']
                                    session_state['approval_pending'] = False
                                    session_state['approval_response'] = None
                                    break
                            time.sleep(0.5)
                        else:
                            # Timeout - deny by default
                            approved = False
                            yield f"data: {json.dumps({'type': 'approval_timeout'})}\n\n"

                        # Note: In a real implementation, you'd send the approval to Claude's stdin
                        # For now, we just continue (Claude will handle based on --allowedTools)

                    # Periodic summary every 30 seconds
                    if time.time() - last_summary_time > 30 and output_buffer:
                        summary = generate_progress_summary(output_buffer)
                        yield f"data: {json.dumps({'type': 'summary', 'summary': summary})}\n\n"
                        output_buffer = []
                        last_summary_time = time.time()

                except json.JSONDecodeError:
                    # Raw text line (not JSON)
                    yield f"data: {json.dumps({'type': 'raw', 'line': line})}\n\n"

            # Wait for process to complete
            process.wait()

            # Generate final completion summary from all events
            completion_summary = generate_completion_summary(all_events)

            # Send completion event with summary and Claude session ID
            exit_code = process.returncode
            success = exit_code == 0

            yield f"data: {json.dumps({'type': 'complete', 'exit_code': exit_code, 'success': success, 'total_lines': line_count, 'summary': completion_summary, 'claude_session_id': claude_session_id})}\n\n"

            # Store Claude session ID in streaming_sessions for potential resume
            with streaming_sessions_lock:
                if session_id in streaming_sessions:
                    streaming_sessions[session_id]['claude_session_id'] = claude_session_id

            # Create notification with conversational summary
            notification_msg = completion_summary['text'] if success else f"Task failed: {prompt[:50]}{'...' if len(prompt) > 50 else ''}"
            add_notification(
                title='Claude Code Complete' if success else 'Claude Code Failed',
                message=notification_msg,
                notification_type='success' if success else 'error',
                job_id=session_id
            )

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

            add_notification(
                title='Claude Code Error',
                message=f"Task failed: {str(e)[:100]}",
                notification_type='error',
                job_id=session_id
            )

        finally:
            # Cleanup session
            with streaming_sessions_lock:
                if session_id in streaming_sessions:
                    del streaming_sessions[session_id]

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/claude/stream/approve', methods=['POST'])
@require_auth
def approve_stream_action():
    """Send approval/denial for a streaming Claude session"""
    data = request.get_json()
    session_id = data.get('session_id')
    approved = data.get('approved', False)

    if not session_id:
        return jsonify({'error': 'No session_id provided'}), 400

    with streaming_sessions_lock:
        if session_id not in streaming_sessions:
            return jsonify({'error': 'Session not found or already completed'}), 404

        session_state = streaming_sessions[session_id]
        if not session_state.get('approval_pending'):
            return jsonify({'error': 'No approval pending for this session'}), 400

        session_state['approval_response'] = approved

    return jsonify({
        'success': True,
        'approved': approved,
        'message': 'Approval recorded'
    })


@app.route('/api/claude/stream/status/<session_id>', methods=['GET'])
@require_auth
def get_stream_status(session_id):
    """Get status of a streaming session"""
    with streaming_sessions_lock:
        if session_id not in streaming_sessions:
            return jsonify({'error': 'Session not found', 'exists': False}), 404

        session_state = streaming_sessions[session_id]
        return jsonify({
            'exists': True,
            'status': session_state.get('status'),
            'approval_pending': session_state.get('approval_pending', False)
        })


if __name__ == '__main__':
    import ssl

    # Check for SSL certificates
    cert_path = os.path.join(os.path.dirname(__file__), 'certs', 'cert.pem')
    key_path = os.path.join(os.path.dirname(__file__), 'certs', 'key.pem')
    use_https = os.path.exists(cert_path) and os.path.exists(key_path)

    protocol = 'https' if use_https else 'http'

    print(f"""
    ╔══════════════════════════════════════════════════════╗
    ║         Solo Voice Assistant Starting...             ║
    ╠══════════════════════════════════════════════════════╣
    ║  Ollama URL:  {OLLAMA_URL:<38} ║
    ║  Ollama Model: {OLLAMA_MODEL:<37} ║
    ║  Kokoro URL:  {KOKORO_URL:<38} ║
    ║  Kokoro Voice: {KOKORO_VOICE:<37} ║
    ║  HTTPS:       {('Enabled' if use_https else 'Disabled'):<38} ║
    ╚══════════════════════════════════════════════════════╝
    """)

    if use_https:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert_path, key_path)
        app.run(host='0.0.0.0', port=5566, debug=True, ssl_context=context)
    else:
        app.run(host='0.0.0.0', port=5566, debug=True)
