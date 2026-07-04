import { useState } from 'react';
import { Edit2, Trash2, CheckCircle2, Save, X } from 'lucide-react';
import type { AiGeneratedQuestion } from '../../types';

interface ReviewScreenProps {
  questions: AiGeneratedQuestion[];
  onSave: (questions: AiGeneratedQuestion[]) => void;
  onCancel: () => void;
}

export const ReviewScreen = ({ questions: initialQuestions, onSave, onCancel }: ReviewScreenProps) => {
  const [questions, setQuestions] = useState<AiGeneratedQuestion[]>(initialQuestions);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleQuestionChange = (id: string, field: keyof AiGeneratedQuestion, value: any) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const handleOptionChange = (qId: string, optIndex: number, field: string, value: any) => {
    setQuestions(questions.map(q => {
      if (q.id !== qId) return q;
      const newOptions = [...q.options];
      
      // If it's a single choice question and we are setting an option to correct, uncheck others
      if (field === 'isCorrect' && value === true && q.type === 'single') {
        newOptions.forEach(o => o.isCorrect = false);
      }
      
      newOptions[optIndex] = { ...newOptions[optIndex], [field]: value };
      return { ...q, options: newOptions };
    }));
  };

  const removeQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Review Generated Quiz</h2>
          <p className="text-sm text-gray-600 mt-1">Review, edit, and approve {questions.length} questions before saving.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(questions)}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors flex items-center shadow-sm"
          >
            <Save size={18} className="mr-2" />
            Approve & Save Quiz
          </button>
        </div>
      </div>

      <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto bg-gray-50/30">
        {questions.map((q, index) => (
          <div key={q.id} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm transition-all hover:shadow-md relative group">
            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
               <button 
                onClick={() => setEditingId(editingId === q.id ? null : q.id)}
                className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                title="Edit Question"
              >
                {editingId === q.id ? <X size={16} /> : <Edit2 size={16} />}
              </button>
              <button 
                onClick={() => removeQuestion(q.id)}
                className="p-1.5 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors"
                title="Delete Question"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="flex items-start gap-4 mb-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-sm">
                {index + 1}
              </span>
              <div className="flex-grow">
                {editingId === q.id ? (
                  <div className="space-y-3">
                    <input 
                      className="w-full p-2 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm font-medium"
                      value={q.textEn}
                      onChange={(e) => handleQuestionChange(q.id, 'textEn', e.target.value)}
                      placeholder="Question in English"
                    />
                    <input 
                      className="w-full p-2 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm font-medium font-tamil"
                      value={q.textTa}
                      onChange={(e) => handleQuestionChange(q.id, 'textTa', e.target.value)}
                      placeholder="Question in Tamil"
                      dir="auto"
                    />
                  </div>
                ) : (
                  <div>
                    <h4 className="text-base font-semibold text-gray-900">{q.textEn}</h4>
                    {q.textTa && <h4 className="text-base font-semibold text-gray-700 font-tamil mt-1">{q.textTa}</h4>}
                  </div>
                )}
                
                <div className="flex gap-2 mt-2">
                  <span className="inline-block px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">{q.type}</span>
                  {q.difficulty && <span className="inline-block px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-full">{q.difficulty}</span>}
                  {q.topic && <span className="inline-block px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full">{q.topic}</span>}
                </div>
              </div>
            </div>

            <div className="ml-12 grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {q.options.map((opt, oIdx) => (
                <div 
                  key={oIdx} 
                  className={`p-3 rounded border ${opt.isCorrect ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex items-start gap-3">
                    {editingId === q.id ? (
                      <input 
                        type={q.type === 'single' ? 'radio' : 'checkbox'}
                        name={`correct-${q.id}`}
                        checked={opt.isCorrect}
                        onChange={(e) => handleOptionChange(q.id, oIdx, 'isCorrect', e.target.checked)}
                        className="mt-1"
                      />
                    ) : (
                      opt.isCorrect ? <CheckCircle2 size={18} className="text-green-500 mt-0.5 flex-shrink-0" /> : <div className="w-[18px] h-[18px] mt-0.5 border border-gray-300 rounded-full flex-shrink-0"></div>
                    )}
                    
                    <div className="flex-grow">
                      {editingId === q.id ? (
                        <div className="space-y-2">
                          <input 
                            className="w-full p-1 border rounded text-sm"
                            value={opt.en}
                            onChange={(e) => handleOptionChange(q.id, oIdx, 'en', e.target.value)}
                          />
                          <input 
                            className="w-full p-1 border rounded text-sm font-tamil"
                            value={opt.ta}
                            onChange={(e) => handleOptionChange(q.id, oIdx, 'ta', e.target.value)}
                            dir="auto"
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm text-gray-800">{opt.en}</p>
                          {opt.ta && <p className="text-sm text-gray-600 font-tamil mt-0.5">{opt.ta}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {(q.explanationEn || editingId === q.id) && (
              <div className="ml-12 mt-4 p-3 bg-blue-50/50 border border-blue-100 rounded text-sm">
                <span className="font-semibold text-blue-800 text-xs uppercase tracking-wider mb-1 block">Explanation</span>
                {editingId === q.id ? (
                   <div className="space-y-2">
                     <textarea 
                       className="w-full p-2 border rounded text-sm"
                       value={q.explanationEn || ''}
                       onChange={(e) => handleQuestionChange(q.id, 'explanationEn', e.target.value)}
                       placeholder="Explanation in English"
                       rows={2}
                     />
                     <textarea 
                       className="w-full p-2 border rounded text-sm font-tamil"
                       value={q.explanationTa || ''}
                       onChange={(e) => handleQuestionChange(q.id, 'explanationTa', e.target.value)}
                       placeholder="Explanation in Tamil"
                       rows={2}
                       dir="auto"
                     />
                   </div>
                ) : (
                  <>
                    <p className="text-blue-900">{q.explanationEn}</p>
                    {q.explanationTa && <p className="text-blue-800 font-tamil mt-1 opacity-80">{q.explanationTa}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
