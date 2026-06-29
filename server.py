from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import hashlib
import json
import os
import time
import unicodedata
import urllib.parse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SURVEY_DATA_DIR", ROOT / "data"))
LOCK_DIR = DATA_DIR / "locks"
NAME_LOCK_DIR = DATA_DIR / "name-locks"
RESULTS_FILE = DATA_DIR / "responses.json"
RESULTS_LOCK = DATA_DIR / "responses.lock"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8087"))


def ensure_storage():
    DATA_DIR.mkdir(exist_ok=True)
    LOCK_DIR.mkdir(exist_ok=True)
    NAME_LOCK_DIR.mkdir(exist_ok=True)
    if not RESULTS_FILE.exists():
        RESULTS_FILE.write_text("[]", encoding="utf-8")


def load_results():
    ensure_storage()
    try:
        return json.loads(RESULTS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_results(results):
    temp_file = RESULTS_FILE.with_suffix(".json.tmp")
    temp_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_file.replace(RESULTS_FILE)


class FileLock:
    def __init__(self, path, timeout=5):
        self.path = path
        self.timeout = timeout
        self.fd = None

    def __enter__(self):
        deadline = time.time() + self.timeout
        while True:
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.fd, str(time.time()).encode("utf-8"))
                return self
            except FileExistsError:
                if time.time() > deadline:
                    raise TimeoutError("保存処理が混み合っています。少し待ってから再送信してください。")
                time.sleep(0.05)

    def __exit__(self, exc_type, exc, traceback):
        if self.fd is not None:
            os.close(self.fd)
        if self.path.exists():
            self.path.unlink()


def normalize_name(name):
    return " ".join(unicodedata.normalize("NFKC", name).strip().lower().split())


def name_lock_path(normalized_name):
    digest = hashlib.sha256(normalized_name.encode("utf-8")).hexdigest()
    return NAME_LOCK_DIR / digest


def read_lock(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_exclusive_lock(path, payload):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    with os.fdopen(fd, "w", encoding="utf-8") as lock_file:
        json.dump(payload, lock_file, ensure_ascii=False)


def used_ids():
    ids = set()
    for record in load_results():
        participant_id = record.get("participant", {}).get("id")
        if isinstance(participant_id, int):
            ids.add(participant_id)
    return sorted(ids)


def used_names():
    names = []
    seen = set()

    for path in NAME_LOCK_DIR.iterdir():
        if not path.is_file():
            continue
        payload = read_lock(path)
        name = payload.get("name")
        normalized = payload.get("normalizedName")
        if isinstance(name, str) and isinstance(normalized, str) and normalized not in seen:
            seen.add(normalized)
            names.append(name.strip())

    for record in load_results():
        name = record.get("participant", {}).get("name")
        if not isinstance(name, str):
            continue
        normalized = normalize_name(name)
        if normalized and normalized not in seen:
            seen.add(normalized)
            names.append(name.strip())

    return names


def parse_participant(payload):
    participant = payload["participant"]
    participant_id = int(participant["id"])
    participant_name = str(participant["name"]).strip()
    group = participant["group"]

    if participant_id < 1 or participant_id > 30:
        return None, "番号は1〜30から選択してください。"

    normalized_name = normalize_name(participant_name)
    if not normalized_name:
        return None, "名前を入力してください。"

    expected_group = "A" if participant_id % 2 == 1 else "B"
    if group != expected_group:
        return None, "番号と条件の組み合わせが正しくありません。"

    participant["id"] = participant_id
    participant["name"] = participant_name
    return {
        "participant": participant,
        "participantId": participant_id,
        "participantName": participant_name,
        "normalizedName": normalized_name,
        "group": group,
    }, None


class SurveyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(content_length).decode("utf-8"))

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/participants":
            self.send_json(200, {"usedIds": used_ids(), "usedNames": used_names()})
            return
        if path == "/api/results":
            self.send_json(200, {"results": load_results(), "usedIds": used_ids(), "usedNames": used_names()})
            return
        super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/start":
            self.handle_start()
            return
        if path == "/api/responses":
            self.handle_response()
            return
        self.send_error(404)

    def handle_start(self):
        ensure_storage()
        try:
            payload = self.read_json_body()
            parsed, error = parse_participant(payload)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "送信データの形式が正しくありません。"})
            return

        if error:
            self.send_json(400, {"error": error})
            return

        participant_id = parsed["participantId"]
        normalized_name = parsed["normalizedName"]
        normalized_name_lock_path = name_lock_path(normalized_name)
        start_token = hashlib.sha256(f"{participant_id}:{normalized_name}:{time.time_ns()}".encode("utf-8")).hexdigest()
        lock_payload = {
            "participantId": participant_id,
            "name": parsed["participantName"],
            "normalizedName": normalized_name,
            "group": parsed["group"],
            "startToken": start_token,
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        try:
            with FileLock(RESULTS_LOCK):
                results = load_results()
                id_used = any(record.get("participant", {}).get("id") == participant_id for record in results)
                name_used = any(normalize_name(record.get("participant", {}).get("name", "")) == normalized_name for record in results)

                if id_used:
                    self.send_json(409, {"error": "この番号はすでに回答済みです。別の番号を選択してください。"})
                    return
                if name_used or normalized_name_lock_path.exists():
                    self.send_json(409, {"error": "この名前はすでに回答済みです。"})
                    return

                try:
                    write_exclusive_lock(normalized_name_lock_path, lock_payload)
                except FileExistsError:
                    self.send_json(409, {"error": "この名前はすでに回答済みです。"})
                    return
        except FileExistsError:
            self.send_json(409, {"error": "この名前はすでに回答済みです。"})
            return
        except TimeoutError as error:
            self.send_json(503, {"error": str(error)})
            return

        self.send_json(201, {"ok": True, "startToken": start_token})

    def handle_response(self):
        ensure_storage()
        try:
            payload = self.read_json_body()
            parsed, error = parse_participant(payload)
            responses = payload["responses"]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "送信データの形式が正しくありません。"})
            return

        if error:
            self.send_json(400, {"error": error})
            return

        participant = parsed["participant"]
        participant_id = parsed["participantId"]
        normalized_name = parsed["normalizedName"]
        start_token = participant.get("startToken")
        name_lock = read_lock(name_lock_path(normalized_name))

        if not start_token or name_lock.get("startToken") != start_token:
            self.send_json(409, {"error": "開始手続きが確認できませんでした。最初からやり直してください。"})
            return

        try:
            with FileLock(RESULTS_LOCK):
                results = load_results()
                if any(record.get("participant", {}).get("id") == participant_id for record in results):
                    self.send_json(409, {"error": "この番号はすでに回答済みです。別の番号を選択してください。"})
                    return
                if any(normalize_name(record.get("participant", {}).get("name", "")) == normalized_name for record in results):
                    self.send_json(409, {"error": "この名前はすでに回答済みです。"})
                    return

                results.append({
                    "participant": participant,
                    "responses": responses,
                    "submittedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                save_results(results)
            self.send_json(201, {"ok": True})
        except TimeoutError as error:
            self.send_json(503, {"error": str(error)})


if __name__ == "__main__":
    ensure_storage()
    server = ThreadingHTTPServer((HOST, PORT), SurveyHandler)
    print(f"Survey server running on {HOST}:{PORT}")
    if HOST in ("0.0.0.0", ""):
        print(f"Local URL: http://127.0.0.1:{PORT}/")
        print(f"For phones on the same Wi-Fi, open http://<this Mac's IP address>:{PORT}/")
    server.serve_forever()
