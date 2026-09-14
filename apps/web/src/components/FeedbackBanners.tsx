interface FeedbackBannersProps {
  error?: string;
  notice?: string;
}
export function FeedbackBanners({ error, notice }: FeedbackBannersProps) {
  return (
    <>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
    </>
  );
}
