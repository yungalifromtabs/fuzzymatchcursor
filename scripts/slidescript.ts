import { OpenAI } from "openai"
import fs from "fs"
import pdfParse from "pdf-parse"
import dotenv from "dotenv"
import { google } from "googleapis"

dotenv.config()

// === INIT OPENAI ===
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// === INIT GOOGLE SLIDES ===
const auth = new google.auth.GoogleAuth({
  keyFile: "service-account.json",
  scopes: ["https://www.googleapis.com/auth/presentations"],
})

const slides = google.slides({ version: "v1", auth })

// === Step 1: Extract PDF Text ===
async function extractTextFromPDF(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  const data = await pdfParse(buffer)
  return data.text
}

// === Step 2: Send to GPT ===
async function analyzeMerchantDocument(pdfText: string): Promise<any> {
  const systemPrompt = `You are a helpful internal agent for Tabs, a company that provides an AI-powered platform for invoicing, receivables, payments, revenue recognition, and reporting. Tabs brings together contract review, billing, collections, payments, revenue recognition, and reporting into a single platform that is easy to use, fast to implement, and gives teams a unified view of their financial operations.
Your job is to help Tabs employees (your users) better understand and support merchants—Tabs customers—by answering questions based on call transcripts and other available data.
Guidelines:
Your knowledge should be strictly focused on Tabs merchants, not Tabs itself. Do not provide general information about Tabs—we already work here.
You will have access to transcripts from calls with merchants. Use this data as your primary source of truth.
Never hallucinate. If you dont have enough information to answer a question, say so.
Be concise, factual, and business-oriented. Assume the user is preparing for a customer-facing meeting or kickoff deck.
If a merchant is referred to by name (e.g., "What does Acme Corp do?"), understand this refers to a Tabs customer.
Clarify and summarize information to help the user quickly get up to speed on a merchant's situation.
You should be able to answer questions like:
What does the merchant do? (their business model or services)
How does the merchant bill customers?
What tools are in the merchants billing tech stack? (e.g., QuickBooks, NetSuite, Stripe, Avalara, CRMs, DocuSign, etc.)
Who are the key players at the merchant, especially the DRI (Directly Responsible Individual) for using Tabs?
Keep answers grounded in the data.`

  const userPrompt = `
I provided a document with transcripts from all our calls with the merchant we are looking to deploy to. I want you to leverage the context you have from the document and provide values for the following fields. For each field, the definition of the value we are looking for is in parentheses:

* [merchantName] (the name of the merchant company)
* [currentTechstack] (details on all the tools the merchant is currently using for processing contracts, producing invoices, and billing. Options usually include but are not limited to Stripe, Quickbooks Online, Quickbooks Enterprise, Maxio, Salesforce, Netsuite, Hubspot, Gsheets)
* [billingModel] (how does the customer bill for their goods and services? Is it Flat Price, Unit Price, Tier flat price, or Tier unit price? Or something entirely custom)
* [contractDetails] (what are the details of typical contracts that the merchant has?)
* [pricingAnomalies] (what are if any, custom pricing or usage elements?)
* [invoicingComplexity] (what are current complexities the merchant encounters with invoicing?)
* [contractComplexity] (what are current complexities the merchant encounters with contract creation and management?)
* [billingComplexity] (what are current complexities the merchant experiences with billing customers?)
* [dealstructureComplexity] (what are complexities the merchant experiences with deal structures for products and services they are providing)
* [merchantInvoicingCadence] (what is the invoicing cadence for the merchant? Options include but are not limited to monthly, quarterly, yearly)
* [tabsGoals] (what are the main 3 goals that Tabs is trying to accomplish with implementing their platform into the merchant's environment?)
* [merchantStakeholder] (who is the individual from the merchant side that we are working with? What is their name? What is their role at the company? What is their responsibility?)

You must respond with a valid JSON object only — no extra commentary or explanation, just the JSON structure. Do not wrap your response in Markdown code fences like \\\`\\\`\\\` or \\\`\\\`\\\`json. Return raw JSON only.
`

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "user", content: `Here is the transcript:\n\n${pdfText}` },
    ],
    temperature: 0.3,
  })

  let raw = completion.choices[0].message?.content || ""
  console.log("🧠 Raw GPT response:\n", raw)

  // Remove Markdown backticks if they exist
  raw = raw
    .replace(/^```(?:json)?\s*/i, "") // leading ``` or ```json
    .replace(/```$/, "") // trailing ```
    .trim()

  if (!raw.startsWith("{")) {
    throw new Error("❌ GPT did not return a valid JSON object:\n\n" + raw)
  }

  return JSON.parse(raw)
}

// === Step 3: Format to Strict JSON ===
async function formatToStrictJSON(looseResponse: string): Promise<any> {
  const prompt = `
You are a strict JSON formatter. You will receive a loosely structured object that may contain extra text, markdown, or improperly formatted fields.

Your task is to extract the useful information and return a **clean JSON object** with the following fields only:

- merchantName: string
- currentTechstack: string[]
- billingModel: string
- contractDetails: string
- pricingAnomalies: string
- invoicingComplexity: string
- contractComplexity: string
- billingComplexity: string
- dealstructureComplexity: string
- merchantInvoicingCadence: string
- tabsGoals: string[]
- merchantStakeholder: {
    name: string,
    role: string,
    responsibility: string
  }

You must respond with a valid JSON object only — no code fences, no explanation, just pure JSON.

Here is the input:
\`\`\`
${looseResponse}
\`\`\`
`

  const result = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a strict JSON reformatter." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  })

  const raw = result.choices[0].message?.content || ""
  const cleaned = raw
    .replace(/```json\s*([\s\S]*?)\s*```/, "$1") // matches ```json ... ```
    .replace(/```([\s\S]*?)```/, "$1") // fallback: matches ``` ... ```
    .trim()

  return JSON.parse(cleaned)
}

// === Step 4: Flatten GPT JSON for Placeholder Mapping ===
function flattenData(data: any): Record<string, string> {
  const map: Record<string, string> = {
    merchantName: data.merchantName,
    billingModel: data.billingModel,
    contractDetails: data.contractDetails,
    pricingAnomalies: data.pricingAnomalies,
    invoicingComplexity: data.invoicingComplexity,
    contractComplexity: data.contractComplexity,
    billingComplexity: data.billingComplexity,
    dealstructureComplexity: data.dealstructureComplexity,
    merchantInvoicingCadence: data.merchantInvoicingCadence,
    currentTechstack: (data.currentTechstack || []).join(", "),
    merchantStakeholderName: data.merchantStakeholder?.name || "",
    merchantStakeholderRole: data.merchantStakeholder?.role || "",
    merchantStakeholderResponsibility: data.merchantStakeholder?.responsibility || "",
  }

  data.tabsGoals?.forEach((goal: string, i: number) => {
    map[`tabsGoals.${i + 1}`] = goal
  })

  return map
}

// === Step 5: Replace Placeholders in Google Slides ===
async function updateGoogleSlides(presentationId: string, data: Record<string, string>) {
  const requests = Object.entries(data).map(([key, value]) => ({
    replaceAllText: {
      containsText: {
        text: `[${key}]`,
        matchCase: true,
      },
      replaceText: value,
    },
  }))

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests },
  })

  console.log("✅ Slides updated successfully.")
}

// === Export functions for use in Next.js ===
export { extractTextFromPDF, analyzeMerchantDocument, formatToStrictJSON, flattenData, updateGoogleSlides }
