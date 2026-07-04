import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabaseClient';
import { PdfUploader } from '../components/pdf/PdfUploader';
import { ConfigurationForm, type GenerationConfig } from '../components/quiz-generator/ConfigurationForm';
import { ReviewScreen } from '../components/quiz-generator/ReviewScreen';
import { PdfExtractor } from '../services/ai/PdfExtractor';
import { QuizGeneratorService } from '../services/ai/QuizGeneratorService';
import type { AiGeneratedQuestion } from '../types';
import { useAuth } from '../contexts/AuthContext';

type GeneratorStep = 'UPLOAD' | 'CONFIGURE' | 'REVIEW';

export const QuizGenerator = () => {
  const [step, setStep] = useState<GeneratorStep>('UPLOAD');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<AiGeneratedQuestion[]>([]);
  const [config, setConfig] = useState<GenerationConfig | null>(null);
  const [generationDuration, setGenerationDuration] = useState(0);
  
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles(files);
  };

  const proceedToConfig = () => {
    if (selectedFiles.length === 0) {
      toast.error('Please upload at least one PDF file.');
      return;
    }
    setStep('CONFIGURE');
  };

  const handleGenerate = async (genConfig: GenerationConfig) => {
    setConfig(genConfig);
    setIsGenerating(true);
    const startTime = Date.now();

    try {
      // 1. Extract text
      const extractedText = await PdfExtractor.extractTextFromMultipleFiles(selectedFiles);
      if (!extractedText || extractedText.trim().length < 50) {
        throw new Error("Could not extract enough text from the PDF(s). Ensure they are not scanned images or empty.");
      }

      // 2. Call AI Service
      const apiKey = import.meta.env.VITE_AI_API_KEY; // Needs to be added to .env
      if (!apiKey) {
        throw new Error("VITE_AI_API_KEY is not defined in the environment variables.");
      }

      const aiService = new QuizGeneratorService(apiKey);
      const questions = await aiService.generateQuiz(extractedText, {
        count: genConfig.count,
        type: genConfig.type,
        difficulty: genConfig.difficulty,
        bloomTaxonomy: genConfig.bloomTaxonomy
      });

      if (!questions || questions.length === 0) {
        throw new Error("AI failed to generate questions.");
      }

      setGeneratedQuestions(questions);
      setGenerationDuration(Date.now() - startTime);
      setStep('REVIEW');
      toast.success(`Successfully generated ${questions.length} questions!`);
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "An error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveQuiz = async (approvedQuestions: AiGeneratedQuestion[]) => {
    if (!config) return;
    
    try {
      toast.loading('Saving quiz...', { id: 'saving' });

      let seriesId: number;
      if (config.seriesId === 'new') {
        const { data: newSeries, error: seriesError } = await supabase
          .from('quiz_series')
          .insert({
            title: config.newSeriesName,
            group_name: config.newGroupName || null,
            is_bilingual: config.newIsBilingual || false,
            requires_approval: config.newRequiresApproval !== false,
            is_frozen: false
          })
          .select()
          .single();

        if (seriesError) throw seriesError;
        if (!newSeries || !newSeries.id) {
          throw new Error("Failed to create new series - no data was returned from the database.");
        }
        seriesId = newSeries.id;
      } else {
        seriesId = parseInt(config.seriesId);
      }

      if (!seriesId || isNaN(seriesId)) {
        throw new Error(`Invalid Series ID: "${config.seriesId}". Please make sure a valid series is selected.`);
      }

      // 1. Insert Quiz
      const { data: quizData, error: quizError } = await supabase
        .from('quizzes')
        .insert({
          title: config.title,
          series_id: seriesId,
          status: 'draft' // Save as draft initially so admin can review further if needed
        })
        .select()
        .single();
        
      if (quizError) throw quizError;
      
      const newQuizId = quizData.id;

      // 2. Insert Generation Metadata (Optional, if table exists)
      // Attempt to save metadata, but don't fail if the table isn't created yet
      const fileNames = selectedFiles.map(f => f.name);
      await supabase.from('ai_quiz_generations').insert({
        quiz_id: newQuizId,
        source_files: fileNames,
        ai_model: 'gemini-2.5-flash',
        requested_count: config.count,
        generated_count: approvedQuestions.length,
        generation_duration_ms: generationDuration,
        settings: config,
        created_by: user?.id
      });

      // 3. Insert Questions and Options
      for (let i = 0; i < approvedQuestions.length; i++) {
        const q = approvedQuestions[i];
        
        // Insert Question
        const { data: qData, error: qError } = await supabase
          .from('questions')
          .insert({
            quiz_id: newQuizId,
            question_type: q.type,
            text_en: q.textEn,
            text_ta: q.textTa,
            ai_rubric: q.explanationEn + " | " + q.explanationTa,
            position: i + 1
          })
          .select()
          .single();

        if (qError) throw qError;

        // Insert Options
        const optionsToInsert = q.options.map(o => ({
          question_id: qData.id,
          text_en: o.en,
          text_ta: o.ta,
          is_correct: o.isCorrect
        }));

        const { error: oError } = await supabase
          .from('question_options')
          .insert(optionsToInsert);

        if (oError) throw oError;
      }

      toast.success('Quiz saved successfully!', { id: 'saving' });
      navigate('/admin');
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Error saving quiz', { id: 'saving' });
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center">
          <button 
            onClick={() => {
              if (step === 'REVIEW') setStep('CONFIGURE');
              else if (step === 'CONFIGURE') setStep('UPLOAD');
              else navigate('/admin');
            }}
            className="mr-4 p-2 rounded-full hover:bg-gray-200 text-gray-600 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              <Bot className="mr-3 text-blue-600" size={28} />
              AI Quiz Generator
            </h1>
            <p className="text-sm text-gray-600 mt-1">Upload course materials and let AI generate bilingual quizzes automatically.</p>
          </div>
        </div>
        
        {/* Stepper */}
        <div className="hidden md:flex items-center gap-2">
          <div className={`px-3 py-1 text-sm font-medium rounded-full ${step === 'UPLOAD' ? 'bg-blue-100 text-blue-800' : 'text-gray-500'}`}>1. Upload</div>
          <div className="w-8 h-px bg-gray-300"></div>
          <div className={`px-3 py-1 text-sm font-medium rounded-full ${step === 'CONFIGURE' ? 'bg-blue-100 text-blue-800' : 'text-gray-500'}`}>2. Configure</div>
          <div className="w-8 h-px bg-gray-300"></div>
          <div className={`px-3 py-1 text-sm font-medium rounded-full ${step === 'REVIEW' ? 'bg-blue-100 text-blue-800' : 'text-gray-500'}`}>3. Review</div>
        </div>
      </div>

      <div className="mt-8">
        {step === 'UPLOAD' && (
          <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Step 1: Upload Knowledge Source</h3>
            <PdfUploader onFilesSelected={handleFilesSelected} maxFiles={5} maxSizeMB={20} />
            <div className="mt-8 flex justify-end">
              <button
                onClick={proceedToConfig}
                disabled={selectedFiles.length === 0}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Next: Configure Quiz
              </button>
            </div>
          </div>
        )}

        {step === 'CONFIGURE' && (
          <div className="max-w-3xl mx-auto">
             <ConfigurationForm onGenerate={handleGenerate} isGenerating={isGenerating} />
          </div>
        )}

        {step === 'REVIEW' && (
          <ReviewScreen 
            questions={generatedQuestions} 
            onSave={handleSaveQuiz} 
            onCancel={() => setStep('CONFIGURE')} 
          />
        )}
      </div>
    </div>
  );
};
