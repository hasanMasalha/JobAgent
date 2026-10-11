// The key a saved answer (EasyApplyAnswer) is matched by: the question
// lower-cased, whitespace collapsed, trailing spaces and asterisks dropped.
// Must match the AI service's normalize() (ai-service/application_answers.py),
// which is how the fillers look a saved answer up.
export function questionKey(question: string): string {
  return question.toLowerCase().split(/\s+/).filter(Boolean).join(" ").replace(/[ *]+$/, "");
}
