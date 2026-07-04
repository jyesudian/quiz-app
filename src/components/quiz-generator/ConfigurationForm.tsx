import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import type { QuizSeries } from '../../types';

export interface GenerationConfig {
  title: string;
  seriesId: string;
  count: number;
  type: string;
  difficulty: string;
  bloomTaxonomy: string;
  newSeriesName?: string;
  newGroupName?: string;
  newIsBilingual?: boolean;
  newRequiresApproval?: boolean;
}

interface ConfigurationFormProps {
  onGenerate: (config: GenerationConfig) => void;
  isGenerating: boolean;
}

export const ConfigurationForm = ({ onGenerate, isGenerating }: ConfigurationFormProps) => {
  const [seriesList, setSeriesList] = useState<QuizSeries[]>([]);
  const [config, setConfig] = useState<GenerationConfig>({
    title: '',
    seriesId: '',
    count: 10,
    type: 'Mixed',
    difficulty: 'Medium',
    bloomTaxonomy: 'Mixed',
    newSeriesName: '',
    newGroupName: '',
    newIsBilingual: false,
    newRequiresApproval: true
  });

  useEffect(() => {
    const fetchSeries = async () => {
      const { data, error } = await supabase
        .from('quiz_series')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!error && data) {
        setSeriesList(data);
        if (data.length > 0) {
          setConfig(prev => ({ ...prev, seriesId: data[0].id.toString() }));
        }
      }
    };
    fetchSeries();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate(config);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h3 className="text-lg font-bold text-gray-900 mb-6 border-b pb-2">Quiz Settings</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="col-span-1 md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Quiz Title</label>
          <input 
            type="text" 
            required
            value={config.title}
            onChange={(e) => setConfig({...config, title: e.target.value})}
            className="w-full p-2.5 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g. History Chapter 1 Quiz"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Add to Series</label>
          <select 
            required
            value={config.seriesId}
            onChange={(e) => setConfig({...config, seriesId: e.target.value})}
            className="w-full p-2.5 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="" disabled>Select Series</option>
            {seriesList.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
            <option value="new">+ Create New Series...</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Number of Questions (1 - 50)</label>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setConfig({ ...config, count: Math.max(1, config.count - 1) })}
              className="px-3.5 py-2 border border-gray-300 rounded-l-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-colors"
            >
              -
            </button>
            <input
              type="number"
              min={1}
              max={50}
              value={config.count === 0 ? '' : config.count}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                  setConfig({ ...config, count: val });
                } else {
                  setConfig({ ...config, count: 0 });
                }
              }}
              onBlur={() => {
                const val = Math.min(50, Math.max(1, config.count || 1));
                setConfig({ ...config, count: val });
              }}
              className="w-full p-2 bg-gray-50 border-t border-b border-gray-300 text-center text-gray-900 text-sm focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setConfig({ ...config, count: Math.min(50, config.count + 1) })}
              className="px-3.5 py-2 border border-gray-300 rounded-r-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {config.seriesId === 'new' && (
          <div className="col-span-1 md:col-span-2 p-4 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-4">
            <h4 className="text-sm font-bold text-gray-900 col-span-1 md:col-span-2">New Series Settings</h4>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Series Name *</label>
              <input 
                type="text" 
                required={config.seriesId === 'new'}
                value={config.newSeriesName} 
                onChange={(e) => setConfig({...config, newSeriesName: e.target.value})}
                placeholder="e.g. Science Part 1"
                className="w-full border border-gray-300 rounded-md text-sm p-2 bg-white" 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Group Name</label>
              <input 
                type="text" 
                value={config.newGroupName} 
                onChange={(e) => setConfig({...config, newGroupName: e.target.value})}
                placeholder="e.g. Batch A"
                className="w-full border border-gray-300 rounded-md text-sm p-2 bg-white" 
              />
            </div>
            <div className="flex items-center space-x-6 col-span-1 md:col-span-2 mt-2">
              <label className="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  checked={config.newRequiresApproval} 
                  onChange={(e) => setConfig({...config, newRequiresApproval: e.target.checked})}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4" 
                />
                <span className="text-sm font-medium text-gray-700">Require Approval</span>
              </label>
              <label className="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  checked={config.newIsBilingual} 
                  onChange={(e) => setConfig({...config, newIsBilingual: e.target.checked})}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4" 
                />
                <span className="text-sm font-medium text-gray-700">Bilingual Support (Tamil)</span>
              </label>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Question Type</label>
          <select 
            value={config.type}
            onChange={(e) => setConfig({...config, type: e.target.value})}
            className="w-full p-2.5 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="single">Single Choice Only</option>
            <option value="multiple">Multiple Choice Only</option>
            <option value="Mixed">Mixed</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
          <select 
            value={config.difficulty}
            onChange={(e) => setConfig({...config, difficulty: e.target.value})}
            className="w-full p-2.5 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
            <option value="Mixed">Mixed</option>
          </select>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="submit"
          disabled={isGenerating || !config.seriesId || !config.title || (config.seriesId === 'new' && !config.newSeriesName?.trim())}
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center shadow-sm"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing PDF & Generating Quiz...
            </>
          ) : (
            'Generate Questions with AI'
          )}
        </button>
      </div>
    </form>
  );
};
