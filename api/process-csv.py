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

def handler(request):
    """
    Vercel serverless function handler for processing CSV files.
    Expects JSON body with base64-encoded CSV file.
    
    Vercel Python functions receive requests in different formats:
    - Sometimes as an object with 'body' attribute (string or dict)
    - Sometimes directly as the request object
    """
    try:
        # Handle different Vercel request formats
        body = None
        
        # Case 1: Request has a 'body' attribute (string or dict)
        if hasattr(request, 'body'):
            if isinstance(request.body, str):
                body = json.loads(request.body)
            elif isinstance(request.body, dict):
                body = request.body
            else:
                body = request.body
        
        # Case 2: Request is a dict directly
        elif isinstance(request, dict):
            body = request
        
        # Case 3: Try to get body from request attributes
        else:
            # Try common request formats
            if hasattr(request, 'json'):
                body = request.json
            elif hasattr(request, 'data'):
                if isinstance(request.data, str):
                    body = json.loads(request.data)
                else:
                    body = request.data
            else:
                # Last resort: try to parse as JSON string
                try:
                    body = json.loads(str(request))
                except:
                    pass
        
        if not body:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Missing or invalid request body'})
            }
        
        csv_base64 = body.get('csv_base64') if isinstance(body, dict) else None
        col_a = body.get('col_a')
        col_b = body.get('col_b')
        
        if not csv_base64:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Missing csv_base64 in request body'})
            }
        
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
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'CSV must have at least 2 columns'})
                }
            col_a = headers[0]
            col_b = headers[1]
        
        # Run matching job
        output_bytes = run_matching_job(csv_bytes, col_a, col_b)
        
        # Encode output as base64
        output_base64 = base64.b64encode(output_bytes).decode('utf-8')
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'success': True,
                'output_base64': output_base64,
                'output_file_name': 'matched_output.csv'
            })
        }
        
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }
