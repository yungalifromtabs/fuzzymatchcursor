# Vercel Deployment Checklist

## ✅ What Should Work

1. **Next.js App**: Fully compatible - Vercel is built for Next.js
2. **Python Serverless Function**: Located at `api/process-csv.py` - Vercel will auto-detect it
3. **Dependencies**: `requirements.txt` in root - Vercel will install Python packages automatically
4. **File Structure**: Import paths should work correctly

## ⚠️ Required Configuration on Vercel

### 1. Environment Variables
**CRITICAL**: You must set `OPENAI_API_KEY` in Vercel project settings:

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: Your OpenAI API key
   - **Environment**: Production, Preview, Development (select all)

### 2. Python Runtime
Vercel should auto-detect Python files in `api/` directory, but verify:
- The file `api/process-csv.py` exists
- `requirements.txt` is in the project root
- Python dependencies are listed in `requirements.txt`

### 3. Build Settings
No special build settings needed - Vercel handles Next.js + Python automatically.

## 🔍 Potential Issues & Solutions

### Issue 1: Python Function Not Found
**Symptom**: `404 Not Found` when calling `/api/process-csv`

**Solution**: 
- Ensure `api/process-csv.py` exists (not in `app/api/`)
- Check Vercel build logs for Python function detection

### Issue 2: Missing Dependencies
**Symptom**: `ModuleNotFoundError` in Python function

**Solution**:
- Verify `requirements.txt` includes all dependencies:
  ```
  numpy>=1.24.0
  scikit-learn>=1.3.0
  openai>=1.0.0
  ```
- Check Vercel build logs for pip install errors

### Issue 3: OPENAI_API_KEY Not Available
**Symptom**: `Missing OPENAI_API_KEY environment variable` error

**Solution**:
- Set `OPENAI_API_KEY` in Vercel environment variables (see above)
- Redeploy after adding environment variable

### Issue 4: Request Format Issues
**Symptom**: `Missing or invalid request body` errors

**Solution**: 
- The handler has been updated to handle multiple request formats
- If issues persist, check Vercel function logs for the actual request format

### Issue 5: Import Errors
**Symptom**: `ModuleNotFoundError: No module named 'process_csv'`

**Solution**:
- Verify `scripts/process_csv.py` exists
- The handler adds `scripts/` to Python path automatically
- Check file structure is preserved in deployment

## 📝 Testing Deployment

1. **Deploy to Vercel**:
   ```bash
   git push origin main
   # Or use Vercel CLI: vercel --prod
   ```

2. **Check Build Logs**:
   - Look for Python function detection
   - Verify `pip install -r requirements.txt` succeeds
   - Check for any import errors

3. **Test the Function**:
   - Upload a CSV file through the UI
   - Check Vercel function logs for errors
   - Verify environment variables are accessible

4. **Monitor Function Logs**:
   - Go to Vercel dashboard → Your Project → Functions
   - Check logs for `api/process-csv` function
   - Look for any runtime errors

## 🚨 Important Notes

1. **Local vs Production**:
   - Local: Uses `venv/bin/python3` if available
   - Vercel: Uses system Python with packages from `requirements.txt`
   - The code automatically detects the environment

2. **File System**:
   - Vercel functions are read-only except `/tmp`
   - The code uses base64 encoding to avoid file system issues
   - No temporary files are created on Vercel

3. **Timeout Limits**:
   - Hobby plan: 10 seconds
   - Pro plan: 60 seconds
   - Enterprise: Custom
   - Large CSV files might hit timeout limits

4. **Cold Starts**:
   - First request may be slower (cold start)
   - Subsequent requests are faster (warm)

## ✅ Verification Steps

After deployment, verify:

- [ ] Build succeeds without errors
- [ ] Python function is detected in build logs
- [ ] Dependencies install successfully
- [ ] `OPENAI_API_KEY` is set in environment variables
- [ ] CSV upload works in production
- [ ] Python script executes successfully
- [ ] Output file downloads correctly

## 📞 If Issues Persist

1. Check Vercel function logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test the Python function locally first
4. Check Vercel status page for service issues
5. Review Vercel documentation for Python functions
