import { useState, useCallback } from 'react';
import { UploadCloud, File, X, AlertCircle } from 'lucide-react';

interface PdfUploaderProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
}

export const PdfUploader = ({ onFilesSelected, maxFiles = 5, maxSizeMB = 10 }: PdfUploaderProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const validateFiles = (files: File[]): File[] => {
    const validFiles: File[] = [];
    setError(null);
    
    if (selectedFiles.length + files.length > maxFiles) {
      setError(`You can only upload up to ${maxFiles} files.`);
      return [];
    }

    for (const file of files) {
      if (file.type !== 'application/pdf') {
        setError(`File "${file.name}" is not a PDF.`);
        continue;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        setError(`File "${file.name}" exceeds the ${maxSizeMB}MB limit.`);
        continue;
      }
      validFiles.push(file);
    }
    
    return validFiles;
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = validateFiles(files);
    
    if (validFiles.length > 0) {
      const newFiles = [...selectedFiles, ...validFiles];
      setSelectedFiles(newFiles);
      onFilesSelected(newFiles);
    }
  }, [selectedFiles, maxFiles, maxSizeMB, onFilesSelected]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const validFiles = validateFiles(files);
      
      if (validFiles.length > 0) {
        const newFiles = [...selectedFiles, ...validFiles];
        setSelectedFiles(newFiles);
        onFilesSelected(newFiles);
      }
    }
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    onFilesSelected(newFiles);
  };

  return (
    <div className="w-full">
      <div 
        className="border-2 border-dashed border-blue-300 rounded-lg p-10 flex flex-col items-center justify-center text-center bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => document.getElementById('pdf-upload')?.click()}
      >
        <UploadCloud size={48} className="text-blue-500 mb-4" />
        <h3 className="text-lg font-semibold text-blue-900">Drag & Drop PDFs here</h3>
        <p className="text-sm text-blue-600 mt-2">or click to browse files</p>
        <p className="text-xs text-blue-400 mt-1">Max {maxFiles} files, {maxSizeMB}MB each</p>
        <input 
          id="pdf-upload" 
          type="file" 
          accept=".pdf" 
          multiple 
          className="hidden" 
          onChange={handleFileInput}
        />
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded flex items-start">
          <AlertCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Selected Files</h4>
          <ul className="space-y-2">
            {selectedFiles.map((file, idx) => (
              <li key={idx} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md shadow-sm">
                <div className="flex items-center overflow-hidden">
                  <File size={20} className="text-red-500 mr-3 flex-shrink-0" />
                  <span className="text-sm text-gray-800 truncate">{file.name}</span>
                  <span className="text-xs text-gray-500 ml-3">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
