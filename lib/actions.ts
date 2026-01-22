"use server"

import { writeFile, unlink, readFile, access } from "fs/promises"
import { constants } from "fs"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import os from "os"

const execAsync = promisify(exec)

// Sanitize filename to prevent path traversal and invalid characters
function sanitizeFilename(filename: string): string {
  // Remove path separators and dangerous characters
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "") // Remove leading dots
    .substring(0, 255) // Limit length
}

// Get temp directory - use /tmp on Vercel, os.tmpdir() elsewhere
function getTempDir(): string {
  // On Vercel, /tmp is the only writable directory
  // On local/dev, use os.tmpdir() which works cross-platform
  return process.env.VERCEL ? "/tmp" : os.tmpdir()
}

export async function processSlideForm(formData: FormData) {
  // This function is kept for backward compatibility but uses the same pattern
  return runPythonScript(formData)
}

export async function runPythonScript(formData: FormData) {
  try {
    const file = formData.get("file") as File

    if (!file) {
      throw new Error("Missing file")
    }

    // Read file contents from the request
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const csvBase64 = buffer.toString("base64")
    
    const isVercel = !!process.env.VERCEL
    
    if (isVercel) {
      // On Vercel, call the Python serverless function via HTTP
      // Use absolute URL for server-side fetch
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : 'http://localhost:3000'
      
      const apiUrl = `${baseUrl}/api/process-csv`
      
      console.log("🔄 Calling Python API on Vercel:", apiUrl)
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          csv_base64: csvBase64,
        }),
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` }
        }
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      
      const responseData = await response.json()
      
      // Handle Vercel Python function response format
      // Response might be wrapped in a 'body' string if it's a serverless function
      let result = responseData
      if (responseData.body && typeof responseData.body === 'string') {
        result = JSON.parse(responseData.body)
      }
      
      if (!result.success) {
        throw new Error(result.error || 'Python script failed')
      }
      
      return {
        success: true,
        message: "Python script executed successfully",
        output: "",
        outputFileName: result.output_file_name || `matched_${file.name}`,
        outputBase64: result.output_base64,
      }
    } else {
      // Local development: execute Python directly
      const tempDir = getTempDir()
      const safeInputName = sanitizeFilename(file.name)
      const safeOutputName = sanitizeFilename(`matched_${file.name}`)
      const tempFilePath = path.join(tempDir, safeInputName)
      const outputFilePath = path.join(tempDir, safeOutputName)
      
      await writeFile(tempFilePath, new Uint8Array(buffer))

      try {
        // Try to use venv if it exists locally
        let pythonPath = "python3"
        const venvPythonPath = path.join(process.cwd(), "venv", "bin", "python3")
        try {
          // Check if venv Python executable exists and is accessible
          await access(venvPythonPath, constants.F_OK)
          pythonPath = venvPythonPath
          console.log("✅ Using virtual environment Python:", pythonPath)
        } catch {
          // Venv doesn't exist, use system python3
          pythonPath = "python3"
          console.log("⚠️  Virtual environment not found, using system python3")
        }
        
        const pythonScriptPath = path.join(process.cwd(), "scripts", "process_csv.py")
        
        console.log("🐍 Running Python script locally...")
        console.log(`Python: ${pythonPath}`)
        console.log(`Script: ${pythonScriptPath}`)
        console.log(`Input: ${tempFilePath}`)
        console.log(`Output: ${outputFilePath}`)
        
        const { stdout, stderr } = await execAsync(
          `"${pythonPath}" "${pythonScriptPath}" "${tempFilePath}" "${outputFilePath}"`,
          {
            env: {
              ...process.env,
              OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
            },
          }
        )

        if (stderr && !stderr.includes("DeprecationWarning")) {
          console.warn("Python script warnings:", stderr)
        }

        const outputBuffer = await readFile(outputFilePath)
        const outputBase64 = outputBuffer.toString("base64")

        return {
          success: true,
          message: "Python script executed successfully",
          output: stdout,
          outputFileName: safeOutputName,
          outputBase64: outputBase64,
        }
      } finally {
        await unlink(tempFilePath).catch(console.error)
        await unlink(outputFilePath).catch(console.error)
      }
    }
  } catch (error: any) {
    console.error("❌ Error running Python script:", error)
    return {
      success: false,
      message: error.message || "Error running Python script",
      error: error.stderr || error.stdout || String(error),
    }
  }
}
