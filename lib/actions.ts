"use server"

import { writeFile, unlink, readFile } from "fs/promises"
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
    
    // Use /tmp on Vercel, os.tmpdir() elsewhere
    const tempDir = getTempDir()
    
    // Sanitize filename to prevent path traversal
    const safeInputName = sanitizeFilename(file.name)
    const safeOutputName = sanitizeFilename(`matched_${file.name}`)
    
    const tempFilePath = path.join(tempDir, safeInputName)
    const outputFilePath = path.join(tempDir, safeOutputName)
    
    // Write uploaded file to temp directory
    await writeFile(tempFilePath, new Uint8Array(buffer))

    try {
      // Determine Python and script paths
      // On Vercel, use system python3 (venv won't be available)
      // On local, try venv first, fallback to system python3
      const isVercel = !!process.env.VERCEL
      let pythonPath = "python3"
      let pythonScriptPath = path.join(process.cwd(), "scripts", "process_csv.py")
      
      if (!isVercel) {
        // Try to use venv if it exists locally
        const venvPythonPath = path.join(process.cwd(), "venv", "bin", "python3")
        try {
          await readFile(venvPythonPath)
          pythonPath = venvPythonPath
        } catch {
          // Venv doesn't exist, use system python3
          pythonPath = "python3"
        }
      }
      
      console.log("🐍 Running Python script on CSV file...")
      console.log(`Using Python: ${pythonPath}`)
      console.log(`Input file: ${tempFilePath}`)
      console.log(`Output file: ${outputFilePath}`)
      
      // Run Python script with input and output file paths
      // Pass environment variables (including OPENAI_API_KEY) to the Python script
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

      console.log("✅ Python script output:", stdout)

      // Check if output file exists and read it
      let outputBase64 = ""
      try {
        const outputBuffer = await readFile(outputFilePath)
        outputBase64 = outputBuffer.toString("base64")
      } catch (readError) {
        console.error("❌ Error reading output file:", readError)
        throw new Error(`Output file was not created. Python script may have failed. Check: ${outputFilePath}`)
      }

      return {
        success: true,
        message: "Python script executed successfully",
        output: stdout,
        outputFileName: safeOutputName,
        outputBase64: outputBase64,
      }
    } catch (error: any) {
      console.error("❌ Error running Python script:", error)
      return {
        success: false,
        message: error.message || "Error running Python script",
        error: error.stderr || error.stdout || String(error),
      }
    } finally {
      // Clean up temporary files
      await unlink(tempFilePath).catch(console.error)
      await unlink(outputFilePath).catch(console.error)
    }
  } catch (error) {
    console.error("❌ Error processing form:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "An unknown error occurred",
    }
  }
}
