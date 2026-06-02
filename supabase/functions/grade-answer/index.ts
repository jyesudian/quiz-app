import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { studentAnswer, aiRubric, questionEn, imageUrl } = await req.json();

    if (!studentAnswer || !aiRubric || !questionEn) {
      throw new Error("Missing required fields: studentAnswer, aiRubric, or questionEn");
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing");
    }

    let imagePart = null;
    if (imageUrl) {
      try {
        const imageRes = await fetch(imageUrl);
        if (imageRes.ok) {
          const blob = await imageRes.blob();
          const mimeType = blob.type || 'image/jpeg';
          const buffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          let binary = '';
          const len = uint8.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64Data = btoa(binary);
          imagePart = {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          };
        } else {
          console.error("Failed to fetch imageUrl:", imageUrl, imageRes.statusText);
        }
      } catch (err) {
        console.error("Error fetching image from URL:", imageUrl, err);
      }
    }

    let prompt = `You are an AI grader for a Bible study quiz.
Question: "${questionEn}"
Grading Rubric / Golden Answer: "${aiRubric}"
Student's Answer: "${studentAnswer}"`;

    if (imageUrl) {
      prompt += `\nAn image has been attached to this question. Review the image and grade the student's answer accordingly.`;
    }

    prompt += `\n\nGrade the student's answer out of 10 points based STRICTLY on the provided rubric. 
Be gracious but fair. 
Return ONLY a raw JSON object with two fields: 
1. "score" (a number between 0 and 10)
2. "feedback" (a brief string explaining the score, maximum 2 sentences)

Do not include markdown blocks like \`\`\`json. Return the raw JSON.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              ...(imagePart ? [imagePart] : [])
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Gemini API Error:", errBody);
      throw new Error("Failed to call Gemini API");
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultText) {
      throw new Error("Invalid response structure from Gemini API");
    }

    // Attempt to parse the JSON response from Gemini
    let resultJson;
    try {
      resultJson = JSON.parse(resultText.trim());
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", resultText);
      // Fallback if parsing fails
      resultJson = { score: 0, feedback: "Error grading answer." };
    }

    return new Response(JSON.stringify(resultJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
