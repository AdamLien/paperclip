/** The same product identity across sign-in and first-run setup. */
export function MdeckBrand() {
  return (
    <div className="morbit-auth-mark" aria-label="metabiz mDeck">
      <img src="/mdeck-app.png" alt="" width="48" height="48" />
      <strong aria-hidden="true">mDeck</strong>
    </div>
  );
}
