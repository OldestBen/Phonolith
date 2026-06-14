import time
import threading
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

AUDIO_EXTENSIONS = {'.flac', '.mp3', '.aac', '.m4a', '.ogg', '.wav', '.aiff', '.wv', '.ape', '.opus'}

_observer: Observer | None = None
_debounce_timer: threading.Timer | None = None


class AudioFileHandler(FileSystemEventHandler):
    def __init__(self, callback):
        self.callback = callback
        self._pending: set[str] = set()
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def _schedule(self):
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(2.0, self._flush)
        self._timer.daemon = True
        self._timer.start()

    def _flush(self):
        with self._lock:
            if self._pending:
                self._pending.clear()
                self.callback()

    def on_created(self, event):
        if not event.is_directory and Path(event.src_path).suffix.lower() in AUDIO_EXTENSIONS:
            with self._lock:
                self._pending.add(event.src_path)
            self._schedule()

    def on_modified(self, event):
        if not event.is_directory and Path(event.src_path).suffix.lower() in AUDIO_EXTENSIONS:
            with self._lock:
                self._pending.add(event.src_path)
            self._schedule()


def start_watcher(library_path: str, on_file_changed=None):
    global _observer
    if _observer:
        return
    handler = AudioFileHandler(callback=on_file_changed or (lambda: None))
    _observer = Observer()
    _observer.schedule(handler, library_path, recursive=True)
    _observer.start()


def stop_watcher():
    global _observer
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None
