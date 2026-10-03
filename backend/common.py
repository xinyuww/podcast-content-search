"""Small shared I/O, timestamp, API-response and media helpers."""
import hashlib
import json
import os
import re
import subprocess
from backend.paths import ROOT


def atomic_json(path, value):
    pending = path.with_suffix(path.suffix + '.tmp')
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    pending.replace(path)


def stamp(value):
    ms = round(value * 1000)
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds, ms = divmod(ms, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}.{ms:03}'


def api_key():
    value = os.environ.get("OPENAI_API_KEY", "").strip()
    if not value:
        path = ROOT / ".env.local"
        if path.exists():
            for line in path.read_text().splitlines():
                match = re.match(r"\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$", line)
                if match:
                    value = match.group(1).strip().strip("\"'‘’“”")
                    break
    if not value or value.lower().startswith(("your_", "replace", "sk-your")):
        raise ValueError("Missing OPENAI_API_KEY. Set it in the ignored .env.local; never paste it in chat.")
    if not value.isascii() or any(c.isspace() for c in value):
        raise ValueError("OPENAI_API_KEY contains non-ASCII characters or whitespace; check local formatting.")
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def response_result(response):
    if response.get('status') != 'completed':
        raise ValueError('API response not completed: ' + str(response.get('status')))
    texts = []
    for item in response.get('output', []):
        for content in item.get('content', []):
            if content.get('type') == 'refusal':
                raise ValueError('Model refused segmentation')
            if content.get('type') == 'output_text':
                texts.append(content['text'])
    return json.loads(''.join(texts))


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=format_name,duration",
        "-of", "json", str(path),
    ], text=True))["format"]
