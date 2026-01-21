"use server"

import { writeFile, unlink, mkdir, readFile } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"

const execAsync = promisify(exec)

export async function processSlideForm(formData: FormData) {
  try {
    const file = formData.get("file") as File

    if (!file) {
      throw new Error("Missing file")
    }

    // Save uploaded file temporarily
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const tempDir = path.join(process.cwd(), "temp")
    
    // Ensure temp directory exists
    try {
      await mkdir(tempDir, { recursive: true })
    } catch (err) {
      // Directory might already exist, ignore
    }

    const tempFilePath = path.join(tempDir, file.name)
    const outputFileName = `matched_${file.name}`
    const outputFilePath = path.join(tempDir, outputFileName)
    
    await writeFile(tempFilePath, new Uint8Array(buffer))

    try {
      // Path to Python script and virtual environment
      const pythonScriptPath = path.join(process.cwd(), "scripts", "process_csv.py")
      const venvPythonPath = path.join(process.cwd(), "venv", "bin", "python3")
      
      console.log("🔄 Running fuzzy matching on CSV file...")
      
      // Run Python script with input and output file paths using venv Python
      // Pass environment variables (including OPENAI_API_KEY) to the Python script
      const { stdout, stderr } = await execAsync(
        `"${venvPythonPath}" "${pythonScriptPath}" "${tempFilePath}" "${outputFilePath}"`,
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

      console.log("✅ Matching completed:", stdout)

      // Read the output file to return it
      const outputBuffer = await readFile(outputFilePath)
      const outputBase64 = outputBuffer.toString("base64")

      return {
        success: true,
        message: "CSV matching completed successfully!",
        outputFileName: outputFileName,
        outputBase64: outputBase64,
      }
    } catch (error: any) {
      console.error("❌ Error running matching job:", error)
      return {
        success: false,
        message: error.message || "Error running matching job",
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

export async function runPythonScript(formData: FormData) {
  try {
    const file = formData.get("file") as File

    if (!file) {
      throw new Error("Missing file")
    }

    // Save uploaded file temporarily
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const tempDir = path.join(process.cwd(), "temp")
    
    // Ensure temp directory exists
    try {
      await mkdir(tempDir, { recursive: true })
    } catch (err) {
      // Directory might already exist, ignore
    }

    const tempFilePath = path.join(tempDir, file.name)
    const outputFileName = `matched_${file.name}`
    const outputFilePath = path.join(tempDir, outputFileName)
    
    await writeFile(tempFilePath, new Uint8Array(buffer))

    try {
      // Path to Python script and virtual environment
      const pythonScriptPath = path.join(process.cwd(), "scripts", "process_csv.py")
      const venvPythonPath = path.join(process.cwd(), "venv", "bin", "python3")
      
      console.log("🐍 Running Python script on CSV file...")
      
      // Run Python script with input and output file paths using venv Python
      // Pass environment variables (including OPENAI_API_KEY) to the Python script
      const { stdout, stderr } = await execAsync(
        `"${venvPythonPath}" "${pythonScriptPath}" "${tempFilePath}" "${outputFilePath}"`,
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
        outputFileName: outputFileName,
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
