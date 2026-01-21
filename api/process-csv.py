from http.server import BaseHTTPRequestHandler
import json
import base64
import os
import sys

# Add scripts directory to path
# On Vercel, scripts are in the same directory structure
script_dir = os.path.join(os.path.dirname(__file__), '..', 'scripts')
if os.path.exists(script_dir):
    sys.path.insert(0, script_dir)
else:
    # Fallback: try current directory structure
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

from process_csv import run_matching_job

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))
            
            csv_base64 = data.get('csv_base64')
            col_a = data.get('col_a')
            col_b = data.get('col_b')
            
            if not csv_base64:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Missing csv_base64'}).encode())
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
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'CSV must have at least 2 columns'}).encode())
                    return
                col_a = headers[0]
                col_b = headers[1]
            
            # Run matching job
            output_bytes = run_matching_job(csv_bytes, col_a, col_b)
            
            # Encode output as base64
            output_base64 = base64.b64encode(output_bytes).decode('utf-8')
            
            # Return success response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'output_base64': output_base64,
                'output_file_name': f'matched_output.csv'
            }).encode())
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': False,
                'error': str(e)
            }).encode())
