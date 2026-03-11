/**
 * Shared stop-words set used by observation.ts and procedural.ts
 * for tag extraction and keyword filtering.
 */
export const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as',
  'into', 'through', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
  'and', 'or', 'but', 'if', 'then', 'that', 'this', 'it', 'its',
  'i', 'we', 'you', 'he', 'she', 'they', 'them', 'their', 'our', 'my',
  'so', 'than', 'when', 'where', 'who', 'which', 'what', 'how', 'why',
  'not', 'no', 'all', 'each', 'both', 'few', 'more', 'other', 'some',
  'such', 'only', 'own', 'same', 'also', 'just', 'now', 'very', 'too',
  // Korean particles
  '은', '는', '이', '가', '을', '를', '의', '에', '에서', '로', '으로',
  '와', '과', '도', '만', '가', '께', '한테', '에게', '부터', '까지',
  '이다', '입니다', '있다', '없다', '이라', '이면', '라면', '같은',
]);
