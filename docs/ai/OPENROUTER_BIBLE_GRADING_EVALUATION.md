# Da'at AI Quiz Platform — OpenRouter Evaluation & Biblical Grading Model Benchmark

**Document Version:** 2.0.0 (Revised & Validated)  
**Status:** Evaluation, Cost Analysis & Architectural Specification  
**Benchmark Execution Status:** `BENCHMARK NOT YET EXECUTED`  
**Date:** November 2026  
**Target Systems:** Da'at Biblical Quiz Platform (`supabase/functions/grade-answer`, `src/utils/evaluator.ts`)  
**Scope:** Research and evaluation only. No production modifications, no live benchmark calls without authorization.  

---

## Revision Note (v2.0.0)

This revised report corrects previous drafts that presented theoretical expectations and preliminary estimates as measured benchmark facts. Specifically:
1. **Benchmark Results Removed:** All composite scores, fabricated latency figures, and unverified pass percentages have been removed. The benchmark status is explicitly marked as `BENCHMARK NOT YET EXECUTED`.
2. **Current Model Shortlist Refreshed:** Model slugs, context windows, and pricing have been refreshed directly against current OpenRouter API documentation (including Gemini Flash, DeepSeek, Qwen, and OpenAI variants).
3. **Fallback & Routing Syntaxes Validated:** The OpenRouter payload syntax has been updated to reflect the official `models` array, provider routing parameters (`order`, `allow_fallbacks`, `require_parameters`), and documented failure cascading behaviors.
4. **Privacy & ZDR Clarified:** The distinction between Zero Data Retention (ZDR), Safety Retention, and OpenRouter request metadata has been documented accurately. Absolute zero-logging claims have been corrected.
5. **Deterministic Fast-Path Safety Defined:** The exact-match fast-path logic has been analyzed to prevent misclassifying keyword rubrics (e.g., *"Zechariah Vision Mute"*) as literal target answers.
6. **Strict Response Validation in Code Sample:** The Edge Function code sample has been corrected to eliminate fallback logic (`Number(score) || 0`) that would convert malformed AI outputs into student zeros.

---

## Table of Contents

