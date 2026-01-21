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
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null
    setFile(selectedFile)
    if (error) setError("")
    if (success) setSuccess("")
    setIsValid(null)
    setValidationError("")
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

      // Check all rows have at least 2 columns
      for (let i = 1; i < Math.min(lines.length, 10); i++) {
        const rowColumns = lines[i].split(",").map((col) => col.trim()).filter((col) => col.length > 0)
        if (rowColumns.length < 2) {
          setValidationError(`Row ${i + 1} has ${rowColumns.length} column(s), need at least 2`)
          setIsValid(false)
          return false
        }
      }

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

  // Progress simulation effect
  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now()
      setProgress(0)
      setProgressMessage("Initializing...")
      
      // Simulate progress updates
      const stages = [
        { progress: 5, message: "Uploading file..." },
        { progress: 15, message: "Parsing CSV..." },
        { progress: 30, message: "Running exact matching..." },
        { progress: 50, message: "Preparing AI embeddings..." },
        { progress: 70, message: "Computing similarity scores..." },
        { progress: 85, message: "Matching rows..." },
        { progress: 95, message: "Generating output..." },
      ]
      
      let stageIndex = 0
      let currentProgressValue = 0
      
      progressIntervalRef.current = setInterval(() => {
        if (stageIndex < stages.length) {
          const stage = stages[stageIndex]
          currentProgressValue = stage.progress
          setProgress(stage.progress)
          setProgressMessage(stage.message)
          stageIndex++
        } else {
          // Slow progress from 95% to 99%
          currentProgressValue = Math.min(currentProgressValue + 0.5, 99)
          setProgress(currentProgressValue)
        }
        
        // Calculate estimated time remaining
        if (startTimeRef.current && currentProgressValue > 0) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000 // seconds
          const estimatedTotal = elapsed / (currentProgressValue / 100)
          const remaining = estimatedTotal - elapsed
          setTimeRemaining(Math.max(0, Math.ceil(remaining)))
        }
      }, 1000) // Update every second
    } else {
      // Cleanup
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
      if (!isRunning) {
        setProgress(0)
        setProgressMessage("")
        setTimeRemaining(null)
        startTimeRef.current = null
      }
    }
    
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [isRunning])

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

    try {
      const formData = new FormData()
      formData.append("file", file!)

      const result = await runPythonScript(formData)

      // Complete progress
      setProgress(100)
      setProgressMessage("Complete!")
      setTimeRemaining(0)

      if (result.success) {
        setSuccess("Values matched successfully - check your downloads")
        
        // Download the output file
        if (result.outputBase64 && result.outputFileName) {
          // Convert base64 to blob
          const binaryString = atob(result.outputBase64)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const blob = new Blob([bytes], { type: "text/csv" })
          
          // Create download link and trigger download
          const url = URL.createObjectURL(blob)
          const link = document.createElement("a")
          link.href = url
          link.download = result.outputFileName
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
        }
      } else {
        setError(result.message || "Error running Python script")
      }
    } catch (err) {
      setError("An error occurred while running the Python script")
      console.error(err)
    } finally {
      setIsRunning(false)
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
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="font-semibold text-gray-900">Tabs</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">Placeholder</CardTitle>
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
                {isValid === true && (
                  <p className="text-sm text-green-600">✓ CSV validated: At least 2 columns detected</p>
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
                    Estimated time remaining: {timeRemaining} second{timeRemaining !== 1 ? "s" : ""}
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
