"""
Solo Voice Assistant - Flask Backend
Integrates with local Ollama for text generation and Kokoro TTS for voice output
"""

import os
import json
import base64
import requests
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Configuration
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2:latest')
KOKORO_URL = os.environ.get('KOKORO_URL', 'http://localhost:8880')
KOKORO_VOICE = os.environ.get('KOKORO_VOICE', 'af_heart')

# System prompt for the assistant
SYSTEM_PROMPT = """You are a helpful, friendly voice assistant. Keep your responses concise and conversational since they will be spoken aloud. Aim for 1-3 sentences unless the user asks for more detail. Be warm and engaging."""


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
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
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
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
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