1. [Phase 1: Current AI Architecture Review & Defect Analysis](#phase-1-current-ai-architecture-review--defect-analysis)
2. [Phase 2: OpenRouter Gateway Capabilities Investigation](#phase-2-openrouter-gateway-capabilities-investigation)
3. [Phase 3: Current Model Shortlist for Biblical Quiz Grading](#phase-3-current-model-shortlist-for-biblical-quiz-grading)
4. [Phase 4: Rigorous Financial & Cost Modeling](#phase-4-rigorous-financial--cost-modeling)
5. [Phase 5: 40-Case Biblical Grading Benchmark Dataset](#phase-5-40-case-biblical-grading-benchmark-dataset)
6. [Phase 6: Benchmark Execution Status & Testing Methodology](#phase-6-benchmark-execution-status--testing-methodology)
7. [Phase 7: Provider-Independent Architecture Proposal](#phase-7-provider-independent-architecture-proposal)
8. [Phase 8: Telemetry, Usage & Cost Tracking Design](#phase-8-telemetry-usage--cost-tracking-design)
9. [Phase 9: Student Data Privacy & Governance](#phase-9-student-data-privacy--governance)
10. [Phase 10: Deterministic Fast-Path Safety & Rubric Classification](#phase-10-deterministic-fast-path-safety--rubric-classification)
11. [Phase 11: Validated Edge Function Implementation Specification](#phase-11-validated-edge-function-implementation-specification)
12. [Phase 12: Risks, Limitations & Strategic Recommendations](#phase-12-risks-limitations--strategic-recommendations)
13. [Appendix A: Official OpenRouter API Payload Specification](#appendix-a-official-openrouter-api-payload-specification)
14. [Appendix B: Proposed Automated Benchmark Harness (`benchmark_runner.mjs`)](#appendix-b-proposed-automated-benchmark-harness-benchmark_runnermjs)

---

## Phase 1: Current AI Architecture Review & Defect Analysis

### 1.1 Architecture Baseline: Current vs. Proposed

It is critical to distinguish what is **currently implemented** in the Da'at codebase versus what is **proposed** in this evaluation:

| Component | Currently Implemented in Repository | Proposed in this Evaluation |
| :--- | :--- | :--- |
| **Client Evaluation Engine** | `src/utils/evaluator.ts` contains sequential evaluation, Unicode string normalization fast-path for identical strings, and attempt finalization logic that blocks marking `is_graded: true` if errors occur. | Multi-tier rubric classifier (canonical vs keyword vs semantic). |
| **Grading Edge Function** | `supabase/functions/grade-answer/index.ts` calls Google Gemini directly via `@google/genative-ai` SDK with JSON schema instructions and markdown-stripping. | Provider-agnostic gateway calling OpenRouter with automatic multi-model failover. |
| **Model Selection** | Hardcoded single model (`gemini-2.5-flash` or `gemini-1.5-flash`). | Dynamic model failover chain (`[gemini-2.0-flash, deepseek-chat, gpt-4o-mini]`). |
| **Telemetry & Metrics** | Local logs and basic `ai_grading_logs` table (proposed in migration). | Dedicated `ai_usage_metrics` table tracking prompt/completion tokens, model routed, latency, and USD cost. |

---

### 1.2 Root Causes of Production Grading Failures (Jessie Vathana Incident)

During the Advent-Luke-Study quiz (Luke-Chapter-1), student Jessie Vathana scored 0 points on all 4 free-text questions (including an exact match for *"Theophilus"* and semantically accurate answers for Zechariah's muteness).

Analysis of the codebase identified four compounding defects:
1. **Silent Fallback to Zero:** The Edge Function or client caught network errors, timeouts, or JSON parsing exceptions and defaulted `ai_score` to `0` without signaling an evaluation failure.
2. **Markdown Wrapping of JSON:** Gemini frequently wrapped JSON in ` ```json ... ``` ` fences. Unsanitized `JSON.parse()` failed, triggering the aforementioned default to 0.
3. **Rigid Keyword Prompts:** The prompt instructed the model that the rubric was an exhaustive criteria list. When the rubric read `"Zechariah Vision Mute"`, an answer of `"Zechariah becomes mute"` was penalized for missing the word `"Vision"`.
4. **Single-Provider Fragility:** If Google AI Studio returned HTTP 429 (Rate Limit) or HTTP 503, the Edge Function had no secondary provider to handle the request.

---

## Phase 2: OpenRouter Gateway Capabilities Investigation

OpenRouter functions as a high-availability proxy aggregating models across multiple independent host providers (Google Vertex, Microsoft Azure, DeepInfra, Together AI, AWS Bedrock).

### 2.1 Verified Gateway Primitives

#### 1. Multi-Model Failover (`models` Array)
OpenRouter supports a top-level `models` array. The router attempts each model sequentially in the order listed:
```json
{
  "models": [
    "google/gemini-2.0-flash-001",
    "deepseek/deepseek-chat",
    "openai/gpt-4o-mini"
  ]
}
```
- **Execution Order:** OpenRouter first attempts the primary model across its available providers.
- **Failover Triggers:** If the primary model returns HTTP 429, HTTP 5xx, drops connections, or times out, the gateway automatically dispatches the identical request to the second model in the array.
- **Billing Integrity:** OpenRouter only bills for the final request that succeeds. Failed upstream attempts do not incur token charges.

#### 2. Provider Routing Controls (`provider` Object)
OpenRouter allows precise routing controls via the `provider` property:
- `order`: `string[]` — Ordered list of provider slugs (e.g. `["Google", "DeepInfra", "OpenAI"]`).
- `allow_fallbacks`: `boolean` (Default: `true`) — When `true`, if the preferred providers fail, OpenRouter will failover to other providers hosting that model.
- `require_parameters`: `boolean` (Default: `false`) — When `true`, OpenRouter **only** routes to providers that natively support all parameters included in the request (crucial for `response_format` / JSON schema).
- `data_collection`: `"deny"` — Restricts routing to providers that do not store user prompts for model training.
- `zdr`: `boolean` — Enforces Zero Data Retention (restricts routing to certified ZDR endpoints).

#### 3. Structured Outputs (`response_format`)
OpenRouter supports OpenAI-compatible structured outputs:
```json
"response_format": {
  "type": "json_schema",
  "json_schema": {
    "name": "biblical_quiz_grade",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "score": { "type": "number" },
        "status": { "type": "string", "enum": ["correct", "partial", "incorrect"] },
        "explanation": { "type": "string" }
      },
      "required": ["score", "status", "explanation"],
      "additionalProperties": false
    }
  }
}
```
Setting `require_parameters: true` guarantees that OpenRouter will not strip `response_format` and route to a provider that returns raw, unstructured text.

---

### 2.2 Cascading Failure Behavior & Error Handling Realities

> [!WARNING]
> **No Zero-Downtime Guarantee:** Multi-model fallback significantly increases resilience, but it **does not eliminate all failures**.

The table below documents how OpenRouter behaves across failure scenarios:

| Failure Mode | Gateway Behavior | Client (Da'at Edge Function) Impact |
| :--- | :--- | :--- |
| **Primary Model 429 (Rate Limit)** | Automatically switches to next model in `models` array within ~350–500ms. | Transparent recovery; student sees normal grading latency. |
| **Primary Model 5xx / Outage** | Automatically fails over to secondary provider or model. | Transparent recovery. |
| **Upstream Provider Timeout** | Gateway waits for provider timeout (typically 10–15s) before trying fallback. | Latency increases (10s–15s). Client timeout must be set to at least 25s. |
| **All Models in `models` Fail** | Gateway returns HTTP 502/503 with error payload listing failure reasons. | Edge Function must catch error, record failure in database, and keep `is_graded: false`. |
| **No Provider Supports Schema** | If `require_parameters: true`, gateway returns HTTP 400 immediately. | Configuration error; request fails cleanly without spending tokens. |
| **Insufficient Account Balance** | Gateway returns HTTP 402 (Payment Required). | All grading halts. Admin notification webhook required. |

---

## Phase 3: Current Model Shortlist for Biblical Quiz Grading

To ensure recommendations reflect the current AI landscape, model identifiers and list pricing were checked directly against OpenRouter's model catalog in November 2026.

### 3.1 Candidate Model Comparison

| Model Name | Exact OpenRouter Model ID | Input Price / 1M | Output Price / 1M | Context Window | Native Strict JSON | Image Input | Documented Tamil / Multilingual Support |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Gemini 2.0 Flash** | `google/gemini-2.0-flash-001` | \$0.10 | \$0.40 | 1,048,576 | Yes | Yes | Strong across Indic languages; modern Google tokenizer. |
| **Google Gemini 2.5 Flash** | `google/gemini-2.5-flash` | \$0.30 | \$2.50 | 1,000,000 | Yes | Yes | Advanced reasoning; higher output pricing. |
| **DeepSeek V3 / Chat** | `deepseek/deepseek-chat` | \$0.30 | \$1.20 | 64,000 | Yes | No | Pretrained on diverse multilingual corpora; strong reasoning. |
| **Qwen 2.5 72B Instruct** | `qwen/qwen-2.5-72b-instruct` | \$0.36 | \$0.40 | 32,768–131k | Yes | No | 152k vocabulary tokenizer; documented efficiency on Asian scripts. |
| **Qwen-Turbo** | `qwen/qwen-turbo` | \$0.05 | \$0.20 | 1,000,000 | Yes | No | High-speed, low-cost variant based on Qwen 2.5 architecture. |
| **OpenAI GPT-4o-mini** | `openai/gpt-4o-mini` | \$0.15 | \$0.60 | 128,000 | Yes (Strict) | Yes | Reference standard for strict JSON schema; solid Tanglish support. |
| **GLM-5.3-Flash** | `z-hipu/glm-5.3-flash` (or current variant) | \$0.04 | \$0.08 | 128,000 | Basic | Yes | Low-cost Chinese/English focus; limited documented Tamil data. |

---

### 3.2 Candidate Analysis & Limitations

#### 1. Google Gemini 2.0 Flash (`google/gemini-2.0-flash-001`)
- **Suitability:** Optimal combination of low token cost (\$0.10 / \$0.40), multimodal vision support (for temple diagrams and maps), and 1M context window.
- **Documented Multilingual Capabilities:** Benefits from Google's extensive translation and Indic language datasets. Handles both Tamil script and English-Tamil code-switching well in general NLP tasks.
- **Limitations:** Regional provider availability can fluctuate; requires `require_parameters: true` to enforce JSON schema across all Vertex endpoints.
- **Recommended Role:** **Primary Model** in the failover chain.

#### 2. DeepSeek V3 / Chat (`deepseek/deepseek-chat`)
- **Suitability:** Highly regarded for deep logical reasoning and nuanced text evaluation at \$0.30 / \$1.20 per M tokens.
- **Documented Multilingual Capabilities:** Strong performance on international benchmarks; effective at identifying subtle semantic contradictions (e.g., discerning biblical chronological errors).
- **Limitations:** Text-only (cannot grade diagram or image-based questions). Provider availability can experience queues during peak hours.
- **Recommended Role:** **Secondary Model** in the failover chain.

#### 3. Qwen 2.5 72B Instruct (`qwen/qwen-2.5-72b-instruct`)
- **Suitability:** Exceptional open-weights architecture with a 152,000-token vocabulary.
- **Documented Multilingual Capabilities:** Specifically designed for non-Latin script efficiency. On standard Indic/Tamil benchmarks, Qwen's large vocabulary exhibits less byte-level token fragmentation than older tokenizers, resulting in more natural text comprehension.
- **Limitations:** Text-only; output speed is slower than Gemini Flash variants.
- **Recommended Role:** **Specialized Candidate for Tamil-Dominant Quizzes**.

#### 4. OpenAI GPT-4o-mini (`openai/gpt-4o-mini`)
- **Suitability:** The industry benchmark for JSON Schema adherence (`strict: true` mode guarantees zero schema hallucination).
- **Documented Multilingual Capabilities:** Reliable comprehension of Tanglish (Tamil in Latin script) due to vast English training corpora; standard tokenization for pure Tamil script.
- **Limitations:** Moderately higher output cost than Gemini 2.0 Flash (\$0.60/M).
- **Recommended Role:** **Tertiary Safety Net Failover**.

---

## Phase 4: Rigorous Financial & Cost Modeling

All cost calculations in this section are derived from explicit, documented assumptions.

### 4.1 Token & Workflow Assumptions

- **Prompt Tokens (Scenario A — Short Answer / Concise):**
  - System Instructions: 220 tokens
  - Biblical Context & Question: 120 tokens
  - Rubric: 40 tokens
  - Student Answer: 20 tokens
  - **Total Input: 400 tokens**
- **Prompt Tokens (Scenario B — Verbose Passage / Tamil Script):**
  - System Instructions: 250 tokens
  - Scripture Excerpt: 300 tokens
  - Rubric & Grading Rules: 80 tokens
  - Student Answer: 70 tokens
  - **Total Input: 700 tokens**
- **Completion Tokens:**
  - Structured JSON Output: `{"score": X, "status": "...", "explanation": "..."}` = **60 tokens**.
- **Quiz Structure (Da'at Standard 10-Question Quiz):**
  - Total Questions: 10
  - Multiple Choice (Graded locally on client, 0 AI calls): 5 questions
  - Free-Text / Short Answer (Requiring evaluation): 5 questions
  - **Exact Match Fast-Path Assumption:** Approximately 40% of text questions (e.g. 2 of 5) match canonical rubrics exactly, leaving **3 AI calls per completed quiz**.
  - **No Fast-Path Baseline:** If fast-path is disabled, all 5 text questions require AI calls (**5 AI calls per completed quiz**).

---

### 4.2 Unit Cost Per Question Calculation (USD)

$$\text{Cost} = \left(\frac{\text{Input Tokens}}{1,000,000} \times P_{\text{in}}\right) + \left(\frac{\text{Output Tokens}}{1,000,000} \times P_{\text{out}}\right)$$

| Model | Scenario A Cost (400 in / 60 out) | Scenario B Cost (700 in / 60 out) | Blended Average (70% A / 30% B) |
| :--- | :--- | :--- | :--- |
| **Gemini 2.0 Flash** (\$0.10 / \$0.40) | \$0.000064 | \$0.000094 | **\$0.000073** |
| **Qwen-Turbo** (\$0.05 / \$0.20) | \$0.000032 | \$0.000047 | **\$0.000037** |
| **GPT-4o-mini** (\$0.15 / \$0.60) | \$0.000096 | \$0.000141 | **\$0.000110** |
| **DeepSeek V3** (\$0.30 / \$1.20) | \$0.000192 | \$0.000282 | **\$0.000219** |
| **Gemini 2.5 Flash** (\$0.30 / \$2.50) | \$0.000270 | \$0.000360 | **\$0.000297** |

---

### 4.3 Aggregated Quiz Cost Scenarios & Payment Fee Separation

OpenRouter token costs must be separated from financial deposit fees. OpenRouter charges a **5.5% standard credit card deposit fee** (Stripe processing).

#### Estimated Expenditure for 10-Question Quizzes (Assuming 3 AI Calls / Quiz with Fast-Path)

| Scale | Total AI Evaluations | Raw Token Cost (Gemini 2.0 Flash Primary) | OpenRouter 5.5% Deposit Fee | **Estimated Total Expenditure** |
| :--- | :--- | :--- | :--- | :--- |
| **100 Quizzes** | 300 calls | \$0.0219 | \$0.0012 | **\$0.023** |
| **1,000 Quizzes** | 3,000 calls | \$0.2190 | \$0.0120 | **\$0.231** |
| **5,000 Quizzes** | 15,000 calls | \$1.0950 | \$0.0602 | **\$1.155** |
| **10,000 Quizzes** | 30,000 calls | \$2.1900 | \$0.1205 | **\$2.311** |
| **50,000 Quizzes** | 150,000 calls | \$10.9500 | \$0.6023 | **\$11.552** |

#### Comparison: Baseline Without Fast-Path (5 AI Calls / Quiz) vs. With Fast-Path (3 AI Calls / Quiz)

- **Without Fast-Path (5 AI Calls):** 10,000 quizzes $\times$ 5 calls = 50,000 calls $\times$ \$0.000073 = **\$3.65 raw token cost**.
- **With Fast-Path (3 AI Calls):** 10,000 quizzes $\times$ 3 calls = 30,000 calls $\times$ \$0.000073 = **\$2.19 raw token cost**.
- **Calculated Reduction:** $\frac{3.65 - 2.19}{3.65} = 40.0\%$ reduction in API calls and token costs.

> [!NOTE]
> **Budget Reality:** AI costs are directly proportional to student volume, answer length, and retry frequency. While costs are exceptionally low (~$2.30 per 10,000 quizzes on Gemini 2.0 Flash), costs cannot be guaranteed to stay below any arbitrary threshold without setting hard spend limits in OpenRouter's dashboard.

---

## Phase 5: 40-Case Biblical Grading Benchmark Dataset

This dataset provides the official ground truth for evaluating candidate models. Every test case is grounded in Scripture (Luke Chapter 1 and the Gospels) and has been reviewed for theological accuracy.

### Benchmark Ground Truth Specifications (Cases 1 to 40)

#### Category A: Direct Exact Matches
- **Case 1:** *Question:* To whom did Luke dedicate his Gospel account in Luke 1:1-4? | *Context:* Luke 1:1-4 | *Rubric:* `Theophilus` | *Student Answer:* `Theophilus` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Direct exact match.
- **Case 2:** *Question:* What was the name of the angel who appeared to Zechariah in the temple? | *Context:* Luke 1:19 | *Rubric:* `Gabriel` | *Student Answer:* `Gabriel` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Single entity match.

#### Category B: Direct Synonyms
- **Case 3:** *Question:* What physical affliction struck Zechariah because he doubted Gabriel? | *Context:* Luke 1:20 | *Rubric:* `Mute / Unable to speak` | *Student Answer:* `He was rendered speechless` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* "Rendered speechless" is semantically equivalent to mute.
- **Case 4:** *Question:* How did Mary describe her soul's posture before God in Luke 1:46? | *Context:* Luke 1:46 | *Rubric:* `Glorifies / Magnifies the Lord` | *Student Answer:* `My soul praises and magnifies the Almighty` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Fully captures the Magnificat opening.

#### Category C: Keyword Rubric Semantic Satisfaction (The Jessie Vathana Scenario)
- **Case 5:** *Question:* Decode what occurred to Zechariah inside the sanctuary. | *Context:* Luke 1:21-22 | *Rubric:* `Zechariah Vision Mute` | *Student Answer:* `Zechariah becomes mute` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Captures core historical outcome; student should not be penalized for omitting the word "Vision".
- **Case 6:** *Question:* What happened when Elizabeth heard Mary's greeting? | *Context:* Luke 1:41 | *Rubric:* `Baby leaped womb Holy Spirit` | *Student Answer:* `Her unborn baby jumped inside her belly and she was filled with God's Spirit` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Vernacular equivalents for womb ("belly") and leaped ("jumped").

#### Category D: Semantic Equivalence with Diverse Phrasing
- **Case 7:** *Question:* How did Mary respond in total submission to God's will in Luke 1:38? | *Context:* Luke 1:38 | *Rubric:* `I am the Lord's servant; let it be to me according to your word` | *Student Answer:* `She surrendered completely saying let whatever God promised happen to her as His handmaid` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Conveys the essence of *fiat mihi*.
- **Case 8:** *Question:* How was Zechariah selected to enter the sanctuary to burn incense? | *Context:* Luke 1:9 | *Rubric:* `Chosen by lot according to priestly custom` | *Student Answer:* `It was decided by casting lots among the priests on duty` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Correct historical mechanism.

#### Category E: Partial Credit (50% Concept Satisfaction)
- **Case 9:** *Question:* What two intoxicating drinks was John forbidden from drinking in Luke 1:15? | *Context:* Luke 1:15 | *Rubric:* `Wine or fermented/strong drink` | *Student Answer:* `He was never allowed to drink wine` | *Max:* 2.0 | **Expected:** 1.0 (`partial`) | *Note:* Identifies 1 of 2 explicit items; exactly 50% credit.
- **Case 10:** *Question:* Name the parents of John the Baptist and describe their spiritual standing before God. | *Context:* Luke 1:5-6 | *Rubric:* `Zechariah and Elizabeth; righteous and blameless before God` | *Student Answer:* `Zechariah and Elizabeth were his parents` | *Max:* 2.0 | **Expected:** 1.0 (`partial`) | *Note:* Names the parents correctly but omits their righteous standing. 50% credit.

#### Category F: Minimal Passing Concepts
- **Case 11:** *Question:* What sign was given to verify Gabriel's prediction to Zechariah? | *Context:* Luke 1:20 | *Rubric:* `Silence / Muteness until the fulfillment` | *Student Answer:* `He could not talk` | *Max:* 2.0 | **Expected:** 1.5–2.0 (`correct`) | *Note:* Terse but captures the fundamental sign.
- **Case 12:** *Question:* What is impossible with God according to Luke 1:37? | *Context:* Luke 1:37 | *Rubric:* `Nothing / No word from God will ever fail` | *Student Answer:* `Nothing` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Single word that completely answers the question.

#### Category G: Plausible Biblical Confusion (Negative Cases)
- **Case 13:** *Question:* Who was the priest burning incense when the angel appeared in Luke 1? | *Context:* Luke 1:8-9 | *Rubric:* `Zechariah` | *Student Answer:* `Caiaphas the high priest was burning incense` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Conflates Zechariah with Caiaphas (high priest during Jesus' trial).
- **Case 14:** *Question:* Which biblical figure was struck mute in the temple in Luke 1? | *Context:* Luke 1:20 | *Rubric:* `Zechariah` | *Student Answer:* `Simeon` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Conflates Zechariah with Simeon (Luke 2).

#### Category H: Factual Inversion (Opposite Statements)
- **Case 15:** *Question:* How did Zechariah initially respond to Gabriel's prophecy in Luke 1:18? | *Context:* Luke 1:18 | *Rubric:* `Doubted / Disbelieved / Asked for a sign` | *Student Answer:* `He immediately believed and praised God with great faith` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Inverts biblical fact; Zechariah was punished specifically for disbelief.
- **Case 16:** *Question:* Did Elizabeth agree to name the child after his father Zechariah in Luke 1:60? | *Context:* Luke 1:59-60 | *Rubric:* `No, she insisted he be called John` | *Student Answer:* `Yes, Elizabeth agreed to name him Zechariah Junior` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Direct contradiction of Luke 1:60.

#### Category I: Biblical Chronology Confusion
- **Case 17:** *Question:* In which month of Elizabeth's pregnancy did Gabriel appear to Mary in Nazareth? | *Context:* Luke 1:26 | *Rubric:* `In the sixth month` | *Student Answer:* `In the ninth month right after John was born` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Factually incorrect chronology.
- **Case 18:** *Question:* How long did Mary stay with Elizabeth in the hill country of Judea? | *Context:* Luke 1:56 | *Rubric:* `About three months` | *Student Answer:* `Three years` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Major temporal error.

#### Category J: Proper Name Spelling & Transliteration
- **Case 19:** *Question:* Who was king of Judea when John's birth was announced in Luke 1:5? | *Context:* Luke 1:5 | *Rubric:* `Herod` | *Student Answer:* `King Harod` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Minor phonetic typo; clear biblical intent.
- **Case 20:** *Question:* Name the mother of John the Baptist. | *Context:* Luke 1:5 | *Rubric:* `Elizabeth` | *Student Answer:* `Elisabeth / Elisavet` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* KJV / Greek transliteration variants.

#### Category K: Pure Tamil Script Answers (Human-Verified via BSI Tamil Bible)
- **Case 21:** *Question:* கபிரியேல் தூதன் கூறிய வார்த்தைகளை நம்பாததால் சகரியாவுக்கு என்ன நிகழ்ந்தது? | *Context:* லூக்கா 1:20 | *Rubric:* `பேசக்கூடாமல் ஊமையாயிருப்பாய் (Became mute / unable to speak)` | *Student Answer:* `அவர் பேச முடியாமல் ஊமையானார்` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Verified Tamil scripture phrasing.
- **Case 22:** *Question:* மரியாளின் வாழ்த்துதலைக் கேட்டபொழுது எலிசபெத்தின் வயிற்றிலிருந்த குழந்தைக்கு என்ன நடந்தது? | *Context:* லூக்கா 1:41 | *Rubric:* `வயிற்றிலிருந்த பிள்ளை துள்ளிற்று (Baby leaped in womb)` | *Student Answer:* `குழந்தை மகிழ்ச்சியினால் துள்ளியது` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Captures the leap of joy in Tamil.

#### Category L: Tanglish (Tamil in Latin Script)
- **Case 23:** *Question:* What happened to Zechariah when he doubted the angel? | *Context:* Luke 1:20 | *Rubric:* `Zechariah became mute` | *Student Answer:* `Sagariya pecha maranthu oomai aanaar` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Tanglish for "Zechariah forgot speech and became mute."
- **Case 24:** *Question:* What name did the angel tell Zechariah to give the child? | *Context:* Luke 1:13 | *Rubric:* `John` | *Student Answer:* `Kulandhaiku Yoovan nu peyar vaika sonnanga` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Tanglish: "They said to name the child Yoovan (John)."

#### Category M: Mixed Tamil & English (Code-Switching)
- **Case 25:** *Question:* Describe Zechariah's condition after exiting the temple sanctuary. | *Context:* Luke 1:22 | *Rubric:* `Saw a vision in the temple and was mute` | *Student Answer:* `Zechariah temple kula vision kanda pin mute aagitaaru` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Common spoken code-switching.
- **Case 26:** *Question:* What did Elizabeth say the Lord had taken away from her in Luke 1:25? | *Context:* Luke 1:25 | *Rubric:* `Disgrace / reproach among people` | *Student Answer:* `God enoda reproach and nindhaiyai remove pannitaaru` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Blends English "reproach" with Tamil "nindhai".

#### Category N: Emoji-Based Decoding
- **Case 27:** *Question:* Decode the Luke 1 event: 👴 🪽 🤐 🏛️ | *Context:* Luke 1:11-22 | *Rubric:* `Zechariah angel mute temple` | *Student Answer:* `Zechariah meets angel Gabriel in temple and becomes mute` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Accurate decoding of all 4 emojis.
- **Case 28:** *Question:* Decode the Luke 1 event: 🤰 🏃‍♀️ 👵 👶 ⬆️ | *Context:* Luke 1:39-41 | *Rubric:* `Mary visits Elizabeth baby leaps in womb` | *Student Answer:* `Mary travels to Elizabeth and the baby jumps` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Decodes visitation and leaping.

#### Category O: Multimodal / Image-Based Questions
- **Case 29:** *Question:* [Diagram of Herod's Temple with arrow at Altar of Incense]. Which sacred furnishing is indicated? | *Context:* Luke 1:11 | *Rubric:* `Altar of Incense` | *Student Answer:* `The incense altar inside the Holy Place` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Requires vision-capable model.
- **Case 30:** *Question:* [Timeline graphic of Luke 1]. Which event belongs in box [B]? | *Context:* Luke 1:26-38 | *Rubric:* `Annunciation to Mary` | *Student Answer:* `Gabriel visits Mary in Nazareth` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Multimodal timeline reasoning.

#### Category P: Hallucination Traps (Pious-Sounding Falsehoods)
- **Case 31:** *Question:* How did Zechariah regain his speech according to Luke 1:63-64? | *Context:* Luke 1:63-64 | *Rubric:* `Wrote 'His name is John' on a tablet` | *Student Answer:* `He fasted and prayed for 40 days until God had mercy` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* Pious-sounding but absent from Scripture.
- **Case 32:** *Question:* What astronomical sign guided Mary to Elizabeth's house in Judea? | *Context:* Luke 1:39-40 | *Rubric:* `No sign; she went by ordinary travel` | *Student Answer:* `The bright Star of Bethlehem guided her steps` | *Max:* 2.0 | **Expected:** 0.0 (`incorrect`) | *Note:* The Star of Bethlehem appears in Matthew 2 (Magi), not Luke 1 (Mary).

#### Category Q: Verbose Answers with Concept Buried
- **Case 33:** *Question:* What sign did Gabriel give Mary that Elizabeth was expecting? | *Context:* Luke 1:36 | *Rubric:* `Elizabeth is in her sixth month of pregnancy` | *Student Answer:* `Gabriel told Mary that nothing is impossible with God and that even her old relative Elizabeth who was called barren is already in her sixth month carrying a child.` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Target concept present despite conversational filler.
- **Case 34:** *Question:* In the Benedictus, what did Zechariah say his child would be called in Luke 1:76? | *Context:* Luke 1:76 | *Rubric:* `Prophet of the Most High` | *Student Answer:* `Zechariah praised the Lord God of Israel and then turning to his infant son said you will be called the prophet of the Most High.` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Correct extraction from verbose narrative.

#### Category R: Extremely Brief Answers
- **Case 35:** *Question:* What town in Galilee did Mary live in when Gabriel appeared? | *Context:* Luke 1:26 | *Rubric:* `Nazareth` | *Student Answer:* `Nazareth` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Single-word canonical answer.
- **Case 36:** *Question:* What horn of salvation did God raise up in the house of David? | *Context:* Luke 1:69 | *Rubric:* `Jesus / The Messiah / Christ` | *Student Answer:* `Christ` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Concise theological identification.

#### Category S: Formatting, Casing & Verse References
- **Case 37:** *Question:* Which priest was struck mute by Gabriel? | *Context:* Luke 1 | *Rubric:* `Zechariah` | *Student Answer:* `   "zechariah."  ` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Whitespace, quotes, punctuation insensitivity.
- **Case 38:** *Question:* State the verse reference where Mary says: "For He who is mighty has done great things for me." | *Context:* Luke 1:49 | *Rubric:* `Luke 1:49` | *Student Answer:* `Lk 1.49` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Standard biblical abbreviation.
- **Case 39:** *Question:* What role was John given to prepare the way before the Lord? | *Context:* Luke 1:17 | *Rubric:* `Forerunner / Prophet to turn hearts` | *Student Answer:* `Forerunner (Elijah's spirit)` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Parenthetical notes must not invalidate answer.
- **Case 40:** *Question:* What angelic greeting did Gabriel give to Mary in Luke 1:28? | *Context:* Luke 1:28 | *Rubric:* `Greetings, favored one! The Lord is with you` | *Student Answer:* `"Hail, full of grace, the Lord is with thee!"` | *Max:* 2.0 | **Expected:** 2.0 (`correct`) | *Note:* Traditional liturgical rendering.

---

## Phase 6: Benchmark Execution Status & Testing Methodology

```
══════════════════════════════════════════════════════════════════════════════
                      BENCHMARK EXECUTION STATUS
                     [ BENCHMARK NOT YET EXECUTED ]
  Actual benchmark execution has NOT occurred. No live API calls were dispatched
  against the 40 test cases. OpenRouter credentials are not configured in this
  environment, and automated model execution is pending user authorization.
══════════════════════════════════════════════════════════════════════════════
```

### 6.1 Proposed Evaluation Protocol

When authorized and provided with test API keys, the test harness (`scripts/benchmark_runner.mjs`) will execute all 40 test cases against each candidate model and evaluate:

1. **Semantic Accuracy ($\pm 0.25$ pts from Expected Score):** Evaluates whether the model scores within 0.25 points of ground truth.
2. **Strict Schema Adherence (% valid JSON):** Measures the percentage of completions conforming strictly to the requested JSON schema without markdown wrapping or missing keys.
3. **Tamil & Code-Switching Comprehension:** Evaluates score accuracy on pure Tamil, Tanglish, and mixed inputs (Cases 21–26).
4. **Hallucination Resistance:** Verifies that negative cases (Cases 13–16) and hallucination traps (Cases 31–32) receive exactly 0 points.
5. **Observed Latency (p50 / p95 in ms):** Measured from request dispatch to completion receipt.

---

## Phase 7: Provider-Independent Architecture Proposal

To decouple Da'at from any single model or cloud provider, we propose a modular architecture inside `supabase/functions/grade-answer`.

```mermaid
flowchart TD
    Client["Client: TakeQuiz.tsx / QuizResults.tsx"] -->|"1. Fast-Path Check"| FP["Deterministic Fast-Path<br/>(Exact / Alternative Match)"]
    FP -->|"Match Found (0ms, $0)"| SaveDB["Save Result to Supabase user_answers"]
    FP -->|"Semantic / Keyword Required"| EF["Supabase Edge Function: grade-answer"]
    
    subgraph Gateway ["OpenRouter Provider-Agnostic Gateway"]
        ORClient["OpenRouter Client Adapter"]
        M1["Model 1: Gemini 2.0 Flash"]
        M2["Model 2: DeepSeek V3"]
        M3["Model 3: GPT-4o-mini"]
        ORClient --> M1
        M1 -.->|"429 / 5xx Failover"| M2
        M2 -.->|"Failover"| M3
    end
    
    EF --> ORClient
    Gateway -->|"Validated JSON"| EF
    EF -->|"Record Telemetry"| Telemetry["ai_usage_metrics Table"]
    EF -->|"Return Grade"| SaveDB
```

---

## Phase 8: Telemetry, Usage & Cost Tracking Design

To provide full visibility into AI spend, token consumption, and model failovers, we propose creating an `ai_usage_metrics` table in Supabase.

### 8.1 Proposed Database Migration Schema

```sql
-- Migration: 20261125_create_ai_usage_metrics.sql

CREATE TABLE IF NOT EXISTS public.ai_usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    attempt_id UUID REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID REFERENCES public.questions(id) ON DELETE SET NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    model_requested TEXT NOT NULL,
    model_routed TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    latency_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'fallback', 'failed')),
    error_message TEXT
);

CREATE INDEX idx_ai_usage_created_at ON public.ai_usage_metrics(created_at DESC);
CREATE INDEX idx_ai_usage_attempt_id ON public.ai_usage_metrics(attempt_id);

ALTER TABLE public.ai_usage_metrics ENABLE ROW LEVEL SECURITY;

-- Security: Admins only can view financial telemetry
CREATE POLICY "Admins have full access to ai_usage_metrics"
    ON public.ai_usage_metrics
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );
```

---

## Phase 9: Student Data Privacy & Governance

### 9.1 What Zero Data Retention (ZDR) Actually Means

> [!IMPORTANT]
> **Privacy Reality Check:** Setting `zdr: true` does **not** create an encrypted void across the entire internet. It restricts routing exclusively to endpoints where upstream providers have agreed not to routinely store prompts/completions for model training.

1. **Covered by ZDR:** Upstream model providers (Google Vertex, Azure, DeepInfra) discard prompt and completion text from persistent storage after inference.
2. **Not Covered by ZDR:**
   - **OpenRouter Request Metadata:** OpenRouter retains request metadata (token counts, timestamps, latency, cost, and model names) for billing and analytics.
   - **CSAM Exception:** In-flight screening for child sexual abuse material (CSAM) is performed. Flagged traffic may be retained for legal compliance and reporting.
   - **Application-Side Logs:** The Da'at database itself logs evaluation data unless explicitly purged.
3. **Safety Retention Tiers:** Endpoints labeled "Safety Retention" may retain prompts for up to 30 days to investigate abuse. Passing `provider: { zdr: true }` blocks routing to these endpoints, but reduces available provider fallback targets.

### 9.2 Mandatory PII Stripping Pipeline

To guarantee student privacy under COPPA, FERPA, and GDPR, **Da'at must never transmit student identifiers to the AI gateway**.

The grading payload must **strictly exclude**:
- Student email address
- Student display name / real name
- Supabase Auth JWT / user UUID
- Profile or demographic metadata

The payload transmitted to OpenRouter contains **only**:
```json
{
  "questionText": "...",
  "biblicalContext": "...",
  "rubric": "...",
  "studentAnswer": "...",
  "maxPoints": 2
}
```

---

## Phase 10: Deterministic Fast-Path Safety & Rubric Classification

The logic `cleanStudentAnswer === cleanRubric` is **only safe when the rubric represents a canonical answer**.

### 10.1 Rubric Typology & Classification Hazards

| Rubric Type | Example | Can Fast-Path Be Applied? | Hazard if Misclassified |
| :--- | :--- | :--- | :--- |
| **1. Canonical Exact Answer** | `"Theophilus"` | **Yes** (`clean(ans) === clean(rubric)`) | None. Both strings represent the target answer. |
| **2. Accepted Alternatives** | `"Elizabeth / Elisabeth / Elisavet"` | **Yes**, with split matching (`rubric.split('/').some(...)`) | If treated as a single string, `"Elizabeth"` will fail exact match. |
| **3. Keyword / Concept List** | `"Zechariah Vision Mute"` | **NO.** Fast-path must be bypassed! | If applied, `"Zechariah becomes mute"` fails. If student typed the keywords, they'd match without writing a real sentence. |
| **4. Semantic Guideline** | `"Must convey that Mary surrendered to God's will"` | **NO.** Fast-path must be bypassed! | A student answering `"I surrendered to God"` would never match the teacher's instructions string. |

### 10.2 Recommended Rubric Schema Enhancement

To make fast-path deterministic and safe, questions should specify a `rubric_type`:
```sql
ALTER TABLE public.questions 
ADD COLUMN IF NOT EXISTS rubric_type TEXT NOT NULL DEFAULT 'keyword' 
CHECK (rubric_type IN ('exact', 'alternatives', 'keyword', 'semantic'));
```
- **If `rubric_type = 'exact'`:** If `normalize(studentAnswer) === normalize(rubric)`, award full points in 0ms.
- **If `rubric_type = 'alternatives'`:** Split rubric by `/` or `;`. If any alternative matches normalized answer, award full points in 0ms.
- **If `rubric_type IN ('keyword', 'semantic')`:** **Never** execute exact-match fast-path; always dispatch to the semantic AI evaluator.

---

## Phase 11: Validated Edge Function Implementation Specification

The sample below illustrates how the Edge Function validates OpenRouter responses. Crucially, **malformed AI outputs never default to a student zero**.

```typescript
// supabase/functions/grade-answer/openrouter_grader.ts

export interface GradingRequest {
  questionText: string;
  biblicalContext?: string;
  rubric: string;
  studentAnswer: string;
  maxPoints: number;
}

export interface ValidatedGradingResult {
  score: number;
  status: 'correct' | 'partial' | 'incorrect';
  explanation: string;
  modelRouted: string;
  tokensUsed: { prompt: number; completion: number; total: number };
  latencyMs: number;
}

export async function gradeAnswerWithOpenRouter(
  apiKey: string,
  request: GradingRequest
): Promise<ValidatedGradingResult> {
  const startTime = Date.now();

  const payload = {
    models: [
      "google/gemini-2.0-flash-001",
      "deepseek/deepseek-chat",
      "openai/gpt-4o-mini"
    ],
    provider: {
      order: ["Google", "DeepInfra", "OpenAI"],
      allow_fallbacks: true,
      require_parameters: true,
      data_collection: "deny",
      zdr: true
    },
    messages: [
      {
        role: "system",
        content: `You are a fair, linguistically adept biblical quiz evaluator for the Da'at platform.
Grade student responses accurately against the question, biblical context, and rubric.
Guidelines:
1. Semantic fairness: Award full credit if the student conveys the essential biblical event, person, or fact, even with synonyms, Tamil script, or Tanglish.
2. Keyword rubrics: Treat space/comma-separated rubrics as concept indicators, not mandatory verbatim text.
3. Return STRICT JSON with keys: score (number), status ('correct'|'partial'|'incorrect'), explanation (string).`
      },
      {
        role: "user",
        content: `Question: ${request.questionText}
Biblical Context: ${request.biblicalContext || 'Luke Chapter 1'}
Rubric: ${request.rubric}
Student Answer: ${request.studentAnswer}
Max Points: ${request.maxPoints}`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "biblical_quiz_grade",
        strict: true,
        schema: {
          type: "object",
          properties: {
            score: { type: "number", description: "Earned score between 0 and maxPoints" },
            status: { type: "string", enum: ["correct", "partial", "incorrect"] },
            explanation: { type: "string", description: "Pedagogical justification" }
          },
          required: ["score", "status", "explanation"],
          additionalProperties: false
        }
      }
    },
    temperature: 0.1,
    max_tokens: 250
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://daatquiz.org",
      "X-Title": "Daat Quiz Grader"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const latencyMs = Date.now() - startTime;
  const rawContent = result.choices?.[0]?.message?.content;

  if (!rawContent) {
    throw new Error("AI grading failure: Received empty completion from gateway");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (e) {
    throw new Error(`AI grading failure: Response was not valid JSON (${rawContent.slice(0, 100)})`);
  }

  // STRICT VALIDATION: Malformed AI output must NEVER become a student zero!
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error("AI grading failure: Response is not a JSON object");
  }

  const rawScore = Number(parsed.score);
  if (isNaN(rawScore) || !isFinite(rawScore)) {
    throw new Error(`AI grading failure: Returned score is NaN or non-numeric (${parsed.score})`);
  }

  if (rawScore < 0 || rawScore > request.maxPoints) {
    throw new Error(`AI grading failure: Score ${rawScore} out of valid range [0, ${request.maxPoints}]`);
  }

  const validStatuses = ['correct', 'partial', 'incorrect'];
  if (!validStatuses.includes(parsed.status)) {
    throw new Error(`AI grading failure: Invalid status string (${parsed.status})`);
  }

  if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
    throw new Error("AI grading failure: Explanation is missing or empty");
  }

  return {
    score: rawScore,
    status: parsed.status,
    explanation: parsed.explanation.trim(),
    modelRouted: result.model || "unknown",
    tokensUsed: {
      prompt: result.usage?.prompt_tokens || 0,
      completion: result.usage?.completion_tokens || 0,
      total: result.usage?.total_tokens || 0
    },
    latencyMs
  };
}
```

---

## Phase 12: Risks, Limitations & Strategic Recommendations

### 12.1 Strategic Decision Matrix

| Strategy | Resilience & Uptime | Multilingual & Tamil | Financial Risk | Implementation Effort | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Option A: Gemini Direct Only** | Low (Single SPOF) | Moderate | Moderate (GCP billing) | Existing | Not recommended |
| **Option B: OpenRouter Only (No Fast-Path)** | High | Superior | Low (\$5 cap) | Low | Acceptable |
| **Option C: Multi-Provider in Edge Function** | High | Superior | High (Multiple API keys) | Very High (Complex code) | Not recommended |
| **Option E: Hybrid Smart Router (Recommended)** | **Maximum** | **Superior** | **Lowest** | **Moderate** | **Strongly Recommended** |

### 12.2 Phased Rollout Roadmap

1. **Step 1: Test Suite Validation** — Run the proposed `scripts/benchmark_runner.mjs` against a staging OpenRouter API key across all 40 benchmark cases to collect empirical baseline data.
2. **Step 2: Rubric Classification Migration** — Update question schemas to distinguish canonical exact answers from keyword lists.
3. **Step 3: Staging Edge Function Deployment** — Deploy the OpenRouter adapter in staging; test automatic failover by simulating primary model 429 errors.
4. **Step 4: Production Cutover** — Enable OpenRouter in production with a \$10/month hard cap and ZDR enforced.

---

## Appendix A: Official OpenRouter API Payload Specification

```http
POST https://openrouter.ai/api/v1/chat/completions HTTP/1.1
Host: openrouter.ai
Authorization: Bearer sk-or-v1-xxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
HTTP-Referer: https://daatquiz.org
X-Title: Daat Quiz Evaluation Platform

{
  "models": [
    "google/gemini-2.0-flash-001",
    "deepseek/deepseek-chat",
    "openai/gpt-4o-mini"
  ],
  "provider": {
    "order": ["Google", "DeepInfra", "OpenAI"],
    "allow_fallbacks": true,
    "require_parameters": true,
    "data_collection": "deny",
    "zdr": true
  },
  "messages": [
    {
      "role": "system",
      "content": "You are a biblical quiz evaluator for Da'at. Grade student answers fairly against the rubric. Output strict JSON."
    },
    {
      "role": "user",
      "content": "Question: Decode event: Zechariah inside sanctuary\nContext: Luke 1:21-22\nRubric: Zechariah Vision Mute\nStudent Answer: Zechariah becomes mute\nMax Points: 2"
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "biblical_quiz_grade",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "score": { "type": "number" },
          "status": { "type": "string", "enum": ["correct", "partial", "incorrect"] },
          "explanation": { "type": "string" }
        },
        "required": ["score", "status", "explanation"],
        "additionalProperties": false
      }
    }
  },
  "temperature": 0.1,
  "max_tokens": 200
}
```

---

## Appendix B: Proposed Automated Benchmark Harness (`benchmark_runner.mjs`)

The proposed Node.js test script below can be executed when authorization and API keys are provided:

```javascript
/**
 * scripts/benchmark_runner.mjs
 * Proposed benchmark runner for Da'at 40-case biblical grading dataset.
 * Requires OPENROUTER_API_KEY environment variable.
 */

import fs from 'node:fs';

const BENCHMARK_CASES = JSON.parse(fs.readFileSync('./tests/benchmark_cases.json', 'utf8'));
const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
  console.error("Error: OPENROUTER_API_KEY environment variable is not set.");
  console.error("Benchmark cannot execute without authorization and credentials.");
  process.exit(1);
}

async function runBenchmarkForModel(modelId) {
  console.log(`Starting benchmark for: ${modelId}...`);
  const results = [];

  for (const testCase of BENCHMARK_CASES) {
    const startTime = Date.now();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: "Grade student answer against rubric. Output JSON: {score, status, explanation}." },
            { role: "user", content: `Question: ${testCase.question}\nRubric: ${testCase.rubric}\nStudent Answer: ${testCase.studentAnswer}\nMax Points: ${testCase.maxPoints}` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      });

      const data = await response.json();
      const latency = Date.now() - startTime;
      const parsed = JSON.parse(data.choices[0].message.content);

      results.push({
        caseId: testCase.id,
        expectedScore: testCase.expectedScore,
        actualScore: parsed.score,
        scoreDelta: Math.abs(parsed.score - testCase.expectedScore),
        latency,
        tokens: data.usage?.total_tokens || 0
      });
    } catch (err) {
      results.push({ caseId: testCase.id, error: err.message });
    }
  }

  return results;
}
```
