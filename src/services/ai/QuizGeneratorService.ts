import { GoogleGenAI, Type } from '@google/genai';
import type { AiGeneratedQuestion } from '../../types';

export class QuizGeneratorService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateQuiz(
    textContext: string,
    config: {
      count: number;
      type: string;
      difficulty: string;
      bloomTaxonomy?: string;
    }
  ): Promise<AiGeneratedQuestion[]> {
    const prompt = this.buildPrompt(textContext, config);
    
    // We expect the model to return a structured JSON response
    const schema = {
      type: Type.ARRAY,
      description: "List of generated quiz questions",
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: "A random unique identifier (UUID) for the question."
          },
          type: {
            type: Type.STRING,
            description: "Either 'single' or 'multiple'",
            enum: ['single', 'multiple']
          },
          textEn: {
            type: Type.STRING,
            description: "The question text in English."
          },
          textTa: {
            type: Type.STRING,
            description: "The question text translated to Tamil."
          },
          options: {
            type: Type.ARRAY,
            description: "List of options for the question.",
            items: {
              type: Type.OBJECT,
              properties: {
                en: { type: Type.STRING, description: "Option text in English." },
                ta: { type: Type.STRING, description: "Option text translated to Tamil." },
                isCorrect: { type: Type.BOOLEAN, description: "Whether this option is correct." }
              },
              required: ["en", "ta", "isCorrect"]
            }
          },
          explanationEn: {
            type: Type.STRING,
            description: "Explanation of the correct answer in English."
          },
          explanationTa: {
            type: Type.STRING,
            description: "Explanation of the correct answer translated to Tamil."
          },
          difficulty: {
            type: Type.STRING,
            description: "Difficulty level.",
            enum: ['Easy', 'Medium', 'Hard']
          },
          topic: {
            type: Type.STRING,
            description: "The main topic or subtopic of the question."
          },
          bloomTaxonomy: {
            type: Type.STRING,
            description: "Bloom's taxonomy level."
          }
        },
        required: ["id", "type", "textEn", "textTa", "options", "explanationEn", "explanationTa", "difficulty"]
      }
    };

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.2,
        }
      });

      if (response.text) {
        const questions: AiGeneratedQuestion[] = JSON.parse(response.text);
        return questions;
      }
      return [];
    } catch (error) {
      console.error("Error generating quiz:", error);
      throw new Error("Failed to generate quiz from AI.");
    }
  }

  private buildPrompt(
    textContext: string,
    config: { count: number; type: string; difficulty: string; bloomTaxonomy?: string }
  ): string {
    let prompt = `You are an expert quiz generator and professional translator. 
Your task is to generate exactly ${config.count} quiz questions based ONLY on the provided document text.

Requirements:
1. Generate EXACTLY ${config.count} questions. Do not generate more or less. If the document is too short, generate as many as possible up to ${config.count} without repeating concepts.
2. The question type should be ${config.type}. 
   - If 'single', exactly one option must be correct.
   - If 'multiple', one or more options can be correct.
   - If 'Mixed', you can choose 'single' or 'multiple' for each question.
3. The overall difficulty should be ${config.difficulty}.
${config.bloomTaxonomy && config.bloomTaxonomy !== 'Mixed' ? `4. Ensure questions align with the '${config.bloomTaxonomy}' level of Bloom's Taxonomy.` : ''}
5. ALL text MUST be bilingual (English and Tamil). For every English string (question, option, explanation), you must provide a highly accurate Tamil translation.
6. Provide a detailed explanation for the correct answer(s) in both English and Tamil.
7. Avoid trivial or obvious questions. Test genuine understanding of the concepts.

DOCUMENT TEXT:
=====================================
${textContext}
=====================================

Return a JSON array conforming exactly to the requested schema.`;

    return prompt;
  }
}
