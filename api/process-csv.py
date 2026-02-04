from http.server import BaseHTTPRequestHandler
import json
import base64
import os
import sys

# Add scripts directory to path
script_dir = os.path.join(os.path.dirname(__file__), '..', 'scripts')
if os.path.exists(script_dir):
    sys.path.insert(0, script_dir)
else:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

from process_csv import run_matching_job


class handler(BaseHTTPRequestHandler):
    """
    Vercel serverless function handler for processing CSV files.
    Uses BaseHTTPRequestHandler which Vercel's Python runtime expects.
    """
    
    def do_POST(self):
        """Handle POST requests"""
        try:
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(content_length)
            body = json.loads(body_bytes.decode('utf-8'))
            
            csv_base64 = body.get('csv_base64')
            col_a = body.get('col_a')
            col_b = body.get('col_b')
            
            if not csv_base64:
                self._send_error(400, 'Missing csv_base64 in request body')
                return
            
            # Decode base64 CSV
            csv_bytes = base64.b64decode(csv_base64)
            
            # Use first 2 columns if not specified
            if not col_a or not col_b:
                import csv
                import io
                text = csv_bytes.decode('utf-8-sig', errors='replace')
                reader = csv.DictReader(io.StringIO(text))
                headers = reader.fieldnames or []
                if len(headers) < 2:
                    self._send_error(400, 'CSV must have at least 2 columns')
                    return
                col_a = headers[0]
                col_b = headers[1]
            
            # Run matching job
            output_bytes = run_matching_job(csv_bytes, col_a, col_b)
            
            # Encode output as base64
            output_base64 = base64.b64encode(output_bytes).decode('utf-8')
            
            # Send success response
            self._send_response(200, {
                'success': True,
                'output_base64': output_base64,
                'output_file_name': 'matched_output.csv'
            })
            
        except Exception as e:
            self._send_error(500, str(e))
    
    def do_GET(self):
        """Handle GET requests - return info about the endpoint"""
        self._send_response(200, {
            'status': 'ok',
            'message': 'CSV Processing API. Send a POST request with csv_base64 in the body.',
            'methods': ['POST']
        })
    
    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def _send_response(self, status_code, data):
        """Send a JSON response"""
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
    
    def _send_error(self, status_code, message):
        """Send an error response"""
        self._send_response(status_code, {
            'success': False,
            'error': message
        })
