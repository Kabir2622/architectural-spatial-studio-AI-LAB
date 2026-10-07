"""Network-free regressions for bounded generation and recommendation caching."""
import copy
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as api
import recommender
from response_cache import ResponseCache


class LatencyTests(unittest.TestCase):
    def setUp(self):
        api.response_cache = ResponseCache()
        self.redis_patch = patch.object(api, 'redis_client', None)
        self.redis_patch.start()
        self.limit_enabled = api.limiter.enabled
        api.limiter.enabled = False
        self.client = api.app.test_client()
        self.payload = dict(width=16, depth=14, budget=12000, style='Minimalist Modern', eco_mode=False)

    def tearDown(self):
        self.redis_patch.stop()
        api.limiter.enabled = self.limit_enabled

    def test_repeat_request_is_cached_without_redis(self):
        with patch.object(api, 'get_llm_recommendation', side_effect=lambda candidates, style, budget, **kw:
                          recommender.get_fallback_recommendation(candidates, style, budget)) as generate:
            first = self.client.post('/api/recommend', json=self.payload)
            started = time.monotonic()
            second = self.client.post('/api/recommend', json=self.payload)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json, second.json)
            self.assertEqual(generate.call_count, 1)
            self.assertLess(time.monotonic() - started, 0.5)
            for tier in second.json['tiers'].values():
                self.assertEqual(len(tier['detailed_bundle']), 5)
                self.assertEqual(tier['total_price'], sum(item['price'] for item in tier['detailed_bundle'].values()))
                for singular, item in tier['detailed_bundle'].items():
                    plural = 'vanities' if singular == 'vanity' else singular + 's'
                    original = next(product for product in api.load_raw_catalog()[plural] if product['id'] == item['id'])
                    self.assertEqual(item['price'], original['price'])

    def test_changed_catalog_invalidates_recommendation(self):
        catalog = copy.deepcopy(api.load_raw_catalog())
        with patch.object(api, 'load_raw_catalog', return_value=catalog), patch.object(api, 'get_llm_recommendation', side_effect=lambda candidates, style, budget, **kw:
                          recommender.get_fallback_recommendation(candidates, style, budget)) as generate:
            self.client.post('/api/recommend', json=self.payload)
            catalog['faucets'][0]['price'] += 1
            self.client.post('/api/recommend', json=self.payload)
            self.assertEqual(generate.call_count, 2)

    def test_slow_provider_is_bounded_and_returns_valid_local_bundle(self):
        finished = threading.Event()
        fake_client = type('FakeClient', (), {})()
        fake_client.models = type('Models', (), {})()
        def stalled(**kwargs):
            finished.wait(1)
            return type('Response', (), {'text': '{}'})()
        fake_client.models.generate_content = stalled
        candidates = api.constraint_filter(16, 14, 18000, 'Minimalist Modern')
        try:
            with patch.object(recommender, 'get_client', return_value=fake_client), patch.object(recommender, 'GENERATION_TIMEOUT', 0.03):
                started = time.monotonic()
                result = recommender.get_llm_recommendation(candidates, 'Minimalist Modern', 12000)
                self.assertLess(time.monotonic() - started, 0.3)
                self.assertEqual(result['recommendation_source'], 'local')
                self.assertEqual(set(result['tiers']), {'essential', 'curated', 'eco', 'signature'})
        finally:
            finished.set()

    def test_cache_copies_results_and_evicts_old_entries(self):
        cache = ResponseCache(max_entries=1)
        cache.set('a', {'bundle': ['original']})
        cached = cache.get('a'); cached['bundle'][0] = 'modified'
        self.assertEqual(cache.get('a')['bundle'], ['original'])
        cache.set('b', {})
        self.assertIsNone(cache.get('a'))

    def test_invalid_dimensions_are_rejected_before_generation(self):
        with patch.object(api, 'get_llm_recommendation') as generate:
            self.assertEqual(self.client.post('/api/recommend', json={**self.payload, 'width': 'NaN'}).status_code, 400)
            self.assertEqual(self.client.post('/api/recommend', json={**self.payload, 'budget': 0}).status_code, 400)
            generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
