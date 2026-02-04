import { NextRequest } from "next/server"
import { spawn } from "child_process"
import { writeFile, unlink, readFile, access } from "fs/promises"
import { constants } from "fs"
import path from "path"
import os from "os"

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .substring(0, 255)
}

export async function POST(request: NextRequest) {
  // Check if running on Vercel - SSE streaming with Python subprocess doesn't work there
  if (process.env.VERCEL) {
    return new Response(
      JSON.stringify({ error: "Streaming not available on Vercel. Use /api/process-csv instead." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  const formData = await request.formData()
  const file = formData.get("file") as File

  if (!file) {
    return new Response(
      JSON.stringify({ error: "No file provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  // Set up temp files
  const tempDir = os.tmpdir()
  const safeInputName = sanitizeFilename(file.name)
  const safeOutputName = sanitizeFilename(`matched_${file.name}`)
  const tempFilePath = path.join(tempDir, safeInputName)
  const outputFilePath = path.join(tempDir, safeOutputName)

  // Write uploaded file to temp
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  await writeFile(tempFilePath, new Uint8Array(buffer))

  // Find Python interpreter
  let pythonPath = "python3"
  const venvPythonPath = path.join(process.cwd(), "venv", "bin", "python3")
  try {
    await access(venvPythonPath, constants.F_OK)
    pythonPath = venvPythonPath
  } catch {
    pythonPath = "python3"
  }

  const pythonScriptPath = path.join(process.cwd(), "scripts", "process_csv.py")

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const sendEvent = (event: string, data: object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        sendEvent("progress", { stage: "starting", message: "Starting Python process...", percent: 0 })

        const pythonProcess = spawn(pythonPath, [pythonScriptPath, tempFilePath, outputFilePath], {
          env: {
            ...process.env,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
          },
        })

        let stderrBuffer = ""

        pythonProcess.stderr.on("data", (data: Buffer) => {
          stderrBuffer += data.toString()
          
          // Parse progress lines
          const lines = stderrBuffer.split("\n")
          stderrBuffer = lines.pop() || "" // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("[PROGRESS]")) {
              const match = line.match(/\[PROGRESS\]\s*(\w+)\|([^|]*)\|(\d*)/)
              if (match) {
                const [, stage, message, percentStr] = match
                const percent = percentStr ? parseInt(percentStr, 10) : undefined
                sendEvent("progress", { stage, message, percent })
              }
            }
          }
        })

        pythonProcess.stdout.on("data", (data: Buffer) => {
          // Capture stdout but don't send as events
          console.log("Python stdout:", data.toString())
        })

        // Wait for process to complete
        const exitCode = await new Promise<number>((resolve) => {
          pythonProcess.on("close", (code) => {
            resolve(code || 0)
          })
        })

        if (exitCode !== 0) {
          sendEvent("error", { message: `Python process exited with code ${exitCode}` })
          controller.close()
          return
        }

        // Read output file and send as final event
        try {
          const outputBuffer = await readFile(outputFilePath)
          const outputBase64 = outputBuffer.toString("base64")
          
          sendEvent("complete", {
            success: true,
            outputFileName: safeOutputName,
            outputBase64: outputBase64,
          })
        } catch (err) {
          sendEvent("error", { message: "Failed to read output file" })
        }

        // Cleanup temp files
        await unlink(tempFilePath).catch(() => {})
        await unlink(outputFilePath).catch(() => {})

        controller.close()
      } catch (err: any) {
        sendEvent("error", { message: err.message || "Unknown error" })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
