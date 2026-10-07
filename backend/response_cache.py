"""Bounded process-local cache; works even when Redis is not installed."""
import copy
import time
from collections import OrderedDict
from threading import Lock


class ResponseCache:
    def __init__(self, ttl=3600, max_entries=128):
        self.ttl = ttl
        self.max_entries = max_entries
        self.entries = OrderedDict()
        self.lock = Lock()

    def get(self, key):
        with self.lock:
            entry = self.entries.get(key)
            if entry is None:
                return None
            expires, value = entry
            if expires <= time.monotonic():
                del self.entries[key]
                return None
            self.entries.move_to_end(key)
            return copy.deepcopy(value)

    def set(self, key, value):
        with self.lock:
            self.entries[key] = (time.monotonic() + self.ttl, copy.deepcopy(value))
            self.entries.move_to_end(key)
            while len(self.entries) > self.max_entries:
                self.entries.popitem(last=False)
