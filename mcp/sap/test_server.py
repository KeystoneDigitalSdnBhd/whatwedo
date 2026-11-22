import io
import json
import unittest
from unittest.mock import patch
import server

class SAPTests(unittest.TestCase):
    def test_graphql_errors_are_not_success(self):
        with patch('urllib.request.urlopen', return_value=io.BytesIO(b'{"errors":[{"message":"denied"}]}')):
            with self.assertRaises(RuntimeError):
                server.query('query { x }')

    def test_response_and_timeout(self):
        with patch('urllib.request.urlopen', return_value=io.BytesIO(b'{"data":{"ok":true}}')) as send:
            self.assertEqual(server.query('query { x }'), {'ok': True})
            self.assertEqual(send.call_args.kwargs['timeout'], 30)
            self.assertEqual(send.call_args.args[0].full_url, server.ENDPOINT)

    def test_search_escapes_input_and_paginates(self):
        with patch.object(server, 'query', return_value={}) as query:
            term = 'CAP" } mutation { example'
            server.sap_search(term, 3)
            self.assertIn(json.dumps(term), query.call_args.args[0])
            server.sap_concepts('identity', 2, 4)
            self.assertIn('skip: 4', query.call_args.args[0])

    def test_invalid_inputs_do_not_call_network(self):
        with patch.object(server, 'query') as query:
            for call in [lambda: server.sap_search(''), lambda: server.sap_search('CAP', 0),
                         lambda: server.sap_concepts(limit=101), lambda: server.sap_concepts(skip=-1)]:
                with self.assertRaises(ValueError):
                    call()
            query.assert_not_called()

if __name__ == '__main__':
    unittest.main()
