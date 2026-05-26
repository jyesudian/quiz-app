import { useState, useEffect } from 'react';
import { ChevronRight, Plus, Languages, BrainCircuit, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import { translateText } from '../utils/translate';
import type { QuizSeries, Question, QuestionOption } from '../types';

export const CreateQuiz = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isBilingual] = useState(true);
  const [seriesData, setSeriesData] = useState<QuizSeries[]>([]);
  const [seriesSelection, setSeriesSelection] = useState<string>('new');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [newGroupName, setNewGroupName] = useState('Adult Sunday School');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [quizTitle, setQuizTitle] = useState('');

  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const { data: seriesList } = await supabase.from('quiz_series').select('*');
        if (seriesList) setSeriesData(seriesList as any[]);

        if (id) {
          const { data: quizData } = await supabase.from('quizzes').select('*').eq('id', id).single();
          if (quizData) {
            setQuizTitle(quizData.title);
            setSeriesSelection(quizData.series_id.toString());
          }

          const { data: questionsData } = await supabase
            .from('questions')
            .select(`*, question_options(*)`)
            .eq('quiz_id', id)
            .order('position', { ascending: true });

          if (questionsData) {
            const mappedQuestions = questionsData.map((q: any) => ({
              id: q.id,
              type: q.question_type,
              textEn: q.text_en,
              textTa: q.text_ta || '',
              aiRubric: q.ai_rubric || '',
              options: (q.question_options || []).map((opt: any) => ({
                id: opt.id,
                en: opt.text_en,
                ta: opt.text_ta || '',
                isCorrect: opt.is_correct || false
              }))
            }));
            setQuestions(mappedQuestions);
          }
        } else {
          setQuestions([{ id: Date.now(), type: 'single', textEn: '', textTa: '', options: [{ en: '', ta: '', isCorrect: false }], aiRubric: '' }]);
        }
      } catch (err: any) {
        toast.error('Failed to load quiz data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchInitialData();
  }, [id]);

  const addQuestion = () => setQuestions([...questions, { id: Date.now(), type: 'single', textEn: '', textTa: '', options: [{ en: '', ta: '', isCorrect: false }], aiRubric: '' }]);
  
  const addOption = (qIndex: number) => { 
    const newQs = [...questions]; 
    newQs[qIndex].options.push({ en: '', ta: '', isCorrect: false }); 
    setQuestions(newQs); 
  };

  const handleAutoTranslate = async (qIndex: number) => {
    const q = questions[qIndex];
    if (!q.textEn || !q.textEn.trim()) {
      toast.error('Please enter the question text in English first.');
      return;
    }

    try {
      const translatedQuestion = await translateText(q.textEn);
      let translatedOptions = [...q.options];
      
      if (q.type === 'single' || q.type === 'multiple') {
        translatedOptions = await Promise.all(
          q.options.map(async (opt: QuestionOption) => {
            if (opt.en && opt.en.trim()) {
              const translatedOpt = await translateText(opt.en);
              return { ...opt, ta: translatedOpt };
            }
            return opt;
          })
        );
      }

      setQuestions((prevQuestions) => {
        const newQs = [...prevQuestions];
        newQs[qIndex] = {
          ...newQs[qIndex],
          textTa: translatedQuestion,
          options: translatedOptions,
        };
        return newQs;
      });
    } catch (err: any) {
      toast.error('Translation failed');
    }
  };

  const handleSave = async (status: 'draft' | 'published') => {
    if (!quizTitle.trim()) {
      toast.error('Please enter a quiz title.');
      return;
    }

    // Validate that single and multiple choice questions have at least one correct option selected
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.type === 'single' || q.type === 'multiple') {
        console.log(`Validating Question ${i + 1} (${q.type}):`, q.options);
        const hasCorrect = q.options.some(opt => opt.isCorrect);
        console.log(`Question ${i + 1} hasCorrect:`, hasCorrect);
        if (!hasCorrect) {
          toast.error(`Question ${i + 1} (${q.type === 'single' ? 'Single Choice' : 'Multiple Choice'}) must have at least one correct answer marked.`);
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      let seriesId: number;

      if (seriesSelection === 'new') {
        if (!newSeriesName.trim()) throw new Error('Please enter a series name.');
        const { data: newSeries, error: seriesError } = await supabase
          .from('quiz_series')
          .insert({
            title: newSeriesName,
            group_name: newGroupName,
            is_bilingual: isBilingual,
            requires_approval: requiresApproval,
            is_frozen: false
          })
          .select().single();

        if (seriesError) throw seriesError;
        seriesId = newSeries.id;
      } else {
        seriesId = parseInt(seriesSelection);
      }

      let quizId: number;

      if (id) {
        quizId = parseInt(id);
        const { error: quizUpdateError } = await supabase.from('quizzes').update({ series_id: seriesId, title: quizTitle, status: status }).eq('id', quizId);
        if (quizUpdateError) throw quizUpdateError;
        await supabase.from('questions').delete().eq('quiz_id', quizId);
      } else {
        const { data: newQuiz, error: quizInsertError } = await supabase.from('quizzes').insert({ series_id: seriesId, title: quizTitle, status: status }).select().single();
        if (quizInsertError) throw quizInsertError;
        quizId = newQuiz.id;
      }

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const { data: insertedQuestion, error: qError } = await supabase.from('questions').insert({
          quiz_id: quizId,
          question_type: q.type,
          text_en: q.textEn,
          text_ta: q.textTa || null,
          ai_rubric: q.aiRubric || null,
          position: i + 1
        }).select().single();

        if (qError) throw qError;

        if (q.type === 'single' || q.type === 'multiple') {
          const optionsToInsert = q.options.map((opt: any) => ({
            question_id: insertedQuestion.id,
            text_en: opt.en,
            text_ta: opt.ta || null,
            is_correct: opt.isCorrect || false
          }));
          const { error: optError } = await supabase.from('question_options').insert(optionsToInsert);
          if (optError) throw optError;
        }
      }

      toast.success(id ? 'Quiz updated successfully!' : 'Quiz created successfully!');
      navigate('/admin');
    } catch (err: any) {
      toast.error('Failed to save quiz: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="text-center py-8">Loading quiz data...</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => navigate('/admin')} className="text-blue-600 hover:underline flex items-center text-sm font-medium">
          <ChevronRight className="rotate-180 w-4 h-4 mr-1" /> Back to Dashboard
        </button>
        <div className="space-x-3">
          <button disabled={isSaving} onClick={() => handleSave('draft')} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            {isSaving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button disabled={isSaving} onClick={() => handleSave('published')} className="px-4 py-2 bg-blue-800 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-900">
            {isSaving ? 'Saving...' : id ? 'Update Quiz' : 'Publish Quiz'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-blue-50 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Quiz Title (English)</label>
            <input type="text" value={quizTitle} onChange={(e) => setQuizTitle(e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2" placeholder="e.g. Revelation Chapter 1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Add to Series</label>
            <select className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2 mb-3" value={seriesSelection} onChange={(e) => setSeriesSelection(e.target.value)}>
              <option value="new">Create New Series...</option>
              {seriesData.map((s: any) => <option key={s.id} value={s.id.toString()}>{s.title}</option>)}
            </select>
          </div>
        </div>
        
        {seriesSelection === 'new' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-bold text-gray-900 mb-3">New Series Settings</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Series Name</label>
                <input type="text" className="w-full border-gray-300 rounded text-sm border p-2" value={newSeriesName} onChange={(e) => setNewSeriesName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Group Name</label>
                <input type="text" className="w-full border-gray-300 rounded text-sm border p-2" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
              </div>
              <div>
                 <label className="flex items-center space-x-2 mt-6">
                   <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4" />
                   <span className="text-sm font-medium text-gray-700">Require Approval</span>
                 </label>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {questions.map((q, qIndex) => (
          <div key={q.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex justify-between items-center">
              <span className="font-bold text-gray-700">Question {qIndex + 1}</span>
              <div className="flex space-x-4 items-center">
                <select className="text-sm border-gray-300 rounded border p-1" value={q.type} onChange={(e) => {
                  const newQs = [...questions];
                  newQs[qIndex].type = e.target.value as any;
                  if (e.target.value === 'text') newQs[qIndex].options = [];
                  else if (newQs[qIndex].options.length === 0) newQs[qIndex].options = [{ en: '', ta: '', isCorrect: false }];
                  setQuestions(newQs);
                }}>
                  <option value="single">Single Choice</option>
                  <option value="multiple">Multiple Choice</option>
                  <option value="text">Text Entry (AI Graded)</option>
                </select>
                <button type="button" onClick={() => setQuestions(questions.filter((_, idx) => idx !== qIndex))} className="text-red-500"><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">English Text</label>
                  <textarea className="w-full border-gray-300 rounded-md border p-3" rows={2} value={q.textEn} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].textEn = e.target.value; setQuestions(newQs); }}></textarea>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex justify-between items-center">
                    <span>Tamil Text (தமிழ்)</span>
                    <button type="button" onClick={() => handleAutoTranslate(qIndex)} className="text-blue-600 flex items-center bg-blue-50 px-2 py-0.5 rounded text-xs"><Languages size={12} className="mr-1"/> Auto-Translate</button>
                  </label>
                  <textarea className="w-full border-gray-300 rounded-md border p-3 bg-slate-50" rows={2} value={q.textTa} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].textTa = e.target.value; setQuestions(newQs); }}></textarea>
                </div>
              </div>

              {q.type === 'text' && (
                <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <label className="block text-sm font-bold text-amber-900 mb-2 flex items-center"><BrainCircuit size={16} className="mr-2"/> AI Grading Rubric</label>
                  <textarea className="w-full border-amber-300 rounded-md shadow-sm border p-3" rows={2} value={q.aiRubric} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].aiRubric = e.target.value; setQuestions(newQs); }}></textarea>
                </div>
              )}

              {(q.type === 'single' || q.type === 'multiple') && (
                <div className="space-y-4 pl-4 border-l-2 border-gray-100">
                  {q.options.map((opt, oIndex) => (
                    <div key={oIndex} className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-1 text-center">
                          <input type={q.type === 'single' ? 'radio' : 'checkbox'} name={`q-${q.id}`} checked={opt.isCorrect} onChange={(e) => {
                              const newQs = [...questions];
                              if (q.type === 'single') {
                                newQs[qIndex].options = newQs[qIndex].options.map((o, idx) => ({ ...o, isCorrect: idx === oIndex }));
                              } else {
                                newQs[qIndex].options[oIndex].isCorrect = e.target.checked;
                              }
                              setQuestions(newQs);
                            }} className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="col-span-5"><input type="text" className="w-full border-gray-300 rounded text-sm border p-2" placeholder="Option (EN)" value={opt.en} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].options[oIndex].en = e.target.value; setQuestions(newQs); }} /></div>
                        <div className="col-span-5"><input type="text" className="w-full border-gray-300 rounded text-sm border p-2 bg-slate-50" placeholder="Option (TA)" value={opt.ta} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].options[oIndex].ta = e.target.value; setQuestions(newQs); }} /></div>
                        <div className="col-span-1 text-center"><button type="button" onClick={() => { const newQs = [...questions]; newQs[qIndex].options = newQs[qIndex].options.filter((_, idx) => idx !== oIndex); setQuestions(newQs); }} className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button></div>
                    </div>
                  ))}
                  <button type="button" onClick={() => addOption(qIndex)} className="text-xs text-blue-600 font-bold flex items-center hover:bg-blue-50 px-2 py-1 rounded">
                    <Plus size={14} className="mr-1" /> Add Option
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={addQuestion} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-bold hover:bg-gray-50 hover:text-blue-600 transition-all flex items-center justify-center">
          <Plus size={20} className="mr-2" /> Add Another Question
        </button>
      </div>
    </div>
  );
};
