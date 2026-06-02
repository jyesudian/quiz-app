export interface UserProfile {
  id: string;
  name: string;
  role: 'student' | 'admin';
}

export interface QuizSeries {
  id: number;
  title: string;
  group: string;
  totalQuizzes: number;
  isBilingual: boolean;
  requiresApproval: boolean;
  isFrozen: boolean;
  enrolled: string[];
  isPending?: boolean;
  quizzes?: { id: number; title: string; isAttempted?: boolean }[];
}

export interface Quiz {
  id: number;
  seriesId: number;
  title: string;
  status: 'draft' | 'published';
}

export interface EnrollmentRequest {
  id: number;
  studentName: string;
  seriesId: number;
  seriesName: string;
  date: string;
}

export interface QuestionOption {
  id?: number | string;
  en: string;
  ta: string;
  isCorrect: boolean;
  matchEn?: string;
  matchTa?: string;
}

export interface Question {
  id: number | string;
  type: 'single' | 'multiple' | 'text' | 'match' | 'picture';
  textEn: string;
  textTa: string;
  aiRubric: string;
  options: QuestionOption[];
  leftItems?: { id?: number | string; en: string; ta: string }[];
  rightItems?: { id?: number | string; en: string; ta: string }[];
  imageUrl?: string;
}
