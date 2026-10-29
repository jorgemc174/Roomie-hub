export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <section className="ui-loading" role="status" aria-busy="true">
      <p className="ui-loading-label">
        <span className="ui-spinner" aria-hidden="true" />
        {label}
      </p>
      <div className="ui-skeleton-heading" aria-hidden="true" />
      <div className="ui-skeleton-grid" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="ui-skeleton-card" key={i}>
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </section>
  );
}
