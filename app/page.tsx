"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Upload, AlertCircle, CheckCircle, Loader2 } from "lucide-react"
import { runPythonScript } from "@/lib/actions"

export default function Component() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const [validationError, setValidationError] = useState("")
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState("")
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [rowCounts, setRowCounts] = useState<{ colA: number; colB: number } | null>(null)
  const [useRealProgress, setUseRealProgress] = useState(false)
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const estimatedTotalTimeRef = useRef<number>(60) // Default 60 seconds
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastProgressRef = useRef<number>(0) // Track last progress for time estimation

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null
    setFile(selectedFile)
    if (error) setError("")
    if (success) setSuccess("")
    setIsValid(null)
    setValidationError("")
    setRowCounts(null)
  }

  const validateCSVColumns = async () => {
    if (!file) {
      setValidationError("Please upload a CSV file first")
      setIsValid(false)
      return false
    }

    // Validate file type
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setValidationError("Please upload a CSV file")
      setIsValid(false)
      return false
    }

    setIsValidating(true)
    setValidationError("")

    try {
      const text = await file.text()
      const lines = text.split("\n").filter((line) => line.trim().length > 0)
      
      if (lines.length === 0) {
        setValidationError("CSV file is empty")
        setIsValid(false)
        return false
      }

      // Check first line (header) for column count - need at least 2 columns
      const firstLine = lines[0]
      const columns = firstLine.split(",").map((col) => col.trim()).filter((col) => col.length > 0)

      if (columns.length < 2) {
        setValidationError(`CSV must have at least 2 columns, but found ${columns.length}`)
        setIsValid(false)
        return false
      }

      // Count non-empty values in first two columns
      let colACount = 0
      let colBCount = 0
      
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parsing (handles basic cases)
        const rowColumns = lines[i].split(",").map((col) => col.trim())
        if (rowColumns.length >= 1 && rowColumns[0].length > 0) {
          colACount++
        }
        if (rowColumns.length >= 2 && rowColumns[1].length > 0) {
          colBCount++
        }
      }

      setRowCounts({ colA: colACount, colB: colBCount })
      setIsValid(true)
      setValidationError("")
      return true
    } catch (err) {
      setValidationError("Error reading CSV file: " + (err instanceof Error ? err.message : "Unknown error"))
      setIsValid(false)
      return false
    } finally {
      setIsValidating(false)
    }
  }

  const validateForm = () => {
    if (!file) {
      setError("Please upload a CSV file")
      return false
    }

    // Validate file type
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setError("Please upload a CSV file")
      return false
    }

    return true
  }

  // Estimate processing time based on row counts
  const estimateProcessingTime = (colA: number, colB: number): number => {
    // Base time for setup and parsing: 5 seconds
    const baseTime = 5
    
    // Embedding time: ~0.5 seconds per 100 values (batched API calls)
    const totalValues = colA + colB
    const embeddingTime = (totalValues / 100) * 0.5
    
    // Similarity computation: depends on matrix size
    // For 2500 x 4000 = 10M comparisons, roughly 30-60 seconds
    const matrixSize = colA * colB
    const similarityTime = (matrixSize / 1000000) * 5 // ~5 seconds per million comparisons
    
    // Matching and output: 5-10 seconds
    const outputTime = Math.max(5, colA / 500)
    
    // Total with 20% buffer for network latency
    const total = (baseTime + embeddingTime + similarityTime + outputTime) * 1.2
    
    // Minimum 30 seconds, maximum 15 minutes
    return Math.min(Math.max(total, 30), 900)
  }

  // Progress simulation effect - only used when real progress is not available (e.g., on Vercel)
  useEffect(() => {
    // Skip simulation if we're using real progress from SSE
    if (useRealProgress) return
    
    if (isRunning) {
      startTimeRef.current = Date.now()
      
      // Calculate estimated total time based on row counts
      if (rowCounts) {
        estimatedTotalTimeRef.current = estimateProcessingTime(rowCounts.colA, rowCounts.colB)
      } else {
        estimatedTotalTimeRef.current = 120 // Default 2 minutes if no count available
      }
      
      setProgress(0)
      setProgressMessage("Initializing...")
      setTimeRemaining(Math.ceil(estimatedTotalTimeRef.current))
      
      // Progress stages with realistic timing (as percentage of total time)
      const stages = [
        { timePercent: 0.02, message: "Uploading file..." },
        { timePercent: 0.05, message: "Parsing CSV..." },
        { timePercent: 0.10, message: "Running exact matching..." },
        { timePercent: 0.20, message: "Preparing AI embeddings..." },
        { timePercent: 0.55, message: "Getting embeddings from OpenAI..." },
        { timePercent: 0.75, message: "Computing similarity scores..." },
        { timePercent: 0.90, message: "Matching rows..." },
        { timePercent: 0.95, message: "Generating output file..." },
      ]
      
      progressIntervalRef.current = setInterval(() => {
        if (!startTimeRef.current) return
        
        const elapsed = (Date.now() - startTimeRef.current) / 1000 // seconds
        const estimatedTotal = estimatedTotalTimeRef.current
        
        // Calculate progress based on elapsed time (asymptotic approach to 95%)
        // Uses a curve that slows down as it approaches the target
        const rawProgress = (elapsed / estimatedTotal) * 100
        // Asymptotic: never quite reaches 95% until complete
        const progress = Math.min(95 * (1 - Math.exp(-rawProgress / 50)), 94)
        
        setProgress(progress)
        
        // Find appropriate stage message
        const timePercent = elapsed / estimatedTotal
        let currentStage = stages[0]
        for (const stage of stages) {
          if (timePercent >= stage.timePercent) {
            currentStage = stage
          }
        }
        setProgressMessage(currentStage.message)
        
        // Update time remaining
        const remaining = Math.max(0, estimatedTotal - elapsed)
        setTimeRemaining(Math.ceil(remaining))
        
      }, 500) // Update every 500ms for smoother progress
    } else {
      // Cleanup
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
    }
    
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [isRunning, rowCounts, useRealProgress])

  const downloadFile = (base64: string, fileName: string) => {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleRunWithSSE = async (): Promise<boolean> => {
    return new Promise((resolve) => {
      const formData = new FormData()
      formData.append("file", file!)
      
      // Use fetch with SSE endpoint
      fetch("/api/process-csv-stream", {
        method: "POST",
        body: formData,
      })
        .then(async (response) => {
          if (!response.ok) {
            // SSE not available (probably on Vercel), fall back to regular endpoint
            resolve(false)
            return
          }
          
          // Check content type
          const contentType = response.headers.get("content-type")
          if (!contentType?.includes("text/event-stream")) {
            resolve(false)
            return
          }
          
          setUseRealProgress(true)
          startTimeRef.current = Date.now() // Track start time for real progress
          lastProgressRef.current = 0
          
          const reader = response.body?.getReader()
          if (!reader) {
            resolve(false)
            return
          }
          
          const decoder = new TextDecoder()
          let buffer = ""
          
          const processEvents = (text: string) => {
            buffer += text
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""
            
            let currentEvent = ""
            let currentData = ""
            
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7)
              } else if (line.startsWith("data: ")) {
                currentData = line.slice(6)
                
                try {
                  const data = JSON.parse(currentData)
                  
                  if (currentEvent === "progress") {
                    setProgressMessage(data.message || "Processing...")
                    if (data.percent !== undefined && data.percent < 100) {
                      // Don't show 100% from progress events - only from complete event
                      setProgress(Math.min(data.percent, 99))
                      lastProgressRef.current = data.percent
                      
                      // Calculate time remaining based on real progress
                      if (startTimeRef.current && data.percent > 0) {
                        const elapsed = (Date.now() - startTimeRef.current) / 1000
                        const estimatedTotal = elapsed / (data.percent / 100)
                        const remaining = Math.max(0, estimatedTotal - elapsed)
                        setTimeRemaining(Math.ceil(remaining))
                      }
                    }
                  } else if (currentEvent === "complete") {
                    setProgress(100)
                    setProgressMessage("Complete!")
                    setTimeRemaining(0)
                    setSuccess("Values matched successfully - check your downloads")
                    
                    if (data.outputBase64 && data.outputFileName) {
                      downloadFile(data.outputBase64, data.outputFileName)
                    }
                    
                    resolve(true)
                  } else if (currentEvent === "error") {
                    setError(data.message || "An error occurred")
                    resolve(true) // Handled, even if error
                  }
                } catch (e) {
                  console.error("Failed to parse SSE data:", currentData)
                }
              }
            }
          }
          
          const readStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                processEvents(decoder.decode(value, { stream: true }))
              }
            } catch (e) {
              console.error("SSE read error:", e)
              resolve(false)
            }
          }
          
          readStream()
        })
        .catch(() => {
          // SSE failed, fall back to regular endpoint
          resolve(false)
        })
    })
  }

  const handleRun = async () => {
    if (!file) {
      setError("Please upload a CSV file first")
      return
    }

    if (isValid !== true) {
      setError("Please validate the CSV file first")
      return
    }

    setError("")
    setSuccess("")
    setIsRunning(true)
    setProgress(0)
    setProgressMessage("Starting...")
    setTimeRemaining(null)
    setUseRealProgress(false)

    try {
      // Try SSE first for real progress updates (works locally, not on Vercel)
      const sseHandled = await handleRunWithSSE()
      
      if (!sseHandled) {
        // Fall back to regular server action (for Vercel or if SSE fails)
        setUseRealProgress(false)
        
        const formData = new FormData()
        formData.append("file", file!)

        const result = await runPythonScript(formData)

        // Complete progress
        setProgress(100)
        setProgressMessage("Complete!")
        setTimeRemaining(0)

        if (result.success) {
          setSuccess("Values matched successfully - check your downloads")
          
          if (result.outputBase64 && result.outputFileName) {
            downloadFile(result.outputBase64, result.outputFileName)
          }
        } else {
          setError(result.message || "Error running Python script")
        }
      }
    } catch (err) {
      setError("An error occurred while running the Python script")
      console.error(err)
    } finally {
      setIsRunning(false)
      setUseRealProgress(false)
      // Reset progress after a short delay
      setTimeout(() => {
        setProgress(0)
        setProgressMessage("")
        setTimeRemaining(null)
      }, 2000)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Logo in corner */}
      <div className="absolute top-4 left-4">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#14F0F7' }}>
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="font-semibold text-gray-900">Tabs</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">Customer Matching</CardTitle>
            <p className="text-sm text-gray-600 text-center">
              Upload a CSV file to process
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Error banner */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Success banner */}
              {success && (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">{success}</AlertDescription>
                </Alert>
              )}

              {/* File upload */}
              <div className="space-y-2">
                <Label htmlFor="file-upload">Upload CSV File</Label>
                <div className="relative">
                  <Input id="file-upload" type="file" accept=".csv" onChange={handleFileChange} className="w-full" />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <Upload className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
                {file && (
                  <p className="text-sm text-gray-600">
                    Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                )}
                {validationError && (
                  <p className="text-sm text-red-600">{validationError}</p>
                )}
                {isValid === true && rowCounts && (
                  <div className="text-sm text-green-600">
                    <p>✓ CSV validated</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Column A: {rowCounts.colA.toLocaleString()} values · Column B: {rowCounts.colB.toLocaleString()} values
                    </p>
                  </div>
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={validateCSVColumns}
                    disabled={isValidating || !file}
                    className={`flex-1 ${
                      isValid === false
                        ? "bg-red-600 hover:bg-red-700 text-white"
                        : isValid === true
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : ""
                    }`}
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      "Validate"
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleRun}
                    disabled={isRunning || !file || isValid !== true}
                    className="flex-1"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Running...
                      </>
                    ) : (
                      "Run"
                    )}
                  </Button>
                </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Progress Bar */}
        {isRunning && (
          <Card className="w-full max-w-md mt-4">
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">{progressMessage}</span>
                  <span className="text-gray-500">{progress.toFixed(0)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                {timeRemaining !== null && timeRemaining > 0 && (
                  <p className="text-xs text-gray-500 text-center">
                    Estimated time remaining: {timeRemaining >= 60 
                      ? `${Math.floor(timeRemaining / 60)}m ${timeRemaining % 60}s` 
                      : `${timeRemaining}s`}
                  </p>
                )}
                {rowCounts && (rowCounts.colA + rowCounts.colB) > 1000 && progress < 50 && (
                  <p className="text-xs text-amber-600 text-center">
                    Large dataset detected — processing may take several minutes
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
