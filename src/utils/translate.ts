export const translateText = async (text: string): Promise<string> => {
  if (!text || !text.trim()) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ta&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Translation request failed');
    const data = await res.json();
    if (data && data[0]) {
      return data[0].map((part: any) => part[0] || '').join('');
    }
    return '';
  } catch (err) {
    console.error('Translation error:', err);
    throw err;
  }
};
