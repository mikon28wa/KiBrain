export const AI_NOTICE =
  'Brain is a storage for AI conversation histories. Contents originate from AI interactions.';

export function AiNotice() {
  return (
    <p className="ai-notice" data-testid="ai-notice">
      {AI_NOTICE}
    </p>
  );
}
